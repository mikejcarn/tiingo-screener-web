import pandas as pd
from backend.indicators.indicators import get_indicators
from backend.indicators.indicators_list.aVWAP import calculate_avwap


def calculate_aVWAP_peaks(df, periods=25, max_aVWAPs=None):
    """
    Anchor aVWAPs at detected swing peaks.

    Output columns: aVWAP_peak_c0_{anchor_bar}
    """
    df = df.reset_index()
    df['date'] = pd.to_datetime(df['date'])

    base_cols = [c for c in ['Open', 'High', 'Low', 'Close', 'Volume', 'date'] if c in df.columns]
    temp = get_indicators(df[base_cols].copy(), ['peaks_valleys'], {'peaks_valleys': {'periods': periods}})

    indices = sorted(temp[temp['Peaks'] == 1].index.tolist(), reverse=True) if 'Peaks' in temp.columns else []
    if max_aVWAPs is not None:
        indices = indices[:max_aVWAPs]

    result = {f'aVWAP_peak_c0_{idx}': calculate_avwap(df, idx) for idx in indices}

    for col, series in result.items():
        df[col] = series

    df.set_index('date', inplace=True)
    return df[list(result.keys())] if result else df[[]]


def calculate_indicator(df, **params):
    return calculate_aVWAP_peaks(df, **params)
