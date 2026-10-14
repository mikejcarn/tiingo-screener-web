import numpy as np
import pandas as pd
from backend.indicators.indicators_list._divergence_core import detect_divergences, prev_columns


def calculate_rsi_divergence(df: pd.DataFrame, period: int = 14,
                              left: int = 5, right: int = 5, **div_opts):
    close = df['Close']
    delta = close.diff()
    gain  = delta.where(delta > 0, 0.0)
    loss  = -delta.where(delta < 0, 0.0)

    # Wilder's smoothing (EMA with alpha = 1/period)
    avg_gain = gain.ewm(alpha=1 / period, adjust=False).mean()
    avg_loss = loss.ewm(alpha=1 / period, adjust=False).mean()
    rsi = 100 - (100 / (1 + avg_gain / avg_loss))

    reg_bull, reg_bear, hid_bull, hid_bear, prev = detect_divergences(df['High'], df['Low'], rsi, left, right, **div_opts)
    return {
        'RSI':                  rsi,
        'RSI_Regular_Bullish':  reg_bull,
        'RSI_Regular_Bearish':  reg_bear,
        'RSI_Hidden_Bullish':   hid_bull,
        'RSI_Hidden_Bearish':   hid_bear,
        **prev_columns('RSI', prev),
    }


def calculate_indicator(df: pd.DataFrame, **params):
    return calculate_rsi_divergence(df, **params)
