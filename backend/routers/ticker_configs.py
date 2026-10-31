import json
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from backend.core import database as db
from backend.core import datasets

router = APIRouter(prefix="/api")

# Ticker configs double as datasets (list + timeframes + bar window + warm-up)
# — see backend/core/datasets.py.


@router.get("/ticker-configs")
def list_ticker_configs():
    with db._conn() as con:
        return {"configs": datasets.all_datasets(con)}


@router.post("/ticker-configs")
def create_ticker_config():
    now = datetime.utcnow().isoformat()
    with db._conn() as con:
        cur = con.execute(
            "INSERT INTO ticker_configs (name, timeframes, created_at, updated_at) VALUES (?,?,?,?)",
            ("New config", "[]", now, now)
        )
        return datasets.get_dataset(con, cur.lastrowid)


@router.get("/ticker-configs/{config_id}")
def get_ticker_config(config_id: int):
    with db._conn() as con:
        ds = datasets.get_dataset(con, config_id)
    if not ds:
        raise HTTPException(status_code=404, detail="Ticker config not found")
    return ds


class SaveTickerConfigBody(BaseModel):
    name: str
    ticker_list: Optional[str] = None
    timeframes: List[str] = []
    window_mode: str = 'full'            # 'full' | 'last' | 'range'
    window_bars: Optional[int] = None    # 'last'
    window_start: Optional[str] = None   # 'range' (YYYY-MM-DD, either may be blank)
    window_end: Optional[str] = None
    warmup: Optional[int] = None         # None = auto from the indicator config


@router.put("/ticker-configs/{config_id}")
def save_ticker_config(config_id: int, body: SaveTickerConfigBody):
    now = datetime.utcnow().isoformat()
    mode = body.window_mode if body.window_mode in ('full', 'last', 'range') else 'full'
    bars = body.window_bars if body.window_bars and body.window_bars > 0 else None
    start = (body.window_start or '').strip()[:10] or None
    end = (body.window_end or '').strip()[:10] or None
    warmup = body.warmup if body.warmup is not None and body.warmup >= 0 else None
    with db._conn() as con:
        if not con.execute("SELECT id FROM ticker_configs WHERE id=?", (config_id,)).fetchone():
            raise HTTPException(status_code=404, detail="Ticker config not found")
        con.execute(
            "UPDATE ticker_configs SET name=?, ticker_list=?, timeframes=?, window_mode=?, window_bars=?, "
            "window_start=?, window_end=?, warmup=?, updated_at=? WHERE id=?",
            (body.name.strip() or "Unnamed", body.ticker_list, json.dumps(body.timeframes),
             mode, bars, start, end, warmup, now, config_id)
        )
        ds = datasets.get_dataset(con, config_id)
    return {"saved": config_id, "updated_at": now, "win": ds['win'], "window_label": ds['window_label']}


@router.delete("/ticker-configs/{config_id}")
def delete_ticker_config(config_id: int):
    with db._conn() as con:
        con.execute("DELETE FROM ticker_configs WHERE id=?", (config_id,))
    return {"deleted": config_id}
