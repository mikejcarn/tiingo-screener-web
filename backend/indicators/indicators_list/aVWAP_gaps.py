import pandas as pd
from backend.indicators.indicators_list._aVWAP import calculate_avwap


def calculate_aVWAP_gaps(df, max_aVWAPs=None, show_up=True, show_down=True):
    """
    Anchor aVWAPs at price gaps (bars where Low > prior High, or High < prior Low).

    Output columns:
        Gap_Up_aVWAP_c0_{anchor_bar}   — gap-up bars
        Gap_Down_aVWAP_c0_{anchor_bar} — gap-down bars
    """
    df = df.reset_index()
    df['date'] = pd.to_datetime(df['date'])

    prev_high = df['High'].shift(1)
    prev_low  = df['Low'].shift(1)

    result = {}

    if show_up:
        up_indices = sorted(df[df['Low'] > prev_high].index.tolist(), reverse=True)
        if max_aVWAPs is not None:
            up_indices = up_indices[:max_aVWAPs]
        for idx in up_indices:
            result[f'Gap_Up_aVWAP_c0_{idx}'] = calculate_avwap(df, idx)

    if show_down:
        down_indices = sorted(df[df['High'] < prev_low].index.tolist(), reverse=True)
        if max_aVWAPs is not None:
            down_indices = down_indices[:max_aVWAPs]
        for idx in down_indices:
            result[f'Gap_Down_aVWAP_c0_{idx}'] = calculate_avwap(df, idx)

    for col, series in result.items():
        df[col] = series

    df.set_index('date', inplace=True)
    return df[list(result.keys())] if result else df[[]]


def calculate_indicator(df, **params):
    return calculate_aVWAP_gaps(df, **params)
