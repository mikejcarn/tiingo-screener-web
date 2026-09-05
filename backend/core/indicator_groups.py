"""
Maps configured indicator names to the columns they own, for the chart's
per-indicator show/hide toggle panel.

Covers indicators that produce fixed columns computed once and left alone —
either drawn directly as static lines (col_styles.py), or, for the segment-
backed ones (FVG/OB/BoS_CHoCH/liquidity/gaps), consumed by replay_events.py
to build the segments chart.js renders via its separate _segSeries/
_buildSegments mechanism instead of this._lines. SEGMENT_TYPE_BY_INDICATOR
tells the frontend which of those columns-having indicators are actually
segment-backed, so it can route their toggle to setSegmentVisible instead of
setIndicatorVisible (chart.js has no this._lines entries for these — a plain
setIndicatorVisible call would silently no-op).

Indicators driven by the client-side DynamicVWAPEngine (aVWAP_peaks,
aVWAP_valleys, aVWAP_QQEMOD, aVWAP_OB, aVWAP_BoS_CHoCH, aVWAP_gaps,
aVWAP_price_maxima_minima) build and tear down their own line series
continuously during replay rather than owning a fixed column set, so they
aren't represented here — an indicator with no matcher below (or one that
matched zero columns) simply doesn't appear in the toggle panel.
"""
import re

# aVWAP_peak_c<N>_<idx> / aVWAP_valley_c<N>_<idx> belong to the dynamic
# aVWAP_peaks/aVWAP_valleys engine, not aVWAP_pinch's plain aVWAP_peak_<idx>/
# aVWAP_valley_<idx> anchor columns — same distinction col_styles.py draws.
_DYNAMIC_PEAK_VALLEY_RE = re.compile(r'^aVWAP_(?:peak|valley)_c\d+_')

# BoS_CHoCH.py's raw columns carry a per-swing-length numeric suffix
# (BoS_25, CHoCH_25, BoS_CHoCH_Price_25, BoS_CHoCH_Break_Index_25). Anchored
# to require that trailing \d+ so this doesn't also catch aVWAP_averages'
# unrelated 'BoS_CHoCH_avg' (/'_avg_N') column — a plain startswith('BoS_')
# would.
_BOS_CHOCH_RE = re.compile(r'^(?:BoS|CHoCH)_\d+$|^BoS_CHoCH_(?:Price|Break_Index)_\d+$')

_MATCHERS = {
    'SMA':                 lambda col: col.startswith('SMA_'),
    'ZScore':              lambda col: col.startswith('ZScore'),
    'RSI':                 lambda col: col == 'RSI',
    'banker_RSI':          lambda col: col == 'banker_RSI',
    'WAE':                 lambda col: col.startswith('WAE_'),
    'supertrend':          lambda col: col.startswith('Supertrend_'),
    'TTM_squeeze':         lambda col: col.startswith('TTM_squeeze'),
    'candle_colors':       lambda col: col in ('color', 'Fill_Color'),
    'aVWAP_minmax':        lambda col: (
        col.startswith('aVWAP_max_') or col.startswith('aVWAP_min_') or col.startswith('aVWAP_minmax_')
    ),
    'aVWAP_volume_fit':    lambda col: col.startswith('BFIT_'),
    'aVWAP_liquidity_fit': lambda col: col.startswith('LFIT_'),
    'aVWAP_curve_fit':     lambda col: col.startswith('CFIT_'),
    'aVWAP_pinch':         lambda col: (
        (col.startswith('aVWAP_peak_') or col.startswith('aVWAP_valley_') or col.startswith('aVWAP_pinch_'))
        and not _DYNAMIC_PEAK_VALLEY_RE.match(col)
    ),
    # Segment-backed — see module docstring. Exact-set/regex, not a bare
    # prefix: 'OB_' would also catch aVWAP_averages' 'OB_avg', 'Gap_' would
    # also catch aVWAP_gaps' 'Gap_Up_aVWAP_*' dynamic-engine columns, etc.
    'FVG':       lambda col: col in ('FVG', 'FVG_High', 'FVG_Low', 'FVG_Mitigated_Index'),
    'OB':        lambda col: col in ('OB', 'OB_High', 'OB_Low', 'OB_Mitigated_Index'),
    'BoS_CHoCH': lambda col: bool(_BOS_CHOCH_RE.match(col)),
    'liquidity': lambda col: col in ('Liquidity', 'Liquidity_Level', 'Liquidity_Swept'),
    'gaps':      lambda col: col in (
        'Gap_Up', 'Gap_Down', 'Gap_Up_High', 'Gap_Up_Low',
        'Gap_Down_High', 'Gap_Down_Low', 'Gap_Up_Mitigated', 'Gap_Down_Mitigated',
    ),
}

# {indicator_name: segment type key} — matches the 'type' chart.js's
# _buildSegments/_segSeries key on (frontend/js/chart.js, replay_events.py's
# extract_events 'fvg'/'ob'/'bos'/'liq'/'gap' keys).
SEGMENT_TYPE_BY_INDICATOR = {
    'FVG':       'fvg',
    'OB':        'ob',
    'BoS_CHoCH': 'bos',
    'liquidity': 'liq',
    'gaps':      'gap',
}


def columns_by_indicator(indicator_list: list, columns: list) -> dict:
    """
    Returns {indicator_name: [matching columns]} for whichever configured
    indicators (from load_config_from_db's indicator_list) have a known
    matcher above and actually produced columns present in this result.
    """
    result = {}
    for name in indicator_list:
        matcher = _MATCHERS.get(name)
        if not matcher:
            continue
        cols = [c for c in columns if matcher(c)]
        if cols:
            result[name] = cols
    return result


def segment_indicators(indicator_columns: dict) -> dict:
    """
    {indicator_name: segment_type} for whichever segment-backed indicators
    actually matched columns in this result (per columns_by_indicator) — the
    frontend uses this to route those names to setSegmentVisible instead of
    setIndicatorVisible.
    """
    return {name: SEGMENT_TYPE_BY_INDICATOR[name]
            for name in indicator_columns if name in SEGMENT_TYPE_BY_INDICATOR}
