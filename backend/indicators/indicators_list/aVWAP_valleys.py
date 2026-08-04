import pandas as pd
from backend.indicators.indicators import get_indicators
from backend.indicators.indicators_list.aVWAP import calculate_avwap


display_name = "aVWAP — Valleys"

param_labels = {
    'periods':     'Pivot Window (periods)',
    'max_aVWAPs':  'Max Anchors (blank = unlimited)',
}


def calculate_aVWAP_valleys(df, valleys_params={'periods': 25, 'max_aVWAPs': None}):
    """
    Anchor aVWAPs at detected swing valleys.

    valleys_params — a config dict (or list of config dicts), each with:
        'periods'    — pivot-detection window (default 25)
        'max_aVWAPs' — cap on how many valley anchors to keep for this config (None = unlimited)

    Multiple configs (pass a list) each get their own independent periods/max_aVWAPs
    and are kept in separately-labelled anchor groups:
    aVWAP_valley_c0_{anchor_bar}, aVWAP_valley_c1_{anchor_bar}, ...
    """
    df = df.reset_index()
    df['date'] = pd.to_datetime(df['date'])

    base_cols = [c for c in ['Open', 'High', 'Low', 'Close', 'Volume', 'date'] if c in df.columns]
    configs = valleys_params if isinstance(valleys_params, list) else [valleys_params]

    result = {}
    for config_idx, config in enumerate(configs):
        periods    = config.get('periods', 25)
        max_aVWAPs = config.get('max_aVWAPs', None)

        temp = get_indicators(df[base_cols].copy(), ['peaks_valleys'], {'peaks_valleys': {'periods': periods}})
        if 'Valleys' not in temp.columns:
            continue
        indices = sorted(temp[temp['Valleys'] == 1].index.tolist(), reverse=True)
        if max_aVWAPs is not None:
            indices = indices[:max_aVWAPs]

        for idx in indices:
            result[f'aVWAP_valley_c{config_idx}_{idx}'] = calculate_avwap(df, idx)

    for col, series in result.items():
        df[col] = series

    df.set_index('date', inplace=True)
    return df[list(result.keys())] if result else df[[]]


def calculate_indicator(df, **params):
    return calculate_aVWAP_valleys(df, **params)
