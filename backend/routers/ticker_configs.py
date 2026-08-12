import json
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from backend.core import database as db

router = APIRouter(prefix="/api")


@router.get("/ticker-configs")
def list_ticker_configs():
    with db._conn() as con:
        rows = con.execute(
            "SELECT id, name, ticker_list, timeframes, updated_at FROM ticker_configs ORDER BY id"
        ).fetchall()
    return {"configs": [
        {"id": r[0], "name": r[1], "ticker_list": r[2], "timeframes": json.loads(r[3] or '[]'), "updated_at": r[4]}
        for r in rows
    ]}


@router.post("/ticker-configs")
def create_ticker_config():
    now = datetime.utcnow().isoformat()
    with db._conn() as con:
        cur = con.execute(
            "INSERT INTO ticker_configs (name, timeframes, created_at, updated_at) VALUES (?,?,?,?)",
            ("New config", "[]", now, now)
        )
    return {"id": cur.lastrowid, "name": "New config", "ticker_list": None, "timeframes": [],
            "created_at": now, "updated_at": now}


@router.get("/ticker-configs/{config_id}")
def get_ticker_config(config_id: int):
    with db._conn() as con:
        row = con.execute(
            "SELECT id, name, ticker_list, timeframes, created_at, updated_at "
            "FROM ticker_configs WHERE id=?", (config_id,)
        ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Ticker config not found")
    return {
        "id": row[0], "name": row[1], "ticker_list": row[2],
        "timeframes": json.loads(row[3] or '[]'), "created_at": row[4], "updated_at": row[5],
    }


class SaveTickerConfigBody(BaseModel):
    name: str
    ticker_list: Optional[str] = None
    timeframes: List[str] = []


@router.put("/ticker-configs/{config_id}")
def save_ticker_config(config_id: int, body: SaveTickerConfigBody):
    now = datetime.utcnow().isoformat()
    with db._conn() as con:
        if not con.execute("SELECT id FROM ticker_configs WHERE id=?", (config_id,)).fetchone():
            raise HTTPException(status_code=404, detail="Ticker config not found")
        con.execute(
            "UPDATE ticker_configs SET name=?, ticker_list=?, timeframes=?, updated_at=? WHERE id=?",
            (body.name.strip() or "Unnamed", body.ticker_list, json.dumps(body.timeframes), now, config_id)
        )
    return {"saved": config_id, "updated_at": now}


@router.delete("/ticker-configs/{config_id}")
def delete_ticker_config(config_id: int):
    with db._conn() as con:
        con.execute("DELETE FROM ticker_configs WHERE id=?", (config_id,))
    return {"deleted": config_id}
