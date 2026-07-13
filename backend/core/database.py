import sqlite3
import json
from pathlib import Path
from typing import Optional
import pandas as pd

DB_PATH = Path(__file__).parent.parent.parent / "data" / "screener.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS ohlcv (
    ticker    TEXT NOT NULL,
    timeframe TEXT NOT NULL,
    date      TEXT NOT NULL,
    open      REAL,
    high      REAL,
    low       REAL,
    close     REAL,
    volume    REAL,
    PRIMARY KEY (ticker, timeframe, date)
);

CREATE TABLE IF NOT EXISTS indicators (
    ticker    TEXT NOT NULL,
    timeframe TEXT NOT NULL,
    ind_conf  INTEGER NOT NULL,
    date      TEXT NOT NULL,
    data      TEXT NOT NULL,
    PRIMARY KEY (ticker, timeframe, ind_conf, date)
);

CREATE TABLE IF NOT EXISTS fetch_log (
    ticker      TEXT NOT NULL,
    timeframe   TEXT NOT NULL,
    fetched_at  TEXT NOT NULL,
    last_date   TEXT,
    ticker_list TEXT,
    PRIMARY KEY (ticker, timeframe)
);

CREATE INDEX IF NOT EXISTS idx_ohlcv_ticker_tf   ON ohlcv      (ticker, timeframe);
CREATE INDEX IF NOT EXISTS idx_ind_ticker_tf_conf ON indicators (ticker, timeframe, ind_conf);
"""


def _conn() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    return sqlite3.connect(DB_PATH)


def init_db() -> None:
    with _conn() as con:
        con.executescript(SCHEMA)
        # Migrations: add columns introduced after initial schema
        try:
            con.execute("ALTER TABLE fetch_log ADD COLUMN ticker_list TEXT")
        except Exception:
            pass  # column already exists


# ── OHLCV ────────────────────────────────────────────────────

def upsert_ohlcv(ticker: str, timeframe: str, df: pd.DataFrame) -> int:
    """Insert or replace OHLCV rows. df must have Date, Open, High, Low, Close, Volume columns."""
    rows = [
        (ticker, timeframe, str(row['Date'])[:10],
         row['Open'], row['High'], row['Low'], row['Close'], row['Volume'])
        for _, row in df.iterrows()
    ]
    with _conn() as con:
        con.executemany(
            "INSERT OR REPLACE INTO ohlcv VALUES (?,?,?,?,?,?,?,?)", rows
        )
    return len(rows)


def load_ohlcv(ticker: str, timeframe: str, end_date: Optional[str] = None) -> Optional[pd.DataFrame]:
    query = "SELECT date, open, high, low, close, volume FROM ohlcv WHERE ticker=? AND timeframe=?"
    params: list = [ticker, timeframe]
    if end_date:
        query += " AND date <= ?"
        params.append(end_date)
    query += " ORDER BY date"
    with _conn() as con:
        df = pd.read_sql_query(query, con, params=params, parse_dates=['date'])
    if df.empty:
        return None
    df = df.rename(columns={
        'date': 'Date', 'open': 'Open', 'high': 'High',
        'low': 'Low', 'close': 'Close', 'volume': 'Volume'
    })
    return df


# ── Indicators ───────────────────────────────────────────────

def upsert_indicators(ticker: str, timeframe: str, ind_conf: int, df: pd.DataFrame) -> int:
    """Serialize each row's non-OHLCV columns to JSON and store."""
    ohlcv_cols = {'Date', 'date', 'Open', 'High', 'Low', 'Close', 'Volume',
                  'open', 'high', 'low', 'close', 'volume'}
    rows = []
    for _, row in df.iterrows():
        date = str(row.get('Date') or row.get('date') or row.name)[:10]
        data = {k: (None if pd.isna(v) else v)
                for k, v in row.items()
                if k not in ohlcv_cols and k != 'Date'}
        rows.append((ticker, timeframe, ind_conf, date, json.dumps(data)))
    with _conn() as con:
        con.executemany(
            "INSERT OR REPLACE INTO indicators VALUES (?,?,?,?,?)", rows
        )
    return len(rows)


def load_indicators(ticker: str, timeframe: str, ind_conf: int,
                    end_date: Optional[str] = None) -> Optional[pd.DataFrame]:
    """Return wide DataFrame: Date + OHLCV + all indicator columns."""
    ohlcv_df = load_ohlcv(ticker, timeframe, end_date)
    if ohlcv_df is None:
        return None

    query = "SELECT date, data FROM indicators WHERE ticker=? AND timeframe=? AND ind_conf=?"
    params: list = [ticker, timeframe, ind_conf]
    if end_date:
        query += " AND date <= ?"
        params.append(end_date)
    query += " ORDER BY date"

    with _conn() as con:
        rows = con.execute(query, params).fetchall()

    if not rows:
        return None

    ind_records = [{'Date': r[0], **json.loads(r[1])} for r in rows]
    ind_df = pd.DataFrame(ind_records)
    ind_df['Date'] = pd.to_datetime(ind_df['Date'])

    merged = pd.merge(ohlcv_df, ind_df, on='Date', how='left')
    return merged


# ── Metadata ─────────────────────────────────────────────────

def list_tickers(timeframe: Optional[str] = None) -> list[str]:
    query = "SELECT DISTINCT ticker FROM ohlcv"
    params: list = []
    if timeframe:
        query += " WHERE timeframe=?"
        params.append(timeframe)
    query += " ORDER BY ticker"
    with _conn() as con:
        return [r[0] for r in con.execute(query, params).fetchall()]


def list_timeframes(ticker: Optional[str] = None) -> list[str]:
    query = "SELECT DISTINCT timeframe FROM ohlcv"
    params: list = []
    if ticker:
        query += " WHERE ticker=?"
        params.append(ticker)
    query += " ORDER BY timeframe"
    with _conn() as con:
        return [r[0] for r in con.execute(query, params).fetchall()]


def list_ind_confs() -> list[int]:
    with _conn() as con:
        return [r[0] for r in con.execute(
            "SELECT DISTINCT ind_conf FROM indicators ORDER BY ind_conf"
        ).fetchall()]


# ── Fetch log ────────────────────────────────────────────────

def log_fetch(ticker: str, timeframe: str, last_date: Optional[str],
              ticker_list: Optional[str] = None) -> None:
    from datetime import datetime
    with _conn() as con:
        con.execute(
            "INSERT OR REPLACE INTO fetch_log VALUES (?,?,?,?,?)",
            (ticker, timeframe, datetime.utcnow().isoformat(), last_date, ticker_list)
        )


def get_fetch_log(ticker: str, timeframe: str) -> Optional[dict]:
    with _conn() as con:
        row = con.execute(
            "SELECT fetched_at, last_date FROM fetch_log WHERE ticker=? AND timeframe=?",
            (ticker, timeframe)
        ).fetchone()
    if row is None:
        return None
    return {"fetched_at": row[0], "last_date": row[1]}
