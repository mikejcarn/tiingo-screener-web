from typing import Optional, List
from fastapi import APIRouter, HTTPException, BackgroundTasks
from pydantic import BaseModel
import pandas as pd

from backend.core.globals import TIMEFRAME_ALIASES
from backend.core import database as db
from backend.core import job_state
from backend.indicators.indicators import get_indicators, load_indicator_config

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


class BatchIndicatorsRequest(BaseModel):
    timeframes: Optional[List[str]] = None
    ind_conf: int = 0


@router.post("/indicators/batch")
def compute_indicators_batch(req: BatchIndicatorsRequest, background_tasks: BackgroundTasks):
    """Run indicator pipeline for all available tickers in the DB."""
    if job_state.get_all()['indicators']['status'] == 'running':
        raise HTTPException(status_code=409, detail="Indicators job already running")

    def _run():
        tfs = [TIMEFRAME_ALIASES.get(tf.lower(), tf.lower())
               for tf in (req.timeframes or db.list_timeframes())]
        pairs = [(ticker, tf) for tf in tfs for ticker in db.list_tickers(tf)]
        job_state.update('indicators', status='running', done=0, total=len(pairs),
                         current='', errors=0)
        for i, (ticker, tf) in enumerate(pairs):
            if job_state.is_cancelled('indicators'):
                job_state.update('indicators', status='cancelled', current='')
                return
            job_state.update('indicators', current=f"{ticker} {tf}")
            try:
                _run_and_store(ticker, tf, req.ind_conf)
            except Exception as e:
                print(f"indicators error {ticker} {tf}: {e}")
                job_state.add_failure('indicators', f"{ticker}/{tf}", str(e))
            job_state.update('indicators', done=i + 1)
        job_state.update('indicators', status='done', current='')

    background_tasks.add_task(_run)
    return {"status": "started", "ind_conf": req.ind_conf}
