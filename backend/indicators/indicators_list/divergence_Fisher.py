import numpy as np
import pandas as pd
from backend.indicators.indicators_list._divergence_core import detect_divergences


def calculate_fisher_divergence(df: pd.DataFrame, period: int = 10,
                                 left: int = 5, right: int = 5, **_):
    hl2     = (df['High'] + df['Low']) / 2
    max_hl2 = hl2.rolling(period).max()
    min_hl2 = hl2.rolling(period).min()

    val    = (0.33 * 2 * ((hl2 - min_hl2) / (max_hl2 - min_hl2 + 1e-7) - 0.5)).clip(-0.999, 0.999)
    fisher = 0.5 * np.log((1 + val) / (1 - val))
    signal = fisher.ewm(span=3, adjust=False).mean()

    reg_bull, reg_bear, hid_bull, hid_bear = detect_divergences(
        df['Close'], fisher, left, right)
    return {
        'Fisher':                  fisher,
        'Fisher_Signal':           signal,
        'Fisher_Regular_Bullish':  reg_bull,
        'Fisher_Regular_Bearish':  reg_bear,
        'Fisher_Hidden_Bullish':   hid_bull,
        'Fisher_Hidden_Bearish':   hid_bear,
    }


def calculate_indicator(df: pd.DataFrame, **params):
    return calculate_fisher_divergence(df, **params)
