from typing import Optional
import pandas as pd
from backend.core import database as db


def load_ticker_df(ticker: str, timeframe: str) -> Optional[pd.DataFrame]:
    return db.load_ohlcv(ticker, timeframe)


def load_indicator_df(ticker: str, timeframe: str, ind_conf: int) -> Optional[pd.DataFrame]:
    return db.load_indicators(ticker, timeframe, ind_conf)


def list_tickers(timeframe: Optional[str] = None) -> list[str]:
    return db.list_tickers(timeframe)


def list_timeframes(ticker: Optional[str] = None) -> list[str]:
    return db.list_timeframes(ticker)


def list_ind_confs() -> list[int]:
    return db.list_ind_confs()
