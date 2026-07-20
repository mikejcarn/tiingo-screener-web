import numpy as np
import pandas as pd
from backend.indicators.indicators_list._aVWAP import calculate_avwap


def _greedy_extrema(values, n, spacing, mode):
    """Pick up to n non-clustered extrema from values using a greedy mask approach."""
    mask = np.ones(len(values), dtype=bool)
    selected = []
    for _ in range(n):
        candidates = np.where(mask, values, np.nan)
        idx = int(np.nanargmax(candidates) if mode == 'max' else np.nanargmin(candidates))
        if np.isnan(candidates[idx]):
            break
        selected.append(idx)
        lo = max(0, idx - spacing)
        hi = min(len(values), idx + spacing + 1)
        mask[lo:hi] = False
    return sorted(selected)


def calculate_aVWAP_minmax(
    df,
    lookback_bars=None,
    include_max=True,
    include_min=True,
    max_aVWAPs=1,
    min_spacing=20,
):
    """
    Anchor aVWAPs at the highest High(s) and lowest Low(s) within a window.

    lookback_bars — number of recent bars to scan (None = whole chart)
    include_max   — anchor at the top N highest Highs  (red)
    include_min   — anchor at the bottom N lowest Lows  (teal)
    max_aVWAPs    — how many anchors to find per side (1 = single extreme)
    min_spacing   — minimum bar gap between consecutive picks to avoid clustering

    Output columns:
        aVWAP_max_{anchor_bar}
        aVWAP_min_{anchor_bar}
    """
    df = df.reset_index()
    df['date'] = pd.to_datetime(df['date'])

    start = max(0, len(df) - lookback_bars) if lookback_bars is not None else 0
    window = df.iloc[start:]

    n = max_aVWAPs if max_aVWAPs is not None else 1
    spacing = max(0, min_spacing)

    result = {}

    if include_max:
        for idx in _greedy_extrema(window['High'].values, n, spacing, 'max'):
            bar = int(window.index[idx])
            result[f'aVWAP_max_{bar}'] = calculate_avwap(df, bar)

    if include_min:
        for idx in _greedy_extrema(window['Low'].values, n, spacing, 'min'):
            bar = int(window.index[idx])
            result[f'aVWAP_min_{bar}'] = calculate_avwap(df, bar)

    for col, series in result.items():
        df[col] = series

    df.set_index('date', inplace=True)
    return df[list(result.keys())] if result else df[[]]


def calculate_indicator(df, **params):
    return calculate_aVWAP_minmax(df, **params)
