import pandas as pd

display_name = "Banker RSI"
required_columns = ['banker_RSI']
param_schema = {
    'threshold_lower': {'label': 'Min value', 'type': 'number', 'default': 1, 'min': 0},
    'threshold_upper': {'label': 'Max value', 'type': 'number', 'default': 20, 'max': 20},
}


def banker_RSI(df: pd.DataFrame, threshold_lower: float = 1, threshold_upper: float = 20) -> pd.DataFrame:
    if len(df) == 0 or 'banker_RSI' not in df.columns:
        return pd.DataFrame()
    latest = df.iloc[-1]
    if threshold_lower < latest['banker_RSI'] < threshold_upper:
        return df.iloc[-1:].copy()
    return pd.DataFrame()


def calculate_indicator(df, **params):
    return banker_RSI(df, **params)
