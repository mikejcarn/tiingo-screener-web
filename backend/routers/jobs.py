from pathlib import Path
from functools import lru_cache
from datetime import datetime
import csv
import io
import os
import zipfile
import requests
import pandas as pd
from fastapi import APIRouter, HTTPException, UploadFile, File
from pydantic import BaseModel

from backend.core import job_state
from backend.core import database as db
from backend.core.globals import API_KEY as _FALLBACK_API_KEY

router = APIRouter(prefix="/api")

TICKER_LISTS_DIR = Path(__file__).parent.parent / "tickers" / "ticker_lists"


def _masked(key: str) -> str:
    if len(key) <= 8:
        return '•' * len(key)
    return key[:4] + '•' * (len(key) - 8) + key[-4:]


class ApiKeyBody(BaseModel):
    key: str


@router.get("/settings/api-key")
def get_api_key():
    key = db.get_setting('tiingo_api_key') or _FALLBACK_API_KEY
    return {"set": bool(key), "masked": _masked(key) if key else ""}


@router.delete("/settings/api-key")
def delete_api_key():
    db.set_setting('tiingo_api_key', '')
    fallback = _FALLBACK_API_KEY
    return {"set": bool(fallback), "masked": _masked(fallback) if fallback else ""}


@router.put("/settings/api-key")
def save_api_key(body: ApiKeyBody):
    key = body.key.strip()
    if not key:
        raise HTTPException(status_code=400, detail="Key cannot be empty")
    db.set_setting('tiingo_api_key', key)
    return {"set": True, "masked": _masked(key)}


@router.post("/settings/api-key/verify")
def verify_api_key():
    key = db.get_setting('tiingo_api_key') or _FALLBACK_API_KEY
    if not key:
        return {"valid": False, "detail": "No API key set"}
    try:
        resp = requests.get(
            'https://api.tiingo.com/tiingo/daily/AAPL',
            headers={'Authorization': f'Token {key}', 'Content-Type': 'application/json'},
            timeout=8,
        )
        if resp.status_code == 200:
            return {"valid": True}
        return {"valid": False, "detail": f"HTTP {resp.status_code}"}
    except Exception as e:
        return {"valid": False, "detail": str(e)}


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


@lru_cache(maxsize=1)
def _tiingo_tickers_cached():
    path = TICKER_LISTS_DIR / 'tiingo-tickers.csv'
    rows = []
    with open(path, newline='', encoding='utf-8') as f:
        for r in csv.DictReader(f):
            ticker = r.get('ticker', '').strip().upper()
            if not ticker or not ticker[0].isalpha():
                continue
            rows.append((
                ticker,
                r.get('exchange', ''),
                r.get('assetType', ''),
            ))
    return rows


@router.get("/tickers/search")
def search_tickers(q: str = ''):
    if len(q) < 1:
        return {"results": []}
    q = q.upper()
    all_t = _tiingo_tickers_cached()
    prefix  = [t for t in all_t if t[0].startswith(q)][:20]
    return {"results": [{"ticker": t[0], "exchange": t[1], "assetType": t[2]} for t in prefix]}


@router.post("/ticker-lists/upload")
async def upload_ticker_list(file: UploadFile = File(...)):
    if not file.filename.lower().endswith('.csv'):
        raise HTTPException(status_code=400, detail="Only CSV files are accepted")
    contents = await file.read()
    name = Path(file.filename).stem
    dest = TICKER_LISTS_DIR / f"{name}.csv"
    dest.write_bytes(contents)
    try:
        count = len(pd.read_csv(dest))
    except Exception:
        count = 0
    return {"name": name, "count": count}


TIINGO_TICKERS_FILE = TICKER_LISTS_DIR / 'tiingo-tickers.csv'
TIINGO_TICKERS_URL  = 'https://apimedia.tiingo.com/docs/tiingo/daily/supported_tickers.zip'


@router.get("/tickers/list-info")
def tiingo_list_info():
    if not TIINGO_TICKERS_FILE.exists():
        return {"exists": False}
    mtime = os.path.getmtime(TIINGO_TICKERS_FILE)
    updated_at = datetime.fromtimestamp(mtime).strftime('%Y-%m-%d')
    with open(TIINGO_TICKERS_FILE, newline='', encoding='utf-8') as f:
        rows = sum(1 for _ in f) - 1
    return {"exists": True, "rows": rows, "updated_at": updated_at}


@router.post("/tickers/update-list")
def update_tiingo_tickers():
    try:
        resp = requests.get(TIINGO_TICKERS_URL, timeout=60)
        resp.raise_for_status()
        with zipfile.ZipFile(io.BytesIO(resp.content)) as z:
            csv_name = next(n for n in z.namelist() if n.lower().endswith('.csv'))
            csv_bytes = z.read(csv_name)
        TIINGO_TICKERS_FILE.write_bytes(csv_bytes)
        _tiingo_tickers_cached.cache_clear()
        rows = csv_bytes.decode('utf-8', errors='replace').count('\n') - 1
        updated_at = datetime.now().strftime('%Y-%m-%d')
        return {"updated": True, "rows": rows, "updated_at": updated_at}
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


@router.get("/ticker-lists")
def ticker_lists():
    lists = []
    for f in sorted(TICKER_LISTS_DIR.glob("*.csv")):
        if f.name == 'tiingo-tickers.csv':
            continue
        try:
            df = pd.read_csv(f)
            lists.append({"name": f.stem, "count": len(df)})
        except Exception:
            lists.append({"name": f.stem, "count": 0})
    return {"lists": lists}


@router.get("/fetch-history")
def fetch_history():
    with db._conn() as con:
        rows = con.execute("""
            SELECT
                strftime('%Y-%m-%d %H:00', fetched_at) AS session,
                ticker_list,
                timeframe,
                COUNT(DISTINCT ticker)                  AS tickers,
                MAX(last_date)                          AS last_date
            FROM fetch_log
            GROUP BY strftime('%Y-%m-%d %H:00', fetched_at), ticker_list, timeframe
            ORDER BY session DESC
            LIMIT 40
        """).fetchall()
    return {"history": [
        {"session": r[0], "ticker_list": r[1] or "—",
         "timeframe": r[2], "tickers": r[3], "last_date": r[4] or "—"}
        for r in rows
    ]}


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
