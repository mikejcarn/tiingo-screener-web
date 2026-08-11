import json
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from backend.core import database as db

router = APIRouter(prefix="/api")


# ── Pipeline config CRUD ─────────────────────────────────────────

@router.get("/pipeline-configs")
def list_pipeline_configs():
    with db._conn() as con:
        rows = con.execute(
            "SELECT id, name, ticker_list, timeframes, ind_conf_id, scan_config_id, updated_at "
            "FROM pipeline_configs ORDER BY id"
        ).fetchall()
    return {"configs": [
        {"id": r[0], "name": r[1], "ticker_list": r[2], "timeframes": json.loads(r[3] or '[]'),
         "ind_conf_id": r[4], "scan_config_id": r[5], "updated_at": r[6]}
        for r in rows
    ]}


@router.post("/pipeline-configs")
def create_pipeline_config():
    now = datetime.utcnow().isoformat()
    with db._conn() as con:
        cur = con.execute(
            "INSERT INTO pipeline_configs (name, timeframes, created_at, updated_at) VALUES (?,?,?,?)",
            ("New pipeline", "[]", now, now)
        )
    return {"id": cur.lastrowid, "name": "New pipeline", "ticker_list": None, "timeframes": [],
            "ind_conf_id": None, "scan_config_id": None, "created_at": now, "updated_at": now}


@router.get("/pipeline-configs/{config_id}")
def get_pipeline_config(config_id: int):
    with db._conn() as con:
        row = con.execute(
            "SELECT id, name, ticker_list, timeframes, ind_conf_id, scan_config_id, created_at, updated_at "
            "FROM pipeline_configs WHERE id=?", (config_id,)
        ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Pipeline config not found")
    return {
        "id": row[0], "name": row[1], "ticker_list": row[2],
        "timeframes": json.loads(row[3] or '[]'), "ind_conf_id": row[4], "scan_config_id": row[5],
        "created_at": row[6], "updated_at": row[7],
    }


class SavePipelineBody(BaseModel):
    name: str
    ticker_list: Optional[str] = None
    timeframes: List[str] = []
    ind_conf_id: Optional[int] = None
    scan_config_id: Optional[int] = None


@router.put("/pipeline-configs/{config_id}")
def save_pipeline_config(config_id: int, body: SavePipelineBody):
    now = datetime.utcnow().isoformat()
    with db._conn() as con:
        if not con.execute("SELECT id FROM pipeline_configs WHERE id=?", (config_id,)).fetchone():
            raise HTTPException(status_code=404, detail="Pipeline config not found")
        con.execute(
            "UPDATE pipeline_configs SET name=?, ticker_list=?, timeframes=?, ind_conf_id=?, scan_config_id=?, updated_at=? WHERE id=?",
            (body.name.strip() or "Unnamed", body.ticker_list, json.dumps(body.timeframes),
             body.ind_conf_id, body.scan_config_id, now, config_id)
        )
    return {"saved": config_id, "updated_at": now}


@router.delete("/pipeline-configs/{config_id}")
def delete_pipeline_config(config_id: int):
    with db._conn() as con:
        con.execute("DELETE FROM pipeline_log WHERE config_id=?", (config_id,))
        con.execute("DELETE FROM pipeline_configs WHERE id=?", (config_id,))
    return {"deleted": config_id}


# ── Run log ───────────────────────────────────────────────────────

class LogPipelineRunBody(BaseModel):
    config_id: int
    status: str = "done"
    fetch_tickers: int = 0
    fetch_errors: int = 0
    ind_tickers: int = 0
    ind_errors: int = 0
    scan_run_id: Optional[int] = None


@router.post("/pipeline/log")
def log_pipeline_run(body: LogPipelineRunBody):
    with db._conn() as con:
        row = con.execute("SELECT name FROM pipeline_configs WHERE id=?", (body.config_id,)).fetchone()
    config_name = row[0] if row else f"Pipeline {body.config_id}"
    run_id = db.log_pipeline_run(
        body.config_id, config_name, body.status,
        fetch_tickers=body.fetch_tickers, fetch_errors=body.fetch_errors,
        ind_tickers=body.ind_tickers, ind_errors=body.ind_errors,
        scan_run_id=body.scan_run_id,
    )
    return {"id": run_id}


@router.get("/pipeline/history")
def pipeline_history():
    return {"history": db.get_pipeline_history()}


@router.delete("/pipeline/history/{run_id}")
def delete_pipeline_history_run(run_id: int):
    db.delete_pipeline_run(run_id)
    return {"ok": True}


@router.delete("/pipeline/history")
def clear_pipeline_history():
    db.clear_pipeline_history()
    return {"ok": True}
