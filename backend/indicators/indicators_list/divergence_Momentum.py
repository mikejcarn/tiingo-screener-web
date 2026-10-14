import pandas as pd
from backend.indicators.indicators_list._divergence_core import detect_divergences, prev_columns


def calculate_momentum_divergence(df: pd.DataFrame, period: int = 10,
                                   smooth_period: int = 3,
                                   left: int = 5, right: int = 5, **div_opts):
    close    = df['Close']
    momentum = close - close.shift(period)
    smoothed = momentum.ewm(span=smooth_period, adjust=False).mean()

    reg_bull, reg_bear, hid_bull, hid_bear, prev = detect_divergences(df['High'], df['Low'], smoothed, left, right, **div_opts)
    return {
        'Momentum':              momentum,
        'Momentum_Smoothed':     smoothed,
        'Momo_Regular_Bullish':  reg_bull,
        'Momo_Regular_Bearish':  reg_bear,
        'Momo_Hidden_Bullish':   hid_bull,
        'Momo_Hidden_Bearish':   hid_bear,
        **prev_columns('Momo', prev),
    }


def calculate_indicator(df: pd.DataFrame, **params):
    return calculate_momentum_divergence(df, **params)
