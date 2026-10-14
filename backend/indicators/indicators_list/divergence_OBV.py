import numpy as np
import pandas as pd
from backend.indicators.indicators_list._divergence_core import detect_divergences, prev_columns


def calculate_obv_divergence(df: pd.DataFrame, period: int = 21,
                              left: int = 5, right: int = 5, **div_opts):
    close  = df['Close'].values
    volume = df['Volume'].values

    direction = np.sign(np.diff(close, prepend=close[0]))
    obv = pd.Series(np.cumsum(direction * volume), index=df.index)
    obv_smoothed = obv.ewm(span=period, adjust=False).mean()

    reg_bull, reg_bear, hid_bull, hid_bear, prev = detect_divergences(
        df['High'], df['Low'], obv_smoothed, left, right, **div_opts)
    return {
        'OBV':                  obv,
        'OBV_Smoothed':         obv_smoothed,
        'OBV_Regular_Bullish':  reg_bull,
        'OBV_Regular_Bearish':  reg_bear,
        'OBV_Hidden_Bullish':   hid_bull,
        'OBV_Hidden_Bearish':   hid_bear,
        **prev_columns('OBV', prev),
    }


def calculate_indicator(df: pd.DataFrame, **params):
    return calculate_obv_divergence(df, **params)
