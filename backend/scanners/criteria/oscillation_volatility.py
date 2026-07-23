import pandas as pd
from typing import Optional

display_name = "Oscillation Volatility"
required_columns = ['MA_Cross_Count', 'MA_Avg_Deviation_Z', 'MA_Oscillation_Score']
param_schema = {
    'cross_count':          {'label': 'Min MA crosses',      'type': 'int',    'default': 0, 'min': 0},
    'cross_count_max':      {'label': 'Max MA crosses (0=∞)','type': 'int',    'default': 0, 'min': 0},
    'avg_deviation':        {'label': 'Min avg deviation',   'type': 'number', 'default': 0.0, 'min': 0.0},
    'avg_deviation_max':    {'label': 'Max avg deviation (0=∞)', 'type': 'number', 'default': 0.0, 'min': 0.0},
    'oscillation_score':    {'label': 'Min score',           'type': 'number', 'default': 0.0, 'min': 0.0},
    'oscillation_score_max':{'label': 'Max score (0=∞)',     'type': 'number', 'default': 0.0, 'min': 0.0},
}

_REQUIRED = ['MA_Cross_Count', 'MA_Avg_Deviation_Z', 'MA_Oscillation_Score']


def oscillation_volatility(df: pd.DataFrame,
                           cross_count: int = 0, cross_count_max: int = 0,
                           avg_deviation: float = 0.0, avg_deviation_max: float = 0.0,
                           oscillation_score: float = 0.0, oscillation_score_max: float = 0.0) -> pd.DataFrame:
    if len(df) == 0 or not all(c in df.columns for c in _REQUIRED):
        return pd.DataFrame()
    latest = df.iloc[-1]

    # 0 means "no limit" for max params
    def check(val, mn, mx): return (mn <= 0 or val >= mn) and (mx <= 0 or val <= mx)

    if (check(latest['MA_Cross_Count'],       cross_count,       cross_count_max) and
            check(latest['MA_Avg_Deviation_Z'],   avg_deviation,     avg_deviation_max) and
            check(latest['MA_Oscillation_Score'], oscillation_score, oscillation_score_max)):
        return df.iloc[-1:].copy()
    return pd.DataFrame()


def calculate_indicator(df, **params):
    return oscillation_volatility(df, **params)
