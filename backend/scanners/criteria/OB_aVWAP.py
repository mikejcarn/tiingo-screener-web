import pandas as pd
from typing import Optional

display_name = "Order Block aVWAP"
param_schema = {
    'mode':           {'label': 'Side',       'type': 'select', 'options': ['bullish', 'bearish'], 'default': 'bullish'},
    'direction':      {'label': 'Direction',  'type': 'select', 'options': ['within', 'below', 'above'], 'default': 'within'},
    'distance_pct':   {'label': 'Distance %', 'type': 'number', 'default': 1.0, 'min': 0.0},
    'require_in_range':{'label': 'Must be in OB range', 'type': 'bool', 'default': False},
    'max_lookback':   {'label': 'Max lookback bars (0=all)', 'type': 'int', 'default': 0, 'min': 0},
}


def OB_aVWAP(df: pd.DataFrame, mode: str = 'bullish', distance_pct: float = 1.0,
             direction: str = 'within', require_in_range: bool = False,
             max_lookback: int = 0) -> pd.DataFrame:
    if df is None or len(df) == 0:
        return pd.DataFrame()
    latest = df.iloc[-1]
    side   = 'bull' if mode == 'bullish' else 'bear'
    prefix = f'aVWAP_OB_{side}_c'

    avwap_cols = [c for c in df.columns if c.startswith(prefix)]
    if not avwap_cols:
        return pd.DataFrame()

    usable = []
    for c in avwap_cols:
        v = latest.get(c, pd.NA)
        if pd.notna(v):
            try:
                anchor_idx = int(c.split('_')[-1])
            except Exception:
                continue
            usable.append((anchor_idx, c, float(v)))

    if not usable:
        return pd.DataFrame()

    if max_lookback > 0:
        min_anchor = len(df) - max_lookback
        usable = [(a, c, v) for a, c, v in usable if a >= min_anchor]
    if not usable:
        return pd.DataFrame()

    anchor_idx, avwap_col, avwap_val = max(usable, key=lambda x: x[0])
    close    = float(latest['Close'])
    distance = (close - avwap_val) / avwap_val * 100.0

    if direction == 'below':
        ok = -distance_pct <= distance <= 0
    elif direction == 'above':
        ok = 0 <= distance <= distance_pct
    else:
        ok = abs(distance) <= distance_pct

    if not ok:
        return pd.DataFrame()

    if require_in_range and 'OB_High' in df.columns and 'OB_Low' in df.columns:
        try:
            ob_high = float(df.iloc[anchor_idx]['OB_High'])
            ob_low  = float(df.iloc[anchor_idx]['OB_Low'])
            if not (ob_low <= close <= ob_high):
                return pd.DataFrame()
        except Exception:
            return pd.DataFrame()

    row = df.iloc[-1:].copy()
    row['Signal']      = f'{mode}_OB_aVWAP_{direction}'
    row['OB_aVWAP']    = avwap_val
    row['Distance_Pct']= distance
    return row


def calculate_indicator(df, **params):
    return OB_aVWAP(df, **params)
