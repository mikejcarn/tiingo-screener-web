import pandas as pd
from backend.indicators.indicators_list import _oscillators_core as osc
from backend.indicators.indicators_list._divergence_core import detect_divergences, prev_columns


def calculate_fisher_divergence(df: pd.DataFrame, period: int = 10,
                                 left: int = 5, right: int = 5, **div_opts):
    fisher, signal = osc.fisher(df, period)

    reg_bull, reg_bear, hid_bull, hid_bear, prev = detect_divergences(
        df['High'], df['Low'], fisher, left, right, **div_opts)
    return {
        'Fisher':                  fisher,
        'Fisher_Signal':           signal,
        'Fisher_Regular_Bullish':  reg_bull,
        'Fisher_Regular_Bearish':  reg_bear,
        'Fisher_Hidden_Bullish':   hid_bull,
        'Fisher_Hidden_Bearish':   hid_bear,
        **prev_columns('Fisher', prev),
    }


def calculate_indicator(df: pd.DataFrame, **params):
    return calculate_fisher_divergence(df, **params)
