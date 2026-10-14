import pandas as pd
from backend.indicators.indicators_list._divergence_core import detect_divergences, prev_columns


def calculate_macd_divergence(df: pd.DataFrame, fast_period: int = 12,
                               slow_period: int = 26, signal_period: int = 9,
                               left: int = 5, right: int = 5, **div_opts):
    close  = df['Close']
    macd   = close.ewm(span=fast_period, adjust=False).mean() - \
             close.ewm(span=slow_period, adjust=False).mean()
    signal = macd.ewm(span=signal_period, adjust=False).mean()

    reg_bull, reg_bear, hid_bull, hid_bear, prev = detect_divergences(df['High'], df['Low'], macd, left, right, **div_opts)
    return {
        'MACD':                  macd,
        'Signal':                signal,
        'Histogram':             macd - signal,
        'MACD_Regular_Bullish':  reg_bull,
        'MACD_Regular_Bearish':  reg_bear,
        'MACD_Hidden_Bullish':   hid_bull,
        'MACD_Hidden_Bearish':   hid_bear,
        **prev_columns('MACD', prev),
    }


def calculate_indicator(df: pd.DataFrame, **params):
    return calculate_macd_divergence(df, **params)
