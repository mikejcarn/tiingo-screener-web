import pandas as pd
from backend.indicators.indicators import get_indicators
from backend.indicators.indicators_list.aVWAP import calculate_avwap


display_name = "aVWAP — Valleys"

param_labels = {
    'periods':            'Pivot Window (periods)',
    'max_aVWAPs':         'Max Anchors (blank = unlimited)',
    'styling':            'Line Coloring',
    'curve_slope_window': 'Slope Smoothing (bars)',
    'curve_atr_period':   'Slope ATR Period',
    'slope_scale':        'Slope Saturation Scale (ATR/bar)',
}

param_descriptions = {
    # Shared verbatim with aVWAP_peaks' own 'styling' entry — the two modules feed
    # the same global param_descriptions namespace (keyed by param name only), so this
    # text is written to apply equally to peaks (red) and valleys (teal). One dropdown,
    # mutually exclusive options — this used to be two separate params (styling +
    # curve_color) that silently fought over the same lines' color (curve coloring
    # overrode styling's hue but not its per-config width), so they're merged here.
    'styling': "How to color this indicator's lines — one mutually-exclusive choice. "
               "'shades' (default) gives every config a shade of this indicator's color, "
               "tiered by opacity from most- to least-recently-added config. "
               "'highlight_first' keeps the first config at full color and renders every "
               "other config as a shade of grey instead, so the primary config stands out "
               "from the rest. 'grayscale' renders every config as a shade of grey (no hue "
               "at all), so price action stands out against the aVWAP lines instead of one "
               "config standing out against the others — useful for high-resolution "
               "snapshots. 'curve_opacity' / 'curve_heatmap' color each line by how much it "
               "has curved vs. flattened along its own path (per aVWAP-curve-to-straight.md, "
               "same idea as aVWAP-Min/Max's chained-line coloring), relative to that same "
               "line's own sharpest move so far — 'curve_opacity' keeps the usual red/teal "
               "hue, fading the alpha as the line settles from a sharp curve to flat; "
               "'curve_heatmap' shifts hue itself from hot (still curving) to a cool neutral "
               "gray (flattened). 'slope_gradient' colors each point by its instantaneous "
               "slope alone (a plain derivative, no memory of the line's own past): rising "
               "reads as aqua, falling as red, flat as neutral gray, intensity scaled by "
               "steepness up to slope_scale — unlike the curve_* modes, a given shade always "
               "means the same real steepness on every line, not 'relative to how sharp this "
               "particular line has ever been'. All three non-rank modes (curve_opacity, "
               "curve_heatmap, slope_gradient) render every config the same way, so which "
               "config a line belongs to is no longer visually distinguishable — an "
               "intentional trade-off of picking one of them.",
    'curve_slope_window': "Bars used to measure each line's slope at each point (an endpoint "
                    "delta, not a single-bar difference) — too short and it's noisy, too long "
                    "and sharp curves get smoothed away. Only used when styling is "
                    "'curve_opacity', 'curve_heatmap', or 'slope_gradient'.",
    'curve_atr_period':  "Lookback period for the ATR used to normalize slope into a "
                    "volatility-comparable unit for the coloring. Only used when styling is "
                    "'curve_opacity', 'curve_heatmap', or 'slope_gradient'.",
    'slope_scale': "The ATR-normalized slope magnitude (in ATR per curve_slope_window bars) "
                    "at which slope_gradient's color hits full saturation — steeper points "
                    "clip to the same maximum intensity, flatter points fade toward neutral "
                    "gray. Default 0.15 was picked empirically: an aVWAP line's own slope "
                    "(already smoothed by being a cumulative average) rarely exceeds ~0.15-0.3 "
                    "ATR/bar even at real swing highs/lows — a scale of 1.0 would leave almost "
                    "every line looking flat gray. Raise it if lines look maxed-out too often; "
                    "lower it if they look faint. Only used when styling is 'slope_gradient'.",
}


def calculate_aVWAP_valleys(
    df,
    valleys_params={'periods': 25, 'max_aVWAPs': None},
    styling='shades',
    curve_slope_window=5,
    curve_atr_period=14,
    slope_scale=0.15,
):
    """
    Anchor aVWAPs at detected swing valleys.

    valleys_params — a config dict (or list of config dicts), each with:
        'periods'    — pivot-detection window (default 25)
        'max_aVWAPs' — cap on how many valley anchors to keep for this config (None = unlimited)

    styling — how the (possibly multiple) configs' lines are colored on the chart, one
        mutually exclusive choice:
        'shades'          — every config a shade of teal, tiered by opacity (default)
        'highlight_first' — first config full teal, every other config a shade of grey
        'grayscale'       — every config a shade of grey, no teal at all
        'curve_opacity'   — colored by curvature relative to this line's own sharpest move
                            so far (per aVWAP-curve-to-straight.md), same teal hue fading
                            in/out as the line settles; not rank-tiered
        'curve_heatmap'   — same curvature-relative-to-self metric, hue shifts hot -> cool
                            gray instead of fading alpha; not rank-tiered
        'slope_gradient'  — colored by instantaneous slope alone (no self-history/decay):
                            aqua when rising, red when falling, neutral gray when flat,
                            intensity scaled by steepness up to slope_scale; not rank-tiered

    curve_slope_window / curve_atr_period / slope_scale — see param_descriptions. Only
        meaningful when styling is 'curve_opacity', 'curve_heatmap', or 'slope_gradient'.

    None of these six params touch this function's DataFrame output — these lines are
    rendered live by the client-side DynamicVWAPEngine, not from this function's return
    value. They exist only so calculate_indicator accepts them; replay_events.py reads
    the raw values straight from ind_params and forwards them to the JS engine, which
    ports the same math aVWAP_minmax/aVWAP.py's calculate_avwap_straightening /
    avwap_curve_color use for curve_opacity/curve_heatmap, plus an analogous simpler
    (memoryless) computation for slope_gradient.

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
