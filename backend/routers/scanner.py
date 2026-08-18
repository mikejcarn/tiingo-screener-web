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

_CRITERIA_DESCRIPTIONS = {
    'aVWAP_avg':             "Tests whether the most recent close is within, above, or below the composite aVWAP average (peaks + valleys, or either alone) by a specified percentage. Useful for identifying price proximity to a dynamic volume-weighted mean.",
    'aVWAP_avg_multi':       "Tests whether multiple aVWAP average lines satisfy a structural condition — stacked bullishly/bearishly or crossing over. Requires a minimum percentage separation between lines to confirm stacking. Useful for identifying momentum alignment across multiple anchored VWAP timeframes.",
    'aVWAP_channel':         "Tests whether price is near the upper (resistance) or lower (support) boundary of the aVWAP channel — the spread between the peaks aVWAP and valleys aVWAP lines. Identifies price at key dynamic S/R levels defined by volume-weighted price from swing anchors.",
    'aVWAP_minmax_bias':     "Compares how many bars the aVWAP Min/Max lines anchored at swing lows (bullish/support) vs swing highs (bearish/resistance) have been running, as a percentage bias from -100 (fully bearish) to +100 (fully bullish). A line anchored further back has been active longer, so a lopsided bias suggests the ticker's structure has been predominantly bullish or bearish over the visible history. Requires an indicator config with aVWAP — Min / Max computed.",
    'banker_RSI':            "Tests whether the Banker RSI value falls within a specified range on the most recent bar. The Banker RSI measures divergence between slow and fast RSI to proxy institutional activity. High positive values suggest accumulation; high negative values suggest distribution.",
    'BoS_CHoCH':             "Tests whether the most recent structural price event within the lookback window is a Break of Structure (trend continuation — price clears a prior swing) or Change of Character (potential reversal — price breaks the opposite swing), filtered by direction.",
    'divergences':           "Tests for divergence between price and one or more momentum oscillators on the most recent swing. Bullish divergence (price lower low, oscillator higher low) suggests upside potential; bearish divergence (price higher high, oscillator lower high) suggests downside. Supports OBV, Volume, Vortex, Fisher, and others.",
    'liquidity':             "Tests whether price is currently within a specified percentage of a significant swing high or low where retail stop-loss orders are likely clustered. These liquidity pools are common targets for stop-hunting moves before a reversal.",
    'OB':                    "Tests whether the most recent close is near or within an active order block — the last candle before a strong impulsive move in the opposite direction. Order blocks represent likely institutional entry zones and act as dynamic support (bullish) or resistance (bearish).",
    'OB_aVWAP':              "Tests whether price is near the aVWAP anchored at an order block. Combines order block location (institutional zone) with volume-weighted price from that anchor to identify high-probability confluence levels.",
    'oscillation_volatility':"Tests the oscillation behavior of price against its aVWAP average — how frequently and how far price crosses the mean. Set min/max thresholds on crossing count, average deviation, and composite score to isolate trending (low oscillation) or choppy (high oscillation) conditions.",
    'QQEMOD':                "Tests for overbought/oversold readings or reversal signals from the QQE Mod indicator, which uses ATR-adaptive bands on a double-smoothed RSI for significantly less noise than raw RSI. Reversal modes require a minimum number of consecutive qualifying bars and optionally a price confirmation.",
    'QQEMOD_aVWAP':          "Tests whether price has pulled back to a VWAP anchored at a recent QQE Mod momentum signal — a potential trend continuation entry at a volume-weighted level coinciding with a prior institutional momentum shift.",
    'SMA':                   "Tests the relationship between price and one or more Simple Moving Averages — whether price is above, below, within a distance band, or whether the SMAs themselves are stacked in a bullish or bearish order. Periods must match those configured in the linked indicator config.",
    'StDev':                 "Tests whether the most recent close is beyond a specified number of standard deviations from the dynamic mean (Z-Score band). Oversold selects tickers extended below the lower band; Overbought selects those extended above the upper band. Useful for mean-reversion setups.",
    'supertrend':            "Tests whether the Supertrend indicator is currently in a bullish (support below price) or bearish (resistance above price) state. The Supertrend uses ATR-based trailing bands and produces a definitive flip signal on trend change.",
    'TTM_squeeze':           "Tests for TTM Squeeze activity — active compression (Bollinger Bands inside Keltner Channels, signalling a potential breakout building) or a breakout (squeeze just fired). Filter by how long the squeeze has been active using min/max bar counts.",
}

_CRITERIA_PARAM_DESCRIPTIONS = {
    'mode':                  "The specific condition or direction to match.",
    'condition':             "The structural relationship to test across the set of aVWAP lines.",
    'direction':             "Whether price must be within, above, or below the target level.",
    'bias_direction':        "Which side's bias must dominate to match — bullish (support lines running longer), bearish (resistance lines running longer), or either direction beyond the threshold.",
    'min_bias_pct':          "Minimum bias magnitude required to match, as a percentage of total combined bar-length across both sides. 0 matches any imbalance; 100 requires one side to be completely absent.",
    'lookback_bars':         "Number of recent bars to search when looking for the most recent matching event. Shorter windows find very recent events; longer windows catch events that may still be relevant.",
    'distance_pct':          "Maximum allowed distance from the target level as a percentage of price. Smaller values require price to be closer; set to 0 for exact matches.",
    'outside_range':         "When enabled, inverts the distance check — matches when price is outside the range rather than inside it.",
    'threshold_pct':         "Minimum percentage separation between lines required to confirm stacking. Prevents false positives from nearly-equal lines.",
    'confirmation_bars':     "Number of consecutive bars the condition must hold before it qualifies as confirmed.",
    'threshold_lower':       "Minimum indicator value the most recent bar must reach to match.",
    'threshold_upper':       "Maximum indicator value the most recent bar must reach to match.",
    'threshold':             "Standard deviation threshold defining the band boundary. Price must be beyond this level (above for overbought, below for oversold) to match.",
    'divergence_types':      "Oscillator types to check for divergence. Only types with matching columns in the indicator data will be evaluated.",
    'max_bars_back':         "Maximum number of bars back to search for a divergence pivot high or low.",
    'require_confirmation':  "When enabled, requires a price-action confirmation signal before counting the divergence as valid.",
    'atr_threshold':         "ATR-based tolerance for how close price must be to the order block zone. Set to 0 to require price to be strictly within the zone.",
    'max_lookback':          "Maximum age in bars for order blocks to consider. Set to 0 to include all blocks regardless of age.",
    'require_in_range':      "Requires price to also be within the raw order block price range, not just near the aVWAP.",
    'cross_count':           "Minimum number of aVWAP average crossings in the lookback window. Set to 0 to apply no minimum.",
    'cross_count_max':       "Maximum crossings allowed. Set to 0 for no upper limit.",
    'avg_deviation':         "Minimum average deviation magnitude at each crossing (normalized by rolling standard deviation). Set to 0 for no minimum.",
    'avg_deviation_max':     "Maximum average deviation allowed. Set to 0 for no upper limit.",
    'oscillation_score':     "Minimum composite oscillation score (crossing count × average deviation). Set to 0 for no minimum.",
    'oscillation_score_max': "Maximum oscillation score allowed. Set to 0 for no upper limit.",
    'max_lines':             "Maximum number of aVWAP lines to evaluate. Set to 0 to check all active lines.",
    'min_lines':             "Minimum number of lines that must satisfy the pullback condition simultaneously.",
    'extend_to_end':         "When enabled, only considers lines that extend all the way to the current bar.",
    'min_consecutive':       "Minimum number of consecutive bars that must be in the QQE state to qualify as a signal.",
    'min_squeeze_bars':      "Minimum number of consecutive squeeze bars (Bollinger Bands inside Keltner Channels) that must be present.",
    'max_squeeze_bars':      "Maximum squeeze bar count. Set to 0 for no upper limit.",
    'sma_periods':           "Periods of the SMAs to evaluate. Must match the periods present in the indicator config output columns.",
}


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
            schema = getattr(mod, "param_schema", {})
            schema_with_desc = {
                k: {**v, "description": _CRITERIA_PARAM_DESCRIPTIONS.get(k, "")}
                for k, v in schema.items()
            }
            items.append({
                "name":         name,
                "display_name": getattr(mod, "display_name", name),
                "description":  _CRITERIA_DESCRIPTIONS.get(name, ""),
                "param_schema": schema_with_desc,
            })
        except Exception:
            pass
    return {"criteria": items, "param_descriptions": _CRITERIA_PARAM_DESCRIPTIONS}


@router.get("/criteria/check/{ind_conf_id}")
def check_criteria_compatibility(ind_conf_id: int, timeframe: str = "daily"):
    with db._conn() as con:
        row = con.execute(
            "SELECT data FROM indicators WHERE ind_conf=? AND timeframe=? LIMIT 1",
            (ind_conf_id, timeframe)
        ).fetchone()
    if not row:
        return {"compatibility": {name: None for name in _list_criteria_names()}}

    available = set(json.loads(row[0]).keys())

    def _matches(req: list[str]) -> bool:
        for r in req:
            if r.endswith('*'):
                prefix = r[:-1]
                if not any(c.startswith(prefix) for c in available):
                    return False
            else:
                if r not in available:
                    return False
        return True

    compat = {}
    for name in _list_criteria_names():
        try:
            mod = _load_criteria_module(name)
            req = getattr(mod, 'required_columns', None)
            compat[name] = _matches(req) if req is not None else None
        except Exception:
            compat[name] = None

    return {"compatibility": compat}


@router.get("/criteria/ind_conf_timeframes/{ind_conf_id}")
def get_ind_conf_timeframes(ind_conf_id: int):
    with db._conn() as con:
        rows = con.execute(
            "SELECT DISTINCT timeframe FROM indicators WHERE ind_conf=?",
            (ind_conf_id,)
        ).fetchall()
    return {"timeframes": [r[0] for r in rows]}


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
            "SELECT id, name, logic, ind_conf_id, ticker_list, created_at, updated_at FROM scan_configs WHERE id=?", (config_id,)
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Scan config not found")
        crit_rows = con.execute(
            "SELECT id, criteria_name, timeframe, params_json, logic FROM scan_criteria "
            "WHERE config_id=? ORDER BY sort_order, id", (config_id,)
        ).fetchall()
    return {
        "id": row[0], "name": row[1], "logic": row[2], "ind_conf_id": row[3],
        "ticker_list": row[4], "created_at": row[5], "updated_at": row[6],
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
    ticker_list: Optional[str] = None
    criteria: list[CriteriaEntry] = []


@router.put("/scan-configs/{config_id}")
def save_scan_config(config_id: int, body: SaveScanBody):
    now = datetime.utcnow().isoformat()
    logic = body.logic.upper() if body.logic.upper() in ("AND", "OR") else "AND"
    with db._conn() as con:
        if not con.execute("SELECT id FROM scan_configs WHERE id=?", (config_id,)).fetchone():
            raise HTTPException(status_code=404, detail="Scan config not found")
        con.execute(
            "UPDATE scan_configs SET name=?, logic=?, ind_conf_id=?, ticker_list=?, updated_at=? WHERE id=?",
            (body.name.strip() or "Unnamed", logic, body.ind_conf_id, body.ticker_list, now, config_id)
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
        run_ids = [r[0] for r in con.execute(
            "SELECT id FROM scan_log WHERE config_id=?", (config_id,)
        ).fetchall()]
        if run_ids:
            placeholders = ','.join('?' * len(run_ids))
            con.execute(f"DELETE FROM scan_results WHERE run_id IN ({placeholders})", run_ids)
        con.execute("DELETE FROM scan_log WHERE config_id=?", (config_id,))
        con.execute("DELETE FROM scan_configs WHERE id=?", (config_id,))
    return {"deleted": config_id}


# ── Run ──────────────────────────────────────────────────────

class RunScanRequest(BaseModel):
    config_id: int
    scope_ticker_list: Optional[str] = None  # restrict to tickers last fetched under this list name (e.g. from Pipeline)


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
            "SELECT name, logic, ind_conf_id, ticker_list FROM scan_configs WHERE id=?", (req.config_id,)
        ).fetchone()
        if not cfg:
            raise HTTPException(status_code=404, detail="Scan config not found")
        cfg_name, logic, ind_conf_id, ticker_list = cfg
        crit_rows = con.execute(
            "SELECT criteria_name, timeframe, params_json, logic FROM scan_criteria "
            "WHERE config_id=? ORDER BY sort_order, id", (req.config_id,)
        ).fetchall()

    if not crit_rows:
        raise HTTPException(status_code=400, detail="Add at least one criteria entry before running")
    if not ind_conf_id and not ticker_list:
        raise HTTPException(status_code=400, detail="Select an indicator config or a ticker list before running")

    criteria_list = [{"name": r[0], "timeframe": r[1], "params": json.loads(r[2]), "logic": r[3] or "AND"} for r in crit_rows]
    needed_tfs    = list({c["timeframe"] for c in criteria_list})

    # Tickers: from indicator data (ind_conf mode) or OHLCV (tickers-only mode).
    # scope_ticker_list further restricts ind_conf mode to tickers last fetched under
    # that list name (e.g. a Pipeline run scoping the scan to just what it fetched) —
    # only applied in ind_conf mode; tickers-only mode already has its own ticker_list.
    if ind_conf_id:
        tickers = db.list_tickers(ind_conf=ind_conf_id, ticker_list=req.scope_ticker_list)
    else:
        tickers = db.list_tickers(ticker_list=ticker_list)

    results = []
    for ticker in tickers:
        # Load DataFrames per timeframe (cache within this ticker)
        dfs: dict[str, pd.DataFrame | None] = {}
        for tf in needed_tfs:
            dfs[tf] = db.load_indicators(ticker, tf, ind_conf_id) if ind_conf_id else db.load_ohlcv(ticker, tf)

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

    run_id = db.log_scan_run(req.config_id, cfg_name, len(results), len(tickers),
                              ind_conf_id=ind_conf_id, timeframes=needed_tfs)
    if results:
        db.save_scan_results(run_id, results)
    return {"run_id": run_id, "count": len(results), "total": len(tickers), "results": results}


@router.get("/scan/history")
def scan_history():
    return {"history": db.get_scan_history()}


@router.get("/scan/runs")
def list_scan_runs():
    return {"runs": db.get_scan_runs()}


@router.get("/scan/runs/{run_id}")
def get_scan_run(run_id: int, timeframe: Optional[str] = None, min_bars: Optional[int] = None):
    tickers = db.get_scan_run_tickers(run_id, timeframe=timeframe, min_bars=min_bars)
    if not tickers:
        raise HTTPException(status_code=404, detail="Scan run not found or no results")
    return {"tickers": tickers}


@router.delete("/scan/runs/{run_id}")
def delete_scan_run(run_id: int):
    db.delete_scan_run(run_id)
    return {"deleted": run_id}


@router.delete("/scan/history")
def clear_scan_history():
    db.clear_scan_history()
    return {"cleared": "scan_history"}
