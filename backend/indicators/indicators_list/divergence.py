from backend.indicators.indicators_list.divergence_RSI        import calculate_rsi_divergence
from backend.indicators.indicators_list.divergence_MACD       import calculate_macd_divergence
from backend.indicators.indicators_list.divergence_OBV        import calculate_obv_divergence
from backend.indicators.indicators_list.divergence_ATR        import calculate_atr_divergence
from backend.indicators.indicators_list.divergence_Fisher     import calculate_fisher_divergence
from backend.indicators.indicators_list.divergence_Fractal    import calculate_fractal_divergence
from backend.indicators.indicators_list.divergence_MFI        import calculate_mfi_divergence
from backend.indicators.indicators_list.divergence_Momentum   import calculate_momentum_divergence
from backend.indicators.indicators_list.divergence_Stochastic import calculate_stochastic_divergence
from backend.indicators.indicators_list.divergence_Volume     import calculate_volume_divergence
from backend.indicators.indicators_list.divergence_Vortex     import calculate_vortex_divergence

display_name = "Divergence"

param_separators = ['RSI']  # visual divider before the type toggles

param_labels = {
    'show_regular':     'Show Regular',
    'show_hidden':      'Show Hidden',
    'show_labels':      'Show Labels',
    'show_markers':     'Show Markers',
    'show_wicks':       'Show Wick Highlights',
    'show_candles':     'Show Candle Colors',
    'show_pivots':      'Show Pivot Lines',
    'RSI':              'RSI',
    'MACD':             'MACD',
    'OBV':              'OBV',
    'ATR':              'ATR',
    'Fisher':           'Fisher Transform',
    'Fractal':          'Fractal',
    'MFI':              'Money Flow Index',
    'Momentum':         'Momentum',
    'Stochastic':       'Stochastic',
    'Volume':           'Volume',
    'Vortex':           'Vortex',
    'period':           'Period',
    'left':             'Pivot Left Bars',
    'right':            'Pivot Right Bars',
    'macd_fast':        'MACD Fast',
    'macd_slow':        'MACD Slow',
    'macd_signal':      'MACD Signal',
    'stoch_d':          'Stoch %D Period',
    'smooth_period':    'Momentum Smooth',
    'volume_threshold': 'MFI Volume Threshold',
    'vol_filter':       'Fractal Volume Filter',
}


def calculate_divergence(df,
    show_regular=True, show_hidden=True,
    show_labels=True, show_markers=True, show_wicks=True, show_candles=False, show_pivots=False,
    RSI=True, MACD=False, OBV=False, ATR=False, Fisher=False,
    Fractal=False, MFI=False, Momentum=False, Stochastic=False,
    Volume=False, Vortex=False,
    period=14, left=5, right=5,
    macd_fast=12, macd_slow=26, macd_signal=9,
    stoch_d=3, smooth_period=3, volume_threshold=1.2, vol_filter=True,
    **_
):
    result = {}
    if RSI:
        result.update(calculate_rsi_divergence(df, period=period, left=left, right=right))
    if MACD:
        result.update(calculate_macd_divergence(df, fast_period=macd_fast, slow_period=macd_slow,
                                                signal_period=macd_signal, left=left, right=right))
    if OBV:
        result.update(calculate_obv_divergence(df, period=period, left=left, right=right))
    if ATR:
        result.update(calculate_atr_divergence(df, period=period, left=left, right=right))
    if Fisher:
        result.update(calculate_fisher_divergence(df, period=period, left=left, right=right))
    if Fractal:
        result.update(calculate_fractal_divergence(df, period=period, vol_filter=vol_filter,
                                                   left=left, right=right))
    if MFI:
        result.update(calculate_mfi_divergence(df, period=period, volume_threshold=volume_threshold,
                                               left=left, right=right))
    if Momentum:
        result.update(calculate_momentum_divergence(df, period=period, smooth_period=smooth_period,
                                                    left=left, right=right))
    if Stochastic:
        result.update(calculate_stochastic_divergence(df, k_period=period, d_period=stoch_d,
                                                      left=left, right=right))
    if Volume:
        result.update(calculate_volume_divergence(df, period=period, left=left, right=right))
    if Vortex:
        result.update(calculate_vortex_divergence(df, period=period, left=left, right=right))

    if not show_regular:
        result = {k: v for k, v in result.items() if '_Regular_' not in k}
    if not show_hidden:
        result = {k: v for k, v in result.items() if '_Hidden_' not in k}

    return result


def calculate_indicator(df, **params):
    return calculate_divergence(df, **params)
