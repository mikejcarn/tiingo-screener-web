import pandas as pd
from typing import Literal

display_name = "Break of Structure / Change of Character"
param_schema = {
    'mode':          {'label': 'Mode', 'type': 'select',
                      'options': ['BoS_bullish', 'BoS_bearish', 'CHoCH_bullish', 'CHoCH_bearish'],
                      'default': 'BoS_bullish'},
    'lookback_bars': {'label': 'Lookback bars', 'type': 'int', 'default': 200, 'min': 1},
}


def BoS_CHoCH(df: pd.DataFrame, mode: str = 'BoS_bullish', lookback_bars: int = 200) -> pd.DataFrame:
    """Checks that the most recent BoS or CHoCH event matches the requested mode/direction.
    Supports parameterized column names like BoS_25, CHoCH_25 from the indicator."""
    if len(df) < 2:
        return pd.DataFrame()

    event_type  = 'BoS' if 'BoS' in mode else 'CHoCH'
    direction   = 1 if 'bullish' in mode else -1

    # Find all columns matching BoS_{sl} or CHoCH_{sl}
    bos_cols   = [c for c in df.columns if c.startswith('BoS_')   and not c.startswith('BoS_CHoCH')]
    choch_cols = [c for c in df.columns if c.startswith('CHoCH_') and not c.startswith('CHoCH_')]

    if not bos_cols and not choch_cols:
        return pd.DataFrame()

    lookback_df = df.iloc[-lookback_bars:] if len(df) > lookback_bars else df

    # Walk backwards to find most recent BoS or CHoCH event (any swing length)
    last_type = last_dir = None
    for i in range(len(lookback_df) - 2, -1, -1):
        row = lookback_df.iloc[i]
        for col in bos_cols:
            if row[col] != 0:
                last_type, last_dir = 'BoS', row[col]
                break
        if last_type:
            break
        for col in choch_cols:
            if row[col] != 0:
                last_type, last_dir = 'CHoCH', row[col]
                break
        if last_type:
            break

    if last_type == event_type and last_dir == direction:
        return df.iloc[-1:].copy()
    return pd.DataFrame()


def calculate_indicator(df, **params):
    return BoS_CHoCH(df, **params)
