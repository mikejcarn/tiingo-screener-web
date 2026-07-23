import pandas as pd
from typing import Optional, Literal

display_name = "Order Block"
required_columns = ['OB']
param_schema = {
    'mode':         {'label': 'Mode', 'type': 'select',
                     'options': ['bullish', 'bearish', 'support', 'resistance'], 'default': 'bullish'},
    'atr_threshold':{'label': 'ATR tolerance (0=none)', 'type': 'number', 'default': 0.0, 'min': 0.0},
    'max_lookback': {'label': 'Max lookback bars (0=all)', 'type': 'int', 'default': 0, 'min': 0},
}


def _atr(df: pd.DataFrame, length: int = 7) -> pd.Series:
    tr = pd.concat([df['High'] - df['Low'],
                    (df['High'] - df['Close'].shift(1)).abs(),
                    (df['Low']  - df['Close'].shift(1)).abs()], axis=1).max(axis=1)
    atr = tr.rolling(length).mean()
    atr.iloc[length:] = tr.ewm(span=length, adjust=False).mean().iloc[length:]
    return atr


def OB(df: pd.DataFrame, mode: str = 'bullish',
       atr_threshold: float = 0.0, max_lookback: int = 0) -> pd.DataFrame:
    if len(df) == 0 or 'OB' not in df.columns:
        return pd.DataFrame()
    work = df.iloc[-max_lookback:] if max_lookback > 0 else df

    if mode in ('bullish', 'bearish'):
        target_val = 1 if mode == 'bullish' else -1
        rev = work.iloc[::-1]
        recent = rev[rev['OB'] != 0].head(1)
        if recent.empty:
            return pd.DataFrame()
        if recent.iloc[0]['OB'] == target_val:
            return df.iloc[-1:].copy()
        return pd.DataFrame()

    elif mode in ('support', 'resistance'):
        current_price = df['Close'].iloc[-1]
        target_val    = 1 if mode == 'support' else -1
        rev = work.iloc[::-1]
        ob_row = rev[rev['OB'] == target_val].head(1)
        if ob_row.empty:
            return pd.DataFrame()
        ob = ob_row.iloc[0]
        tolerance = 0.0
        if atr_threshold > 0:
            atr_series = _atr(df)
            tolerance  = atr_series.iloc[-1] * atr_threshold
        low  = ob.get('OB_Low',  ob.get('Low',  0)) - tolerance
        high = ob.get('OB_High', ob.get('High', 0)) + tolerance
        if low <= current_price <= high:
            return df.iloc[-1:].copy()
        return pd.DataFrame()

    raise ValueError(f"Invalid mode: {mode}")


def calculate_indicator(df, **params):
    return OB(df, **params)
