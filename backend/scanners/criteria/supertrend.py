import pandas as pd

display_name = "Supertrend"
required_columns = ['Supertrend_Direction']
param_schema = {
    'mode': {'label': 'Mode', 'type': 'select', 'options': ['bullish', 'bearish'], 'default': 'bullish'},
}


def supertrend(df: pd.DataFrame, mode: str = 'bullish') -> pd.DataFrame:
    if len(df) == 0:
        return pd.DataFrame()
    latest = df.iloc[-1]
    if 'Supertrend_Direction' not in latest.index or pd.isna(latest['Supertrend_Direction']):
        return pd.DataFrame()
    if mode == 'bullish':
        return df.iloc[-1:].copy() if latest['Supertrend_Direction'] == 1 else pd.DataFrame()
    elif mode == 'bearish':
        return df.iloc[-1:].copy() if latest['Supertrend_Direction'] == -1 else pd.DataFrame()
    raise ValueError("mode must be 'bullish' or 'bearish'")


def calculate_indicator(df, **params):
    return supertrend(df, **params)
