import pandas as pd
from backend.indicators.indicators_list.aVWAP import calculate_avwap


def calculate_aVWAP_minmax(
    df,
    periods=None,
    include_max=True,
    include_min=True,
):
    """
    Anchor aVWAPs at the highest High (max) and lowest Low (min).

    periods     — lookback bar count (None = whole chart; int for window)
    include_max — aVWAP anchored at the highest High  (red)
    include_min — aVWAP anchored at the lowest Low    (teal)

    Output columns:
        aVWAP_max_{anchor_bar}
        aVWAP_min_{anchor_bar}
    """
    df = df.reset_index()
    df['date'] = pd.to_datetime(df['date'])

    start = max(0, len(df) - periods) if periods is not None else 0
    window = df.iloc[start:]

    result = {}

    if include_max:
        idx = int(window['High'].idxmax())
        result[f'aVWAP_max_{idx}'] = calculate_avwap(df, idx)

    if include_min:
        idx = int(window['Low'].idxmin())
        result[f'aVWAP_min_{idx}'] = calculate_avwap(df, idx)

    for col, series in result.items():
        df[col] = series

    df.set_index('date', inplace=True)
    return df[list(result.keys())] if result else df[[]]


def calculate_indicator(df, **params):
    return calculate_aVWAP_minmax(df, **params)
