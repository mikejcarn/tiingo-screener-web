import pandas as pd
from backend.indicators.indicators import get_indicators
from backend.indicators.indicators_list.aVWAP import calculate_avwap



display_name = "aVWAP — Pinch"
def calculate_avwap_pinch(
    df,
    anchor_type='peak',           # 'peak' or 'valley' — the main anchor type
    anchor_periods=100,           # Lookback for anchor detection
    anchor_max_aVWAPs=1,          # Number of most recent anchors to show
    counterpart_periods=20,       # Lookback for counterpart detection
    counterpart_max_aVWAPs=3,     # Number of counterpart aVWAPs per anchor (pinch side)
    beyond_max_aVWAPs=3,          # Number of beyond aVWAPs per anchor (far side of anchor)
):
    """
    Calculate aVWAP pinch pairs plus beyond (handoff) aVWAPs.

    For each anchor (peak or valley):
      - Pinch counterparts: structure points on the converging side (below peak / above valley)
      - Beyond handoffs:    structure points on the far side (above peak / below valley)

      anchor_type='peak'   → anchor at peak,    pinch at valleys below,  beyond at peaks above
      anchor_type='valley' → anchor at valley,  pinch at peaks above,    beyond at valleys below

    Parameters:
        anchor_type           : 'peak' or 'valley'
        anchor_periods        : Rolling lookback for anchor detection
        anchor_max_aVWAPs     : Number of most recent anchors to include (None = all)
        counterpart_periods   : Rolling lookback for counterpart/beyond detection
        counterpart_max_aVWAPs: Number of pinch counterpart aVWAPs per anchor
        beyond_max_aVWAPs     : Number of beyond (handoff) aVWAPs per anchor

    Output columns:
        aVWAP_peak_{idx}          — anchor aVWAP at a detected peak        (solid)
        aVWAP_pinch_valley_{idx}  — pinch counterpart below the peak       (solid)
        aVWAP_pinch_above_{idx}   — beyond/handoff peaks above the anchor  (dotted)
        aVWAP_valley_{idx}        — anchor aVWAP at a detected valley      (solid)
        aVWAP_pinch_peak_{idx}    — pinch counterpart above the valley     (solid)
        aVWAP_pinch_below_{idx}   — beyond/handoff valleys below anchor    (dotted)
    """

    df = df.reset_index()
    df['date'] = pd.to_datetime(df['date'])

    base_cols = [c for c in ['Open', 'High', 'Low', 'Close', 'Volume', 'date'] if c in df.columns]

    # Detect anchors with anchor_periods
    anchor_df = get_indicators(
        df[base_cols].copy(),
        ['peaks_valleys'],
        {'peaks_valleys': {'periods': anchor_periods}}
    )

    # Detect counterparts/beyond with counterpart_periods (typically smaller)
    counter_df = get_indicators(
        df[base_cols].copy(),
        ['peaks_valleys'],
        {'peaks_valleys': {'periods': counterpart_periods}}
    )

    peak_indices           = anchor_df[anchor_df['Peaks']   == 1].index.tolist() if 'Peaks'   in anchor_df.columns else []
    valley_indices         = anchor_df[anchor_df['Valleys'] == 1].index.tolist() if 'Valleys' in anchor_df.columns else []
    counter_peak_indices   = counter_df[counter_df['Peaks']   == 1].index.tolist() if 'Peaks'   in counter_df.columns else []
    counter_valley_indices = counter_df[counter_df['Valleys'] == 1].index.tolist() if 'Valleys' in counter_df.columns else []

    if anchor_type == 'peak':
        main_indices        = sorted(peak_indices, reverse=True)
        pinch_pool          = counter_valley_indices   # valleys below anchor (converging)
        beyond_pool         = counter_valley_indices   # valleys above anchor (handoff)
        find_pinch          = _find_lowest_valleys
        find_beyond         = _find_highest_valleys_above
        main_label          = 'peak'
        pinch_label         = 'pinch_valley'
        beyond_label        = 'pinch_above'
    else:
        main_indices        = sorted(valley_indices, reverse=True)
        pinch_pool          = counter_peak_indices     # peaks above anchor (converging)
        beyond_pool         = counter_peak_indices     # peaks below anchor (handoff)
        find_pinch          = _find_highest_peaks
        find_beyond         = _find_lowest_peaks_below
        main_label          = 'valley'
        pinch_label         = 'pinch_peak'
        beyond_label        = 'pinch_below'

    if anchor_max_aVWAPs is not None:
        main_indices = main_indices[:anchor_max_aVWAPs]

    result = {}

    for anchor_idx in main_indices:
        anchor_price = df.loc[anchor_idx, 'High'] if anchor_type == 'peak' else df.loc[anchor_idx, 'Low']

        # Anchor aVWAP
        main_key = f'aVWAP_{main_label}_{anchor_idx}'
        if main_key not in result:
            result[main_key] = calculate_avwap(df, anchor_idx)

        # Pinch counterparts — converging side
        for idx in find_pinch(df, pinch_pool, anchor_idx, anchor_price, counterpart_max_aVWAPs):
            key = f'aVWAP_{pinch_label}_{idx}'
            if key not in result:
                result[key] = calculate_avwap(df, idx)

        # Beyond handoffs — far side of anchor
        for idx in find_beyond(df, beyond_pool, anchor_idx, anchor_price, beyond_max_aVWAPs):
            key = f'aVWAP_{beyond_label}_{idx}'
            if key not in result:
                result[key] = calculate_avwap(df, idx)

    for key, series in result.items():
        df[key] = series

    avwap_cols = list(result.keys())
    df.set_index('date', inplace=True)
    return df[avwap_cols] if avwap_cols else df[[]]


def _find_highest_valleys_above(df, valley_indices, after_idx, anchor_price, max_counterparts):
    """
    Among detected valleys after after_idx and ABOVE anchor_price,
    return the N highest by Low price. (peak mode beyond — green dotted)
    """
    candidates = [i for i in valley_indices if i > after_idx and df.loc[i, 'Low'] > anchor_price]
    if candidates:
        return sorted(candidates, key=lambda i: df.loc[i, 'Low'], reverse=True)[:max_counterparts]
    sub = df.iloc[after_idx + 1:]
    sub = sub[sub['Low'] > anchor_price]
    if sub.empty:
        return []
    return [int(i) for i in sub['Low'].nlargest(max_counterparts).index]


def _find_lowest_peaks_below(df, peak_indices, after_idx, anchor_price, max_counterparts):
    """
    Among detected peaks after after_idx and BELOW anchor_price,
    return the N lowest by High price. (valley mode beyond — red dotted)
    """
    candidates = [i for i in peak_indices if i > after_idx and df.loc[i, 'High'] < anchor_price]
    if candidates:
        return sorted(candidates, key=lambda i: df.loc[i, 'High'])[:max_counterparts]
    sub = df.iloc[after_idx + 1:]
    sub = sub[sub['High'] < anchor_price]
    if sub.empty:
        return []
    return [int(i) for i in sub['High'].nsmallest(max_counterparts).index]


def _find_lowest_valleys(df, valley_indices, after_idx, anchor_price, max_counterparts):
    """
    Among detected valleys after after_idx and below anchor_price,
    return the N lowest by Low price.
    """
    candidates = [i for i in valley_indices if i > after_idx and df.loc[i, 'Low'] < anchor_price]
    if candidates:
        return sorted(candidates, key=lambda i: df.loc[i, 'Low'])[:max_counterparts]
    sub = df.iloc[after_idx + 1:]
    sub = sub[sub['Low'] < anchor_price]
    if sub.empty:
        return []
    return [int(i) for i in sub['Low'].nsmallest(max_counterparts).index]


def _find_highest_peaks(df, peak_indices, after_idx, anchor_price, max_counterparts):
    """
    Among detected peaks after after_idx and above anchor_price,
    return the N highest by High price.
    """
    candidates = [i for i in peak_indices if i > after_idx and df.loc[i, 'High'] > anchor_price]
    if candidates:
        return sorted(candidates, key=lambda i: df.loc[i, 'High'], reverse=True)[:max_counterparts]
    sub = df.iloc[after_idx + 1:]
    sub = sub[sub['High'] > anchor_price]
    if sub.empty:
        return []
    return [int(i) for i in sub['High'].nlargest(max_counterparts).index]


def calculate_indicator(df, **params):
    return calculate_avwap_pinch(df, **params)
