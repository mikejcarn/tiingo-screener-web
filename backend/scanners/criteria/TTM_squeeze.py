import pandas as pd

display_name = "TTM Squeeze"
required_columns = ['TTM_squeeze_Active']
param_schema = {
    'mode': {'label': 'Mode', 'type': 'select', 'options': ['active', 'breakout'], 'default': 'active'},
    'min_squeeze_bars': {'label': 'Min squeeze bars', 'type': 'int', 'default': 5, 'min': 1},
    'max_squeeze_bars': {'label': 'Max squeeze bars (0 = no limit)', 'type': 'int', 'default': 0, 'min': 0},
}


def TTM_squeeze(df: pd.DataFrame, mode: str = 'active', min_squeeze_bars: int = 5,
                max_squeeze_bars: int = 0) -> pd.DataFrame:
    if len(df) == 0 or 'TTM_squeeze_Active' not in df.columns:
        return pd.DataFrame()
    df = df.copy()
    squeeze_changes = (df['TTM_squeeze_Active'].diff() != 0).cumsum()
    df['_sq_dur'] = df.groupby(squeeze_changes)['TTM_squeeze_Active'].cumsum()

    latest = df.iloc[-1]
    prev   = df.iloc[-2] if len(df) > 1 else None
    max_bars = max_squeeze_bars or None

    if mode == 'active':
        if (latest['TTM_squeeze_Active'] == 1 and
                latest['_sq_dur'] >= min_squeeze_bars and
                (max_bars is None or latest['_sq_dur'] <= max_bars)):
            return df.iloc[-1:].drop(columns=['_sq_dur'])
    elif mode == 'breakout':
        if (prev is not None and
                prev['TTM_squeeze_Active'] == 1 and
                latest['TTM_squeeze_Active'] == 0 and
                prev['_sq_dur'] >= min_squeeze_bars and
                (max_bars is None or prev['_sq_dur'] <= max_bars)):
            return df.iloc[-1:].drop(columns=['_sq_dur'])

    return pd.DataFrame()


def calculate_indicator(df, **params):
    return TTM_squeeze(df, **params)
