import importlib
import inspect
import json
import types
from datetime import datetime
from pathlib import Path
from typing import Dict, Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from backend.core import database as db

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


def _get_indicator_defaults(name: str) -> Dict[str, Any]:
    try:
        mod = importlib.import_module(f'backend.indicators.indicators_list.{name}')
    except ImportError:
        return {}
    if hasattr(mod, 'defaults'):
        return mod.defaults
    # Find the calculate_* function defined in this module whose first parameter
    # is 'df' — that's the convention for all indicator main functions, and it
    # naturally skips local helpers like calculate_ema / calculate_atr.
    mod_name = f'backend.indicators.indicators_list.{name}'
    fn = None
    for attr_name, obj in vars(mod).items():
        if (attr_name.startswith('calculate_')
                and attr_name != 'calculate_indicator'
                and isinstance(obj, types.FunctionType)
                and obj.__module__ == mod_name):
            first_param = next(iter(inspect.signature(obj).parameters), None)
            if first_param == 'df':
                fn = obj
                break
    if fn is None:
        return {}
    sig = inspect.signature(fn)
    return {
        k: v.default
        for k, v in sig.parameters.items()
        if k != 'df'
        and v.kind not in (inspect.Parameter.VAR_KEYWORD, inspect.Parameter.VAR_POSITIONAL)
        and v.default is not inspect.Parameter.empty
    }


def _get_param_options(name: str) -> dict:
    try:
        mod = importlib.import_module(f'backend.indicators.indicators_list.{name}')
        return getattr(mod, 'param_options', {})
    except ImportError:
        return {}


def _get_param_labels(name: str) -> dict:
    try:
        mod = importlib.import_module(f'backend.indicators.indicators_list.{name}')
        return getattr(mod, 'param_labels', {})
    except ImportError:
        return {}


def _get_param_separators(name: str) -> list:
    try:
        mod = importlib.import_module(f'backend.indicators.indicators_list.{name}')
        return getattr(mod, 'param_separators', [])
    except ImportError:
        return []


def _get_display_name(name: str) -> str | None:
    try:
        mod = importlib.import_module(f'backend.indicators.indicators_list.{name}')
        return getattr(mod, 'display_name', None)
    except ImportError:
        return None


# Utility modules that exist as indicators but should not appear in the UI
_HIDDEN_INDICATORS = {
    'aVWAP',
    # Individual divergence types — consolidated into the single 'divergence' indicator
    'divergence_ATR', 'divergence_Fisher', 'divergence_Fractal', 'divergence_MACD',
    'divergence_MFI', 'divergence_Momentum', 'divergence_OBV', 'divergence_RSI',
    'divergence_Stochastic', 'divergence_Volume', 'divergence_Vortex',
}

@router.get("/indicator-defaults")
def indicator_defaults():
    available = sorted(
        f.stem for f in INDICATORS_LIST_DIR.glob("*.py")
        if not f.stem.startswith("_") and f.stem not in _HIDDEN_INDICATORS
    )
    defaults = {name: _get_indicator_defaults(name) for name in available}
    param_options = {name: opts for name in available
                     if (opts := _get_param_options(name))}
    param_labels = {name: lbls for name in available
                    if (lbls := _get_param_labels(name))}
    display_names     = {name: dn for name in available
                         if (dn := _get_display_name(name))}
    param_separators  = {name: s for name in available
                         if (s := _get_param_separators(name))}
    return {"available": available, "defaults": defaults,
            "param_options": param_options, "param_labels": param_labels,
            "display_names": display_names, "param_separators": param_separators}
