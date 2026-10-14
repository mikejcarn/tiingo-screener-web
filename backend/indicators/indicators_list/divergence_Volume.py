import pandas as pd
from backend.indicators.indicators_list._divergence_core import detect_divergences, prev_columns


def calculate_volume_divergence(df: pd.DataFrame, period: int = 14,
                                 left: int = 5, right: int = 5, **div_opts):
    vol_ma = df['Volume'].ewm(span=period, adjust=False).mean()

    reg_bull, reg_bear, hid_bull, hid_bear, prev = detect_divergences(
        df['High'], df['Low'], vol_ma, left, right, **div_opts)
    return {
        'Volume_MA':            vol_ma,
        'Vol_Regular_Bullish':  reg_bull,
        'Vol_Regular_Bearish':  reg_bear,
        'Vol_Hidden_Bullish':   hid_bull,
        'Vol_Hidden_Bearish':   hid_bear,
        **prev_columns('Vol', prev),
    }


def calculate_indicator(df: pd.DataFrame, **params):
    return calculate_volume_divergence(df, **params)
