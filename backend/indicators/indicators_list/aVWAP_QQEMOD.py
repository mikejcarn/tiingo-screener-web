import numpy as np
import pandas as pd
from backend.indicators.indicators import get_indicators
from backend.indicators.indicators_list.aVWAP import calculate_avwap


def calculate_aVWAP_QQEMOD(
    df,
    max_anchors=5,
    extend_to_end=True,
    include_zone_aVWAPs=True,
    include_bridge_aVWAPs=True,
    rsi_period=6,
    rsi_period2=6,
    sf=5,
    sf2=5,
    qqe_factor=3.0,
    qqe_factor2=1.61,
    threshold=3,
    bb_length=50,
    bb_multi=0.35,
):
    """
    Anchor aVWAPs at QQEMOD zone extrema.

    Bull zones: anchor at High maximum (prior resistance).
    Bear zones: anchor at Low minimum  (prior support).

    include_zone_aVWAPs:   main aVWAP lines from anchor to zone end (or chart end).
    include_bridge_aVWAPs: dotted lines bridging consecutive same-type zone anchors.

    Output columns:
        aVWAP_QQEMOD_bull_{anchor_bar}      — zone line, from bull-zone peak
        aVWAP_QQEMOD_bear_{anchor_bar}      — zone line, from bear-zone trough
        aVWAP_QQEMOD_bull_dot_{anchor_bar}  — bridge line, bull-to-bull
        aVWAP_QQEMOD_bear_dot_{anchor_bar}  — bridge line, bear-to-bear
    """
    df = df.reset_index()
    df['date'] = pd.to_datetime(df['date'])

    base_cols = [c for c in ['Open', 'High', 'Low', 'Close', 'Volume', 'date'] if c in df.columns]
    qqe_params = {
        'rsi_period': rsi_period, 'rsi_period2': rsi_period2,
        'sf': sf, 'sf2': sf2,
        'qqe_factor': qqe_factor, 'qqe_factor2': qqe_factor2,
        'threshold': threshold, 'bb_length': bb_length, 'bb_multi': bb_multi,
    }
    qqe_df = get_indicators(df[base_cols].copy(), ['QQEMOD'], {'QQEMOD': qqe_params})

    required = ['QQE1_Above_Upper', 'QQE1_Below_Lower',
                'QQE2_Above_Threshold', 'QQE2_Below_Threshold', 'QQE2_Above_TL']
    if not all(c in qqe_df.columns for c in required):
        df.set_index('date', inplace=True)
        return df[[]]

    bull = (qqe_df['QQE1_Above_Upper'].fillna(False).values &
            qqe_df['QQE2_Above_Threshold'].fillna(False).values &
            qqe_df['QQE2_Above_TL'].fillna(False).values)
    bear = (qqe_df['QQE1_Below_Lower'].fillna(False).values &
            qqe_df['QQE2_Below_Threshold'].fillna(False).values &
            ~qqe_df['QQE2_Above_TL'].fillna(False).values)

    vol_mask = df['Volume'].fillna(0) > 0
    last_valid = int(vol_mask[vol_mask].index[-1]) if vol_mask.any() else len(df) - 1

    n, segments = len(df), []
    i = 0
    while i < n:
        if bull[i]:
            start = i
            j = i + 1
            while j < n and not bear[j]:
                j += 1
            ae = min(j - 1, last_valid)
            anchor = int(np.argmax(df['High'].values[start:ae + 1])) + start
            segments.append({'type': 'bull', 'start': start, 'end': min(j, last_valid), 'anchor': anchor})
            i = j if j < n else n
        elif bear[i]:
            start = i
            j = i + 1
            while j < n and not bull[j]:
                j += 1
            ae = min(j - 1, last_valid)
            anchor = int(np.argmin(df['Low'].values[start:ae + 1])) + start
            segments.append({'type': 'bear', 'start': start, 'end': min(j, last_valid), 'anchor': anchor})
            i = j if j < n else n
        else:
            i += 1

    if max_anchors is not None:
        bear_segs = sorted([s for s in segments if s['type'] == 'bear'], key=lambda s: s['start'])[-max_anchors:]
        bull_segs = sorted([s for s in segments if s['type'] == 'bull'], key=lambda s: s['start'])[-max_anchors:]
        segments = sorted(bear_segs + bull_segs, key=lambda s: s['start'])

    result = {}

    if include_zone_aVWAPs:
        for seg in segments:
            anchor = seg['anchor']
            direction = 'bull' if seg['type'] == 'bull' else 'bear'
            col = f'aVWAP_QQEMOD_{direction}_{anchor}'
            avwap = calculate_avwap(df, anchor).copy()
            end_idx = last_valid if extend_to_end else seg['end']
            avwap.iloc[end_idx - anchor + 1:] = np.nan
            result[col] = avwap

    if include_bridge_aVWAPs:
        for seg_type, direction in (('bull', 'bull'), ('bear', 'bear')):
            same_type = [s for s in segments if s['type'] == seg_type]
            for k in range(len(same_type) - 1):
                anchor = same_type[k]['anchor']
                next_anchor = same_type[k + 1]['anchor']
                col = f'aVWAP_QQEMOD_{direction}_dot_{anchor}'
                avwap = calculate_avwap(df, anchor).copy()
                end_idx = last_valid if extend_to_end else next_anchor
                avwap.iloc[end_idx - anchor + 1:] = np.nan
                result[col] = avwap
            if same_type:
                anchor = same_type[-1]['anchor']
                col = f'aVWAP_QQEMOD_{direction}_dot_{anchor}'
                if col not in result:
                    avwap = calculate_avwap(df, anchor).copy()
                    avwap.iloc[last_valid - anchor + 1:] = np.nan
                    result[col] = avwap

    for col, series in result.items():
        df[col] = series

    avwap_cols = list(result.keys())
    df.set_index('date', inplace=True)
    return df[avwap_cols] if avwap_cols else df[[]]


def calculate_indicator(df, **params):
    return calculate_aVWAP_QQEMOD(df, **params)
