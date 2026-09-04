# import pandas as pd
# from backend.indicators.indicators import get_indicators
# from backend.core.color_palette import get_color_palette
#
#
# def calculate_candle_colors(df, indicator_color='StDev', custom_params=None):
#     """
#     Enhanced candle color calculator with customizable parameters
#   
#     Parameters:
#         df (pd.DataFrame): Input price data
#         indicator_color (str): Indicator to use for coloring
#         custom_params (dict): Optional parameter overrides by indicator
#             Example: {'StDev': {'std_lookback': 60}, 'TTM_squeeze': {'bb_std_dev': 1.5}}
#           
#     Returns:
#         dict: {'color': pd.Series of colors matching df index}
#     """
#
#     # Indicator Color Options: 
#     # 'ZScore', 'StDev', 'RSI', 'QQEMOD', 'banker_RSI', 'WAE', 'supertrend', 'TTM_squeeze'
#
#     # Default parameters for supported indicators
#     default_params = {
#         'ZScore': {
#             'centreline': 'peaks_valleys_avg',
#             'peaks_valleys_params': {'periods': 20, 'max_aVWAPs': None},
#             'std_lookback': 75,
#             'avg_lookback': 20
#         },
#         'StDev': {
#             'centreline': 'peaks_valleys_avg',
#             'peaks_valleys_params': {'periods': 100, 'max_aVWAPs': None},
#             'std_lookback': 100,
#             'avg_lookback': 10,
#         },
#         'TTM_squeeze': {
#             'bb_length': 20,
#             'bb_std_dev': 2.0,
#             'kc_length': 20,
#             'kc_mult': 1.5,
#             'use_true_range': True
#         },
#         'QQEMOD': {
#             'rsi_period': 8, 
#             'rsi_period2': 4,
#             'sf': 8,
#             'sf2': 4,
#             'qqe_factor': 3.0,
#             'qqe_factor2': 1.61,
#             'threshold': 3,
#             'bb_length': 10,
#             'bb_multi': 0.35,
#         },
#         'banker_RSI': {},
#         'WAE': {},
#         'supertrend': {}
#     }
#
#     # Merge custom parameters with defaults
#     if custom_params:
#         for indicator, params in custom_params.items():
#             if indicator in default_params:
#                 default_params[indicator].update(params)
#
#     df = get_indicators(df, [indicator_color], default_params)
#
#     # Get colors from indicator data
#     colors = get_color_palette()
#
#     # Define color mapping functions ------------------------------------------
#
#     def map_zscore(zscore):
#         if          zscore <= -3.0: return colors['magenta']
#         elif -3.0 < zscore <= -2.5: return colors['red_dark']
#         elif -2.5 < zscore <= -2.0: return colors['red']
#         elif -2.0 < zscore <= -1.5: return colors['red']
#         elif -1.5 < zscore <= -1.0: return colors['red_trans_3']
#         elif -1.0 < zscore <= -0.5: return colors['red_trans_2']
#         elif -0.5 < zscore <=    0: return colors['red_trans_1'] 
#         elif    0 < zscore <=  0.5: return colors['teal_trans_1'] 
#         elif  0.5 < zscore <=  1.0: return colors['teal_trans_2']
#         elif  1.0 < zscore <=  1.5: return colors['teal_trans_3']
#         elif  1.5 < zscore <=  2.0: return colors['teal_trans_3']
#         elif  2.0 < zscore <=  2.5: return colors['teal']
#         elif  2.5 < zscore <=  3.0: return colors['teal']
#         elif  3.0 < zscore:         return colors['neon']
#         return colors['black']
#
#     def map_stdev(row):
#         devs = (row['Close'] - row['StDev_Mean']) / row['StDev']
#         if devs >= 3.0: return colors['neon']
#         elif 2.5 <= devs < 3.0: return colors['neon']
#         elif 2.0 <= devs < 2.5: return colors['neon']
#         elif 1.5 <= devs < 2.0: return colors['aqua']
#         elif 1.0 <= devs < 1.5: return colors['teal']
#         elif 0.5 <= devs < 1.0: return colors['teal_trans_2']
#         elif 0.0 <= devs < 0.5: return colors['black']
#         elif devs <= -3.0: return colors['magenta']
#         elif -3.0 < devs <= -2.5: return colors['magenta']
#         elif -2.5 < devs <= -2.0: return colors['magenta']
#         elif -2.0 < devs <= -1.5: return colors['red_dark']
#         elif -1.5 < devs <= -1.0: return colors['red']
#         elif -1.0 < devs <= -0.5: return colors['red_trans_2']
#         elif -0.5 < devs < 0.0: return colors['black']
#         return colors['black']
#
#     def map_banker_RSI(banker_RSI):
#         if    15 <= banker_RSI <=   20: return colors['neon']
#         elif  11 <= banker_RSI <= 14.9: return colors['aqua']
#         elif 5.1 <= banker_RSI <=   10: return colors['teal']
#         elif 0.1 <= banker_RSI <=    5: return colors['teal_trans_3']
#         elif 0.0 <= banker_RSI <=    0.1: return colors['black']
#         return colors['black']
#
#     def map_RSI(RSI):
#         if    0 < RSI <=  30: return colors['red_dark']
#         elif 30 < RSI <=  35: return colors['red_trans_3']
#         elif 35 < RSI <=  40: return colors['red_trans_2']
#         elif 40 < RSI <=  45: return colors['red_trans_1']
#         elif 45 < RSI <=  50: return colors['red_trans_0']
#         elif 50 < RSI <=  55: return colors['teal_trans_0']
#         elif 55 < RSI <=  60: return colors['teal_trans_1']
#         elif 60 < RSI <=  65: return colors['teal_trans_2']
#         elif 65 < RSI <=  70: return colors['teal_trans_3']
#         elif 70 < RSI <= 100: return colors['aqua']
#         return colors['black']
#
#     def map_QQEMOD(row):
#         if row['QQE1_Above_Upper'] and row['QQE2_Above_Threshold']:
#             return colors['teal'] if row['QQE2_Above_TL'] else colors['teal_trans_3']
#         elif row['QQE1_Below_Lower'] and row['QQE2_Below_Threshold']:
#             return colors['red'] if not row['QQE2_Above_TL'] else colors['red_trans_3']
#         elif row['QQE2_Above_Threshold']: return colors['teal_trans_2']  
#         elif row['QQE2_Below_Threshold']: return colors['red_trans_2']  
#         return colors['black']
#
#     def map_WAE(row):
#         direction = row['WAE_Direction']
#         momentum = row['WAE_Momentum']
#         is_exploding = row['WAE_Upper'] > df['WAE_Upper'].mean()
#         if direction < 0:
#             if   momentum > 3.0: return colors['red_dark'] if is_exploding else colors['red']
#             elif momentum > 2.0: return colors['red_dark'] if is_exploding else colors['red_trans_3']
#             elif momentum > 1.0: return colors['red_dark'] if is_exploding else colors['red_trans_3']
#             elif momentum > 0.5: return colors['red_trans_2']
#         else:
#             if   momentum > 3.0: return colors['aqua'] if is_exploding else colors['teal']
#             elif momentum > 2.0: return colors['aqua'] if is_exploding else colors['teal_trans_3']
#             elif momentum > 1.0: return colors['aqua'] if is_exploding else colors['teal_trans_3']
#             elif momentum > 0.5: return colors['teal_trans_2']
#         return colors['black']
#
#     def map_TTM_squeeze(row):
#         if row['TTM_squeeze_Active'] == 1: return colors['orange']
#         else: return colors['black']
#
#     def map_supertrend(row):
#         return colors['teal'] if row['Supertrend_Direction'] > 0 else colors['red']
#
#     # Create a mapping of indicator to their color functions
#     color_mappers = {
#         'ZScore': lambda df: df['ZScore'].apply(map_zscore),
#         'RSI': lambda df: df['RSI'].apply(map_RSI),
#         'banker_RSI': lambda df: df['banker_RSI'].apply(map_banker_RSI),
#         'StDev': lambda df: df.apply(map_stdev, axis=1),
#         'QQEMOD': lambda df: df.apply(map_QQEMOD, axis=1),
#         'WAE': lambda df: df.apply(map_WAE, axis=1),
#         'supertrend': lambda df: df.apply(map_supertrend, axis=1),
#         'TTM_squeeze': lambda df: df.apply(map_TTM_squeeze, axis=1),
#     }
#
#     # Get the base indicator name (before _color)
#     base_indicator = indicator_color.split('_color')[0] if '_color' in indicator_color else indicator_color
#  
#     # Apply only the needed color mapping
#     if base_indicator in color_mappers:
#         color_series = color_mappers[base_indicator](df)
#         return {'color': color_series}
#  
#     return {'color': pd.Series([colors['black']] * len(df), index=df.index)}
#
#
# def calculate_indicator(df, **params):
#     return calculate_candle_colors(df, **params)





import numpy as np
import pandas as pd
from backend.indicators.indicators import get_indicators
from backend.core.color_palette import get_color_palette
from backend.indicators.indicators_list.aVWAP import calculate_avwap, calculate_avwap_stdev


def _zscore_bucket_color(colors, z):
    """Diverging teal/red ladder shared by the ZScore and aVWAPStDev color
    modes — teal above zero (overbought side), red below (oversold side).

    8 buckets at the classic 1/2/3-stdev breakpoints (3 per side + a tail),
    not the finer 0.5-wide, 14-bucket version this used to be. That finer
    version looked like it had 14 distinct steps, but every step was the
    same RGB as its same-side neighbors at a different alpha — and candle
    borders/wicks always render at full opacity (chart.js flattens alpha to
    1.0 there), so those neighbors drew an identical border and were only
    told apart by a sliver of body-fill opacity. Measured with the dataviz
    skill's validate_palette.js against both this app's chart surfaces
    (#000 dark, #f8f3eb light): 6 real, distinct-lightness steps per side
    still fails the normal-vision separation floor for adjacent zones
    (worst ΔE ~6.5 of a required >=15) — there just isn't room for that many
    reliably-distinct steps in one hue on this contrast budget. 3 steps per
    side clears it (>=15.6) with margin, so that's the ceiling. Tails
    (beyond +/-3 stdev) hue-shift to magenta/neon, same escalating-intensity
    convention banker_RSI's color map already uses."""
    if          z <= -3.0: return colors['magenta']
    elif -3.0 < z <= -2.0: return colors['stdev_red_3']
    elif -2.0 < z <= -1.0: return colors['stdev_red_2']
    elif -1.0 < z <=    0: return colors['stdev_red_1']
    elif    0 < z <=  1.0: return colors['stdev_teal_1']
    elif  1.0 < z <=  2.0: return colors['stdev_teal_2']
    elif  2.0 < z <=  3.0: return colors['stdev_teal_3']
    elif  3.0 < z:         return colors['neon']
    return colors['black']

# Sub-params shown per centreline mode. Keys must match the **kwargs names that
# ZScore / StDev forward to their sub-indicators.

display_name = "Candlestick Colors"
_CENTRELINE_SUB_DEFAULTS = {
    'peaks_valleys_avg': {'periods': 20, 'max_aVWAPs': None},
    'gaps_avg':          {'max_aVWAPs': 10},
    'OB_avg':            {'periods': 20, 'max_aVWAPs': None},
    'SMA':               {'sma_periods': 75},
}

# User-facing params per color mode (exposed to UI as sub-param groups).
_SUB_DEFAULTS = {
    'ZScore': {
        'std_lookback': 75, 'avg_lookback': 20,
        'centreline': 'peaks_valleys_avg',
        'centreline_params': dict(_CENTRELINE_SUB_DEFAULTS['peaks_valleys_avg']),
    },
    'QQEMOD':           {'rsi_period': 6, 'rsi_period2': 5, 'sf': 5, 'sf2': 5,
                         'qqe_factor': 3.0, 'qqe_factor2': 1.61, 'threshold': 3,
                         'bb_length': 50, 'bb_multi': 0.35},
    'RSI':              {'periods': 14},
    'banker_RSI':       {'rsi_period': 50, 'rsi_base': 50, 'sensitivity': 1.5},
    'WAE':              {'fast_period': 20, 'slow_period': 40, 'atr_period': 20, 'explosion_multiplier': 2.0},
    'supertrend':       {'periods': 14, 'multiplier': 3},
    'TTM_squeeze':      {'bb_length': 20, 'bb_std_dev': 2.0,
                         'kc_length': 20, 'kc_mult': 1.5, 'use_true_range': True},
    # anchor_type/anchor_periods/anchor_max_aVWAPs use the same names as
    # aVWAP_pinch's own params — set matching values on both indicators to
    # scope this coloring to the same fan.
    'RelVolume':        {'anchor_type': 'peak', 'anchor_periods': 100, 'anchor_max_aVWAPs': 1, 'vol_span': 15},
    # Same anchor detection as RelVolume/aVWAP_pinch — set matching values on
    # all three to scope them to the same fan.
    'aVWAPStDev':       {'anchor_type': 'peak', 'anchor_periods': 100, 'anchor_max_aVWAPs': 1},
}

# Consumed by _get_indicator_defaults: top-level param defaults shown in editor.
defaults = {
    'indicator_color': 'QQEMOD',
    'custom_params':   dict(_SUB_DEFAULTS['QQEMOD']),
}

# Consumed by _get_param_options: tells the UI which sub-params to swap
# when the user changes indicator_color or centreline.
param_options = {
    'indicator_color': _SUB_DEFAULTS,
    'centreline':      _CENTRELINE_SUB_DEFAULTS,
}

# Merged into the app-wide param tooltip dict (backend/routers/ind_configs.py)
# keyed by param name alone, so only genuinely new keys belong here — anchor_type
# etc. already have tooltips contributed by aVWAP_pinch.py.
param_descriptions = {
    'vol_span': (
        "RelVolume only. How many recent bars define 'normal' volume, as an "
        "exponentially-weighted average — recent bars count more, older ones "
        "fade out gradually rather than dropping off a hard window edge, so "
        "the sense of 'normal' doesn't drift the longer the pinch range runs. "
        "Each bar's opacity is then driven by log(volume ÷ this average): equal "
        "multiples (2x, 4x, 8x...) add equal opacity, so an extreme spike still "
        "reads as more intense than a moderate one instead of both clipping to "
        "the same full color. Also sets how many bars must accumulate in a "
        "range before its saturation point (what counts as 'fully opaque') "
        "starts auto-calibrating off that range's own 95th-percentile "
        "deviation, instead of using a fixed fallback."
    ),
}


def calculate_candle_colors(df, indicator_color='QQEMOD', custom_params=None):
    """
    Enhanced candle color calculator with customizable parameters

    Parameters:
        df (pd.DataFrame): Input price data
        indicator_color (str): Indicator to use for coloring
            Options: 'ZScore', 'RSI', 'QQEMOD', 'banker_RSI', 'WAE', 'supertrend', 'TTM_squeeze'
        custom_params (dict): Optional parameter overrides for the selected indicator

    Returns:
        dict: {'color': pd.Series of colors matching df index}
    """

    if indicator_color == 'RelVolume':
        params = dict(_SUB_DEFAULTS['RelVolume'])
        if custom_params:
            params.update(custom_params)
        return {'Fill_Color': _relvolume_colors(df, **params)}

    if indicator_color == 'aVWAPStDev':
        params = dict(_SUB_DEFAULTS['aVWAPStDev'])
        if custom_params:
            params.update(custom_params)
        return {'Fill_Color': _avwap_stdev_colors(df, **params)}

    default_params = {
        'ZScore': {
            'centreline': 'peaks_valleys_avg',
            'peaks_valleys_params': {'periods': 20, 'max_aVWAPs': None},
            'std_lookback': 75,
            'avg_lookback': 20
        },
        'TTM_squeeze': {
            'bb_length': 20,
            'bb_std_dev': 2.0,
            'kc_length': 20,
            'kc_mult': 1.5,
            'use_true_range': True
        },
        'QQEMOD': {
            'rsi_period': 6,
            'rsi_period2': 5,
            'sf': 5,
            'sf2': 5,
            'qqe_factor': 3.0,
            'qqe_factor2': 1.61,
            'threshold': 3,
            'bb_length': 50,
            'bb_multi': 0.35,
        },
        'banker_RSI': {},
        'WAE': {},
        'supertrend': {},
    }

    # custom_params is a flat dict of overrides for the selected indicator_color.
    if custom_params and indicator_color in default_params:
        default_params[indicator_color].update(custom_params)

    # Unwrap centreline_params (UI wrapper) into the kwarg name the indicator expects.
    ind_p = default_params[indicator_color]
    cp = ind_p.pop('centreline_params', None)
    if cp:
        centreline = ind_p.get('centreline', 'peaks_valleys_avg')
        _kwarg_map = {
            'peaks_valleys_avg': 'peaks_valleys_params',
            'gaps_avg':          'gaps_params',
            'OB_avg':            'OB_params',
        }
        if centreline in _kwarg_map:
            ind_p[_kwarg_map[centreline]] = cp
        elif centreline == 'SMA':
            ind_p.update(cp)  # flattens {'sma_periods': N} directly into kwargs

    df = get_indicators(df, [indicator_color], default_params)

    # Get colors from indicator data
    colors = get_color_palette()

    # Define color mapping functions ------------------------------------------

    def map_zscore(zscore):
        return _zscore_bucket_color(colors, zscore)

    def map_banker_RSI(banker_RSI):
        if    15 <= banker_RSI <=   20: return colors['neon']
        elif  11 <= banker_RSI <= 14.9: return colors['aqua']
        elif 5.1 <= banker_RSI <=   10: return colors['teal']
        elif 0.1 <= banker_RSI <=    5: return colors['teal_trans_3']
        elif 0.0 <= banker_RSI <=    0.1: return colors['black']
        return colors['black']

    def map_RSI(RSI):
        if    0 < RSI <=  30: return colors['red_dark']
        elif 30 < RSI <=  35: return colors['red_trans_3']
        elif 35 < RSI <=  40: return colors['red_trans_2']
        elif 40 < RSI <=  45: return colors['red_trans_1']
        elif 45 < RSI <=  50: return colors['red_trans_0']
        elif 50 < RSI <=  55: return colors['teal_trans_0']
        elif 55 < RSI <=  60: return colors['teal_trans_1']
        elif 60 < RSI <=  65: return colors['teal_trans_2']
        elif 65 < RSI <=  70: return colors['teal_trans_3']
        elif 70 < RSI <= 100: return colors['aqua']
        return colors['black']

    def map_QQEMOD(row):
        if row['QQE1_Above_Upper'] and row['QQE2_Above_Threshold']:
            return colors['teal'] if row['QQE2_Above_TL'] else colors['teal_trans_3']
        elif row['QQE1_Below_Lower'] and row['QQE2_Below_Threshold']:
            return colors['red'] if not row['QQE2_Above_TL'] else colors['red_trans_3']
        elif row['QQE2_Above_Threshold']: return colors['teal_trans_2']  
        elif row['QQE2_Below_Threshold']: return colors['red_trans_2']  
        return colors['black']

    def map_WAE(row):
        direction = row['WAE_Direction']
        momentum = row['WAE_Momentum']
        is_exploding = row['WAE_Upper'] > df['WAE_Upper'].mean()
        if direction < 0:
            if   momentum > 3.0: return colors['red_dark'] if is_exploding else colors['red']
            elif momentum > 2.0: return colors['red_dark'] if is_exploding else colors['red_trans_3']
            elif momentum > 1.0: return colors['red_dark'] if is_exploding else colors['red_trans_3']
            elif momentum > 0.5: return colors['red_trans_2']
        else:
            if   momentum > 3.0: return colors['aqua'] if is_exploding else colors['teal']
            elif momentum > 2.0: return colors['aqua'] if is_exploding else colors['teal_trans_3']
            elif momentum > 1.0: return colors['aqua'] if is_exploding else colors['teal_trans_3']
            elif momentum > 0.5: return colors['teal_trans_2']
        return colors['black']

    def map_TTM_squeeze(row):
        if row['TTM_squeeze_Active'] == 1: return colors['orange']
        else: return colors['black']

    def map_supertrend(row):
        return colors['teal'] if row['Supertrend_Direction'] > 0 else colors['red']

    # Create a mapping of indicator to their color functions
    color_mappers = {
        'ZScore': lambda df: df['ZScore'].apply(map_zscore),
        'RSI': lambda df: df['RSI'].apply(map_RSI),
        'banker_RSI': lambda df: df['banker_RSI'].apply(map_banker_RSI),
        'QQEMOD': lambda df: df.apply(map_QQEMOD, axis=1),
        'WAE': lambda df: df.apply(map_WAE, axis=1),
        'supertrend': lambda df: df.apply(map_supertrend, axis=1),
        'TTM_squeeze': lambda df: df.apply(map_TTM_squeeze, axis=1),
    }

    # Get the base indicator name (before _color)
    base_indicator = indicator_color.split('_color')[0] if '_color' in indicator_color else indicator_color
   
    # Apply only the needed color mapping
    if base_indicator in color_mappers:
        color_series = color_mappers[base_indicator](df)
        return {'color': color_series}
   
    return {'color': pd.Series([colors['black']] * len(df), index=df.index)}


def _relvolume_colors(df, anchor_type='peak', anchor_periods=100, anchor_max_aVWAPs=1, vol_span=15):
    """
    Colors candles by volume relative to an EWMA volume baseline within each
    aVWAP-Pinch anchor's range. Mirrors aVWAP_pinch's own anchor detection
    (anchor_type / anchor_periods / anchor_max_aVWAPs) — set the same values
    on both indicators to scope this to the same fan.

    Returns a 'Fill_Color' series (not 'color') — chart.js renders this as
    a body-fill-only tint and leaves the candle's border/wick on their normal
    up/down coloring. Deliberately one hue (orange) rather than a teal/red
    split: this is a volume signal, not a directional one, and a dark red
    "low volume" candle previously read as a strong bearish move, which is
    the opposite of what it meant. Bars outside any selected anchor's range
    are left untinted (None) so the candle renders exactly as it would with
    no candle_colors indicator at all — that boundary is the one deliberate
    cliff, marking where the anchor's range actually starts.

    Baseline: an EWMA of volume (span=vol_span), not a fixed lookback window
    or a plain expanding mean — old bars fade out gradually rather than
    dropping off a hard window edge (fixed window) or never letting go
    (expanding mean, which dilutes further from the anchor a range runs, so
    the same relative spike reads louder early in a range and quieter late
    in it — an artifact of the window growing, not the data). EWMA keeps the
    "effective lookback" roughly constant across the whole range. Still
    fully causal (only ever uses bars up to and including the current one),
    so a bar's color never depends on volume the replay hasn't reached yet.

    Opacity: driven by log(volume ÷ baseline) rather than the raw ratio, so
    equal multiples (2x, 4x, 8x...) add equal opacity — a genuinely extreme
    day reads more intense than a moderate one instead of both clipping to
    the same full color. |log_ratio| is symmetric around zero by
    construction, so one formula handles both above- and below-average bars
    — no separate high/low tuning needed. Opacity lands at ~0 (transparent)
    right at the baseline itself, so bars inside the range fade smoothly
    toward transparent as volume nears "normal" instead of jumping to a
    solid fill.

    Saturation (what |log_ratio| counts as "fully opaque") is auto-calibrated
    per range rather than a fixed constant: once vol_span bars have
    accumulated in the range, it's the expanding (causal — bars up to here
    only) 95th percentile of |log_ratio| seen so far, so a quiet range and a
    genuinely volatile one each use the full opacity scale relative to their
    own behavior instead of a single global threshold under- or
    over-shooting for either. Before vol_span bars exist, a percentile
    estimate from a handful of points is unreliable (the one elevated bar
    so far would just define its own threshold and always read as maximal)
    — those early bars fall back to a fixed default instead.
    """
    orig_index = df.index
    df = df.reset_index(drop=False)
    n = len(df)
    out = pd.Series([None] * n, index=df.index, dtype=object)

    base_cols = [c for c in ['Open', 'High', 'Low', 'Close', 'Volume'] if c in df.columns]
    pv = get_indicators(df[base_cols].copy(), ['peaks_valleys'], {'peaks_valleys': {'periods': anchor_periods}})
    col = 'Peaks' if anchor_type == 'peak' else 'Valleys'
    if col not in pv.columns:
        out.index = orig_index
        return out

    anchors = sorted(pv[pv[col] == 1].index.tolist(), reverse=True)
    if anchor_max_aVWAPs is not None:
        anchors = anchors[:anchor_max_aVWAPs]
    anchors = sorted(anchors)
    if not anchors:
        out.index = orig_index
        return out

    volume = df['Volume']
    RGB = (255, 165, 0)          # orange — a volume-only hue, distinct from the up/down teal/red pair
    SAT_PERCENTILE = 0.95        # per-range saturation = this percentile of |log_ratio| seen so far
    FALLBACK_SAT_LOG = 0.85      # used only until vol_span bars accumulate (ratio ~2.3x)
    MIN_SAT_LOG = 0.05           # floor so a dead-flat volume stretch can't divide-by-near-zero

    for seg_i, start in enumerate(anchors):
        end = anchors[seg_i + 1] - 1 if seg_i + 1 < len(anchors) else n - 1
        seg_vol = volume.iloc[start:end + 1]
        baseline = seg_vol.ewm(span=vol_span, min_periods=1).mean()
        ratio = seg_vol.divide(baseline).replace([float('inf'), float('-inf')], 1.0).fillna(1.0).clip(lower=1e-6)
        abs_log_ratio = np.log(ratio).abs()

        sat = abs_log_ratio.expanding(min_periods=vol_span).quantile(SAT_PERCENTILE)
        sat = sat.fillna(FALLBACK_SAT_LOG).clip(lower=MIN_SAT_LOG)
        alpha = (abs_log_ratio / sat).clip(upper=1.0)

        for offset, a in enumerate(alpha.values):
            out.iloc[start + offset] = f"rgba({RGB[0]},{RGB[1]},{RGB[2]},{a:.2f})"

    out.index = orig_index
    return out


def _stdev_zone_fill_color(colors, z):
    """Fill-tint tiers for aVWAPStDev's stdev zones — same escalating-
    intensity convention banker_RSI's color map already uses (teal_trans_0
    -> teal_trans_3 -> aqua -> neon), mirrored on the red side (red_trans_0
    -> red_trans_3 -> red_dark -> magenta). Unlike _zscore_bucket_color
    (which backs a full-candle recolor, and needs opaque steps since
    chart.js forces that path's border/wick to full alpha), this is safe to
    build from alpha variants of the same hue: aVWAPStDev renders through
    Fill_Color, a body-only tint that never touches the border/wick, so each
    tier's own alpha renders as given instead of collapsing into its
    neighbors'."""
    if          z <= -3.0: return colors['magenta']
    elif -3.0 < z <= -2.0: return colors['red_dark']
    elif -2.0 < z <= -1.0: return colors['red_trans_3']
    elif -1.0 < z <=    0: return colors['red_trans_0']
    elif    0 < z <=  1.0: return colors['teal_trans_0']
    elif  1.0 < z <=  2.0: return colors['teal_trans_3']
    elif  2.0 < z <=  3.0: return colors['aqua']
    elif  3.0 < z:         return colors['neon']
    return None


def _avwap_stdev_colors(df, anchor_type='peak', anchor_periods=100, anchor_max_aVWAPs=1):
    """
    Colors candles by how many anchor-VWAP standard deviations the bar's
    typical price sits above/below the anchor's own cumulative volume-
    weighted VWAP, within each aVWAP-Pinch anchor's range. Same anchor
    detection as RelVolume/aVWAP_pinch (anchor_type/anchor_periods/
    anchor_max_aVWAPs) — set matching values on all three to scope them to
    the same fan.

    Reuses calculate_avwap / calculate_avwap_stdev (aVWAP.py) — the same
    cumulative VWAP + volume-weighted dispersion aVWAP_pinch's own
    show_stdev_bands draws as lines — so the "center" and "normal deviation"
    here are anchored to the same structural point (peak/valley) as the rest
    of the fan, instead of drifting with a rolling window like the ZScore
    mode's centreline. Above the aVWAP reads as overbought, below as
    oversold, tiered by _stdev_zone_fill_color.

    Returns a 'Fill_Color' series (not 'color') — chart.js renders this as a
    body-fill-only tint and leaves the candle's border/wick on their normal
    up/down coloring, so the stdev-zone signal never overrides whether the
    candle itself was bullish/bearish — same rendering path as RelVolume.
    Bars outside any selected anchor's range are left untinted (None) so the
    candle renders exactly as it would with no candle_colors indicator at
    all — the one deliberate cliff, marking where the anchor's range starts.
    """
    orig_index = df.index
    df = df.reset_index(drop=False)
    n = len(df)
    colors = get_color_palette()
    out = pd.Series([None] * n, index=df.index, dtype=object)

    base_cols = [c for c in ['Open', 'High', 'Low', 'Close', 'Volume'] if c in df.columns]
    pv = get_indicators(df[base_cols].copy(), ['peaks_valleys'], {'peaks_valleys': {'periods': anchor_periods}})
    col = 'Peaks' if anchor_type == 'peak' else 'Valleys'
    if col not in pv.columns:
        out.index = orig_index
        return out

    anchors = sorted(pv[pv[col] == 1].index.tolist(), reverse=True)
    if anchor_max_aVWAPs is not None:
        anchors = anchors[:anchor_max_aVWAPs]
    anchors = sorted(anchors)
    if not anchors:
        out.index = orig_index
        return out

    typical = (df['High'] + df['Low'] + df['Close']) / 3

    for seg_i, start in enumerate(anchors):
        end = anchors[seg_i + 1] - 1 if seg_i + 1 < len(anchors) else n - 1
        vwap = calculate_avwap(df, start)
        stdev = calculate_avwap_stdev(df, start).replace(0, np.nan)
        z = ((typical - vwap) / stdev).fillna(0.0)
        seg_z = z.iloc[start:end + 1]

        for offset, zi in enumerate(seg_z.values):
            out.iloc[start + offset] = _stdev_zone_fill_color(colors, zi)

    out.index = orig_index
    return out


def calculate_indicator(df, **params):
    return calculate_candle_colors(df, **params)
