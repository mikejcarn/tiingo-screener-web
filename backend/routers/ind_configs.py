import json
from datetime import datetime
from pathlib import Path
from typing import Dict, Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from backend.core import database as db
from backend.indicators.indicators import load_indicator_config

router = APIRouter(prefix="/api")

INDICATORS_LIST_DIR = Path(__file__).parent.parent / "indicators" / "indicators_list"
ALL_TIMEFRAMES = ['daily', 'weekly', '1hour', '4hour', '5min']


@router.get("/ind-configs")
def list_configs():
    with db._conn() as con:
        rows = con.execute(
            "SELECT id, name, created_at, updated_at FROM ind_configs ORDER BY id"
        ).fetchall()
    return {"configs": [{"id": r[0], "name": r[1], "created_at": r[2], "updated_at": r[3]} for r in rows]}


class CreateConfigBody(BaseModel):
    name: str = "New config"


@router.post("/ind-configs")
def create_config(body: CreateConfigBody):
    now = datetime.utcnow().isoformat()
    with db._conn() as con:
        cur = con.execute(
            "INSERT INTO ind_configs (name, created_at, updated_at) VALUES (?,?,?)",
            (body.name.strip() or "New config", now, now)
        )
        config_id = cur.lastrowid
    return {"id": config_id, "name": body.name, "created_at": now, "updated_at": now}


@router.delete("/ind-configs/{config_id}")
def delete_config(config_id: int):
    with db._conn() as con:
        con.execute("DELETE FROM ind_config_indicators WHERE config_id=?", (config_id,))
        con.execute("DELETE FROM ind_configs WHERE id=?", (config_id,))
    return {"deleted": config_id}


@router.get("/ind-configs/{config_id}")
def get_config(config_id: int):
    with db._conn() as con:
        row = con.execute(
            "SELECT id, name, created_at, updated_at FROM ind_configs WHERE id=?", (config_id,)
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Config not found")
        ind_rows = con.execute(
            "SELECT timeframe, indicator, params FROM ind_config_indicators WHERE config_id=?",
            (config_id,)
        ).fetchall()

    indicators: Dict[str, Dict[str, Any]] = {}
    for tf, ind, params_json in ind_rows:
        indicators.setdefault(tf, {})[ind] = json.loads(params_json)

    return {"id": row[0], "name": row[1], "created_at": row[2], "updated_at": row[3], "indicators": indicators}


class SaveConfigBody(BaseModel):
    name: str
    indicators: Dict[str, Dict[str, Any]]


@router.put("/ind-configs/{config_id}")
def save_config(config_id: int, body: SaveConfigBody):
    now = datetime.utcnow().isoformat()
    with db._conn() as con:
        if not con.execute("SELECT id FROM ind_configs WHERE id=?", (config_id,)).fetchone():
            raise HTTPException(status_code=404, detail="Config not found")
        con.execute("UPDATE ind_configs SET name=?, updated_at=? WHERE id=?",
                    (body.name.strip() or "Unnamed", now, config_id))
        con.execute("DELETE FROM ind_config_indicators WHERE config_id=?", (config_id,))
        for tf, inds in body.indicators.items():
            for ind_name, params in inds.items():
                con.execute(
                    "INSERT INTO ind_config_indicators VALUES (?,?,?,?)",
                    (config_id, tf, ind_name, json.dumps(params))
                )
    return {"saved": config_id, "updated_at": now}


@router.get("/indicator-defaults")
def indicator_defaults():
    available = sorted(
        f.stem for f in INDICATORS_LIST_DIR.glob("*.py")
        if not f.stem.startswith("_")
    )

    defaults: Dict[str, Any] = {}
    for tf in ALL_TIMEFRAMES:
        result = load_indicator_config(0, tf)
        if result and result != (None, None):
            _, params = result
            defaults[tf] = params or {}
        else:
            defaults[tf] = {}

    return {"available": available, "defaults": defaults}
