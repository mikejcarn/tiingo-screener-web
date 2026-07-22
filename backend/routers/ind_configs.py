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


_DESCRIPTIONS = {
    'aVWAP_anchor_score':    "Ranks every candidate swing point by three criteria — prominence (how significant the swing is relative to surrounding bars), isolation (how long it remains the local extreme), and reversal sharpness (how quickly price entered and exited the swing, i.e. a V-shape). Each is percentile-ranked, then combined into a weighted score. Only the top-scoring anchors are kept and labelled by quality rank (q1 = best), making this useful for filtering the most meaningful aVWAP anchors.",
    'aVWAP_BoS_CHoCH':      "Anchors VWAPs at Break of Structure and Change of Character events in price action. A BoS occurs when price breaks a prior swing high/low in the direction of the trend (continuation). A CHoCH occurs when price breaks the opposite swing (potential reversal). VWAPs anchored at these structural events provide dynamic support/resistance levels that update as market structure evolves.",
    'aVWAP_gaps':            "Anchors VWAPs at the origin of price gaps (where the open of a candle skips away from the prior close). These levels track how price interacts with volume-weighted price as measured from the gap point, often acting as support or resistance when price returns to fill the gap.",
    'aVWAP_minmax':          "Anchors VWAPs at significant local highs and lows identified by a greedy extrema algorithm. Unlike simple rolling max/min, this uses spacing constraints to avoid clustering anchors together, producing a set of well-separated, meaningful turning points from which to measure volume-weighted price.",
    'aVWAP_OB':              "Anchors VWAPs at order block formations — areas where institutional order flow was likely concentrated before a strong move. The VWAP from these anchor points tracks how price interacts with volume-weighted levels relative to where institutions likely entered, often relevant when price returns to test the order block zone.",
    'aVWAP_peaks':           "Anchors VWAPs at detected swing high points. The resulting VWAP lines measure volume-weighted price from each peak, typically sloping downward as more volume accumulates below the anchor. Useful for identifying overhead supply zones and how price behaves relative to volume from prior highs.",
    'aVWAP_pinch':           "Identifies areas where multiple aVWAP lines converge to a tight cluster (a 'pinch'). Convergence of VWAPs from different anchors signals compressed price action and reduced market conviction, which often precedes a significant directional move when one VWAP separates from the others.",
    'aVWAP_QQEMOD':          "Anchors VWAPs at momentum signal transitions identified by the QQE Mod indicator. These anchors mark points where the QQE momentum model detected a significant shift in trend, combining volume-weighted price analysis with momentum-based context for where a trend may have begun.",
    'aVWAP_valleys':         "Anchors VWAPs at detected swing low points. The resulting VWAP lines measure volume-weighted price from each trough, typically sloping upward as more volume accumulates above the anchor. Useful for identifying demand zones and how price behaves relative to volume from prior lows.",
    'banker_RSI':            "A modified RSI designed to detect institutional accumulation. It measures the divergence between a slow RSI (capturing longer-term price change) and a fast RSI (capturing short-term noise), scaling the result to highlight when 'smart money' is accumulating or distributing against the dominant retail flow. High positive readings suggest institutional buying; high negative readings suggest distribution.",
    'BoS_CHoCH':             "Detects structural shifts in price action using Smart Money Concepts. A Break of Structure (BoS) is when price clears a prior swing high (in an uptrend) or low (in a downtrend), confirming trend continuation. A Change of Character (CHoCH) is when price breaks the opposing swing structure, signalling a potential trend reversal before the larger move has fully played out.",
    'candle_colors':         "Colors each candlestick body based on the reading of a chosen momentum or volatility indicator (QQEMOD, RSI, Z-Score, Banker RSI, WAE, Supertrend, or TTM Squeeze). Provides an at-a-glance visual read of market state directly on the price chart without requiring a separate pane.",
    'divergence':            "Detects divergence between price action and one or more momentum oscillators. Regular bullish divergence (price makes a lower low, oscillator makes a higher low) suggests a potential reversal to the upside. Regular bearish divergence (price higher high, oscillator lower high) suggests a potential reversal to the downside. Hidden divergences signal trend continuation. Supports RSI, MACD, OBV, ATR, Fisher, Fractal, MFI, Momentum, Stochastic, Volume, and Vortex.",
    'FVG':                   "Marks Fair Value Gaps — price imbalances where a three-candle sequence leaves an uncovered range (the body of the middle candle does not overlap with the wicks of the first or third). These gaps represent areas where price moved too quickly for two-sided trading to occur and are used in Smart Money Concepts as areas where price is likely to return to 'fill' the imbalance.",
    'gaps':                  "Identifies and tracks traditional price gaps — areas where the open of one bar is separated from the close of the previous bar, leaving a gap in the price chart. Unmitigated gaps (not yet filled) are tracked as potential support or resistance zones, since price often returns to close them.",
    'liquidity':             "Identifies swing highs and lows where stop-loss orders from retail traders tend to cluster. Marks when price sweeps through these levels (a 'liquidity grab') — a move designed to trigger those stops — before reversing. These sweeps are key signals in Smart Money Concepts for identifying potential institutional entry points after stop-hunting behavior.",
    'OB':                    "Identifies Order Blocks — the last bullish or bearish candle before a strong impulsive move in the opposite direction. These zones represent areas of likely institutional order flow and often act as significant support or resistance when price returns to them, as unfilled orders from the initial move may still be resting there.",
    'oscillation_volatility':"Measures how frequently and how far price crosses a dynamic centreline (aVWAP peaks/valleys average). Outputs three values: the number of crossings in a lookback window (cross count), the average deviation magnitude at each cross normalized by rolling standard deviation, and a composite oscillation score (cross count × avg deviation). High scores indicate choppy/oscillating price action; low scores indicate trending behavior with few mean-reversions.",
    'peaks_valleys':         "Identifies significant swing highs (peaks) and swing lows (valleys) using a rolling window that checks whether a bar is the highest high or lowest low over a centered window of a given period. These structural pivot points form the foundation for anchored VWAP calculations, divergence detection, and structural analysis throughout the indicator set.",
    'POC':                   "Calculates the Point of Control — the price level with the highest traded volume over a lookback period — using a discretized volume profile. The POC acts as a strong price magnet: price tends to gravitate toward it during consolidation and often reacts at it during trending phases. Multiple POC levels can be plotted simultaneously.",
    'QQEMOD':                "A two-signal momentum indicator built on a double-smoothed RSI with ATR-based dynamic bands. The primary QQE signal uses a Wilder-smoothed RSI filtered through an exponentially smoothed ATR to create adaptive upper and lower trailing bands. A secondary QQE signal with different parameters adds confirmation. Bollinger Bands on the QQE line provide an additional filter for extreme readings. The combination produces trend signals with significantly less noise than a raw RSI.",
    'RSI':                   "The Relative Strength Index measures the speed and magnitude of price changes on a scale of 0 to 100. Calculated as the ratio of average gains to average losses over a period. Readings above 70 conventionally indicate overbought conditions; below 30 indicate oversold. Can be run at multiple periods simultaneously. Often used as an input to divergence detection.",
    'SMA':                   "Simple Moving Average smooths price by averaging the closing price over a specified period, reducing noise and revealing the underlying trend direction. Multiple periods can be plotted simultaneously (e.g. 50, 100, 200) to observe trend structure at different timescales and identify dynamic support/resistance.",
    'supertrend':            "An ATR-based trend-following indicator that plots a trailing band above price during downtrends and below price during uptrends. The band flips sides on a trend reversal signal, providing clear visual direction. The ATR multiplier controls sensitivity — a higher multiplier produces fewer but more reliable signals; a lower multiplier reacts more quickly but generates more noise.",
    'TTM_squeeze':           "Identifies periods of compressed volatility called 'squeezes' — when Bollinger Bands (measuring recent price volatility) contract to fit entirely inside Keltner Channels (measuring average true range). A squeeze signals that explosive price movement is building. When Bollinger Bands expand back outside the Keltner Channels, the squeeze fires and indicates a potential breakout move in the direction of momentum.",
    'WAE':                   "The Waddah Attar Explosion combines MACD-derived momentum with Bollinger Band width to measure both the direction and explosive strength of a price move. The indicator distinguishes between genuine breakout momentum and ordinary price oscillation by requiring both strong MACD divergence and expanding Bollinger Bands simultaneously. Particularly useful for filtering out false breakouts during low-momentum conditions.",
    'ZScore':                "Normalizes price deviation from a dynamic centreline (aVWAP average, order block average, SMA, etc.) into standard deviation units, making extreme price levels statistically comparable across different assets and timeframes. Also plots configurable upper and lower band thresholds (e.g. ±2σ) as potential mean-reversion targets. A Z-score above +2 indicates price is significantly extended above its mean; below −2 indicates significant underextension.",
}

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
    descriptions = {name: _DESCRIPTIONS[name] for name in available if name in _DESCRIPTIONS}
    return {"available": available, "defaults": defaults,
            "param_options": param_options, "param_labels": param_labels,
            "display_names": display_names, "param_separators": param_separators,
            "descriptions": descriptions}
