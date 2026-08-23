"""
aVWAP_curve_fit.py

Multi-period aVWAP indicator that ranks candidate swing-high/low anchors by
how sharply their aVWAP line has curved at its strongest point, rather than
by volume concentration (aVWAP_volume_fit) or touch count
(aVWAP_liquidity_fit). First slice of the design in
aVWAP-curve-to-straight.md (project root) — curve strength only. That spec
also covers a "straightening score" (how much a curve has since flattened
relative to its own peak) and a composite quality score combining
flattening, duration, and path-consistency — deliberately not built here
yet. The goal right now is just: can real curves be identified and
visualized at all, before layering timing/quality scoring on top.

Curve strength = the largest ATR-normalized aVWAP slope this anchor has
ever reached, evaluated as a running peak (not a fixed-window average) —
because anchors form at swing extremes by definition, the sharp initial
move naturally happens early in the anchor's life, so the running max
locks in during that move and stays fixed as the line later flattens. No
separate "early window" detection is needed.

Deliberately NOT self-relative to a fixed threshold — the spec's own
caution: aVWAP slope mechanically decays toward zero as an anchor ages
(accumulated volume grows, so the same size price move produces a smaller
slope change late in life than early on), so this only ever compares a
value against the market's own volatility (ATR), and ranks anchors against
EACH OTHER's peak, not against a hardcoded slope threshold that would just
reward age or punish it depending on how it's set.

Output columns:
  Per selected anchor "{high|low}_p{period}_r{rank}" (rank 1 = sharpest
  curve within that period):
    CFIT_{anchor}_avwap          — anchored VWAP (NaN before the anchor's bar)
    CFIT_{anchor}_curve_strength — ATR-normalized peak slope, last bar only
  Ticker-level summary (last bar only, computed across ALL candidates —
  not just the selected top-N — so period/top_n choices don't skew it):
    CFIT_summary_mean_curve_strength — average curve strength, a
                                        chart-level "how sharply does this
                                        ticker's structure tend to curve"
                                        read, comparable ticker-to-ticker.
"""

import numpy as np
import pandas as pd

display_name = "aVWAP — Curve Fit"

param_labels = {
    'periods':      'Swing Windows (periods)',
    'vol_mult':     'Volume Qualifier (×avg)',
    'top_n':        'Anchors Kept per Side',
    'slope_window': 'Slope Smoothing (bars)',
    'atr_period':   'ATR Period',
    'min_history':  'Minimum Bars Required',
}

param_descriptions = {
    'periods':      "Swing-detection window size(s) in bars, used to find candidate peaks/valleys at "
                     "different scales. Each period is ranked separately, so a small value surfaces "
                     "minor structure and a large value surfaces major structure.",
    'vol_mult':     "Minimum volume on a candidate swing bar, as a multiple of the trailing average, "
                     "required for that swing to qualify as a legitimate anchor. Filters out price "
                     "extremes nobody was actually trading at.",
    'top_n':        "How many top-ranked anchors to keep per side (high/low) per period, ordered by "
                     "curve strength. Rank 1 renders boldest and most opaque; each lower rank fades "
                     "and thins, smoothly across however many are kept.",
    'slope_window': "Number of bars used to measure the aVWAP's slope at each point (an endpoint "
                     "delta, not a single-bar difference) — too short and the slope is noisy, too "
                     "long and sharp curves get smoothed away.",
    'atr_period':   "Lookback period for the ATR used to normalize slope into a volatility-comparable unit.",
    'min_history':  "Minimum bars of history required before this indicator runs at all — returns "
                     "nothing for tickers with less.",
}


def _atr(df, period=14):
    high, low, close = df['High'].values, df['Low'].values, df['Close'].values
    prev_close = pd.Series(close).shift(1).values
    tr = np.maximum(high - low, np.maximum(np.abs(high - prev_close), np.abs(low - prev_close)))
    return pd.Series(tr, index=df.index).rolling(period).mean().values


def _swing_candidates(df, window, vol_mult):
    """
    Every local price extreme (centered rolling window) that also clears a
    volume qualifier — same legitimacy requirement as aVWAP_volume_fit and
    aVWAP_liquidity_fit. Self-contained rather than reusing peaks_valleys.py,
    for the same reason documented there: that file's existing output is
    depended on elsewhere.
    """
    high, low, vol = df['High'].values, df['Low'].values, df['Volume'].values
    avg_vol = pd.Series(vol).rolling(window * 2, min_periods=1).mean().values
    highs = pd.Series(high).rolling(window, center=True).max().values
    lows  = pd.Series(low).rolling(window, center=True).min().values
    strong = vol >= (vol_mult * avg_vol)
    is_high = (high == highs) & strong
    is_low  = (low  == lows)  & strong
    return list(np.where(np.nan_to_num(is_high))[0]), list(np.where(np.nan_to_num(is_low))[0])


def _avwap_and_curve_strength(df, atr, anchor_pos, slope_window):
    """
    aVWAP series (full-length, NaN before anchor_pos) + this anchor's peak
    ATR-normalized slope, evaluated as of the dataset's last bar.
    """
    close, high, low, vol = df['Close'].values, df['High'].values, df['Low'].values, df['Volume'].values
    typical = (high + low + close) / 3.0
    n = len(df)
    seg = slice(anchor_pos, n)
    seg_len = n - anchor_pos

    cum_v  = np.cumsum(vol[seg])
    cum_pv = np.cumsum(typical[seg] * vol[seg])
    with np.errstate(divide='ignore', invalid='ignore'):
        avwap = cum_pv / cum_v

    atr_seg = atr[seg]
    slope_raw = np.full(seg_len, np.nan)
    if seg_len > slope_window:
        slope_raw[slope_window:] = (avwap[slope_window:] - avwap[:-slope_window]) / slope_window
    with np.errstate(divide='ignore', invalid='ignore'):
        norm_slope = slope_raw / atr_seg

    running_max = pd.Series(np.abs(norm_slope)).cummax().values
    curve_strength = running_max[-1]

    out = np.full(n, np.nan)
    out[seg] = avwap
    return pd.Series(out, index=df.index), curve_strength


def calculate_avwap_curve_fit(df, periods=(10, 25, 50, 100), vol_mult=1.5, top_n=3,
                               slope_window=5, atr_period=14, min_history=30):
    if len(df) < min_history:
        return {}

    n = len(df)
    atr = _atr(df, atr_period)
    out = {}
    all_curve_strengths = []

    for period in periods:
        high_pos, low_pos = _swing_candidates(df, period, vol_mult)
        for side, positions in (('high', high_pos), ('low', low_pos)):
            scored = []
            for pos in positions:
                avwap_series, curve_strength = _avwap_and_curve_strength(df, atr, pos, slope_window)
                if curve_strength is None or np.isnan(curve_strength):
                    continue
                scored.append((curve_strength, pos, avwap_series))
                all_curve_strengths.append(curve_strength)
            scored.sort(key=lambda x: x[0], reverse=True)  # sharper curve = better, wins the rank

            for rank, (curve_strength, pos, avwap_series) in enumerate(scored[:top_n], start=1):
                label = f'{side}_p{period}_r{rank}'
                out[f'CFIT_{label}_avwap'] = avwap_series
                cs_col = np.full(n, np.nan)
                cs_col[-1] = curve_strength
                out[f'CFIT_{label}_curve_strength'] = pd.Series(cs_col, index=df.index)

    if all_curve_strengths:
        mean_col = np.full(n, np.nan)
        mean_col[-1] = float(np.mean(all_curve_strengths))
        out['CFIT_summary_mean_curve_strength'] = pd.Series(mean_col, index=df.index)

    return out


def calculate_indicator(df, **params):
    return calculate_avwap_curve_fit(df, **params)
