from pathlib import Path
from typing import Optional
import pandas as pd
from backend.core.globals import TICKERS_DIR, INDICATORS_DIR, SCANNER_DIR


def indicators_conf_dir(ind_conf: int) -> Path:
    return INDICATORS_DIR / f"ind_conf_{ind_conf}"


def ticker_csv_path(ticker: str, timeframe: str) -> Optional[Path]:
    """Return the most recent CSV for a ticker+timeframe in the tickers buffer."""
    matches = sorted(TICKERS_DIR.glob(f"{ticker}_{timeframe}_*.csv"))
    return matches[-1] if matches else None


def indicator_csv_path(ticker: str, timeframe: str, ind_conf: int) -> Optional[Path]:
    """Return the most recent indicator CSV for a ticker+timeframe+conf."""
    conf_dir = indicators_conf_dir(ind_conf)
    matches = sorted(conf_dir.glob(f"{ticker}_{timeframe}_*.csv"))
    return matches[-1] if matches else None


def load_ticker_df(ticker: str, timeframe: str) -> Optional[pd.DataFrame]:
    path = ticker_csv_path(ticker, timeframe)
    if path is None:
        return None
    df = pd.read_csv(path, parse_dates=['Date'])
    df = df.sort_values('Date').reset_index(drop=True)
    return df


def load_indicator_df(ticker: str, timeframe: str, ind_conf: int) -> Optional[pd.DataFrame]:
    path = indicator_csv_path(ticker, timeframe, ind_conf)
    if path is None:
        return None
    df = pd.read_csv(path, parse_dates=['Date'])
    df = df.sort_values('Date').reset_index(drop=True)
    return df


def list_tickers(timeframe: Optional[str] = None) -> list[str]:
    """Return sorted list of unique tickers available in the tickers buffer."""
    pattern = f"*_{timeframe}_*.csv" if timeframe else "*.csv"
    names = set()
    for f in TICKERS_DIR.glob(pattern):
        parts = f.stem.split('_')
        if len(parts) >= 2:
            names.add(parts[0])
    return sorted(names)


def list_timeframes(ticker: Optional[str] = None) -> list[str]:
    """Return sorted list of timeframes available, optionally scoped to a ticker."""
    pattern = f"{ticker}_*.csv" if ticker else "*.csv"
    tfs = set()
    for f in TICKERS_DIR.glob(pattern):
        parts = f.stem.split('_')
        if len(parts) >= 2:
            tfs.add(parts[1])
    return sorted(tfs)


def list_ind_confs() -> list[int]:
    """Return sorted list of available ind_conf numbers."""
    return sorted(
        int(d.name.split('_')[-1])
        for d in INDICATORS_DIR.glob("ind_conf_*/")
        if d.is_dir() and d.name.split('_')[-1].isdigit()
    )
