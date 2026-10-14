"""
Oscillators — draws the selected oscillators in their own chart panes below
price (see backend/core/osc_panes.py for each pane's layout and reference
lines, frontend/js/chart.js for the panes themselves).

Same math as the divergence indicator (_oscillators_core.py), and each pane's
main line is exactly the series divergence compares at swing points — so the
panes double as a way to check divergences by eye. Columns are prefixed
'OSC_' so they never collide with divergence's own oscillator columns when
both indicators are in one config.

show_divergences adds divergence lines inside the panes (never on the price
chart — that's the divergence indicator's job). Detection runs through the
divergence indicator's own per-oscillator functions with the same settings
(names and defaults match divergence.py), so identical settings give
identical divergences. Results are stored as OSC_<pane>_div_<type> columns
holding, on each signal bar, the bar index of the earlier swing it was
matched against (NaN elsewhere) — deliberately NOT named *_Regular_Bullish
etc., so replay_events.py's price markers and the divergence scanner never
pick them up.
"""
from backend.indicators.indicators_list import _oscillators_core as osc
from backend.indicators.indicators_list.divergence import _atr
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

display_name = "Oscillators"

# Dividers: before the periods, before the divergence toggle, and before the
# divergence settings that follow it.
param_separators = ['rsi_period', 'show_divergences', 'show_regular']

_DIV_SETTINGS = ['show_regular', 'show_hidden', 'left', 'right', 'max_lookback_pivots',
                 'max_pivot_distance', 'line_of_sight', 'los_endpoint_bars',
                 'equal_swing_atr', 'min_osc_change', 'volume_threshold', 'vol_filter']
# Divergence settings are shown on the config page only while
# show_divergences is on.
param_conditions = {k: 'show_divergences' for k in _DIV_SETTINGS}

param_labels = {
    'RSI':             'RSI',
    'MACD':            'MACD',
    'OBV':             'OBV',
    'ATR':             'ATR',
    'Fisher':          'Fisher Transform',
    'Fractal':         'Fractal Energy',
    'MFI':             'Money Flow Index',
    'Momentum':        'Momentum',
    'Stochastic':      'Stochastic',
    'Volume':          'Volume MA',
    'Vortex':          'Vortex',
    'rsi_period':      'RSI Period',
    'macd_fast':       'MACD Fast',
    'macd_slow':       'MACD Slow',
    'macd_signal':     'MACD Signal',
    'obv_period':      'OBV Smoothing Period',
    'atr_period':      'ATR Period',
    'fisher_period':   'Fisher Period',
    'fractal_period':  'Fractal Energy Period',
    'mfi_period':      'MFI Period',
    'momentum_period': 'Momentum Period',
    'smooth_period':   'Momentum Smooth',
    'stoch_k':         'Stoch %K Period',
    'stoch_d':         'Stoch %D Period',
    'volume_period':   'Volume MA Period',
    'vortex_period':   'Vortex Period',
    'show_divergences':    'Show Divergences (in panes)',
    'show_regular':        'Show Regular',
    'show_hidden':         'Show Hidden',
    'left':                'Pivot Left Bars',
    'right':               'Pivot Right Bars',
    'max_lookback_pivots': 'Swings to Look Back',
    'max_pivot_distance':  'Max Bars Between Swings',
    'line_of_sight':       'Require Line of Sight',
    'los_endpoint_bars':   'Line of Sight: Oscillator Endpoint Allowance (bars)',
    'equal_swing_atr':     'Equal-Swing Tolerance (× ATR)',
    'min_osc_change':      'Min Oscillator Difference (× its std dev)',
    'volume_threshold':    'MFI Volume Threshold',
    'vol_filter':          'Fractal Volume Filter',
}


def calculate_oscillators(df,
    RSI=True, MACD=True, OBV=False, ATR=False, Fisher=False, Fractal=False,
    MFI=False, Momentum=False, Stochastic=False, Volume=False, Vortex=False,
    rsi_period=14, macd_fast=12, macd_slow=26, macd_signal=9, obv_period=21,
    atr_period=14, fisher_period=10, fractal_period=12, mfi_period=14,
    momentum_period=10, smooth_period=3, stoch_k=14, stoch_d=3,
    volume_period=14, vortex_period=14,
    show_divergences=False,
    show_regular=True, show_hidden=True, left=5, right=5,
    max_lookback_pivots=3, max_pivot_distance=60, line_of_sight=True,
    los_endpoint_bars=2, equal_swing_atr=0.25, min_osc_change=0.2,
    volume_threshold=1.2, vol_filter=True,
    **_
):
    # Same parameter names and defaults as divergence.py, so matching
    # settings in both indicators give identical lines.
    out = {}
    if RSI:
        out['OSC_RSI'] = osc.rsi(df, rsi_period)
    if MACD:
        line, sig, hist = osc.macd(df, macd_fast, macd_slow, macd_signal)
        out['OSC_MACD'], out['OSC_MACD_Signal'], out['OSC_MACD_Hist'] = line, sig, hist
    if OBV:
        out['OSC_OBV'] = osc.obv(df, obv_period)[1]          # the smoothed OBV divergence compares
    if ATR:
        out['OSC_ATR'] = osc.atr(df, atr_period)
    if Fisher:
        out['OSC_Fisher'], out['OSC_Fisher_Signal'] = osc.fisher(df, fisher_period)
    if Fractal:
        out['OSC_Fractal'] = osc.fractal_energy(df, fractal_period)
    if MFI:
        out['OSC_MFI'] = osc.mfi(df, mfi_period)
    if Momentum:
        out['OSC_Momentum'] = osc.momentum(df, momentum_period, smooth_period)[1]  # smoothed, as compared
    if Stochastic:
        out['OSC_Stoch_K'], out['OSC_Stoch_D'] = osc.stochastic(df, stoch_k, stoch_d)
    if Volume:
        out['OSC_Volume_MA'] = osc.volume_ma(df, volume_period)
    if Vortex:
        out['OSC_VI_plus'], out['OSC_VI_minus'] = osc.vortex(df, vortex_period)

    if show_divergences:
        div_opts = {'max_lookback_pivots': max_lookback_pivots, 'max_pivot_distance': max_pivot_distance,
                    'line_of_sight': line_of_sight, 'los_endpoint_bars': los_endpoint_bars,
                    'equal_swing_atr': equal_swing_atr, 'min_osc_change': min_osc_change,
                    'atr': _atr(df, 14)}
        lr = {'left': left, 'right': right, **div_opts}
        # (enabled, pane key, divergence.py's column label, call)
        runs = [
            (RSI,        'RSI',        'RSI',        lambda: calculate_rsi_divergence(df, period=rsi_period, **lr)),
            (MACD,       'MACD',       'MACD',       lambda: calculate_macd_divergence(df, fast_period=macd_fast, slow_period=macd_slow, signal_period=macd_signal, **lr)),
            (OBV,        'OBV',        'OBV',        lambda: calculate_obv_divergence(df, period=obv_period, **lr)),
            (ATR,        'ATR',        'ATR',        lambda: calculate_atr_divergence(df, period=atr_period, **lr)),
            (Fisher,     'Fisher',     'Fisher',     lambda: calculate_fisher_divergence(df, period=fisher_period, **lr)),
            (Fractal,    'Fractal',    'Fractal',    lambda: calculate_fractal_divergence(df, period=fractal_period, vol_filter=vol_filter, **lr)),
            (MFI,        'MFI',        'MFI',        lambda: calculate_mfi_divergence(df, period=mfi_period, volume_threshold=volume_threshold, **lr)),
            (Momentum,   'Momentum',   'Momo',       lambda: calculate_momentum_divergence(df, period=momentum_period, smooth_period=smooth_period, **lr)),
            (Stochastic, 'Stochastic', 'Stochastic', lambda: calculate_stochastic_divergence(df, k_period=stoch_k, d_period=stoch_d, **lr)),
            (Volume,     'Volume MA',  'Vol',        lambda: calculate_volume_divergence(df, period=volume_period, **lr)),
            (Vortex,     'Vortex',     'VI',         lambda: calculate_vortex_divergence(df, period=vortex_period, **lr)),
        ]
        kinds = [('reg_bull', 'Regular_Bullish', show_regular), ('reg_bear', 'Regular_Bearish', show_regular),
                 ('hid_bull', 'Hidden_Bullish',  show_hidden),  ('hid_bear', 'Hidden_Bearish',  show_hidden)]
        for enabled, pane, label, call in runs:
            if not enabled:
                continue
            res = call()
            for kind, suffix, wanted in kinds:
                if not wanted:
                    continue
                # Earlier-swing index on signal bars only — the boolean is the
                # authority (MFI/Fractal filter it after detection), so the
                # unfiltered _prev column is masked by it.
                sig = res[f'{label}_{suffix}'].astype(bool)
                out[f'OSC_{pane.replace(" ", "_")}_div_{kind}'] = res[f'{label}_{suffix}_prev'].where(sig)
    return out


def calculate_indicator(df, **params):
    return calculate_oscillators(df, **params)
