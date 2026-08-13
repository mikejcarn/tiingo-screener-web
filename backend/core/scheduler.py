"""Background scheduler that runs the Pipeline page's run queue on a clock.

One global schedule (the pipeline_schedule singleton row) governs whatever
pipelines currently have queued_for_run=1 — the same set the manual ▶ Run
button on the Pipeline page runs, in the same order (by id). There is no
per-pipeline schedule; queuing a pipeline for the run card is what decides
it participates in scheduled runs too.

Runs in-process alongside the FastAPI app (started from main.py's startup event).
Reuses the same fetch/indicators/scan logic the manual ▶ Run button drives on the
Pipeline page — this module only adds the clock-triggered glue around it, so
scheduled and manual runs share the exact same underlying fetch/indicator/scan
code paths and only collide (rather than corrupt state) if they overlap.
"""
import asyncio
import json
from datetime import datetime

from fastapi import HTTPException
from starlette.background import BackgroundTasks
from starlette.concurrency import run_in_threadpool

from backend.core import database as db
from backend.core import job_state
from backend.routers import fetch as fetch_router
from backend.routers import indicators_router
from backend.routers import scanner as scanner_router

_TICK_SECONDS = 30


async def scheduler_loop() -> None:
    while True:
        try:
            await _check_and_fire_schedules()
        except Exception as e:
            print(f"scheduler tick error: {e}")
        await asyncio.sleep(_TICK_SECONDS)


async def _check_and_fire_schedules() -> None:
    now = datetime.now()
    hhmm = now.strftime("%H:%M")
    today = now.strftime("%Y-%m-%d")
    weekday = now.weekday()  # 0=Monday .. 6=Sunday

    with db._conn() as con:
        row = con.execute(
            "SELECT enabled, days, time, last_run FROM pipeline_schedule WHERE id=1"
        ).fetchone()
    if not row:
        return
    enabled, days_json, sched_time, last_run = row
    if not enabled or sched_time != hhmm or last_run == today:
        return
    if weekday not in json.loads(days_json or "[]"):
        return

    with db._conn() as con:
        # Mark last_run before the run finishes so a slow run (or the next tick,
        # if it lands before this one completes) can't fire the same schedule twice.
        con.execute("UPDATE pipeline_schedule SET last_run=? WHERE id=1", (today,))
        queued_ids = [r[0] for r in con.execute(
            "SELECT id FROM pipeline_configs WHERE queued_for_run=1 ORDER BY id"
        ).fetchall()]
    if queued_ids:
        asyncio.create_task(_run_queue_sequential(queued_ids))


async def _run_queue_sequential(config_ids: list) -> None:
    # Sequential, not parallel — fetch/indicators share a single global job
    # slot each (job_state), so overlapping runs would collide with each
    # other, the same reason the manual ▶ Run button runs one at a time too.
    for config_id in config_ids:
        await run_pipeline_scheduled(config_id)


async def run_pipeline_scheduled(config_id: int) -> None:
    with db._conn() as con:
        row = con.execute(
            "SELECT name, ticker_conf_id, ind_conf_id, scan_config_id "
            "FROM pipeline_configs WHERE id=?", (config_id,)
        ).fetchone()
    if not row:
        return
    name, ticker_conf_id, ind_conf_id, scan_config_id = row

    def _log(status, fetch_tickers=0, fetch_errors=0, ind_tickers=0, ind_errors=0, scan_run_id=None):
        db.log_pipeline_run(config_id, name, status,
                             fetch_tickers=fetch_tickers, fetch_errors=fetch_errors,
                             ind_tickers=ind_tickers, ind_errors=ind_errors, scan_run_id=scan_run_id)

    if not ticker_conf_id:
        _log("error")
        return
    with db._conn() as con:
        tc = con.execute(
            "SELECT ticker_list, timeframes FROM ticker_configs WHERE id=?", (ticker_conf_id,)
        ).fetchone()
    if not tc or not tc[0]:
        _log("error")
        return
    ticker_list = tc[0]
    timeframes = json.loads(tc[1] or "[]")
    if not timeframes:
        _log("error")
        return

    jobs = job_state.get_all()
    if jobs["fetch"]["status"] == "running" or jobs["indicators"]["status"] == "running":
        # A manual run (or another schedule) is already using the shared fetch/
        # indicators job slots — skip this fire rather than collide with it.
        _log("error")
        return

    # ── Fetch stage ──
    bg = BackgroundTasks()
    try:
        fetch_router.fetch_batch(
            fetch_router.BatchFetchRequest(ticker_list=ticker_list, timeframes=timeframes), bg
        )
    except HTTPException:
        _log("error")
        return
    await bg()
    fetch_state = job_state.get_all()["fetch"]
    fetch_tickers, fetch_errors = fetch_state["done"], fetch_state["errors"]
    if fetch_state["status"] != "done":
        _log("error", fetch_tickers=fetch_tickers, fetch_errors=fetch_errors)
        return

    # ── Indicators stage ──
    if not ind_conf_id:
        _log("done", fetch_tickers=fetch_tickers, fetch_errors=fetch_errors)
        return
    bg2 = BackgroundTasks()
    try:
        indicators_router.compute_indicators_batch(
            indicators_router.BatchIndicatorsRequest(config_id=ind_conf_id, ticker_list=ticker_list), bg2
        )
    except HTTPException:
        _log("error", fetch_tickers=fetch_tickers, fetch_errors=fetch_errors)
        return
    await bg2()
    ind_state = job_state.get_all()["indicators"]
    ind_tickers, ind_errors = ind_state["done"], ind_state["errors"]
    if ind_state["status"] != "done":
        _log("error", fetch_tickers=fetch_tickers, fetch_errors=fetch_errors,
             ind_tickers=ind_tickers, ind_errors=ind_errors)
        return

    # ── Scan stage ──
    if not scan_config_id:
        _log("done", fetch_tickers=fetch_tickers, fetch_errors=fetch_errors,
             ind_tickers=ind_tickers, ind_errors=ind_errors)
        return
    try:
        data = await run_in_threadpool(
            scanner_router.run_scan,
            scanner_router.RunScanRequest(config_id=scan_config_id, scope_ticker_list=ticker_list),
        )
    except HTTPException:
        _log("error", fetch_tickers=fetch_tickers, fetch_errors=fetch_errors,
             ind_tickers=ind_tickers, ind_errors=ind_errors)
        return
    _log("done", fetch_tickers=fetch_tickers, fetch_errors=fetch_errors,
         ind_tickers=ind_tickers, ind_errors=ind_errors, scan_run_id=data["run_id"])
