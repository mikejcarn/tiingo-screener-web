import pandas as pd
from typing import Literal

display_name = "aVWAP Channel"
param_schema = {
    'mode':         {'label': 'Level',     'type': 'select', 'options': ['support', 'resistance'], 'default': 'support'},
    'distance_pct': {'label': 'Distance %','type': 'number', 'default': 5.0, 'min': 0.0},
    'direction':    {'label': 'Direction', 'type': 'select', 'options': ['within', 'below', 'above'], 'default': 'within'},
    'outside_range':{'label': 'Outside range', 'type': 'bool', 'default': False},
}


def aVWAP_channel(df: pd.DataFrame, mode: str = 'support', distance_pct: float = 5.0,
                  direction: str = 'within', outside_range: bool = False) -> pd.DataFrame:
    if len(df) == 0:
        return pd.DataFrame()
    latest = df.iloc[-1]

    if mode == 'support':
        cols = [c for c in df.columns if c.startswith('aVWAP_valley_') and pd.notna(latest.get(c))]
        if not cols:
            cols = [c for c in df.columns if c.startswith('aVWAP_') and pd.notna(latest.get(c))]
        if not cols:
            return pd.DataFrame()
        target = min(latest[c] for c in cols)
        signal_prefix = 'aVWAP_Support'
    else:
        cols = [c for c in df.columns if c.startswith('aVWAP_peak_') and pd.notna(latest.get(c))]
        if not cols:
            cols = [c for c in df.columns if c.startswith('aVWAP_') and pd.notna(latest.get(c))]
        if not cols:
            return pd.DataFrame()
        target = max(latest[c] for c in cols)
        signal_prefix = 'aVWAP_Resistance'

    if pd.isna(latest.get('Close')) or pd.isna(target):
        return pd.DataFrame()

    distance = (latest['Close'] - target) / target * 100

    if direction == 'within':
        ok = abs(distance) > distance_pct if outside_range else abs(distance) <= distance_pct
    elif direction == 'below':
        ok = distance < -distance_pct if outside_range else -distance_pct <= distance <= 0
    else:  # above
        ok = distance > distance_pct if outside_range else 0 <= distance <= distance_pct

    if ok:
        row = df.iloc[-1:].copy()
        row['Signal']       = f'{signal_prefix}_{direction}'
        row['aVWAP_Level']  = target
        row['Distance_Pct'] = distance
        return row
    return pd.DataFrame()


def calculate_indicator(df, **params):
    return aVWAP_channel(df, **params)
