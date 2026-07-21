import pandas as pd
from backend.indicators.indicators import get_indicators
from backend.indicators.indicators_list.aVWAP import calculate_avwap


def calculate_aVWAP_valleys(df, periods=[25], max_aVWAPs=None):
    """
    Anchor aVWAPs at detected swing valleys.

    periods — one or more lookback periods; valleys from all are combined.

    Output columns: aVWAP_valley_c0_{anchor_bar}
    """
    df = df.reset_index()
    df['date'] = pd.to_datetime(df['date'])

    base_cols = [c for c in ['Open', 'High', 'Low', 'Close', 'Volume', 'date'] if c in df.columns]
    all_periods = periods if isinstance(periods, list) else [periods]

    index_set = set()
    for p in all_periods:
        temp = get_indicators(df[base_cols].copy(), ['peaks_valleys'], {'peaks_valleys': {'periods': p}})
        if 'Valleys' not in temp.columns:
            continue
        period_indices = sorted(temp[temp['Valleys'] == 1].index.tolist(), reverse=True)
        if max_aVWAPs is not None:
            period_indices = period_indices[:max_aVWAPs]
        index_set.update(period_indices)

    indices = sorted(index_set, reverse=True)

    result = {f'aVWAP_valley_c0_{idx}': calculate_avwap(df, idx) for idx in indices}

    for col, series in result.items():
        df[col] = series

    df.set_index('date', inplace=True)
    return df[list(result.keys())] if result else df[[]]


def calculate_indicator(df, **params):
    return calculate_aVWAP_valleys(df, **params)
