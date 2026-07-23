import importlib
import json
import os
from datetime import datetime
from pathlib import Path
from typing import Optional

import pandas as pd
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from backend.core import database as db

router = APIRouter(prefix="/api")

_CRITERIA_DIR = Path(__file__).parent.parent / "scanners" / "criteria"


# ── Criteria registry ─────────────────────────────────────────

def _list_criteria_names() -> list[str]:
    return sorted(
        p.stem for p in _CRITERIA_DIR.glob("*.py")
        if not p.stem.startswith("_")
    )


def _load_criteria_module(name: str):
    return importlib.import_module(f"backend.scanners.criteria.{name}")


@router.get("/criteria")
def list_criteria():
    items = []
    for name in _list_criteria_names():
        try:
            mod = _load_criteria_module(name)
            items.append({
                "name":         name,
                "display_name": getattr(mod, "display_name", name),
                "param_schema": getattr(mod, "param_schema", {}),
            })
        except Exception:
            pass
    return {"criteria": items}


@router.delete("/criteria/{name}")
def delete_criteria(name: str):
    path = _CRITERIA_DIR / f"{name}.py"
    if not path.exists():
        raise HTTPException(status_code=404, detail="Criteria file not found")
    path.unlink()
    return {"deleted": name}


# ── Scan config CRUD ──────────────────────────────────────────

@router.get("/scan-configs")
def list_scan_configs():
    with db._conn() as con:
        rows = con.execute(
            "SELECT id, name, logic, ind_conf_id, updated_at FROM scan_configs ORDER BY id"
        ).fetchall()
    return {"configs": [{"id": r[0], "name": r[1], "logic": r[2], "ind_conf_id": r[3], "updated_at": r[4]} for r in rows]}


@router.post("/scan-configs")
def create_scan_config():
    now = datetime.utcnow().isoformat()
    with db._conn() as con:
        cur = con.execute(
            "INSERT INTO scan_configs (name, logic, created_at, updated_at) VALUES (?,?,?,?)",
            ("New scan", "AND", now, now)
        )
    return {"id": cur.lastrowid, "name": "New scan", "logic": "AND", "ind_conf_id": None, "criteria": []}


@router.get("/scan-configs/{config_id}")
def get_scan_config(config_id: int):
    with db._conn() as con:
        row = con.execute(
            "SELECT id, name, logic, ind_conf_id, created_at, updated_at FROM scan_configs WHERE id=?", (config_id,)
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Scan config not found")
        crit_rows = con.execute(
            "SELECT id, criteria_name, timeframe, params_json, logic FROM scan_criteria "
            "WHERE config_id=? ORDER BY sort_order, id", (config_id,)
        ).fetchall()
    return {
        "id": row[0], "name": row[1], "logic": row[2], "ind_conf_id": row[3],
        "created_at": row[4], "updated_at": row[5],
        "criteria": [{"id": r[0], "criteria_name": r[1], "timeframe": r[2],
                      "params": json.loads(r[3]), "logic": r[4] or "AND"} for r in crit_rows],
    }


class CriteriaEntry(BaseModel):
    criteria_name: str
    timeframe: str
    params: dict = {}
    logic: str = "AND"


class SaveScanBody(BaseModel):
    name: str
    logic: str = "AND"
    ind_conf_id: Optional[int] = None
    criteria: list[CriteriaEntry] = []


@router.put("/scan-configs/{config_id}")
def save_scan_config(config_id: int, body: SaveScanBody):
    now = datetime.utcnow().isoformat()
    logic = body.logic.upper() if body.logic.upper() in ("AND", "OR") else "AND"
    with db._conn() as con:
        if not con.execute("SELECT id FROM scan_configs WHERE id=?", (config_id,)).fetchone():
            raise HTTPException(status_code=404, detail="Scan config not found")
        con.execute(
            "UPDATE scan_configs SET name=?, logic=?, ind_conf_id=?, updated_at=? WHERE id=?",
            (body.name.strip() or "Unnamed", logic, body.ind_conf_id, now, config_id)
        )
        con.execute("DELETE FROM scan_criteria WHERE config_id=?", (config_id,))
        for i, c in enumerate(body.criteria):
            logic = c.logic.upper() if c.logic.upper() in ("AND", "OR") else "AND"
            con.execute(
                "INSERT INTO scan_criteria (config_id, criteria_name, timeframe, params_json, logic, sort_order) "
                "VALUES (?,?,?,?,?,?)",
                (config_id, c.criteria_name, c.timeframe, json.dumps(c.params), logic, i)
            )
    return {"saved": config_id, "updated_at": now}


@router.delete("/scan-configs/{config_id}")
def delete_scan_config(config_id: int):
    with db._conn() as con:
        con.execute("DELETE FROM scan_criteria WHERE config_id=?", (config_id,))
        con.execute("DELETE FROM scan_configs WHERE id=?", (config_id,))
    return {"deleted": config_id}


# ── Run ──────────────────────────────────────────────────────

class RunScanRequest(BaseModel):
    config_id: int


def _apply_criteria(df: pd.DataFrame, criteria_name: str, params: dict) -> pd.DataFrame:
    """Import and call a criteria module. Returns empty DataFrame on failure."""
    try:
        mod = _load_criteria_module(criteria_name)
        result = mod.calculate_indicator(df, **params)
        return result if isinstance(result, pd.DataFrame) else pd.DataFrame()
    except Exception:
        return pd.DataFrame()


def _summarize_result(result_df: pd.DataFrame) -> dict:
    """Collapse a criteria result DataFrame to a one-row summary dict."""
    if result_df.empty:
        return {}
    row = result_df.iloc[-1]
    out = {}
    for k, v in row.items():
        if k in ('Date', 'Open', 'High', 'Low', 'Close', 'Volume'):
            continue
        if isinstance(v, float):
            out[k] = round(v, 4) if not pd.isna(v) else None
        elif pd.isna(v) if not isinstance(v, (str, bool, list, dict)) else False:
            out[k] = None
        else:
            try:
                out[k] = v.item() if hasattr(v, 'item') else v
            except Exception:
                out[k] = str(v)
    return out


@router.post("/scan/run")
def run_scan(req: RunScanRequest):
    with db._conn() as con:
        cfg = con.execute(
            "SELECT name, logic, ind_conf_id FROM scan_configs WHERE id=?", (req.config_id,)
        ).fetchone()
        if not cfg:
            raise HTTPException(status_code=404, detail="Scan config not found")
        cfg_name, logic, ind_conf_id = cfg
        if not ind_conf_id:
            raise HTTPException(status_code=400, detail="Scan config has no indicator config selected")
        crit_rows = con.execute(
            "SELECT criteria_name, timeframe, params_json, logic FROM scan_criteria "
            "WHERE config_id=? ORDER BY sort_order, id", (req.config_id,)
        ).fetchall()

    if not crit_rows:
        raise HTTPException(status_code=400, detail="Add at least one criteria entry before running")

    criteria_list = [{"name": r[0], "timeframe": r[1], "params": json.loads(r[2]), "logic": r[3] or "AND"} for r in crit_rows]
    needed_tfs    = list({c["timeframe"] for c in criteria_list})

    # Tickers with indicator data for this conf
    with db._conn() as con:
        tickers = [r[0] for r in con.execute(
            "SELECT DISTINCT ticker FROM indicators WHERE ind_conf=? ORDER BY ticker",
            (ind_conf_id,)
        ).fetchall()]

    results = []
    for ticker in tickers:
        # Load DataFrames per timeframe (cache within this ticker)
        dfs: dict[str, pd.DataFrame | None] = {}
        for tf in needed_tfs:
            dfs[tf] = db.load_indicators(ticker, tf, ind_conf_id)

        signals:     dict[str, dict] = {}
        and_passes:  list[bool]      = []
        or_passes:   list[bool]      = []

        for c in criteria_list:
            tf  = c["timeframe"]
            key = f'{c["name"]}_{tf}'
            df  = dfs.get(tf)
            if df is None or df.empty:
                (or_passes if c["logic"] == "OR" else and_passes).append(False)
                continue
            result_df = _apply_criteria(df, c["name"], c["params"])
            passed    = not result_df.empty
            if passed:
                signals[key] = _summarize_result(result_df)
            (or_passes if c["logic"] == "OR" else and_passes).append(passed)

        overall = (
            all(and_passes) and
            (not or_passes or any(or_passes))
        )

        if overall:
            # Latest date from any loaded timeframe
            latest_date = max(
                (df.iloc[-1].get('Date', '') or df.index[-1]
                 for df in dfs.values() if df is not None and not df.empty),
                default=""
            )
            if hasattr(latest_date, 'strftime'):
                latest_date = latest_date.strftime('%Y-%m-%d')
            else:
                latest_date = str(latest_date)[:10]

            results.append({"ticker": ticker, "date": latest_date, "signals": signals})

    db.log_scan_run(req.config_id, cfg_name, len(results), len(tickers))
    return {"count": len(results), "total": len(tickers), "results": results}


@router.get("/scan/history")
def scan_history():
    return {"history": db.get_scan_history()}
