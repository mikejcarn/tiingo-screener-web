import pandas as pd

display_name = "Standard Deviation Band (ZScore)"
required_columns = ['ZScore_*']
param_schema = {
    'threshold': {'label': 'Band level (StDevs)', 'type': 'number', 'default': 2.0, 'min': 0.1},
    'mode': {'label': 'Mode', 'type': 'select', 'options': ['oversold', 'overbought'], 'default': 'oversold'},
}


def StDev(df: pd.DataFrame, threshold: float = 2.0, mode: str = 'oversold') -> pd.DataFrame:
    """Check if price is beyond a ZScore band at the given deviation level.
    Requires ZScore indicator configured with the same threshold value."""
    if len(df) == 0:
        return pd.DataFrame()
    latest = df.iloc[-1]

    # Try float label first, then int (e.g. 2.0 vs 2)
    int_t = int(threshold) if threshold == int(threshold) else threshold
    upper_col = next((c for c in [f'ZScore_Upper_{threshold}', f'ZScore_Upper_{int_t}'] if c in df.columns), None)
    lower_col = next((c for c in [f'ZScore_Lower_{threshold}', f'ZScore_Lower_{int_t}'] if c in df.columns), None)

    if mode == 'oversold':
        if lower_col and not pd.isna(latest[lower_col]) and latest['Close'] < latest[lower_col]:
            return df.iloc[-1:].copy()
    elif mode == 'overbought':
        if upper_col and not pd.isna(latest[upper_col]) and latest['Close'] > latest[upper_col]:
            return df.iloc[-1:].copy()

    return pd.DataFrame()


def calculate_indicator(df, **params):
    return StDev(df, **params)
