import pandas as pd
from backend.indicators.indicators_list import _oscillators_core as osc
from backend.indicators.indicators_list._divergence_core import detect_divergences, prev_columns


def calculate_atr_divergence(df: pd.DataFrame, period: int = 14,
                              left: int = 5, right: int = 5, **div_opts):
    atr = osc.atr(df, period)

    reg_bull, reg_bear, hid_bull, hid_bear, prev = detect_divergences(
        df['High'], df['Low'], atr, left, right, **div_opts)
    return {
        'ATR':                  atr,
        'ATR_Regular_Bullish':  reg_bull,
        'ATR_Regular_Bearish':  reg_bear,
        'ATR_Hidden_Bullish':   hid_bull,
        'ATR_Hidden_Bearish':   hid_bear,
        **prev_columns('ATR', prev),
    }


def calculate_indicator(df: pd.DataFrame, **params):
    return calculate_atr_divergence(df, **params)
