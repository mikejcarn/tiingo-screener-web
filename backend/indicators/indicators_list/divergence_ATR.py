import numpy as np
import pandas as pd
from backend.indicators.indicators_list._divergence_core import detect_divergences


def calculate_atr_divergence(df: pd.DataFrame, period: int = 14,
                              left: int = 5, right: int = 5, **_):
    high_low   = df['High'] - df['Low']
    high_close = (df['High'] - df['Close'].shift(1)).abs()
    low_close  = (df['Low']  - df['Close'].shift(1)).abs()
    tr  = pd.concat([high_low, high_close, low_close], axis=1).max(axis=1)
    atr = tr.rolling(period).mean()

    reg_bull, reg_bear, hid_bull, hid_bear = detect_divergences(
        df['Close'], atr, left, right)
    return {
        'ATR':                  atr,
        'ATR_Regular_Bullish':  reg_bull,
        'ATR_Regular_Bearish':  reg_bear,
        'ATR_Hidden_Bullish':   hid_bull,
        'ATR_Hidden_Bearish':   hid_bear,
    }


def calculate_indicator(df: pd.DataFrame, **params):
    return calculate_atr_divergence(df, **params)
