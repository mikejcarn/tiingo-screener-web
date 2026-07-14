from typing import Optional, List
from fastapi import APIRouter, HTTPException, BackgroundTasks
from pydantic import BaseModel
import json
import pandas as pd

from backend.core.globals import TIMEFRAME_ALIASES
from backend.core import database as db
from backend.core import job_state
from backend.indicators.indicators import get_indicators, load_indicator_config, load_config_from_db

router = APIRouter(prefix="/api")


def _run_and_store(ticker: str, timeframe: str, ind_conf: int) -> int:
    """Load OHLCV from DB, run indicator pipeline, store results. Returns row count."""
    df = db.load_ohlcv(ticker, timeframe)
    if df is None:
        raise ValueError(f"{ticker} {timeframe} not in database — fetch it first")

    # indicators.py expects lowercase 'date' as the index (matches original CSV read_csv index_col='date')
    df_indexed = df.rename(columns={'Date': 'date'}).set_index('date')

    result = load_indicator_config(ind_conf, timeframe)
    if result is None or result == (None, None):
        raise ValueError(f"No indicator config for ind_conf={ind_conf} timeframe={timeframe}")

    indicator_list, params = result
    df_with_ind = get_indicators(df_indexed, indicator_list, params)

    # Reset index so 'Date' becomes a column again for upsert
    df_with_ind = df_with_ind.reset_index().rename(columns={'date': 'Date', 'index': 'Date'})
    if 'Date' not in df_with_ind.columns and df_with_ind.index.name == 'Date':
        df_with_ind = df_with_ind.reset_index()

    return db.upsert_indicators(ticker, timeframe, ind_conf, df_with_ind)


def _run_and_store_db(ticker: str, timeframe: str, config_id: int) -> int:
    """Same as _run_and_store but loads config from DB. Uses config_id as ind_conf key."""
    df = db.load_ohlcv(ticker, timeframe)
    if df is None:
        raise ValueError(f"{ticker} {timeframe} not in database — fetch it first")
    df_indexed = df.rename(columns={'Date': 'date'}).set_index('date')
    indicator_list, params = load_config_from_db(config_id, timeframe)
    if not indicator_list:
        return 0
    df_with_ind = get_indicators(df_indexed, indicator_list, params)
    df_with_ind = df_with_ind.reset_index().rename(columns={'date': 'Date', 'index': 'Date'})
    if 'Date' not in df_with_ind.columns and df_with_ind.index.name == 'Date':
        df_with_ind = df_with_ind.reset_index()
    return db.upsert_indicators(ticker, timeframe, config_id, df_with_ind)


# ── Endpoints ────────────────────────────────────────────────

@router.post("/indicators/{ticker}/{timeframe}/{ind_conf}")
def compute_indicators(ticker: str, timeframe: str, ind_conf: int):
    """Run indicator pipeline for one ticker and store results in DB."""
    tf = TIMEFRAME_ALIASES.get(timeframe.lower())
    if tf is None:
        raise HTTPException(status_code=400, detail=f"Unknown timeframe '{timeframe}'")
    try:
        count = _run_and_store(ticker.upper(), tf, ind_conf)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    return {"ticker": ticker.upper(), "timeframe": tf, "ind_conf": ind_conf, "rows": count}


@router.get("/indicators/history")
def indicator_history():
    return {"history": db.get_indicator_history()}


@router.get("/indicators/tickers-list")
def indicator_tickers_list(config_id: int, timeframe: str = 'daily'):
    """Return sorted list of tickers that have indicator data for a config+timeframe."""
    with db._conn() as con:
        rows = con.execute(
            "SELECT DISTINCT ticker FROM indicators WHERE ind_conf=? AND timeframe=? ORDER BY ticker",
            (config_id, timeframe)
        ).fetchall()
    return {"tickers": [r[0] for r in rows]}


@router.get("/indicators/preview")
def indicator_preview(config_id: int, timeframe: str = 'daily', limit: int = 8,
                      ticker: Optional[str] = None, offset: int = 0):
    """Return a page of rows (OHLCV + indicators) for a ticker. offset=0 → most recent rows."""
    if ticker:
        ticker = ticker.upper()
        with db._conn() as con:
            exists = con.execute(
                "SELECT 1 FROM indicators WHERE ind_conf=? AND timeframe=? AND ticker=? LIMIT 1",
                (config_id, timeframe, ticker)
            ).fetchone()
        if not exists:
            return {"ticker": ticker, "columns": [], "rows": [], "not_found": True}
    else:
        with db._conn() as con:
            row = con.execute(
                "SELECT ticker FROM indicators WHERE ind_conf=? AND timeframe=? ORDER BY rowid DESC LIMIT 1",
                (config_id, timeframe)
            ).fetchone()
        if not row:
            return {"ticker": None, "columns": [], "rows": [], "total_rows": 0}
        ticker = row[0]

    with db._conn() as con:
        total_rows = con.execute(
            "SELECT COUNT(*) FROM indicators WHERE ind_conf=? AND timeframe=? AND ticker=?",
            (config_id, timeframe, ticker)
        ).fetchone()[0]

    # Fetch DESC with offset, then reverse for chronological display
    with db._conn() as con:
        ind_rows = con.execute(
            "SELECT date, data FROM indicators WHERE ind_conf=? AND timeframe=? AND ticker=? "
            "ORDER BY date DESC LIMIT ? OFFSET ?",
            (config_id, timeframe, ticker, limit, offset)
        ).fetchall()
    if not ind_rows:
        return {"ticker": ticker, "columns": [], "rows": [], "total_rows": total_rows}

    ind_rows = list(reversed(ind_rows))  # chronological order for display

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
            "total_rows": total_rows, "offset": offset, "limit": limit}


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
    timeframes: Optional[List[str]] = None
    ind_conf: Optional[int] = None      # legacy: use Python file config
    config_id: Optional[int] = None     # new: use DB config


@router.post("/indicators/batch")
def compute_indicators_batch(req: BatchIndicatorsRequest, background_tasks: BackgroundTasks):
    """Run indicator pipeline for all available tickers in the DB."""
    if job_state.get_all()['indicators']['status'] == 'running':
        raise HTTPException(status_code=409, detail="Indicators job already running")
    if req.config_id is None and req.ind_conf is None:
        raise HTTPException(status_code=400, detail="Provide config_id or ind_conf")

    job_state.update('indicators', status='running', done=0, total=0, current='', errors=0)

    def _run():
        tfs = [TIMEFRAME_ALIASES.get(tf.lower(), tf.lower())
               for tf in (req.timeframes or db.list_timeframes())]
        pairs = [(ticker, tf) for tf in tfs for ticker in db.list_tickers(tf)]
        unique_tickers = len(set(t for t, _ in pairs))
        job_state.update('indicators', total=len(pairs))

        config_name = ''
        if req.config_id is not None:
            with db._conn() as con:
                r = con.execute("SELECT name FROM ind_configs WHERE id=?", (req.config_id,)).fetchone()
                config_name = r[0] if r else f'Config {req.config_id}'
        for i, (ticker, tf) in enumerate(pairs):
            if job_state.is_cancelled('indicators'):
                job_state.update('indicators', status='cancelled', current='')
                return
            job_state.update('indicators', current=f"{ticker} {tf}")
            try:
                if req.config_id is not None:
                    _run_and_store_db(ticker, tf, req.config_id)
                else:
                    _run_and_store(ticker, tf, req.ind_conf)
                job_state.add_log('indicators', ticker, tf, ok=True)
            except Exception as e:
                print(f"indicators error {ticker} {tf}: {e}")
                job_state.add_failure('indicators', f"{ticker}/{tf}", str(e))
                job_state.add_log('indicators', ticker, tf, ok=False)
            job_state.update('indicators', done=i + 1)
        final_errors = job_state.get_all()['indicators']['errors']
        job_state.update('indicators', status='done', current='')
        db.log_indicator_run(
            config_id=req.config_id or req.ind_conf or 0,
            config_name=config_name,
            timeframes=tfs,
            tickers=unique_tickers,
            errors=final_errors,
        )

    background_tasks.add_task(_run)
    return {"status": "started"}
