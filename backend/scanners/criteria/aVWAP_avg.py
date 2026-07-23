import pandas as pd
from typing import Literal

display_name = "aVWAP Average"
required_columns = ['aVWAP_*']
param_schema = {
    'mode':         {'label': 'Average type', 'type': 'select',
                     'options': ['combined', 'peaks', 'valleys'], 'default': 'combined'},
    'direction':    {'label': 'Direction', 'type': 'select',
                     'options': ['within', 'below', 'above'], 'default': 'within'},
    'distance_pct': {'label': 'Distance %', 'type': 'number', 'default': 1.0, 'min': 0.0},
    'outside_range':{'label': 'Outside range', 'type': 'bool', 'default': False},
}

_MODE_COL = {'combined': 'Peaks_Valleys_avg', 'peaks': 'Peaks_avg', 'valleys': 'Valleys_avg'}


def aVWAP_avg(df: pd.DataFrame, mode: str = 'combined', distance_pct: float = 1.0,
              direction: str = 'within', outside_range: bool = False) -> pd.DataFrame:
    if len(df) == 0:
        return pd.DataFrame()
    avg_col = _MODE_COL.get(mode)
    if not avg_col or avg_col not in df.columns:
        return pd.DataFrame()
    latest = df.iloc[-1]
    if pd.isna(latest[avg_col]) or pd.isna(latest['Close']):
        return pd.DataFrame()

    distance = (latest['Close'] - latest[avg_col]) / latest[avg_col] * 100

    if direction == 'within':
        ok = abs(distance) > distance_pct if outside_range else abs(distance) <= distance_pct
    elif direction == 'below':
        ok = distance < -distance_pct if outside_range else -distance_pct <= distance <= 0
    else:  # above
        ok = distance > distance_pct if outside_range else 0 <= distance <= distance_pct

    if ok:
        row = df.iloc[-1:].copy()
        row['Signal']        = f'aVWAP_avg_{direction}' + ('_extended' if outside_range else '')
        row['Average_Level'] = latest[avg_col]
        row['Distance_Pct']  = distance
        return row
    return pd.DataFrame()


def calculate_indicator(df, **params):
    return aVWAP_avg(df, **params)
