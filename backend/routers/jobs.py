from pathlib import Path
import pandas as pd
from fastapi import APIRouter, HTTPException

from backend.core import job_state
from backend.core import database as db

router = APIRouter(prefix="/api")

TICKER_LISTS_DIR = Path(__file__).parent.parent / "tickers" / "ticker_lists"


@router.get("/jobs/status")
def jobs_status():
    return job_state.get_all()


@router.post("/jobs/{job}/cancel")
def cancel_job(job: str):
    if job not in ('fetch', 'indicators'):
        raise HTTPException(status_code=400, detail="Unknown job")
    if job_state.get_all()[job]['status'] != 'running':
        raise HTTPException(status_code=409, detail="Job is not running")
    job_state.cancel(job)
    return {"status": "cancelling"}


@router.get("/ticker-lists")
def ticker_lists():
    lists = []
    for f in sorted(TICKER_LISTS_DIR.glob("*.csv")):
        try:
            df = pd.read_csv(f)
            lists.append({"name": f.stem, "count": len(df)})
        except Exception:
            lists.append({"name": f.stem, "count": 0})
    return {"lists": lists}


@router.get("/stats")
def stats():
    with db._conn() as con:
        rows = con.execute("""
            SELECT o.ticker, o.timeframe,
                   COUNT(*)    AS rows,
                   MAX(o.date) AS last_date,
                   f.fetched_at,
                   f.ticker_list
            FROM ohlcv o
            LEFT JOIN fetch_log f
              ON o.ticker = f.ticker AND o.timeframe = f.timeframe
            GROUP BY o.ticker, o.timeframe
            ORDER BY o.ticker, o.timeframe
        """).fetchall()
        summary = con.execute("""
            SELECT timeframe,
                   COUNT(DISTINCT ticker) AS tickers,
                   COUNT(*)               AS rows,
                   MIN(date)              AS first_date,
                   MAX(date)              AS last_date
            FROM ohlcv
            GROUP BY timeframe
            ORDER BY timeframe
        """).fetchall()
    return {
        "summary": [
            {"timeframe": r[0], "tickers": r[1], "rows": r[2],
             "first_date": r[3], "last_date": r[4]}
            for r in summary
        ],
        "stats": [
            {"ticker": r[0], "timeframe": r[1], "rows": r[2],
             "last_date": r[3], "fetched_at": (r[4] or '')[:10],
             "ticker_list": r[5] or ''}
            for r in rows
        ],
    }


@router.delete("/data/ohlcv")
def clear_ohlcv():
    """Delete all price data and fetch log. Indicators are preserved."""
    with db._conn() as con:
        con.execute("DELETE FROM ohlcv")
        con.execute("DELETE FROM fetch_log")
    return {"cleared": "ohlcv"}


@router.delete("/data/indicators")
def clear_indicators():
    """Delete all computed indicator data."""
    with db._conn() as con:
        con.execute("DELETE FROM indicators")
    return {"cleared": "indicators"}


@router.delete("/data/indicators/orphaned")
def clear_orphaned_indicators():
    """Delete indicator data whose config_id no longer exists in ind_configs."""
    with db._conn() as con:
        con.execute("DELETE FROM indicators WHERE ind_conf NOT IN (SELECT id FROM ind_configs)")
    return {"cleared": "orphaned_indicators"}


@router.delete("/data/all")
def clear_all():
    """Delete all data (ohlcv, indicators, fetch log)."""
    with db._conn() as con:
        con.execute("DELETE FROM ohlcv")
        con.execute("DELETE FROM indicators")
        con.execute("DELETE FROM fetch_log")
    return {"cleared": "all"}
