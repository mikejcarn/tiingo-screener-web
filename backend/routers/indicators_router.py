from typing import Optional
from fastapi import APIRouter, HTTPException, BackgroundTasks
from pydantic import BaseModel
import json
import pandas as pd

from backend.core.globals import TIMEFRAME_ALIASES
from backend.core import database as db
from backend.core import job_state
from backend.core import datasets
from backend.indicators.indicators import get_indicators, load_config_from_db

router = APIRouter(prefix="/api")


def _run_and_store_db(ticker: str, timeframe: str, config_id: int,
                      win: str = '', warmup: Optional[int] = None) -> int:
    """Compute config_id's indicators for one ticker and store them under
    window key `win` ('' = full history). A windowed run computes on the
    window plus `warmup` bars before it (None = auto from the config, see
    datasets.auto_warmup). The warm-up rows are stored too: many indicators
    store bar positions (a swing's bar index, a divergence's earlier bar),
    which count from the first computed bar — trimming would shift them all."""
    df = db.load_ohlcv(ticker, timeframe)
    if df is None:
        raise ValueError(f"{ticker} {timeframe} not in database — fetch it first")
    indicator_list, params = load_config_from_db(config_id, timeframe)
    if not indicator_list:
        return 0
    if win:
        df, _, _ = datasets.window_slice(
            df, win, warmup if warmup is not None else datasets.auto_warmup(params))
        if df.empty:
            return 0
    df_indexed = df.rename(columns={'Date': 'date'}).set_index('date')
    df_with_ind = get_indicators(df_indexed, indicator_list, params)
    df_with_ind = df_with_ind.reset_index().rename(columns={'date': 'Date', 'index': 'Date'})
    if 'Date' not in df_with_ind.columns and df_with_ind.index.name == 'Date':
        df_with_ind = df_with_ind.reset_index()
    return db.upsert_indicators(ticker, timeframe, config_id, df_with_ind, win=win)


# ── Endpoints ────────────────────────────────────────────────


@router.get("/indicators/history")
def indicator_history():
    return {"history": db.get_indicator_history()}


@router.delete("/indicators/history/{run_id}")
def delete_indicator_run(run_id: int):
    db.delete_indicator_run(run_id)
    return {"ok": True}


@router.delete("/indicators/history")
def clear_indicator_history():
    db.clear_indicator_history()
    return {"ok": True}


@router.delete("/indicators/data")
def delete_indicator_data(ind_conf_id: Optional[int] = None,
                          ticker: Optional[str] = None,
                          timeframe: Optional[str] = None,
                          win: Optional[str] = None):
    """win: only that bar window's results ('' = full history); omitted = every window."""
    if ind_conf_id is None and ticker is None and timeframe is None:
        raise HTTPException(status_code=400, detail="At least one filter required")
    deleted = db.delete_indicators(ind_conf_id=ind_conf_id, ticker=ticker, timeframe=timeframe, win=win)
    return {"ok": True, "deleted": deleted}


@router.get("/indicators/summary")
def indicator_summary():
    with db._conn() as con:
        # INDEXED BY forces idx_ind_summary_covering (ind_conf, ticker,
        # timeframe, date) — SQLite's planner doesn't pick it automatically
        # (even post-ANALYZE) despite it covering this query entirely, and
        # falls back to idx_ind_ticker_tf_conf, which lacks `date` and so
        # forces a full-row fetch (including the multi-KB `data` blob) per
        # group just to read it. Measured ~145x faster with the hint
        # (10s -> 0.07s on a 338K-row table) — not a marginal tweak.
        rows = con.execute("""
            SELECT i.ind_conf, i.ticker, i.timeframe,
                   COUNT(*) AS rows,
                   MIN(i.date) AS first_date, MAX(i.date) AS last_date,
                   c.name AS config_name, i.win
            FROM indicators i INDEXED BY idx_ind_summary_covering
            LEFT JOIN ind_configs c ON i.ind_conf = c.id
            GROUP BY i.ind_conf, i.ticker, i.timeframe, i.win
            ORDER BY c.name, i.ticker, i.timeframe, i.win
        """).fetchall()
    return {"rows": [
        {"config_id": r[0], "ticker": r[1], "timeframe": r[2],
         "rows": r[3], "first_date": r[4] or '', "last_date": r[5] or '',
         "config_name": r[6] or f"Config {r[0]}",
         "win": r[7] or '', "window": datasets.window_label(r[7] or '')}
        for r in rows
    ]}


@router.get("/indicators/tickers-list")
def indicator_tickers_list(config_id: int, timeframe: str = 'daily', win: str = ''):
    """Return sorted list of tickers that have indicator data for a config+timeframe (in window win)."""
    with db._conn() as con:
        rows = con.execute(
            "SELECT DISTINCT ticker FROM indicators WHERE ind_conf=? AND timeframe=? AND win=? ORDER BY ticker",
            (config_id, timeframe, win)
        ).fetchall()
    return {"tickers": [r[0] for r in rows]}


@router.get("/indicators/preview")
def indicator_preview(config_id: int, timeframe: str = 'daily',
                      ticker: Optional[str] = None, win: str = ''):
    """Return all rows (OHLCV + indicators) for a ticker in chronological order."""
    if ticker:
        ticker = ticker.upper()
        with db._conn() as con:
            exists = con.execute(
                "SELECT 1 FROM indicators WHERE ind_conf=? AND timeframe=? AND ticker=? AND win=? LIMIT 1",
                (config_id, timeframe, ticker, win)
            ).fetchone()
        if not exists:
            return {"ticker": ticker, "columns": [], "rows": [], "not_found": True}
    else:
        with db._conn() as con:
            row = con.execute(
                "SELECT ticker FROM indicators WHERE ind_conf=? AND timeframe=? AND win=? ORDER BY rowid DESC LIMIT 1",
                (config_id, timeframe, win)
            ).fetchone()
        if not row:
            return {"ticker": None, "columns": [], "rows": [], "total_rows": 0}
        ticker = row[0]

    with db._conn() as con:
        total_rows = con.execute(
            "SELECT COUNT(*) FROM indicators WHERE ind_conf=? AND timeframe=? AND ticker=? AND win=?",
            (config_id, timeframe, ticker, win)
        ).fetchone()[0]

    with db._conn() as con:
        ind_rows = con.execute(
            "SELECT date, data FROM indicators WHERE ind_conf=? AND timeframe=? AND ticker=? AND win=? "
            "ORDER BY date ASC",
            (config_id, timeframe, ticker, win)
        ).fetchall()
    if not ind_rows:
        return {"ticker": ticker, "columns": [], "rows": [], "total_rows": total_rows}

    dates = [r[0] for r in ind_rows]
    placeholders = ','.join('?' * len(dates))
    with db._conn() as con:
        ohlcv_rows = con.execute(
            f"SELECT date, open, high, low, close, volume FROM ohlcv WHERE ticker=? AND timeframe=? AND date IN ({placeholders})",
            [ticker, timeframe] + dates
        ).fetchall()
    ohlcv = {r[0]: r[1:] for r in ohlcv_rows}

    first_ind = json.loads(ind_rows[0][1])
    ind_col_names = list(first_ind.keys())
    ohlcv_cols = ['date', 'open', 'high', 'low', 'close', 'volume']
    all_cols = ohlcv_cols + ind_col_names

    def _fmt(v):
        if v is None: return None
        if isinstance(v, float): return round(v, 4)
        return v

    result_rows = []
    for date, data_json in ind_rows:
        ind_data = json.loads(data_json)
        o = ohlcv.get(date, (None,) * 5)
        result_rows.append({
            'date': date,
            'open': _fmt(o[0]), 'high': _fmt(o[1]), 'low': _fmt(o[2]),
            'close': _fmt(o[3]),
            'volume': int(o[4]) if o[4] is not None else None,
            **{k: _fmt(v) for k, v in ind_data.items()}
        })
    return {"ticker": ticker, "timeframe": timeframe, "columns": all_cols, "rows": result_rows,
            "total_rows": total_rows}


@router.get("/indicators/columns")
def indicator_columns(config_id: int):
    """Return column names stored per timeframe for a given config."""
    with db._conn() as con:
        timeframes = [r[0] for r in con.execute(
            "SELECT DISTINCT timeframe FROM indicators WHERE ind_conf=? ORDER BY timeframe",
            (config_id,)
        ).fetchall()]
        result = []
        for tf in timeframes:
            row = con.execute(
                "SELECT data, COUNT(*) as rows FROM indicators WHERE ind_conf=? AND timeframe=? LIMIT 1",
                (config_id, tf)
            ).fetchone()
            total_rows = con.execute(
                "SELECT COUNT(*) FROM indicators WHERE ind_conf=? AND timeframe=?",
                (config_id, tf)
            ).fetchone()[0]
            tickers = con.execute(
                "SELECT COUNT(DISTINCT ticker) FROM indicators WHERE ind_conf=? AND timeframe=?",
                (config_id, tf)
            ).fetchone()[0]
            if row and row[0]:
                cols = list(json.loads(row[0]).keys())
                result.append({"timeframe": tf, "columns": cols, "rows": total_rows, "tickers": tickers})
    return {"config_id": config_id, "timeframes": result}


class BatchIndicatorsRequest(BaseModel):
    config_id: int
    ticker_list: Optional[str] = None  # restrict to this list's tickers (legacy; dataset_id supersedes it)
    dataset_id: Optional[int] = None   # a dataset (ticker config): its list's tickers, its timeframes, its window


@router.post("/indicators/batch")
def compute_indicators_batch(req: BatchIndicatorsRequest, background_tasks: BackgroundTasks):
    """Run indicator pipeline for all tickers × timeframes defined in the config."""
    if job_state.get_all()['indicators']['status'] == 'running':
        raise HTTPException(status_code=409, detail="Indicators job already running")

    job_state.update('indicators', status='running', done=0, total=0, current='', errors=0)

    def _run():
        with db._conn() as con:
            tf_rows = con.execute(
                "SELECT DISTINCT timeframe FROM ind_config_indicators WHERE config_id=?",
                (req.config_id,)
            ).fetchall()
            r = con.execute("SELECT name FROM ind_configs WHERE id=?", (req.config_id,)).fetchone()
            ds = datasets.get_dataset(con, req.dataset_id)
        config_tfs = [r2[0] for r2 in tf_rows]
        config_name = r[0] if r else f'Config {req.config_id}'

        tfs = [TIMEFRAME_ALIASES.get(tf.lower(), tf.lower()) for tf in config_tfs]
        ticker_list, win, warmup = req.ticker_list, '', None
        if ds:
            # The dataset's list, window and warm-up; its timeframes narrow
            # the config's (an empty set means all of the config's).
            ticker_list, win, warmup = ds['ticker_list'], ds['win'], ds['warmup']
            ds_tfs = {TIMEFRAME_ALIASES.get(t.lower(), t.lower()) for t in ds['timeframes']}
            if ds_tfs:
                tfs = [tf for tf in tfs if tf in ds_tfs]
        pairs = [(ticker, tf) for tf in tfs for ticker in db.list_tickers(tf, ticker_list=ticker_list)]
        unique_tickers = len(set(t for t, _ in pairs))
        job_state.update('indicators', total=len(pairs))

        for i, (ticker, tf) in enumerate(pairs):
            if job_state.is_cancelled('indicators'):
                job_state.update('indicators', status='cancelled', current='')
                return
            job_state.update('indicators', current=f"{ticker} {tf}")
            try:
                _run_and_store_db(ticker, tf, req.config_id, win=win, warmup=warmup)
                job_state.add_log('indicators', ticker, tf, ok=True)
            except Exception as e:
                print(f"indicators error {ticker} {tf}: {e}")
                job_state.add_failure('indicators', f"{ticker}/{tf}", str(e))
                job_state.add_log('indicators', ticker, tf, ok=False)
            job_state.update('indicators', done=i + 1)
        final_errors = job_state.get_all()['indicators']['errors']
        job_state.update('indicators', status='done', current='')
        db.log_indicator_run(
            config_id=req.config_id,
            config_name=config_name,
            timeframes=tfs,
            tickers=unique_tickers,
            errors=final_errors,
            dataset=(f"{ds['name']} · {ds['window_label']}" if ds else None),
        )

    background_tasks.add_task(_run)
    return {"status": "started"}
