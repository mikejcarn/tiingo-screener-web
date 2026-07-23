from fastapi import APIRouter, HTTPException, Query
from typing import Optional
from backend.core import database as db
from backend.core.globals import TIMEFRAME_ALIASES

router = APIRouter(prefix="/api")


def _resolve_tf(timeframe: str) -> str:
    tf = TIMEFRAME_ALIASES.get(timeframe.lower())
    if tf is None:
        raise HTTPException(status_code=400, detail=f"Unknown timeframe '{timeframe}'")
    return tf


@router.get("/tickers")
def get_tickers(timeframe: Optional[str] = None, ticker_list: Optional[str] = None):
    """List available tickers, optionally filtered by timeframe and/or ticker list."""
    tf = _resolve_tf(timeframe) if timeframe else None
    tickers = db.list_tickers(tf, ticker_list)
    timeframes = db.list_timeframes()
    confs = db.list_ind_confs_named()
    lists = db.list_ticker_lists()
    return {"tickers": tickers, "timeframes": timeframes, "ind_confs": confs, "lists": lists}


@router.get("/data/{ticker}/{timeframe}")
def get_ohlcv(ticker: str, timeframe: str, end_date: Optional[str] = None):
    """Return OHLCV bars for a ticker+timeframe as a list of objects."""
    tf = _resolve_tf(timeframe)
    df = db.load_ticker_df(ticker.upper(), tf)
    if df is None:
        raise HTTPException(status_code=404, detail=f"{ticker} {tf} not found in tickers buffer")
    if end_date:
        df = df[df['Date'].astype(str) <= end_date]
    records = df[['Date', 'Open', 'High', 'Low', 'Close', 'Volume']].rename(
        columns={'Date': 'date', 'Open': 'open', 'High': 'high',
                 'Low': 'low', 'Close': 'close', 'Volume': 'volume'}
    )
    records['date'] = records['date'].astype(str)
    return {"ticker": ticker.upper(), "timeframe": tf, "bars": records.to_dict(orient='records')}


@router.get("/indicators/{ticker}/{timeframe}/{ind_conf}")
def get_indicators(ticker: str, timeframe: str, ind_conf: int, end_date: Optional[str] = None):
    """Return full indicator CSV (OHLCV + all indicator columns) as a list of objects."""
    tf = _resolve_tf(timeframe)
    df = db.load_indicator_df(ticker.upper(), tf, ind_conf)
    if df is None:
        raise HTTPException(
            status_code=404,
            detail=f"{ticker} {tf} ind_conf_{ind_conf} not found"
        )
    if end_date:
        df = df[df['Date'].astype(str) <= end_date]
    df['Date'] = df['Date'].astype(str)
    return {
        "ticker": ticker.upper(),
        "timeframe": tf,
        "ind_conf": ind_conf,
        "columns": list(df.columns),
        "bars": df.to_dict(orient='records'),
    }
