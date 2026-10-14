import pandas as pd
from backend.indicators.indicators_list import _oscillators_core as osc
from backend.indicators.indicators_list._divergence_core import detect_divergences, prev_columns


def calculate_vortex_divergence(df: pd.DataFrame, period: int = 14,
                                  left: int = 5, right: int = 5, **div_opts):
    vi_plus, vi_minus = osc.vortex(df, period)

    # Bullish: price lows vs VI+ — lower price low + higher VI+ = bullish
    # Bearish: price highs vs VI- — higher price high + lower VI- = bearish
    # Two passes, one per VI line, keeping only that line's side.
    rb_bull, _, hb_bull, _, prev_plus  = detect_divergences(df['High'], df['Low'], vi_plus,  left, right, **div_opts)
    _, rb_bear, _, hb_bear, prev_minus = detect_divergences(df['High'], df['Low'], vi_minus, left, right, **div_opts)
    prev = {'reg_bull': prev_plus['reg_bull'],  'hid_bull': prev_plus['hid_bull'],
            'reg_bear': prev_minus['reg_bear'], 'hid_bear': prev_minus['hid_bear']}

    return {
        'VI_plus':             vi_plus,
        'VI_minus':            vi_minus,
        'VI_Regular_Bullish':  rb_bull,
        'VI_Regular_Bearish':  rb_bear,
        'VI_Hidden_Bullish':   hb_bull,
        'VI_Hidden_Bearish':   hb_bear,
        **prev_columns('VI', prev),
    }


def calculate_indicator(df: pd.DataFrame, **params):
    return calculate_vortex_divergence(df, **params)
