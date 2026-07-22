import pandas as pd
from backend.indicators.indicators_list._divergence_core import detect_divergences, find_price_pivots
import numpy as np


def calculate_vortex_divergence(df: pd.DataFrame, period: int = 14,
                                  left: int = 5, right: int = 5, **_):
    tr       = pd.concat([df['High'] - df['Low'],
                           (df['High'] - df['Close'].shift(1)).abs(),
                           (df['Low']  - df['Close'].shift(1)).abs()], axis=1).max(axis=1)
    vm_plus  = (df['High'] - df['Low'].shift(1)).abs()
    vm_minus = (df['Low']  - df['High'].shift(1)).abs()
    tr_sum   = tr.rolling(period).sum()
    vi_plus  = vm_plus.rolling(period).sum()  / tr_sum
    vi_minus = vm_minus.rolling(period).sum() / tr_sum

    # Bullish: price lows (Low series) vs VI+ — lower price low + higher VI+ = bullish
    # Bearish: price highs (High series) vs VI- — higher price high + lower VI- = bearish
    # We call detect_divergences twice with the appropriate series pairs.
    rb_bull, _, hb_bull, _ = detect_divergences(df['Low'],  vi_plus,  left, right)
    _, rb_bear, _, hb_bear = detect_divergences(df['High'], vi_minus, left, right)

    return {
        'VI_plus':             vi_plus,
        'VI_minus':            vi_minus,
        'VI_Regular_Bullish':  rb_bull,
        'VI_Regular_Bearish':  rb_bear,
        'VI_Hidden_Bullish':   hb_bull,
        'VI_Hidden_Bearish':   hb_bear,
    }


def calculate_indicator(df: pd.DataFrame, **params):
    return calculate_vortex_divergence(df, **params)
