import pandas as pd
from backend.indicators.indicators_list._divergence_core import detect_divergences


def calculate_stochastic_divergence(df: pd.DataFrame, k_period: int = 14,
                                     d_period: int = 3,
                                     left: int = 5, right: int = 5, **_):
    low_min  = df['Low'].rolling(k_period).min()
    high_max = df['High'].rolling(k_period).max()
    stoch_k  = 100 * ((df['Close'] - low_min) / (high_max - low_min))
    stoch_d  = stoch_k.rolling(d_period).mean()

    reg_bull, reg_bear, hid_bull, hid_bear = detect_divergences(
        df['Close'], stoch_k, left, right)
    return {
        'Stoch_%K':                    stoch_k,
        'Stoch_%D':                    stoch_d,
        'Stochastic_Regular_Bullish':  reg_bull,
        'Stochastic_Regular_Bearish':  reg_bear,
        'Stochastic_Hidden_Bullish':   hid_bull,
        'Stochastic_Hidden_Bearish':   hid_bear,
    }


def calculate_indicator(df: pd.DataFrame, **params):
    return calculate_stochastic_divergence(df, **params)
