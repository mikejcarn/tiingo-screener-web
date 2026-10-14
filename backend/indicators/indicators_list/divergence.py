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

display_name = "Divergences"

# Visual dividers: before the type toggles, then before the pivot settings,
# then before the per-oscillator settings.
param_separators = ['RSI', 'left', 'rsi_period']

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
    'rsi_period':       'RSI Period',
    'obv_period':       'OBV Smoothing Period',
    'atr_period':       'ATR Period',
    'fisher_period':    'Fisher Period',
    'fractal_period':   'Fractal Energy Period',
    'mfi_period':       'MFI Period',
    'momentum_period':  'Momentum Period',
    'stoch_k':          'Stoch %K Period',
    'volume_period':    'Volume MA Period',
    'vortex_period':    'Vortex Period',
    'left':             'Pivot Left Bars',
    'right':            'Pivot Right Bars',
    'max_lookback_pivots': 'Swings to Look Back',
    'max_pivot_distance':  'Max Bars Between Swings',
    'line_of_sight':       'Require Line of Sight',
    'los_endpoint_bars':   'Line of Sight: Oscillator Endpoint Allowance (bars)',
    'macd_fast':        'MACD Fast',
    'macd_slow':        'MACD Slow',
    'macd_signal':      'MACD Signal',
    'stoch_d':          'Stoch %D Period',
    'smooth_period':    'Momentum Smooth',
    'volume_threshold': 'MFI Volume Threshold',
    'vol_filter':       'Fractal Volume Filter',
}

# Each oscillator has its own lookback (its own conventional default), rather
# than one shared 'period' — a single value can't suit RSI, Fisher, OBV
# smoothing and Momentum all at once. param_descriptions is merged into one
# app-wide dict keyed by param name, so rsi_period/atr_period (already
# described for QQEMOD/anchor scoring) are left out here to avoid
# overwriting those indicators' descriptions.
param_descriptions = {
    'obv_period':      "EMA span used to smooth OBV before comparing it at swing points. Default 21.",
    'fisher_period':   "Fisher Transform lookback (high/low normalization window). Default 10.",
    'fractal_period':  "Fractal Energy lookback (net close move vs. average range). Default 12.",
    'mfi_period':      "Money Flow Index lookback. Standard default 14.",
    'momentum_period': "Momentum lookback (close minus close N bars ago). Default 10.",
    'stoch_k':         "Stochastic %K lookback. Standard default 14 (%D smoothing is stoch_d).",
    'volume_period':   "EMA span of the volume average compared at swing points. Default 14.",
    'vortex_period':   "Vortex Indicator lookback. Standard default 14.",
    'max_lookback_pivots': "How many earlier swings (same side — lows for bullish, highs for "
                           "bearish) each new swing is compared against, most recent first; the "
                           "first one that forms a valid divergence is used. 1 = only the "
                           "immediately previous swing (the old behavior). Lets a divergence "
                           "against the swing that matters be found even when a minor swing "
                           "sits in between.",
    'max_pivot_distance':  "Maximum bars between the two swings of a divergence — earlier "
                           "swings further back than this are never compared. Blank/0 = no limit.",
    'line_of_sight':       "Reject a divergence if price or the oscillator crosses its own "
                           "straight line between the two swings — a line joining lows must not "
                           "be undercut, one joining highs must not be exceeded. A divergence "
                           "claims those two lines disagree; if either line is broken in "
                           "between, the two points don't form one clean line.",
    'los_endpoint_bars':   "Bars beside each end of the oscillator's line that line_of_sight "
                           "ignores. The oscillator is read at the price swing bars, but its own "
                           "turn is often a bar or two off, so it pokes past its line right next "
                           "to an endpoint without that being a real break. 0 = strict. Price is "
                           "always checked strictly (its endpoints are the real swing bars).",
}


def calculate_divergence(df,
    show_regular=True, show_hidden=True,
    show_labels=True, show_markers=True, show_wicks=True, show_candles=False, show_pivots=False,
    RSI=True, MACD=False, OBV=False, ATR=False, Fisher=False,
    Fractal=False, MFI=False, Momentum=False, Stochastic=False,
    Volume=False, Vortex=False,
    left=5, right=5, max_lookback_pivots=3, max_pivot_distance=60, line_of_sight=True,
    los_endpoint_bars=2,
    rsi_period=14, macd_fast=12, macd_slow=26, macd_signal=9, obv_period=21,
    atr_period=14, fisher_period=10, fractal_period=12, mfi_period=14,
    momentum_period=10, smooth_period=3, stoch_k=14, stoch_d=3,
    volume_period=14, vortex_period=14, volume_threshold=1.2, vol_filter=True,
    **_
):
    div_opts = {'max_lookback_pivots': max_lookback_pivots,
                'max_pivot_distance':  max_pivot_distance,
                'line_of_sight':       line_of_sight,
                'los_endpoint_bars':   los_endpoint_bars}
    result = {}
    if RSI:
        result.update(calculate_rsi_divergence(df, period=rsi_period, left=left, right=right, **div_opts))
    if MACD:
        result.update(calculate_macd_divergence(df, fast_period=macd_fast, slow_period=macd_slow,
                                                signal_period=macd_signal, left=left, right=right, **div_opts))
    if OBV:
        result.update(calculate_obv_divergence(df, period=obv_period, left=left, right=right, **div_opts))
    if ATR:
        result.update(calculate_atr_divergence(df, period=atr_period, left=left, right=right, **div_opts))
    if Fisher:
        result.update(calculate_fisher_divergence(df, period=fisher_period, left=left, right=right, **div_opts))
    if Fractal:
        result.update(calculate_fractal_divergence(df, period=fractal_period, vol_filter=vol_filter,
                                                   left=left, right=right, **div_opts))
    if MFI:
        result.update(calculate_mfi_divergence(df, period=mfi_period, volume_threshold=volume_threshold,
                                               left=left, right=right, **div_opts))
    if Momentum:
        result.update(calculate_momentum_divergence(df, period=momentum_period, smooth_period=smooth_period,
                                                    left=left, right=right, **div_opts))
    if Stochastic:
        result.update(calculate_stochastic_divergence(df, k_period=stoch_k, d_period=stoch_d,
                                                      left=left, right=right, **div_opts))
    if Volume:
        result.update(calculate_volume_divergence(df, period=volume_period, left=left, right=right, **div_opts))
    if Vortex:
        result.update(calculate_vortex_divergence(df, period=vortex_period, left=left, right=right, **div_opts))

    if not show_regular:
        result = {k: v for k, v in result.items() if '_Regular_' not in k}
    if not show_hidden:
        result = {k: v for k, v in result.items() if '_Hidden_' not in k}

    return result


def calculate_indicator(df, **params):
    return calculate_divergence(df, **params)
