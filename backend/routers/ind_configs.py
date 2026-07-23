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


def _get_param_descriptions(name: str) -> dict:
    try:
        mod = importlib.import_module(f'backend.indicators.indicators_list.{name}')
        return getattr(mod, 'param_descriptions', {})
    except ImportError:
        return {}


def _get_display_name(name: str) -> str | None:
    try:
        mod = importlib.import_module(f'backend.indicators.indicators_list.{name}')
        return getattr(mod, 'display_name', None)
    except ImportError:
        return None


_PARAM_DESCRIPTIONS = {
    # ── Core / universal ─────────────────────────────────────────────────────
    'period':                "Lookback period in bars for the main calculation.",
    'periods':               "Lookback period(s) in bars. Multiple values produce separate output lines.",
    'left':                  "Bars to the left of a candidate pivot required to be lower/higher — controls how wide a swing must be before it qualifies.",
    'right':                 "Bars to the right of a pivot required to confirm it — adds a lag equal to this many bars before a signal appears.",
    'lookback':              "Rolling window size in bars.",
    'lookback_bars':         "Number of recent bars to include in the calculation. Leave empty to use the full available history.",
    'avg_lookback':          "Number of recent lines to average together into a single composite reference line.",
    'max_aVWAPs':            "Maximum number of aVWAP lines to keep active. When the limit is reached, the oldest line is dropped. Leave empty for no limit.",
    'extend_to_end':         "Extend each VWAP line forward to the current bar rather than stopping at the next same-type event.",
    # ── ZScore / bands ───────────────────────────────────────────────────────
    'std_lookback':          "Rolling window in bars for the standard deviation calculation.",
    'band_std':              "Standard deviation multiplier(s) for the upper and lower bands. Multiple values produce separate band pairs.",
    'show_centreline':       "Show the centreline (mean reference line) alongside the deviation bands.",
    'centreline':            "Method used to compute the mean reference line — e.g. peaks/valleys aVWAP average or SMA.",
    'centreline_params':     "Optional parameter overrides passed to the centreline calculation. Leave empty to use defaults.",
    'sma_periods':           "Period for the Simple Moving Average when SMA is selected as the centreline.",
    # ── aVWAP general ────────────────────────────────────────────────────────
    'show_up':               "Show VWAP lines anchored at upward pivot points (valley anchors).",
    'show_down':             "Show VWAP lines anchored at downward pivot points (peak anchors).",
    'swing_length':          "Number of bars on each side defining a swing high/low used as anchor points.",
    'min_spacing':           "Minimum number of bars between successive anchor points — prevents clustering.",
    'include_max':           "Include local high anchors (downward VWAPs from peaks).",
    'include_min':           "Include local low anchors (upward VWAPs from valleys).",
    # ── aVWAP OB ─────────────────────────────────────────────────────────────
    'include_bull':          "Include VWAPs anchored at bullish (demand) order blocks.",
    'include_bear':          "Include VWAPs anchored at bearish (supply) order blocks.",
    'include_OB_lines':      "Also draw the raw order block zone boundaries alongside the VWAPs.",
    'faded':                 "Draw VWAP lines at reduced opacity after they are mitigated.",
    # ── aVWAP BoS/CHoCH ──────────────────────────────────────────────────────
    'include_bull_aVWAP':    "Include VWAPs anchored at bullish BoS/CHoCH structural events.",
    'include_bear_aVWAP':    "Include VWAPs anchored at bearish BoS/CHoCH structural events.",
    'include_BoS':           "Anchor VWAPs at Break of Structure events (trend continuation confirmation).",
    'include_CHoCH':         "Anchor VWAPs at Change of Character events (potential trend reversal signal).",
    # ── aVWAP QQEMOD ─────────────────────────────────────────────────────────
    'max_anchors':           "Maximum number of anchor points to output, kept in descending order of significance.",
    'peak_to_valley':        "Anchor VWAPs at QQE transitions from bullish to bearish momentum.",
    'valley_to_peak':        "Anchor VWAPs at QQE transitions from bearish to bullish momentum.",
    'peak_to_peak':          "Anchor VWAPs at QQE bullish local peaks (local high-momentum bars).",
    'valley_to_valley':      "Anchor VWAPs at QQE bearish local valleys (local low-momentum bars).",
    # ── aVWAP pinch ──────────────────────────────────────────────────────────
    'anchor_type':           "The primary VWAP type used as the main reference for pinch detection.",
    'anchor_periods':        "Lookback period used to find the primary anchor VWAP.",
    'anchor_max_aVWAPs':     "Maximum number of primary (anchor) VWAPs to consider.",
    'counterpart_periods':   "Lookback period for the opposing VWAPs that must converge toward the primary.",
    'counterpart_max_aVWAPs':"Maximum number of opposing VWAPs to track for convergence detection.",
    'beyond_max_aVWAPs':     "Maximum number of secondary VWAPs to draw beyond the convergence zone.",
    # ── aVWAP anchor score ───────────────────────────────────────────────────
    'valleys':               "Score and output valley (swing low) anchors.",
    'peaks':                 "Score and output peak (swing high) anchors.",
    'min_score_pct':         "Minimum percentile score (0–1) to qualify — candidates below this threshold are discarded. Leave empty for no minimum.",
    'keep_scores':           "Include the raw score values as output columns alongside the VWAP lines.",
    'min_swing_spacing':     "Minimum number of bars between candidate anchor points to prevent clustering.",
    'atr_period':            "ATR period used to normalize price prominence for the anchor scoring calculation.",
    'isolation_max_bars':    "Maximum bars to look outward when measuring how long a swing point remains the local extreme.",
    'sharpness_bars_before': "Number of bars before the swing used to score how sharply price entered the reversal (V-shape left side).",
    'sharpness_bars_after':  "Number of bars after the swing used to score how sharply price exited the reversal (V-shape right side).",
    'w_prominence':          "Weight for swing prominence (depth/significance of the move) in the combined score.",
    'w_isolation':           "Weight for isolation (how long the swing point stays the local extreme) in the combined score.",
    'w_sharpness':           "Weight for reversal sharpness (V-shape speed of entry and exit) in the combined score.",
    # ── BoS / CHoCH ──────────────────────────────────────────────────────────
    'swing_lengths':         "Swing length(s) in bars used to detect structural highs and lows. Multiple values run detection at each length simultaneously.",
    'show_bos':              "Show Break of Structure events (price clears a prior swing in the trend direction — trend continuation).",
    'show_choch':            "Show Change of Character events (price breaks the opposing swing structure — potential trend reversal).",
    'BoS_swing_lengths':     "Override which swing lengths are used for BoS detection. Leave empty to use the main swing_lengths setting.",
    'CHoCH_swing_lengths':   "Override which swing lengths are used for CHoCH detection. Leave empty to use the main swing_lengths setting.",
    # ── SMC structural ────────────────────────────────────────────────────────
    'max_swept':             "Maximum number of swept (triggered) levels/zones to display. Oldest are dropped when exceeded.",
    'max_unswept':           "Maximum number of unswept (untriggered) levels/zones to display. Oldest are dropped when exceeded.",
    'max_mitigated':         "Maximum number of mitigated (price has visited) zones to display.",
    'max_unmitigated':       "Maximum number of unmitigated (unfilled) zones to display.",
    'join_consecutive':      "Merge adjacent zones of the same type into a single larger zone.",
    'range_percent':         "Percentage tolerance for clustering nearby levels — levels within this range of each other are treated as the same zone.",
    'extend_lines':          "Extend unswept levels forward to the current bar rather than stopping at the next structural event.",
    'OB_params':             "Parameters for the underlying order block detection used as VWAP anchors.",
    'gaps_params':           "Parameters for the underlying gap detection used as VWAP anchors.",
    'peaks_valleys_params':  "Parameters for the underlying peak/valley detection used to build the reference lines.",
    # ── Supertrend ───────────────────────────────────────────────────────────
    'multiplier':            "ATR multiplier controlling how far the trailing band extends from price — higher values produce fewer but more reliable trend-change signals.",
    # ── WAE ──────────────────────────────────────────────────────────────────
    'fast_period':           "Fast EMA period for the MACD component — shorter values react more quickly to momentum shifts.",
    'slow_period':           "Slow EMA period for the MACD component — longer values provide the stable baseline trend reference.",
    'explosion_multiplier':  "Dead Zone threshold multiplier — signals below this multiple of the volatility baseline are filtered as low-conviction.",
    # ── Banker RSI ───────────────────────────────────────────────────────────
    'rsi_base':              "Neutral RSI reference level (typically 50) used as the midpoint for divergence measurement.",
    'sensitivity':           "Scaling factor applied to the divergence output — higher values amplify the signal magnitude.",
    # ── Oscillation Volatility ────────────────────────────────────────────────
    'include_ma_output':     "Include the composite aVWAP centreline as an output column alongside the oscillation scores.",
    'min_cross_std':         "Minimum deviation in standard deviation units at a crossing to count as a valid oscillation — filters out noise.",
    # ── QQEMOD ───────────────────────────────────────────────────────────────
    'rsi_period':            "RSI lookback period for the primary QQE signal.",
    'rsi_period2':           "RSI lookback period for the secondary QQE confirmation signal.",
    'sf':                    "EMA smoothing factor applied to the primary RSI before the QQE band calculation.",
    'sf2':                   "EMA smoothing factor applied to the secondary RSI before the QQE band calculation.",
    'qqe_factor':            "ATR multiplier for the primary QQE dynamic bands — higher values widen the bands and slow their reaction speed.",
    'qqe_factor2':           "ATR multiplier for the secondary QQE dynamic bands.",
    'threshold':             "QQE2 level threshold — the secondary signal must cross this value to confirm a trend state.",
    'bb_length':             "Bollinger Band period applied to the QQE line for detecting extreme readings. Also used as Bollinger period in TTM Squeeze.",
    'bb_multi':              "Bollinger Band standard deviation multiplier for the QQE extreme reading filter.",
    # ── TTM Squeeze ──────────────────────────────────────────────────────────
    'bb_std_dev':            "Bollinger Band standard deviation multiplier — wider bands reduce squeeze sensitivity.",
    'kc_length':             "Keltner Channel lookback period used for the squeeze detection comparison.",
    'kc_mult':               "Keltner Channel ATR multiplier — larger values widen the channel and make squeezes less frequent.",
    'use_true_range':        "Use True Range (accounts for overnight gaps) instead of High−Low for the Keltner Channel ATR.",
    # ── Divergence ───────────────────────────────────────────────────────────
    'show_regular':          "Show regular divergences — price makes a new extreme but the oscillator does not, signalling a potential reversal.",
    'show_hidden':           "Show hidden divergences — oscillator makes a new extreme but price does not, signalling trend continuation.",
    'show_labels':           "Replace shape markers with arrows and oscillator name labels for clearer source identification.",
    'show_markers':          "Show shape markers at divergence pivot bars — squares for regular divergences, circles for hidden.",
    'show_wicks':            "Highlight the wick and border of candles at divergence pivot bars in aqua (bullish) or red (bearish).",
    'show_candles':          "Color the full candle body aqua (bullish) or red (bearish) at divergence pivot bars.",
    'show_pivots':           "Draw comparison lines connecting the two price pivot points being compared, showing the divergence structure.",
    'RSI':                   "Use Relative Strength Index as a divergence source.",
    'MACD':                  "Use MACD histogram as a divergence source.",
    'OBV':                   "Use On-Balance Volume as a divergence source.",
    'ATR':                   "Use Average True Range as a divergence source.",
    'Fisher':                "Use the Fisher Transform as a divergence source.",
    'Fractal':               "Use Bill Williams Fractals as a divergence source.",
    'MFI':                   "Use Money Flow Index as a divergence source.",
    'Momentum':              "Use price Momentum oscillator as a divergence source.",
    'Stochastic':            "Use Stochastic %K/%D as a divergence source.",
    'Volume':                "Use raw Volume as a divergence source.",
    'Vortex':                "Use the Vortex Indicator (VI+ vs VI−) as a divergence source.",
    'macd_fast':             "MACD fast EMA period.",
    'macd_slow':             "MACD slow EMA period.",
    'macd_signal':           "MACD signal line EMA period.",
    'stoch_d':               "Stochastic %D smoothing period applied to %K.",
    'smooth_period':         "EMA smoothing period applied to the raw Momentum value to reduce noise.",
    'volume_threshold':      "MFI volume multiplier — bars with volume below this multiple of the average are excluded from MFI signals.",
    'vol_filter':            "Only trigger Fractal divergence signals when the pivot bar's volume is above the rolling average.",
    # ── Candle colors ─────────────────────────────────────────────────────────
    'indicator_color':       "The indicator used to determine candle color. Changing this updates the sub-parameters automatically.",
    'custom_params':         "Parameters passed to the selected color indicator. Updated automatically when indicator_color changes.",
    # ── POC ───────────────────────────────────────────────────────────────────
    'num_levels':            "Number of Point of Control price levels to identify and plot simultaneously.",
}

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
    # Merge per-indicator param_descriptions into global defaults
    merged_param_desc: Dict[str, str] = dict(_PARAM_DESCRIPTIONS)
    for name in available:
        per_ind = _get_param_descriptions(name)
        merged_param_desc.update(per_ind)
    return {"available": available, "defaults": defaults,
            "param_options": param_options, "param_labels": param_labels,
            "display_names": display_names, "param_separators": param_separators,
            "descriptions": descriptions, "param_descriptions": merged_param_desc}
