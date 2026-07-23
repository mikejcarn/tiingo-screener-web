import pandas as pd
import numpy as np
from typing import Optional

display_name = "QQEMOD aVWAP Pullback"
param_schema = {
    'mode':          {'label': 'Direction', 'type': 'select',
                      'options': ['bullish', 'bearish', 'both'], 'default': 'bullish'},
    'max_lines':     {'label': 'Max aVWAP lines checked (0=all)', 'type': 'int', 'default': 0, 'min': 0},
    'min_lines':     {'label': 'Min lines that must match', 'type': 'int', 'default': 1, 'min': 1},
    'extend_to_end': {'label': 'Lines extend to current bar', 'type': 'bool', 'default': False},
}

_REQUIRED = ['QQE1_Above_Upper', 'QQE1_Below_Lower',
             'QQE2_Above_Threshold', 'QQE2_Below_Threshold', 'QQE2_Above_TL']


def _find_zone_start(df, zone):
    for i in range(len(df) - 1, -1, -1):
        r = df.iloc[i]
        if zone == 'red':
            in_z = (bool(r['QQE1_Below_Lower']) and bool(r['QQE2_Below_Threshold']) and not bool(r['QQE2_Above_TL']))
        else:
            in_z = (bool(r['QQE1_Above_Upper']) and bool(r['QQE2_Above_Threshold']) and bool(r['QQE2_Above_TL']))
        if not in_z:
            return i + 1
    return 0


def QQEMOD_aVWAP(df: pd.DataFrame, mode: str = 'bullish',
                 max_lines: int = 0, min_lines: int = 1,
                 extend_to_end: bool = False) -> pd.DataFrame:
    if df is None or len(df) == 0:
        return pd.DataFrame()
    if not all(c in df.columns for c in _REQUIRED):
        return pd.DataFrame()

    latest   = df.iloc[-1]
    close    = float(latest['Close'])
    max_l    = max_lines if max_lines > 0 else None
    signals  = []

    def _resolve(col, zone_start):
        if extend_to_end:
            v = latest.get(col)
            return float(v) if pd.notna(v) else None
        valid = df[col].iloc[zone_start:].dropna()
        return float(valid.iloc[-1]) if len(valid) > 0 else None

    def _cols(prefix, zone_start):
        cols = [c for c in df.columns
                if c.startswith(prefix) and int(c.split('_')[-1]) < zone_start]
        cols.sort(key=lambda c: int(c.split('_')[-1]), reverse=True)
        return cols[:max_l] if max_l else cols

    is_red  = (bool(latest['QQE1_Below_Lower']) and bool(latest['QQE2_Below_Threshold']) and
                not bool(latest['QQE2_Above_TL']))
    is_teal = (bool(latest['QQE1_Above_Upper']) and bool(latest['QQE2_Above_Threshold']) and
                bool(latest['QQE2_Above_TL']))

    if mode in ('bullish', 'both') and is_red:
        zs         = _find_zone_start(df, 'red')
        zone_highs = df['High'].iloc[zs:].values
        cands      = []
        for col in _cols('aVWAP_QQEMOD_bear_', zs):
            av = _resolve(col, zs)
            if av is None or np.max(zone_highs) < av:
                continue
            cands.append({'Signal': 'bullish_pullback_to_aVWAP', 'Close': close,
                          'aVWAP': av, 'Distance_Pct': round((close - av) / av * 100, 3),
                          'aVWAP_Column': col, 'Zone': 'red'})
        if len(cands) >= min_lines:
            signals.extend(cands)

    if mode in ('bearish', 'both') and is_teal:
        zs        = _find_zone_start(df, 'teal')
        zone_lows = df['Low'].iloc[zs:].values
        cands     = []
        for col in _cols('aVWAP_QQEMOD_bull_', zs):
            av = _resolve(col, zs)
            if av is None or np.min(zone_lows) > av:
                continue
            cands.append({'Signal': 'bearish_pullback_to_aVWAP', 'Close': close,
                          'aVWAP': av, 'Distance_Pct': round((close - av) / av * 100, 3),
                          'aVWAP_Column': col, 'Zone': 'teal'})
        if len(cands) >= min_lines:
            signals.extend(cands)

    if not signals:
        return pd.DataFrame()
    return pd.DataFrame(signals, index=[df.index[-1]] * len(signals))


def calculate_indicator(df, **params):
    return QQEMOD_aVWAP(df, **params)
