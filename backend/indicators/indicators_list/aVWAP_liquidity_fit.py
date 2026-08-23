"""
aVWAP_liquidity_fit.py

Multi-period aVWAP indicator that ranks candidate swing-high/low anchors by
how many separate times price has come back and touched their line, rather
than by recency, variance, or volume concentration (see the sibling file
aVWAP_volume_fit.py for that). A liquidity-pool-style indicator, but using
aVWAP anchors as the levels instead of raw swing highs/lows — every
candidate is still a real swing high/low (local extreme with a volume
qualifier, not an arbitrary point), the ranking is just about how often
price has returned to interact with its own evolving average.

A "touch" is a contiguous run of bars where price enters a proximity band
around the anchor's aVWAP (band_k * ATR — same band construction as
aVWAP_volume_fit, independent of the anchor's own accumulated variance, so
the band doesn't adapt to make touches easier or harder to score). Each
contiguous run counts as ONE touch, not one per bar — this answers "how
many separate times did price come back," not "how many bars was price
near it" (that's aVWAP_volume_fit's job).

This is deliberately the raw touch count, not a rate normalized by anchor
age. Unlike the earlier variance/survival metrics in aVWAP_volume_fit's
history, where a naive point-in-time or cumulative measure systematically
favored young or old anchors respectively, touch count is closer to how
liquidity pools actually get talked about — "this level has been tested N
times" is meaningful as an absolute number, not only relative to how long
the level has existed. Worth watching for in testing: an older anchor
still has had more opportunity to accumulate touches simply by existing
longer, so if that dominates the ranking in practice, a touches-per-bar
rate would be the natural follow-up fix — the same shape of fix already
applied twice over in aVWAP_volume_fit's own history.

Output columns:
  Per selected anchor "{high|low}_p{period}_r{rank}" (rank 1 = most-touched
  within that period):
    LFIT_{anchor}_avwap   — anchored VWAP (NaN before the anchor's bar)
    LFIT_{anchor}_touches — touch count, last bar only
  Ticker-level summary (last bar only, computed across ALL candidates —
  not just the selected top-N — so period/top_n choices don't skew it):
    LFIT_summary_mean_touches — average touch count, a chart-level "how
                                 often does this ticker's price retest its
                                 own structural levels" read, comparable
                                 ticker-to-ticker.
"""

import numpy as np
import pandas as pd

display_name = "aVWAP — Liquidity Fit"

param_labels = {
    'periods':     'Swing Windows (periods)',
    'vol_mult':    'Volume Qualifier (×avg)',
    'top_n':       'Anchors Kept per Side',
    'band_k':      'Proximity Band (×ATR)',
    'atr_period':  'ATR Period',
    'min_history': 'Minimum Bars Required',
}

param_descriptions = {
    'periods':     "Swing-detection window size(s) in bars, used to find candidate peaks/valleys at "
                    "different scales. Each period is ranked separately, so a small value surfaces "
                    "minor structure and a large value surfaces major structure.",
    'vol_mult':    "Minimum volume on a candidate swing bar, as a multiple of the trailing average, "
                    "required for that swing to qualify as a legitimate anchor. Filters out price "
                    "extremes nobody was actually trading at.",
    'top_n':       "How many top-ranked anchors to keep per side (high/low) per period, ordered by "
                    "touch count. Rank 1 renders boldest and most opaque; each lower rank fades and "
                    "thins, smoothly across however many are kept.",
    'band_k':      "Width of the proximity band around each anchor's aVWAP, in multiples of ATR, used "
                    "to decide whether price counts as 'touching' that line. A contiguous run of bars "
                    "inside the band counts as one touch, not one per bar.",
    'atr_period':  "Lookback period for the ATR used to size the proximity band around each anchor's aVWAP.",
    'min_history': "Minimum bars of history required before this indicator runs at all — returns "
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
    volume qualifier — same legitimacy requirement as aVWAP_volume_fit.
    Self-contained rather than reusing peaks_valleys.py, for the same reason
    documented there: that file's existing output is depended on elsewhere.
    """
    high, low, vol = df['High'].values, df['Low'].values, df['Volume'].values
    avg_vol = pd.Series(vol).rolling(window * 2, min_periods=1).mean().values
    highs = pd.Series(high).rolling(window, center=True).max().values
    lows  = pd.Series(low).rolling(window, center=True).min().values
    strong = vol >= (vol_mult * avg_vol)
    is_high = (high == highs) & strong
    is_low  = (low  == lows)  & strong
    return list(np.where(np.nan_to_num(is_high))[0]), list(np.where(np.nan_to_num(is_low))[0])


def _avwap_and_touches(df, atr, anchor_pos, band_k):
    """
    aVWAP series (full-length, NaN before anchor_pos) + how many separate
    times price entered a band_k*ATR band around its evolving aVWAP.
    Touch counting is fully vectorized (rising-edge detection over the
    in-band boolean array) rather than a per-bar Python loop, which was a
    real performance cost the last time this project computed something
    touch-based (aVWAP_flow_divergence's "respect" component, now removed).
    """
    close, high, low, vol = df['Close'].values, df['High'].values, df['Low'].values, df['Volume'].values
    typical = (high + low + close) / 3.0
    n = len(df)
    seg = slice(anchor_pos, n)

    cum_v  = np.cumsum(vol[seg])
    cum_pv = np.cumsum(typical[seg] * vol[seg])
    with np.errstate(divide='ignore', invalid='ignore'):
        avwap = cum_pv / cum_v

    atr_seg = atr[seg]
    band_upper = avwap + band_k * atr_seg
    band_lower = avwap - band_k * atr_seg
    in_band = np.nan_to_num((low[seg] <= band_upper) & (high[seg] >= band_lower)).astype(bool)

    prev_in_band = np.concatenate(([False], in_band[:-1]))
    touches = int(np.sum(in_band & ~prev_in_band))

    out = np.full(n, np.nan)
    out[seg] = avwap
    return pd.Series(out, index=df.index), touches


def calculate_avwap_liquidity_fit(df, periods=(10, 25, 50, 100), vol_mult=1.5, top_n=3,
                                   band_k=1.0, atr_period=14, min_history=30):
    if len(df) < min_history:
        return {}

    n = len(df)
    atr = _atr(df, atr_period)
    out = {}
    all_touches = []

    for period in periods:
        high_pos, low_pos = _swing_candidates(df, period, vol_mult)
        for side, positions in (('high', high_pos), ('low', low_pos)):
            scored = []
            for pos in positions:
                avwap_series, touches = _avwap_and_touches(df, atr, pos, band_k)
                scored.append((touches, pos, avwap_series))
                all_touches.append(touches)
            scored.sort(key=lambda x: x[0], reverse=True)  # more touches = better, wins the rank

            for rank, (touches, pos, avwap_series) in enumerate(scored[:top_n], start=1):
                label = f'{side}_p{period}_r{rank}'
                out[f'LFIT_{label}_avwap'] = avwap_series
                touches_col = np.full(n, np.nan)
                touches_col[-1] = touches
                out[f'LFIT_{label}_touches'] = pd.Series(touches_col, index=df.index)

    if all_touches:
        mean_col = np.full(n, np.nan)
        mean_col[-1] = float(np.mean(all_touches))
        out['LFIT_summary_mean_touches'] = pd.Series(mean_col, index=df.index)

    return out


def calculate_indicator(df, **params):
    return calculate_avwap_liquidity_fit(df, **params)
