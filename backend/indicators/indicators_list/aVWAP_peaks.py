import pandas as pd
from backend.indicators.indicators import get_indicators
from backend.indicators.indicators_list.aVWAP import calculate_avwap


display_name = "aVWAP — Peaks"

param_labels = {
    'periods':     'Pivot Window (periods)',
    'max_aVWAPs':  'Max Anchors (blank = unlimited)',
    'styling':     'Line Styling',
}

param_descriptions = {
    # Shared verbatim with aVWAP_valleys' own 'styling' entry — the two modules feed
    # the same global param_descriptions namespace (keyed by param name only), so this
    # text is written to apply equally to peaks (red) and valleys (teal).
    'styling': "How to color multiple configs of this type on the chart. 'shades' (default) "
               "gives every config a shade of this indicator's color, tiered by opacity from "
               "most- to least-recently-added config. 'highlight_first' keeps the first "
               "config at full color and renders every other config as a shade of grey "
               "instead, so the primary config stands out from the rest. 'grayscale' renders "
               "every config as a shade of grey (no hue at all), so price action stands out "
               "against the aVWAP lines instead of one config standing out against the others "
               "— useful for high-resolution snapshots.",
}


def calculate_aVWAP_peaks(df, peaks_params={'periods': 25, 'max_aVWAPs': None}, styling='shades'):
    """
    Anchor aVWAPs at detected swing peaks.

    peaks_params — a config dict (or list of config dicts), each with:
        'periods'    — pivot-detection window (default 25)
        'max_aVWAPs' — cap on how many peak anchors to keep for this config (None = unlimited)

    styling — how the (possibly multiple) configs are colored on the chart:
        'shades'          — every config a shade of red, tiered by opacity (default)
        'highlight_first' — first config full red, every other config a shade of grey
        'grayscale'       — every config a shade of grey, no red at all

    Multiple configs (pass a list) each get their own independent periods/max_aVWAPs
    and are kept in separately-labelled anchor groups:
    aVWAP_peak_c0_{anchor_bar}, aVWAP_peak_c1_{anchor_bar}, ...
    """
    df = df.reset_index()
    df['date'] = pd.to_datetime(df['date'])

    base_cols = [c for c in ['Open', 'High', 'Low', 'Close', 'Volume', 'date'] if c in df.columns]
    configs = peaks_params if isinstance(peaks_params, list) else [peaks_params]

    result = {}
    for config_idx, config in enumerate(configs):
        periods    = config.get('periods', 25)
        max_aVWAPs = config.get('max_aVWAPs', None)

        temp = get_indicators(df[base_cols].copy(), ['peaks_valleys'], {'peaks_valleys': {'periods': periods}})
        if 'Peaks' not in temp.columns:
            continue
        indices = sorted(temp[temp['Peaks'] == 1].index.tolist(), reverse=True)
        if max_aVWAPs is not None:
            indices = indices[:max_aVWAPs]

        for idx in indices:
            result[f'aVWAP_peak_c{config_idx}_{idx}'] = calculate_avwap(df, idx)

    for col, series in result.items():
        df[col] = series

    df.set_index('date', inplace=True)
    return df[list(result.keys())] if result else df[[]]


def calculate_indicator(df, **params):
    return calculate_aVWAP_peaks(df, **params)
