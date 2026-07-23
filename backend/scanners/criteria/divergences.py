import pandas as pd
from typing import List, Optional

display_name = "Divergences"
required_columns = ['OBV_Regular_Bullish']
param_schema = {
    'mode':                {'label': 'Direction',     'type': 'select',   'options': ['bearish', 'bullish'], 'default': 'bearish'},
    'divergence_types':    {'label': 'Types (comma)', 'type': 'list_str', 'default': ['OBV', 'VI', 'Fisher', 'Vol']},
    'max_bars_back':       {'label': 'Lookback bars', 'type': 'int',      'default': 20, 'min': 1},
    'require_confirmation':{'label': 'Require price confirmation', 'type': 'bool', 'default': True},
}


def divergences(df: pd.DataFrame,
                divergence_types: Optional[List[str]] = None,
                mode: str = 'bearish',
                max_bars_back: int = 20,
                require_confirmation: bool = True) -> pd.DataFrame:
    if len(df) < 2:
        return pd.DataFrame()
    if divergence_types is None:
        divergence_types = ['OBV', 'VI', 'Fisher', 'Vol']
    mode = mode.lower()
    opposite = 'bullish' if mode == 'bearish' else 'bearish'

    target_cols   = [f'{t}_{k}_{mode.capitalize()}'    for t in divergence_types for k in ('Regular', 'Hidden')]
    opposite_cols = [f'{t}_{k}_{opposite.capitalize()}' for t in divergence_types for k in ('Regular', 'Hidden')]

    div_indices = []
    for col in target_cols:
        if col in df.columns:
            div_indices.extend(df[df[col]].index.tolist())

    if max_bars_back is not None and len(df) > max_bars_back:
        cutoff = df.index[-max_bars_back - 1]
        div_indices = [i for i in div_indices if i >= cutoff]

    if not div_indices:
        return pd.DataFrame()

    most_recent = max(div_indices)
    div_row = df.loc[most_recent]

    # Invalidated by opposite divergence occurring after
    for col in opposite_cols:
        if col in df.columns and df.loc[most_recent:][col].any():
            return pd.DataFrame()

    if require_confirmation:
        if mode == 'bearish' and df.loc[most_recent:]['High'].max() > div_row['High']:
            return pd.DataFrame()
        if mode == 'bullish' and df.loc[most_recent:]['Low'].min() < div_row['Low']:
            return pd.DataFrame()

    return df.iloc[-1:].copy()


def calculate_indicator(df, **params):
    return divergences(df, **params)
