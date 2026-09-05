"""
Maps configured indicator names to the columns they own, for the chart's
per-indicator show/hide toggle panel.

Only covers indicators that produce fixed, static columns computed once and
left alone. Indicators driven by the client-side DynamicVWAPEngine
(aVWAP_peaks, aVWAP_valleys, aVWAP_QQEMOD, aVWAP_OB, aVWAP_BoS_CHoCH,
aVWAP_gaps, aVWAP_price_maxima_minima) build and tear down their own line
series continuously during replay rather than owning a fixed column set, so
they aren't represented here — an indicator with no matcher below (or one
that matched zero columns) simply doesn't appear in the toggle panel.
"""
import re

# aVWAP_peak_c<N>_<idx> / aVWAP_valley_c<N>_<idx> belong to the dynamic
# aVWAP_peaks/aVWAP_valleys engine, not aVWAP_pinch's plain aVWAP_peak_<idx>/
# aVWAP_valley_<idx> anchor columns — same distinction col_styles.py draws.
_DYNAMIC_PEAK_VALLEY_RE = re.compile(r'^aVWAP_(?:peak|valley)_c\d+_')

_MATCHERS = {
    'SMA':                 lambda col: col.startswith('SMA_'),
    'ZScore':              lambda col: col.startswith('ZScore'),
    'RSI':                 lambda col: col == 'RSI',
    'banker_RSI':          lambda col: col == 'banker_RSI',
    'WAE':                 lambda col: col.startswith('WAE_'),
    'supertrend':          lambda col: col.startswith('Supertrend_'),
    'TTM_squeeze':         lambda col: col.startswith('TTM_squeeze'),
    'candle_colors':       lambda col: col in ('color', 'Fill_Color'),
    'aVWAP_minmax':        lambda col: col.startswith('aVWAP_max_') or col.startswith('aVWAP_min_'),
    'aVWAP_volume_fit':    lambda col: col.startswith('BFIT_'),
    'aVWAP_liquidity_fit': lambda col: col.startswith('LFIT_'),
    'aVWAP_curve_fit':     lambda col: col.startswith('CFIT_'),
    'aVWAP_pinch':         lambda col: (
        (col.startswith('aVWAP_peak_') or col.startswith('aVWAP_valley_') or col.startswith('aVWAP_pinch_'))
        and not _DYNAMIC_PEAK_VALLEY_RE.match(col)
    ),
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
