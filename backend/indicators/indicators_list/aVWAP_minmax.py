import numpy as np
import pandas as pd
from backend.indicators.indicators import get_indicators
from backend.indicators.indicators_list.aVWAP import calculate_avwap



display_name = "aVWAP — Min / Max"

param_labels = {
    'lookback_bars':     'Lookback (bars)',
    'include_max':       'Include Max (High)',
    'include_min':       'Include Min (Low)',
    'max_aVWAPs':        'Anchors per Side',
    'min_spacing':       'Min Anchor Spacing',
    'chain_max_peaks':   'Max Anchor -> Chain Peaks',
    'chain_max_valleys': 'Max Anchor -> Chain Valleys',
    'chain_min_peaks':   'Min Anchor -> Chain Peaks',
    'chain_min_valleys': 'Min Anchor -> Chain Valleys',
    'chain_periods':     'Chain Swing Window',
    'chain_max_aVWAPs':  'Chained Anchors per Point',
}

param_descriptions = {
    'chain_max_peaks':   "After each MAX anchor, also anchor an aVWAP at the earliest peak(s) that "
                          "occur after it — extends the same 'ceiling' structure the max anchor "
                          "started. Independent of the other three chain_* flags; any combination "
                          "can be on at once.",
    'chain_max_valleys': "After each MAX anchor, also anchor at the earliest valley(s) after it — "
                          "traces a reversal down from the high, instead of continuing it.",
    'chain_min_peaks':   "After each MIN anchor, also anchor at the earliest peak(s) after it — "
                          "traces a reversal up from the low.",
    'chain_min_valleys': "After each MIN anchor, also anchor at the earliest valley(s) after it — "
                          "extends the same 'floor' structure the min anchor started.",
    'chain_periods':    "Swing-detection window (bars) used to find the peaks/valleys being chained "
                          "to — separate from min_spacing, which only governs the min/max anchors "
                          "themselves. Lower it for a denser, higher-resolution fan (more, smaller "
                          "swings qualify); raise it for only major structure.",
    'chain_max_aVWAPs': "How many chained anchors to keep per min/max anchor, per type (peak and "
                          "valley capped independently). Raise this for a denser fan. Keeps the "
                          "EARLIEST qualifying points after the anchor, not the most recent — rank 1 "
                          "is the one closest to the anchor. Rank 1 renders boldest and most opaque; "
                          "later ranks fade and thin.",
}


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


def _chained_points(pv_df, col, anchor_bar, max_n):
    """
    Up to max_n bar indices where pv_df[col] == 1 and index > anchor_bar,
    EARLIEST first (rank 1 = closest to the anchor) — traces what happened
    immediately after the anchor, not what's happened most recently.
    """
    candidates = sorted(pv_df[(pv_df[col] == 1) & (pv_df.index > anchor_bar)].index.tolist())
    return candidates[:max_n]


def calculate_aVWAP_minmax(
    df,
    lookback_bars=None,
    include_max=True,
    include_min=True,
    max_aVWAPs=1,
    min_spacing=20,
    chain_max_peaks=False,
    chain_max_valleys=False,
    chain_min_peaks=False,
    chain_min_valleys=False,
    chain_periods=20,
    chain_max_aVWAPs=3,
):
    """
    Anchor aVWAPs at the highest High(s) and lowest Low(s) within a window,
    optionally chaining onward from each of those anchors to the earliest
    peak(s) and/or valley(s) that occur after it — a second aVWAP fan built
    off the min/max points instead of a fresh peaks_valleys scan of the
    whole chart, so it stays tied to "what happened after this specific
    extreme" rather than structure anywhere.

    lookback_bars      — number of recent bars to scan (None = whole chart)
    include_max        — anchor at the top N highest Highs  (red)
    include_min        — anchor at the bottom N lowest Lows  (teal)
    max_aVWAPs         — how many anchors to find per side (1 = single extreme)
    min_spacing        — minimum bar gap between consecutive picks to avoid clustering
    chain_max_peaks    — after each MAX anchor, also anchor at peaks after it
    chain_max_valleys  — after each MAX anchor, also anchor at valleys after it
    chain_min_peaks    — after each MIN anchor, also anchor at peaks after it
    chain_min_valleys  — after each MIN anchor, also anchor at valleys after it
    chain_periods      — swing-detection window for the chained peaks/valleys
    chain_max_aVWAPs   — how many chained anchors to keep per min/max anchor, per type

    Output columns:
        aVWAP_max_{anchor_bar}                                    — base max anchor
        aVWAP_min_{anchor_bar}                                    — base min anchor
        aVWAP_minmax_max_{anchor_bar}_peak_r{rank}_{bar}          — chained peak off a max anchor
        aVWAP_minmax_max_{anchor_bar}_valley_r{rank}_{bar}        — chained valley off a max anchor
        aVWAP_minmax_min_{anchor_bar}_peak_r{rank}_{bar}          — chained peak off a min anchor
        aVWAP_minmax_min_{anchor_bar}_valley_r{rank}_{bar}        — chained valley off a min anchor
    Deliberately a different column family (aVWAP_minmax_ rather than
    aVWAP_max_/aVWAP_min_) — those two are reserved for the client-side
    DynamicVWAPEngine (see replay_events._AVWAP_MAX_RE/_AVWAP_MIN_RE and
    col_styles.py's exclusion list); chained anchors render as ordinary
    static lines instead, styled by col_styles.py like aVWAP_pinch's fan.
    """
    df = df.reset_index()
    df['date'] = pd.to_datetime(df['date'])

    start = max(0, len(df) - lookback_bars) if lookback_bars is not None else 0
    window = df.iloc[start:]

    n = max_aVWAPs if max_aVWAPs is not None else 1
    spacing = max(0, min_spacing)

    result = {}
    max_anchors, min_anchors = [], []

    if include_max:
        for idx in _greedy_extrema(window['High'].values, n, spacing, 'max'):
            bar = int(window.index[idx])
            result[f'aVWAP_max_{bar}'] = calculate_avwap(df, bar)
            max_anchors.append(bar)

    if include_min:
        for idx in _greedy_extrema(window['Low'].values, n, spacing, 'min'):
            bar = int(window.index[idx])
            result[f'aVWAP_min_{bar}'] = calculate_avwap(df, bar)
            min_anchors.append(bar)

    chain_flags = {
        ('max', 'peak'):   chain_max_peaks,
        ('max', 'valley'): chain_max_valleys,
        ('min', 'peak'):   chain_min_peaks,
        ('min', 'valley'): chain_min_valleys,
    }
    if any(chain_flags.values()) and (max_anchors or min_anchors):
        base_cols = [c for c in ['Open', 'High', 'Low', 'Close', 'Volume'] if c in df.columns]
        pv_df = get_indicators(df[base_cols].copy(), ['peaks_valleys'], {'peaks_valleys': {'periods': chain_periods}})
        pv_col = {'peak': 'Peaks', 'valley': 'Valleys'}

        for anchor_type, anchors in (('max', max_anchors), ('min', min_anchors)):
            for anchor_bar in anchors:
                for chain_type in ('peak', 'valley'):
                    if not chain_flags[(anchor_type, chain_type)]:
                        continue
                    col = pv_col[chain_type]
                    if col not in pv_df.columns:
                        continue
                    for rank, bar in enumerate(_chained_points(pv_df, col, anchor_bar, chain_max_aVWAPs), start=1):
                        result[f'aVWAP_minmax_{anchor_type}_{anchor_bar}_{chain_type}_r{rank}_{bar}'] = calculate_avwap(df, bar)

    for col, series in result.items():
        df[col] = series

    df.set_index('date', inplace=True)
    return df[list(result.keys())] if result else df[[]]


def calculate_indicator(df, **params):
    return calculate_aVWAP_minmax(df, **params)
