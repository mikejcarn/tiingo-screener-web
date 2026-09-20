import json
import numpy as np
import pandas as pd
from backend.indicators.indicators import get_indicators

display_name = "Volume Profile"

param_labels = {
    'periods':         'Pivot Window (periods)',
    'include_peaks':   'Anchor at Peaks',
    'include_valleys': 'Anchor at Valleys',
    'anchor_select':   'Anchor Selection',
    'max_profiles':    'Max Profiles Shown (per side)',
    'num_bins':        'Price Bins',
    'extend_to_end':   'Extend to Now (vs. stop at next swing)',
    'fill_opacity':    'Bar Opacity',
}

param_descriptions = {
    'periods': "Pivot-detection window for the underlying peaks/valleys swing points — "
               "same param, same meaning, as aVWAP_peaks/aVWAP_valleys' own 'periods'.",
    'anchor_select': "Which swing points to keep, up to max_profiles, per side. 'recent' "
               "(default) keeps the most recent peaks/valleys by bar position — same "
               "convention as max_aVWAPs elsewhere. 'extreme' instead keeps the ones with "
               "the most extreme price — the highest peaks / lowest valleys anywhere in "
               "the chart, regardless of when they happened. With max_profiles=1, "
               "'extreme' gives you exactly one profile anchored at the single highest "
               "peak and one at the single lowest valley on the chart.",
    'max_profiles': "Cap on how many profiles are shown per side (peaks and valleys "
               "capped independently) — which ones are kept is controlled by "
               "anchor_select. A volume profile is real work to compute and to draw (one "
               "histogram per anchor), so unlike a plain aVWAP line this defaults to a "
               "small number rather than unlimited.",
    'num_bins': "How many price levels the volume gets bucketed into per profile. More "
               "bins = finer resolution, more bars to draw.",
    'extend_to_end': "If True, a profile keeps accumulating volume from its anchor all "
               "the way to the current/last bar (growing, like an anchored VWAP). If "
               "False, it stops at the next same-direction swing point instead (a fixed, "
               "comparable snapshot of that one swing leg) — same distinction "
               "aVWAP_OB's own extend_to_end makes for its anchors.",
    'fill_opacity': "Opacity of the volume bars, 0-1. Display-only — has no effect on "
               "the profile's computation.",
}


def _swing_indices(df, periods, column):
    # reset_index here (not on the caller's df) guarantees plain integer bar
    # positions back regardless of what index df itself carries — needed for
    # the .values-array slicing calculate_volume_profile does below.
    sub = df[['Open', 'High', 'Low', 'Close', 'Volume']].reset_index(drop=True)
    temp = get_indicators(sub, ['peaks_valleys'], {'peaks_valleys': {'periods': periods}})
    if column not in temp.columns:
        return []
    return sorted(temp[temp[column] == 1].index.tolist())


def _bounded_ends(anchors, n):
    """For each anchor (ascending), the next anchor's bar — or n - 1 for the
    last one, same 'cap at the next same-direction swing' rule liquidity.py
    uses for its own unswept levels."""
    ends = {}
    for i, idx in enumerate(anchors):
        ends[idx] = anchors[i + 1] if i + 1 < len(anchors) else n - 1
    return ends


def _histogram(high, low, volume, num_bins):
    """Volume-at-price histogram — same binning technique as POC.py: each
    bar's volume distributed evenly across its own high-low range, summed
    into num_bins equal price buckets over the window's real (nonzero-volume)
    high/low extent."""
    real_mask = volume > 0
    if not real_mask.any():
        return None
    price_min = float(low[real_mask].min())
    price_max = float(high[real_mask].max())
    price_range = price_max - price_min
    if price_range <= 0:
        return None
    bin_size = price_range / num_bins
    lo_bins = np.clip(((low - price_min) / bin_size).astype(int), 0, num_bins - 1)
    hi_bins = np.clip(((high - price_min) / bin_size).astype(int), 0, num_bins - 1)
    bins = np.zeros(num_bins)
    for i in np.nonzero(real_mask)[0]:
        span = hi_bins[i] - lo_bins[i] + 1
        bins[lo_bins[i]:hi_bins[i] + 1] += volume[i] / span
    return price_min, bin_size, bins


def _select_anchors(anchors, price, max_profiles, anchor_select, want_highest):
    """Which of a side's swing points to keep, up to max_profiles. 'recent' keeps
    the most recent by bar position (existing default); 'extreme' keeps the ones
    with the most extreme price instead — highest for peaks (want_highest=True),
    lowest for valleys (want_highest=False) — independent of when they happened."""
    if max_profiles is None:
        return anchors
    if anchor_select == 'extreme':
        return sorted(anchors, key=lambda i: price[i], reverse=want_highest)[:max_profiles]
    return sorted(anchors, reverse=True)[:max_profiles]


def calculate_volume_profile(df, periods=25, include_peaks=True, include_valleys=True,
                              anchor_select='recent', max_profiles=3, num_bins=24,
                              extend_to_end=True, fill_opacity=0.4):
    # Unlike aVWAP_peaks.py/aVWAP_OB.py (which return a DataFrame — the only
    # return type get_indicators realigns positionally against a mismatched
    # index), this returns a plain dict of Series like OB.py/liquidity.py do,
    # which get_indicators concats by index *label*. So — unusually for an
    # anchor-based indicator here — df's original index must NOT be reset;
    # _swing_indices resets its own internal copy instead, so its returned
    # anchor positions are still plain 0-based integers for the .values
    # array slicing below, independent of whatever index df itself carries.
    n = len(df)
    high   = df['High'].values
    low    = df['Low'].values
    volume = df['Volume'].fillna(0).values

    flag   = pd.Series(0.0, index=df.index)
    data   = pd.Series('', index=df.index, dtype=object)

    for column, direction, want in (('Peaks', 1, include_peaks), ('Valleys', -1, include_valleys)):
        if not want:
            continue
        anchors = _swing_indices(df, periods, column)
        if not anchors:
            continue
        price_for_side = high if direction == 1 else low
        kept = _select_anchors(anchors, price_for_side, max_profiles, anchor_select,
                                want_highest=(direction == 1))
        bounded_end = _bounded_ends(anchors, n)
        for idx in kept:
            end = (n - 1) if extend_to_end else bounded_end[idx]
            if end <= idx:
                continue
            hist = _histogram(high[idx:end + 1], low[idx:end + 1], volume[idx:end + 1], num_bins)
            if hist is None:
                continue
            price_min, bin_size, bins = hist
            flag.iloc[idx] = direction
            data.iloc[idx] = json.dumps({
                'e': int(end), 'lo': round(price_min, 6), 'bs': round(bin_size, 6),
                'b': [round(float(v), 2) for v in bins], 'fo': fill_opacity,
            })

    return {
        'VolumeProfile': flag,
        'VolumeProfile_Data': data,
    }


def calculate_indicator(df, **params):
    return calculate_volume_profile(df, **params)
