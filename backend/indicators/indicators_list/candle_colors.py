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





import pandas as pd
from backend.indicators.indicators import get_indicators
from backend.core.color_palette import get_color_palette

# Sub-params shown per centreline mode. Keys must match the **kwargs names that
# ZScore / StDev forward to their sub-indicators.
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
    'StDev': {
        'stdev_lookback': 100, 'avg_lookback': 10,
        'centreline': 'peaks_valleys_avg',
        'centreline_params': dict(_CENTRELINE_SUB_DEFAULTS['peaks_valleys_avg']),
    },
    'QQEMOD':           {'rsi_period': 8, 'rsi_period2': 4, 'sf': 8, 'sf2': 4,
                         'qqe_factor': 3.0, 'qqe_factor2': 1.61, 'threshold': 3,
                         'bb_length': 10, 'bb_multi': 0.35},
    'RSI':              {'periods': 14},
    'banker_RSI':       {'rsi_period': 50, 'rsi_base': 50, 'sensitivity': 1.5},
    'WAE':              {'fast_period': 20, 'slow_period': 40, 'atr_period': 20, 'explosion_multiplier': 2.0},
    'supertrend':       {'periods': 14, 'multiplier': 3},
    'TTM_squeeze':      {'bb_length': 20, 'bb_std_dev': 2.0,
                         'kc_length': 20, 'kc_mult': 1.5, 'use_true_range': True},
    'engulfing_candle': {'mode': 'both', 'engulfing_periods': 3, 'close_threshold': 0.25},
}

# Consumed by _get_indicator_defaults: top-level param defaults shown in editor.
defaults = {
    'indicator_color': 'StDev',
    'custom_params':   dict(_SUB_DEFAULTS['StDev']),
}

# Consumed by _get_param_options: tells the UI which sub-params to swap
# when the user changes indicator_color or centreline.
param_options = {
    'indicator_color': _SUB_DEFAULTS,
    'centreline':      _CENTRELINE_SUB_DEFAULTS,
}


def calculate_candle_colors(df, indicator_color='StDev', custom_params=None):
    """
    Enhanced candle color calculator with customizable parameters
    
    Parameters:
        df (pd.DataFrame): Input price data
        indicator_color (str): Indicator to use for coloring
        custom_params (dict): Optional parameter overrides by indicator
            Example: {'StDev': {'std_lookback': 60}, 'TTM_squeeze': {'bb_std_dev': 1.5}}
            
    Returns:
        dict: {'color': pd.Series of colors matching df index}
    """

    # Indicator Color Options: 
    # 'ZScore', 'StDev', 'RSI', 'QQEMOD', 'banker_RSI', 'WAE', 'supertrend', 
    # 'TTM_squeeze', 'engulfing_candle'

    # Default parameters for supported indicators
    default_params = {
        'ZScore': {
            'centreline': 'peaks_valleys_avg',
            'peaks_valleys_params': {'periods': 20, 'max_aVWAPs': None},
            'std_lookback': 75,
            'avg_lookback': 20
        },
        'StDev': {
            'centreline': 'peaks_valleys_avg',
            'peaks_valleys_params': {'periods': 100, 'max_aVWAPs': None},
            'stdev_lookback': 100,
            'avg_lookback': 10,
        },
        'TTM_squeeze': {
            'bb_length': 20,
            'bb_std_dev': 2.0,
            'kc_length': 20,
            'kc_mult': 1.5,
            'use_true_range': True
        },
        'QQEMOD': {
            'rsi_period': 8, 
            'rsi_period2': 4,
            'sf': 8,
            'sf2': 4,
            'qqe_factor': 3.0,
            'qqe_factor2': 1.61,
            'threshold': 3,
            'bb_length': 10,
            'bb_multi': 0.35,
        },
        'banker_RSI': {},
        'WAE': {},
        'supertrend': {},
        'engulfing_candle': {
            'mode': 'both',
            'engulfing_periods': 3,
            'close_threshold': 0.25
        }
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
        if          zscore <= -3.0: return colors['magenta']
        elif -3.0 < zscore <= -2.5: return colors['red_dark']
        elif -2.5 < zscore <= -2.0: return colors['red']
        elif -2.0 < zscore <= -1.5: return colors['red']
        elif -1.5 < zscore <= -1.0: return colors['red_trans_3']
        elif -1.0 < zscore <= -0.5: return colors['red_trans_2']
        elif -0.5 < zscore <=    0: return colors['red_trans_1'] 
        elif    0 < zscore <=  0.5: return colors['teal_trans_1'] 
        elif  0.5 < zscore <=  1.0: return colors['teal_trans_2']
        elif  1.0 < zscore <=  1.5: return colors['teal_trans_3']
        elif  1.5 < zscore <=  2.0: return colors['teal_trans_3']
        elif  2.0 < zscore <=  2.5: return colors['teal']
        elif  2.5 < zscore <=  3.0: return colors['teal']
        elif  3.0 < zscore:         return colors['neon']
        return colors['black']

    def map_stdev(row):
        devs = (row['Close'] - row['StDev_Mean']) / row['StDev']
        if devs >= 3.0: return colors['neon']
        elif 2.5 <= devs < 3.0: return colors['neon']
        elif 2.0 <= devs < 2.5: return colors['neon']
        elif 1.5 <= devs < 2.0: return colors['aqua']
        elif 1.0 <= devs < 1.5: return colors['teal']
        elif 0.5 <= devs < 1.0: return colors['teal_trans_2']
        elif 0.0 <= devs < 0.5: return colors['black']
        elif devs <= -3.0: return colors['magenta']
        elif -3.0 < devs <= -2.5: return colors['magenta']
        elif -2.5 < devs <= -2.0: return colors['magenta']
        elif -2.0 < devs <= -1.5: return colors['red_dark']
        elif -1.5 < devs <= -1.0: return colors['red']
        elif -1.0 < devs <= -0.5: return colors['red_trans_2']
        elif -0.5 < devs < 0.0: return colors['black']
        return colors['black']

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

    def map_engulfing_candle(row):
        """
        Color candles based on their role in engulfing patterns:
        - Bullish engulfing candle: neon green (strong buy signal)
        - Bullish engulfed candles: teal (weaker buy, part of pattern)
        - Bearish engulfing candle: magenta (strong sell signal)
        - Bearish engulfed candles: red (weaker sell, part of pattern)
        """
        cluster_value = row['engulfing_pattern_cluster']
        
        if cluster_value == 'bullish_engulfing':
            return colors['aqua']
        elif cluster_value == 'bullish_engulfed':
            return colors['teal']
        elif cluster_value == 'bearish_engulfing':
            return colors['red_dark']
        elif cluster_value == 'bearish_engulfed':
            return colors['red']
        
        return colors['black']

    # Create a mapping of indicator to their color functions
    color_mappers = {
        'ZScore': lambda df: df['ZScore'].apply(map_zscore),
        'RSI': lambda df: df['RSI'].apply(map_RSI),
        'banker_RSI': lambda df: df['banker_RSI'].apply(map_banker_RSI),
        'StDev': lambda df: df.apply(map_stdev, axis=1),
        'QQEMOD': lambda df: df.apply(map_QQEMOD, axis=1),
        'WAE': lambda df: df.apply(map_WAE, axis=1),
        'supertrend': lambda df: df.apply(map_supertrend, axis=1),
        'TTM_squeeze': lambda df: df.apply(map_TTM_squeeze, axis=1),
        'engulfing_candle': lambda df: df.apply(map_engulfing_candle, axis=1),
    }

    # Get the base indicator name (before _color)
    base_indicator = indicator_color.split('_color')[0] if '_color' in indicator_color else indicator_color
   
    # Apply only the needed color mapping
    if base_indicator in color_mappers:
        color_series = color_mappers[base_indicator](df)
        return {'color': color_series}
   
    return {'color': pd.Series([colors['black']] * len(df), index=df.index)}


def calculate_indicator(df, **params):
    return calculate_candle_colors(df, **params)
