import pandas as pd

display_name = "QQEMOD"
param_schema = {
    'mode': {'label': 'Mode', 'type': 'select',
             'options': ['overbought', 'oversold', 'bullish_reversal', 'bearish_reversal'],
             'default': 'oversold'},
    'min_consecutive':    {'label': 'Min consecutive bars (reversal)', 'type': 'int',  'default': 3, 'min': 1},
    'require_confirmation':{'label': 'Require price confirmation',     'type': 'bool', 'default': True},
}

_REQUIRED = ['QQE1_Above_Upper', 'QQE1_Below_Lower',
             'QQE2_Above_Threshold', 'QQE2_Below_Threshold', 'QQE2_Above_TL']


def QQEMOD(df: pd.DataFrame, mode: str = 'oversold',
           min_consecutive: int = 3, require_confirmation: bool = True) -> pd.DataFrame:
    if len(df) == 0 or not all(c in df.columns for c in _REQUIRED):
        return pd.DataFrame()
    latest = df.iloc[-1]

    def _teal(r): return bool(r['QQE1_Above_Upper']) and bool(r['QQE2_Above_Threshold']) and bool(r['QQE2_Above_TL'])
    def _red(r):  return bool(r['QQE1_Below_Lower']) and bool(r['QQE2_Below_Threshold']) and not bool(r['QQE2_Above_TL'])

    if mode == 'overbought':
        return df.iloc[-1:].copy() if _teal(latest) else pd.DataFrame()

    if mode == 'oversold':
        return df.iloc[-1:].copy() if _red(latest) else pd.DataFrame()

    if len(df) < min_consecutive + 1:
        return pd.DataFrame()

    window  = df.iloc[-(min_consecutive + 1):]
    current = window.iloc[-1]
    prev    = window.iloc[:-1]

    if mode == 'bearish_reversal':
        cur_weak  = (bool(current['QQE1_Above_Upper']) and
                     bool(current['QQE2_Above_Threshold']) and
                     not bool(current['QQE2_Above_TL']))
        prev_strong = all(_teal(prev.iloc[i]) for i in range(len(prev)))
        ok = cur_weak and prev_strong
        if ok and require_confirmation and df['Close'].iloc[-1] > df['Close'].iloc[-2]:
            return pd.DataFrame()
        return df.iloc[-1:].copy() if ok else pd.DataFrame()

    if mode == 'bullish_reversal':
        cur_weak  = (bool(current['QQE1_Below_Lower']) and
                     bool(current['QQE2_Below_Threshold']) and
                     bool(current['QQE2_Above_TL']))
        prev_strong = all(_red(prev.iloc[i]) for i in range(len(prev)))
        ok = cur_weak and prev_strong
        if ok and require_confirmation and df['Close'].iloc[-1] < df['Close'].iloc[-2]:
            return pd.DataFrame()
        return df.iloc[-1:].copy() if ok else pd.DataFrame()

    return pd.DataFrame()


def calculate_indicator(df, **params):
    return QQEMOD(df, **params)
