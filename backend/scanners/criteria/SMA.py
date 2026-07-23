import pandas as pd
from typing import List

display_name = "SMA Relationship"
param_schema = {
    'sma_periods': {'label': 'Periods (comma-separated)', 'type': 'list_int', 'default': [50, 20, 10]},
    'mode': {'label': 'Mode', 'type': 'select', 'options': ['within', 'above', 'below', 'order'], 'default': 'within'},
    'distance_pct': {'label': 'Distance %', 'type': 'number', 'default': 1.0, 'min': 0.0},
    'outside_range': {'label': 'Outside range', 'type': 'bool', 'default': False},
}


def SMA(df: pd.DataFrame, sma_periods: List[int] = None, distance_pct: float = 1.0,
        mode: str = 'within', outside_range: bool = False) -> pd.DataFrame:
    if sma_periods is None:
        sma_periods = [50, 20, 10]
    if len(df) == 0:
        return pd.DataFrame()
    latest = df.iloc[-1]

    if mode == 'order':
        sma_values = {}
        for p in sma_periods:
            col = f'SMA_{p}'
            if col not in df.columns or pd.isna(latest[col]):
                return pd.DataFrame()
            sma_values[p] = latest[col]
        order_ok = all(sma_values[sma_periods[i]] < sma_values[sma_periods[i+1]]
                       for i in range(len(sma_periods) - 1))
        return df.iloc[-1:].copy() if order_ok else pd.DataFrame()

    for p in sma_periods:
        col = f'SMA_{p}'
        if col not in df.columns or pd.isna(latest[col]):
            return pd.DataFrame()
        price, sma_val = latest['Close'], latest[col]
        distance = abs(price - sma_val) / price * 100
        if mode == 'within':
            ok = distance > distance_pct if outside_range else distance <= distance_pct
        elif mode == 'above':
            ok = (price > sma_val) and (distance > distance_pct if outside_range else distance <= distance_pct)
        elif mode == 'below':
            ok = (price < sma_val) and (distance > distance_pct if outside_range else distance <= distance_pct)
        else:
            ok = False
        if not ok:
            return pd.DataFrame()

    return df.iloc[-1:].copy()


def calculate_indicator(df, **params):
    return SMA(df, **params)
