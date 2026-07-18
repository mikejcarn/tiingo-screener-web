from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional, List
import time
import requests
import pandas as pd
from tiingo import TiingoClient
from fastapi import APIRouter, HTTPException, BackgroundTasks
from pydantic import BaseModel

from backend.core.globals import API_KEY as _FALLBACK_API_KEY, TIMEFRAME_ALIASES
from backend.core import database as db
from backend.core import job_state

TICKER_LISTS_DIR = Path(__file__).parent.parent / "tickers" / "ticker_lists"

router = APIRouter(prefix="/api")


def _read_ticker_list(path: Path) -> list[str]:
    """Read tickers from a CSV. Finds 'ticker' or 'symbol' column (case-insensitive),
    falls back to the first column so any single-column CSV works too."""
    df = pd.read_csv(path)
    cols_lower = {c.lower(): c for c in df.columns}
    col = cols_lower.get('ticker') or cols_lower.get('symbol') or df.columns[0]
    return df[col].dropna().str.strip().str.upper().unique().tolist()

# ── Tiingo fetch helpers (adapted from tiingo-screener-python/src/tickers/tickers.py) ──

_TIMEFRAME_CONFIG = {
    'weekly':  {'frequency': 'weekly',  'default_timedelta': None},
    'daily':   {'frequency': 'daily',   'default_timedelta': None},
    '4hour':   {'resampleFreq': '4hour','default_timedelta': timedelta(hours=15000)},
    '1hour':   {'resampleFreq': '1hour','default_timedelta': timedelta(hours=5000)},
    '5min':    {'resampleFreq': '5min', 'default_timedelta': timedelta(hours=100)},
}


_QUOTA_PHRASE = 'look up for this month'

class TiingoQuotaError(Exception):
    """Raised when the Tiingo monthly unique-symbol limit is exceeded."""


def _check_quota(text: str) -> None:
    if _QUOTA_PHRASE in text:
        raise TiingoQuotaError(
            "Tiingo monthly symbol quota exceeded (500 symbols/month on free plan). "
            "Wait for the calendar month to reset or upgrade at https://api.tiingo.com/pricing"
        )


def _robust_tiingo_call(client, ticker, start_date, end_date, frequency, max_retries=5):
    for attempt in range(max_retries):
        try:
            return client.get_ticker_price(ticker, startDate=start_date, endDate=end_date, frequency=frequency)
        except Exception as e:
            # TiingoClient calls response.json() internally; the raw body is in e.doc on JSONDecodeError
            _check_quota(getattr(e, 'doc', '') or str(e))
            if any(s in str(e).lower() for s in ('connection', 'network', 'timeout', 'unreachable')):
                if attempt == max_retries - 1:
                    raise
                time.sleep(2 ** attempt)
            else:
                raise
    raise Exception("All retries failed")


def _robust_api_call(url, headers, params, max_retries=5):
    for attempt in range(max_retries):
        try:
            resp = requests.get(url, headers=headers, params=params, timeout=30)
            _check_quota(resp.text)
            if resp.status_code >= 400:
                resp.raise_for_status()
            return resp.json()
        except TiingoQuotaError:
            raise
        except requests.exceptions.HTTPError:
            raise
        except requests.exceptions.RequestException as e:
            if attempt == max_retries - 1:
                raise
            time.sleep(2 ** attempt)
    raise requests.exceptions.RequestException("All retries failed")


def _create_df(data, timeframe: str) -> pd.DataFrame:
    if not data:
        raise ValueError("No data returned from Tiingo")
    df = pd.DataFrame(data)
    if timeframe in ('daily', 'weekly'):
        df.rename(columns={'adjLow': 'Low', 'adjHigh': 'High',
                           'adjClose': 'Close', 'adjOpen': 'Open',
                           'adjVolume': 'Volume'}, inplace=True)
        df.drop(columns=[c for c in ('close','high','low','open','volume','splitFactor','divCash')
                         if c in df.columns], inplace=True)
    else:
        df.rename(columns={'low': 'Low', 'high': 'High', 'close': 'Close',
                           'open': 'Open', 'volume': 'Volume'}, inplace=True)
    df['date'] = pd.to_datetime(df['date'])
    df = df.rename(columns={'date': 'Date'})
    df = df.sort_values('Date').reset_index(drop=True)
    return df


def _get_api_key() -> str:
    return db.get_setting('tiingo_api_key') or _FALLBACK_API_KEY


def fetch_ticker(ticker: str, timeframe: str,
                 start_date: Optional[str] = None,
                 end_date: Optional[str] = None) -> pd.DataFrame:
    api_key = _get_api_key()
    tf = TIMEFRAME_ALIASES.get(timeframe.lower(), timeframe.lower())
    config = _TIMEFRAME_CONFIG.get(tf)
    if config is None:
        raise ValueError(f"Unsupported timeframe: {timeframe}")

    end_dt = datetime.strptime(end_date, '%Y-%m-%d').date() if end_date else datetime.now().date()
    end_str = str(end_dt)

    if start_date is None:
        delta = config.get('default_timedelta') or timedelta(days=1825)
        start_str = (datetime(end_dt.year, end_dt.month, end_dt.day) - delta).strftime('%Y-%m-%d')
    else:
        start_str = start_date

    headers = {'Content-Type': 'application/json'}
    client = TiingoClient({'api_key': api_key, 'session': True})

    if 'frequency' in config:
        data = _robust_tiingo_call(client, ticker, start_str, end_str, config['frequency'])
        return _create_df(data, config['frequency'])

    # Intraday — try stock endpoint, fall back to crypto
    try:
        url = f"https://api.tiingo.com/iex/{ticker}/prices"
        data = _robust_api_call(url, headers, {
            'startDate': start_str, 'endDate': end_str,
            'resampleFreq': config['resampleFreq'],
            'columns': 'open,high,low,close,volume', 'token': api_key
        })
        return _create_df(data, config['resampleFreq'])
    except ValueError:
        url = "https://api.tiingo.com/tiingo/crypto/prices"
        data = _robust_api_call(url, headers, {
            'tickers': ticker, 'startDate': start_str, 'endDate': end_str,
            'resampleFreq': config['resampleFreq'],
            'columns': 'open,high,low,close,volume', 'token': api_key
        })
        data = data[0]['priceData']
        df = _create_df(data, config['resampleFreq'])
        return df.drop(columns=[c for c in ('volumeNotional', 'tradesDone') if c in df.columns])


# ── Endpoints ────────────────────────────────────────────────

class BatchFetchRequest(BaseModel):
    tickers: Optional[List[str]] = None
    ticker_list: Optional[str] = None   # CSV filename stem, e.g. "TSX"
    timeframes: List[str]
    end_date: Optional[str] = None


class SingleTickerRequest(BaseModel):
    ticker: str
    timeframes: List[str]


@router.post("/fetch/ticker")
def fetch_ticker_multi(req: SingleTickerRequest):
    """Fetch one ticker across multiple timeframes synchronously."""
    ticker = req.ticker.strip().upper()
    if not ticker:
        raise HTTPException(status_code=400, detail="Ticker cannot be empty")
    results, errors = [], []
    for tf_alias in req.timeframes:
        tf = TIMEFRAME_ALIASES.get(tf_alias.lower())
        if not tf:
            errors.append({"timeframe": tf_alias, "reason": "Unknown timeframe"})
            continue
        try:
            df = fetch_ticker(ticker, tf)
            rows = db.upsert_ohlcv(ticker, tf, df)
            last_date = str(df['Date'].max())[:10] if not df.empty else None
            db.log_fetch(ticker, tf, last_date, ticker_list=None)
            results.append({"timeframe": tf, "rows": rows})
        except TiingoQuotaError as e:
            raise HTTPException(status_code=429, detail=str(e))
        except Exception as e:
            errors.append({"timeframe": tf, "reason": str(e)})
    return {"ticker": ticker, "results": results, "errors": errors}


@router.post("/fetch/{ticker}/{timeframe}")
def fetch_single(ticker: str, timeframe: str, end_date: Optional[str] = None):
    """Fetch one ticker from Tiingo and store in DB."""
    tf = TIMEFRAME_ALIASES.get(timeframe.lower())
    if tf is None:
        raise HTTPException(status_code=400, detail=f"Unknown timeframe '{timeframe}'")
    try:
        df = fetch_ticker(ticker.upper(), tf, end_date=end_date)
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))

    count = db.upsert_ohlcv(ticker.upper(), tf, df)
    last_date = str(df['Date'].max())[:10] if not df.empty else None
    db.log_fetch(ticker.upper(), tf, last_date, ticker_list=None)
    return {"ticker": ticker.upper(), "timeframe": tf, "rows": count, "last_date": last_date}


@router.post("/fetch/batch")
def fetch_batch(req: BatchFetchRequest, background_tasks: BackgroundTasks):
    """Kick off a background fetch for a list of tickers × timeframes."""
    if job_state.get_all()['fetch']['status'] == 'running':
        raise HTTPException(status_code=409, detail="Fetch job already running")

    # Resolve ticker list
    if req.ticker_list:
        csv_path = TICKER_LISTS_DIR / f"{req.ticker_list}.csv"
        tickers = _read_ticker_list(csv_path)
    else:
        tickers = req.tickers or []

    timeframes = req.timeframes

    job_state.update('fetch', status='running', done=0, total=len(tickers), current='', errors=0)

    def _run():
        for i, ticker in enumerate(tickers):
            if job_state.is_cancelled('fetch'):
                job_state.update('fetch', status='cancelled', current='')
                return
            job_state.update('fetch', current=ticker)
            for tf_alias in timeframes:
                tf = TIMEFRAME_ALIASES.get(tf_alias.lower(), tf_alias.lower())
                try:
                    df = fetch_ticker(ticker.upper(), tf, end_date=req.end_date)
                    db.upsert_ohlcv(ticker.upper(), tf, df)
                    last_date = str(df['Date'].max())[:10] if not df.empty else None
                    db.log_fetch(ticker.upper(), tf, last_date, ticker_list=req.ticker_list)
                except TiingoQuotaError as e:
                    print(f"fetch_batch QUOTA EXCEEDED: {e}")
                    job_state.update('fetch', status='error', current='quota exceeded')
                    job_state.add_failure('fetch', ticker, str(e))
                    return
                except Exception as e:
                    print(f"fetch_batch error {ticker} {tf}: {e}")
                    job_state.add_failure('fetch', ticker, str(e))
            job_state.update('fetch', done=i + 1)
        job_state.update('fetch', status='done', current='')

    background_tasks.add_task(_run)
    return {"status": "started", "tickers": len(tickers), "timeframes": timeframes}


@router.get("/fetch/status/{ticker}/{timeframe}")
def fetch_status(ticker: str, timeframe: str):
    tf = TIMEFRAME_ALIASES.get(timeframe.lower())
    if tf is None:
        raise HTTPException(status_code=400, detail=f"Unknown timeframe '{timeframe}'")
    entry = db.get_fetch_log(ticker.upper(), tf)
    if entry is None:
        return {"ticker": ticker.upper(), "timeframe": tf, "fetched": False}
    return {"ticker": ticker.upper(), "timeframe": tf, "fetched": True, **entry}
