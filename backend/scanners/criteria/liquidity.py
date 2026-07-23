import pandas as pd

display_name = "Liquidity Level"
required_columns = ['Liquidity', 'Liquidity_Level']
param_schema = {
    'distance_pct': {'label': 'Distance %', 'type': 'number', 'default': 1.0, 'min': 0.0},
}


def liquidity(df: pd.DataFrame, distance_pct: float = 1.0) -> pd.DataFrame:
    if len(df) == 0:
        return pd.DataFrame()
    required = ['Liquidity', 'Liquidity_Level']
    if not all(c in df.columns for c in required):
        return pd.DataFrame()
    latest = df.iloc[-1]
    zones = df[df['Liquidity'] != 0]
    if zones.empty:
        return pd.DataFrame()
    latest_zone = zones.iloc[-1]
    if latest_zone['Liquidity_Level'] == 0:
        return pd.DataFrame()
    distance = abs(latest['Close'] - latest_zone['Liquidity_Level']) / latest['Close'] * 100
    if distance <= distance_pct:
        return df.iloc[-1:].copy()
    return pd.DataFrame()


def calculate_indicator(df, **params):
    return liquidity(df, **params)
