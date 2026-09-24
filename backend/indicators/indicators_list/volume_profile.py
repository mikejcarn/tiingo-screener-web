import json
import numpy as np
import pandas as pd
from backend.indicators.indicators import get_indicators

display_name = "Volume Profile"

# Dividers between the logical sections below (Peaks anchoring / Valleys
# anchoring / Whole-Chart profile / Histogram & display / POC & Value Area /
# HVN & LVN) — display order follows calculate_volume_profile's own
# parameter order, so this list and that signature must be kept in the same
# grouping.
param_separators = ['include_valleys', 'show_full_range', 'num_bins', 'show_poc', 'show_hvn']

param_labels = {
    'include_peaks':          'Anchor at Peaks',
    'periods_peaks':          'Pivot Window — Peaks (periods)',
    'anchor_select_peaks':    'Anchor Selection — Peaks',
    'max_profiles_peaks':     'Max Profiles Shown — Peaks',
    'include_valleys':        'Anchor at Valleys',
    'periods_valleys':        'Pivot Window — Valleys (periods)',
    'anchor_select_valleys':  'Anchor Selection — Valleys',
    'max_profiles_valleys':   'Max Profiles Shown — Valleys',
    'show_full_range':        'Show Whole-Chart Profile',
    'num_bins':               'Price Bins',
    'extend_to_end':          'Extend to Now (vs. stop at next swing)',
    'fill_opacity':           'Bar Opacity',
    'show_histogram':         'Show Histogram Bars',
    'bar_style':              'Histogram Style',
    'heatmap_opacity':        'Heatmap Max Opacity',
    'heatmap_contrast':       'Heatmap Contrast',
    'directional_color':      'Color by Bull/Bear Direction',
    'histogram_grayscale':    'Histogram Grayscale',
    'show_poc':               'Show POC Line',
    'show_value_area':        'Show Value Area (VAH/VAL)',
    'value_area_pct':         'Value Area %',
    'show_hvn':               'Show High Volume Nodes',
    'show_lvn':               'Show Low Volume Nodes',
    'node_window':            'Node Detection Window (bins)',
    'max_nodes':              'Max Nodes Shown (per side)',
}

param_descriptions = {
    'periods_peaks': "Pivot-detection window for the Peaks swing points a profile can "
               "anchor at — same param, same meaning, as aVWAP_peaks' own 'periods'. "
               "Independent of the Valleys window, so peaks and valleys can use "
               "different pivot sensitivities.",
    'periods_valleys': "Pivot-detection window for the Valleys swing points a profile "
               "can anchor at — same param, same meaning, as aVWAP_valleys' own "
               "'periods'. Independent of the Peaks window.",
    'anchor_select_peaks': "Which Peak swing points to keep, up to max_profiles_peaks. "
               "'recent' (default) keeps the most recent by bar position — same "
               "convention as max_aVWAPs elsewhere. 'extreme' instead keeps the highest "
               "peaks anywhere in the chart, regardless of when they happened. With "
               "max_profiles_peaks=1, 'extreme' gives you exactly one profile anchored "
               "at the single highest peak on the chart.",
    'anchor_select_valleys': "Which Valley swing points to keep, up to "
               "max_profiles_valleys. 'recent' (default) keeps the most recent by bar "
               "position. 'extreme' instead keeps the lowest valleys anywhere in the "
               "chart, regardless of when they happened. With max_profiles_valleys=1, "
               "'extreme' gives you exactly one profile anchored at the single lowest "
               "valley on the chart.",
    'max_profiles_peaks': "Cap on how many Peak-anchored profiles are shown — which "
               "ones are kept is controlled by anchor_select_peaks. A volume profile is "
               "real work to compute and to draw (one histogram per anchor), so unlike "
               "a plain aVWAP line this defaults to a small number rather than "
               "unlimited.",
    'max_profiles_valleys': "Cap on how many Valley-anchored profiles are shown — which "
               "ones are kept is controlled by anchor_select_valleys.",
    'show_full_range': "Add one extra profile anchored at the very first bar of the "
               "chart and spanning all the way to the last — a single volume-at-price "
               "picture of the entire loaded history, independent of the Peaks/Valleys "
               "swing anchoring above (ignores extend_to_end and periods/anchor_select/ "
               "max_profiles — it always covers the whole chart). Uses the same "
               "num_bins/style/POC/Value-Area/HVN-LVN settings as every other profile.",
    'num_bins': "How many price levels the volume gets bucketed into per profile. More "
               "bins = finer resolution, more bars to draw.",
    'extend_to_end': "If True, a profile keeps accumulating volume from its anchor all "
               "the way to the current/last bar (growing, like an anchored VWAP). If "
               "False, it stops at the next same-direction swing point instead (a fixed, "
               "comparable snapshot of that one swing leg) — same distinction "
               "aVWAP_OB's own extend_to_end makes for its anchors.",
    'fill_opacity': "Opacity of the volume bars, 0-1. Display-only — has no effect on "
               "the profile's computation.",
    'show_histogram': "Draw the volume-at-price histogram bars themselves. Turning this "
               "off doesn't affect POC/Value Area/HVN/LVN — those are computed from the "
               "same underlying histogram regardless and have their own show_* toggles.",
    'bar_style': "'bars' (default) draws each price bin as a horizontal bar whose "
               "WIDTH scales with that bin's volume, the classic sideways-histogram "
               "look. 'heatmap' instead draws every bin as a full-width band (same "
               "span as an HVN/LVN zone) and encodes volume as OPACITY instead — the "
               "highest-volume bins read darkest/most opaque, the lowest read almost "
               "invisible. Same underlying bins either way, just a different encoding "
               "of the same numbers.",
    'heatmap_opacity': "Opacity of the highest-volume bin in 'heatmap' style, 0-1 — "
               "every other bin scales down from this ceiling by its own share of that "
               "peak volume. Separate from fill_opacity, since 'bars' style already has "
               "bar width to carry the volume signal and only needs a modest fill, while "
               "'heatmap' has nothing but opacity to work with. Has no effect in 'bars' "
               "style.",
    'heatmap_contrast': "Exponent applied to each bin's own share of the peak volume "
               "before it's scaled to opacity, in 'heatmap' style. 1.0 = linear (a bin "
               "at half the peak's volume gets half the opacity). Above 1.0 (default "
               "2.0) suppresses lower-volume bins faster than it suppresses high ones, "
               "so only genuinely significant levels stay visible against an emptier "
               "background — higher values push that further. Below 1.0 does the "
               "opposite, boosting faint bins so more of the profile's shape shows "
               "through at the cost of the standout levels being less distinct. Has no "
               "effect in 'bars' style.",
    'histogram_grayscale': "Fill the histogram bins — bars or heatmap, whichever "
               "bar_style is active — in neutral gray instead of the profile's own "
               "color (orange, or teal/red under directional_color); width/opacity "
               "still encode volume the same way either style. POC/Value Area/HVN/LVN "
               "keep their own colors regardless — this only affects the histogram "
               "fill itself.",
    'directional_color': "Color profiles by their anchor's direction — teal for a "
               "peak-anchored (bull) profile, red for a valley-anchored (bear) one, same "
               "coloring as the rest of the chart's bull/bear elements. Off (default) "
               "uses a single neutral orange for every profile regardless of anchor "
               "direction, since a profile's own shape (not its anchor's direction) is "
               "usually the point of looking at it.",
    'show_poc': "Draw the Point of Control — a line at the single highest-volume price "
               "bin — across the full span of each profile.",
    'show_value_area': "Draw the Value Area bounds (VAH/VAL) — the band of prices "
               "holding value_area_pct of the profile's volume, expanded outward from "
               "the POC bin — across the full span of each profile.",
    'value_area_pct': "Fraction of a profile's total volume the Value Area (VAH/VAL) "
               "must contain, 0-1. Standard volume-profile convention default is 0.70.",
    'show_hvn': "Mark High Volume Nodes — local peaks in the profile's own volume-at-"
               "price shape — same centered-window 'equals its own window's max' "
               "technique peaks_valleys.py uses along time, applied here along price "
               "instead. Independent of show_lvn.",
    'show_lvn': "Mark Low Volume Nodes — local troughs in the profile's own volume-at-"
               "price shape, including untraded gaps — same technique as show_hvn, "
               "mirrored to the window's min instead of its max. Independent of "
               "show_hvn.",
    'node_window': "Bins compared on each side when testing whether a bin is a local "
               "volume peak/trough (window size = 2 * node_window + 1, in bins, not "
               "price). A flat run of tied bins — e.g. a stretch of untraded price with "
               "identically zero volume — collapses to a single node at its midpoint "
               "rather than flagging every bin in the run.",
    'max_nodes': "Cap on how many HVN/LVN markers are shown per profile per side. When a "
               "profile has more candidates than this, HVN keeps the highest-volume ones "
               "and LVN keeps the lowest-volume ones.",
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


def _poc_value_area(price_min, bin_size, bins, target_pct):
    """Point of Control (the single highest-volume bin) and Value Area bounds
    (VAH/VAL) — starting from the POC bin, repeatedly add whichever neighbor
    (one above or one below the current range) holds more volume, until the
    accumulated volume reaches target_pct of the profile's total. Standard
    volume-profile value-area algorithm."""
    total = float(bins.sum())
    poc_bin = int(np.argmax(bins))
    poc_price = price_min + (poc_bin + 0.5) * bin_size
    if total <= 0:
        return poc_price, poc_price, poc_price

    target = total * target_pct
    lo = hi = poc_bin
    acc = float(bins[poc_bin])
    n = len(bins)
    while acc < target and (lo > 0 or hi < n - 1):
        vol_below = bins[lo - 1] if lo > 0 else -1.0
        vol_above = bins[hi + 1] if hi < n - 1 else -1.0
        if vol_above >= vol_below:
            hi += 1
            acc += bins[hi]
        else:
            lo -= 1
            acc += bins[lo]

    val_price = price_min + lo * bin_size
    vah_price = price_min + (hi + 1) * bin_size
    return poc_price, vah_price, val_price


def _dedupe_runs(mask):
    """Collapse each contiguous run of True in a boolean array into its
    (start, end) bin-index bounds, inclusive — so a flat plateau (e.g.
    several tied zero-volume bins in a row) yields one run spanning its
    full width, not one point per bin."""
    runs = []
    n = len(mask)
    i = 0
    while i < n:
        if mask[i]:
            j = i
            while j + 1 < n and mask[j + 1]:
                j += 1
            runs.append((i, j))
            i = j + 1
        else:
            i += 1
    return runs


def _hvn_lvn(price_min, bin_size, bins, node_window, max_nodes, want_hvn, want_lvn):
    """High/Low Volume Nodes — local peaks and troughs in the profile's own
    volume-at-price shape, found the same way peaks_valleys.py finds swing
    points in time: a centered rolling window, flagging bins that equal
    their own window's max (HVN) or min (LVN), just applied along price
    (bin index) instead of along bars. Bins right at the histogram's edges
    never get a full window and so are never flagged, same edge behavior
    peaks_valleys.py has for bars near the start/end of the chart.

    A zero-volume bin is never an HVN (a 'locally highest' bin in an
    all-dead window isn't a real node), but zero-volume bins are eligible
    LVNs — an untraded gap in the profile is exactly the kind of low-volume
    node this is meant to surface.

    Returns each node as a [lo, hi] price-range pair — the run's full bin
    span, not just a single center point — so a wide flat plateau (a
    several-bin-wide untraded gap, say) renders as a zone that wide rather
    than a sliver at its midpoint.
    """
    window = 2 * node_window + 1
    s = pd.Series(bins)

    def to_zone(run):
        s_bin, e_bin = run
        return [round(price_min + s_bin * bin_size, 6),
                round(price_min + (e_bin + 1) * bin_size, 6)]

    hvn_zones = []
    if want_hvn:
        roll_max = s.rolling(window, center=True).max().to_numpy()
        is_hvn = (bins == roll_max) & (bins > 0)
        hvn_runs = sorted(_dedupe_runs(is_hvn), key=lambda r: bins[r[0]], reverse=True)
        hvn_zones = [to_zone(r) for r in hvn_runs[:max_nodes]]

    lvn_zones = []
    if want_lvn:
        roll_min = s.rolling(window, center=True).min().to_numpy()
        is_lvn = (bins == roll_min)
        lvn_runs = sorted(_dedupe_runs(is_lvn), key=lambda r: bins[r[0]])
        lvn_zones = [to_zone(r) for r in lvn_runs[:max_nodes]]

    return hvn_zones, lvn_zones


def _build_payload(high, low, volume, end, num_bins, fill_opacity, show_histogram,
                    bar_style, heatmap_opacity, heatmap_contrast, histogram_grayscale,
                    directional_color, show_poc, show_value_area, value_area_pct,
                    show_hvn, show_lvn, node_window, max_nodes):
    """Build one anchor's JSON payload from its own high/low/volume slice —
    shared by the Peaks/Valleys swing-anchored profiles and the whole-chart
    profile (show_full_range) below, so neither duplicates the histogram /
    POC / Value Area / HVN-LVN assembly. Returns None when the slice has no
    real (nonzero-volume) range to build a histogram from."""
    hist = _histogram(high, low, volume, num_bins)
    if hist is None:
        return None
    price_min, bin_size, bins = hist
    payload = {
        'e': int(end), 'lo': round(price_min, 6), 'bs': round(bin_size, 6),
        'b': [round(float(v), 2) for v in bins], 'fo': fill_opacity,
        'sh': show_histogram, 'dc': directional_color, 'bst': bar_style,
        'hop': heatmap_opacity, 'hct': heatmap_contrast, 'hgs': histogram_grayscale,
    }
    if show_poc or show_value_area:
        poc_price, vah_price, val_price = _poc_value_area(price_min, bin_size, bins,
                                                            value_area_pct)
        if show_poc:
            payload['poc'] = round(poc_price, 6)
        if show_value_area:
            payload['vah'] = round(vah_price, 6)
            payload['val'] = round(val_price, 6)
    if show_hvn or show_lvn:
        hvn_zones, lvn_zones = _hvn_lvn(price_min, bin_size, bins, node_window,
                                         max_nodes, show_hvn, show_lvn)
        if hvn_zones:
            payload['hvn'] = hvn_zones
        if lvn_zones:
            payload['lvn'] = lvn_zones
    return payload


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


def calculate_volume_profile(df,
                              include_peaks=True, periods_peaks=25,
                              anchor_select_peaks='recent', max_profiles_peaks=3,
                              include_valleys=True, periods_valleys=25,
                              anchor_select_valleys='recent', max_profiles_valleys=3,
                              show_full_range=False,
                              num_bins=24, extend_to_end=True, fill_opacity=0.4,
                              show_histogram=True, bar_style='bars',
                              heatmap_opacity=0.85, heatmap_contrast=2.0,
                              directional_color=False, histogram_grayscale=False,
                              show_poc=True, show_value_area=True, value_area_pct=0.7,
                              show_hvn=True, show_lvn=True, node_window=2, max_nodes=5):
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

    sides = (
        ('Peaks', 1, include_peaks, periods_peaks, anchor_select_peaks, max_profiles_peaks),
        ('Valleys', -1, include_valleys, periods_valleys, anchor_select_valleys, max_profiles_valleys),
    )
    for column, direction, want, side_periods, side_anchor_select, side_max_profiles in sides:
        if not want:
            continue
        anchors = _swing_indices(df, side_periods, column)
        if not anchors:
            continue
        price_for_side = high if direction == 1 else low
        kept = _select_anchors(anchors, price_for_side, side_max_profiles, side_anchor_select,
                                want_highest=(direction == 1))
        bounded_end = _bounded_ends(anchors, n)
        for idx in kept:
            end = (n - 1) if extend_to_end else bounded_end[idx]
            if end <= idx:
                continue
            payload = _build_payload(
                high[idx:end + 1], low[idx:end + 1], volume[idx:end + 1], end,
                num_bins, fill_opacity, show_histogram, bar_style,
                heatmap_opacity, heatmap_contrast, histogram_grayscale, directional_color,
                show_poc, show_value_area, value_area_pct,
                show_hvn, show_lvn, node_window, max_nodes)
            if payload is None:
                continue
            flag.iloc[idx] = direction
            data.iloc[idx] = json.dumps(payload)

    # Whole-chart profile — anchored at bar 0 regardless of any Peaks/Valleys
    # swing point, always spanning the full 0..n-1 range (extend_to_end and
    # the bounded-end rule don't apply here, there's no 'next swing' to stop
    # at). Bar 0 can never itself be a real peak/valley anchor — peaks_valleys.py's
    # centered rolling window needs bars on both sides, so it never flags the
    # very first bar — so this can't collide with a swing-anchored profile.
    if show_full_range and n > 1:
        payload = _build_payload(
            high, low, volume, n - 1,
            num_bins, fill_opacity, show_histogram, bar_style,
            heatmap_opacity, heatmap_contrast, histogram_grayscale, directional_color,
            show_poc, show_value_area, value_area_pct,
            show_hvn, show_lvn, node_window, max_nodes)
        if payload is not None:
            flag.iloc[0] = 1.0
            data.iloc[0] = json.dumps(payload)

    return {
        'VolumeProfile': flag,
        'VolumeProfile_Data': data,
    }


def calculate_indicator(df, **params):
    return calculate_volume_profile(df, **params)
