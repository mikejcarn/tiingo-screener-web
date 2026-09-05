"""
aVWAP_volume_fit.py

Multi-period aVWAP indicator that ranks candidate swing-high/low anchors by
how much of the market's actual trading activity has occurred near their
line, rather than by a variance-based fit score. Every candidate is still a
real swing high/low (local extreme with a volume qualifier, not an
arbitrary point).

An earlier version of this file ranked anchors by "survival length" (how
many bars before volume-weighted variance broke a threshold). That measured
temporal stability, not significance — a simply quiet, thinly-traded
stretch produces a long survival time almost for free (price barely moved,
so variance stays low), even if hardly anyone was actually transacting
there. It couldn't tell "well-fit because the market kept validating this
level" apart from "well-fit because nothing happened."

Volume-crossing measures participation directly: for each candidate, how
much volume occurred while price was actually near its line (within
band_k * ATR)? That raw amount is then usable two ways — rank_by picks
which:

  rank_by='volfrac' (default) — that volume as a FRACTION of the anchor's
    own total volume since it formed. Self-relative: an old anchor only
    wins if the market kept genuinely returning to it, not merely for
    having existed a long time, so a young anchor can outrank an old one
    immediately if the market is concentrating there right now.

  rank_by='volume' — the same volume, raw, not normalized. The volume-
    profile / point-of-control sense of "structural reference": a level
    where a large absolute amount of trading has occurred, which is
    itself what makes it act as support/resistance. This naturally favors
    anchors that have had more time to accumulate volume — intentional
    here, not a confound to normalize away, since an old, heavily-traded
    level having proven itself over time is exactly the point.

Either way, a plain fraction OR raw sum would be a worse metric on its
own than what actually gets compared here: this file rejected an earlier
"survival length" approach (how many bars before volume-weighted variance
broke a threshold) because that measured temporal stability, not
significance — a quiet, thinly-traded stretch produces a long survival
time almost for free (price barely moved, so variance stays low), even if
hardly anyone was actually transacting there. Volume-crossing, in either
ranking mode, requires actual participation near the line, not just an
absence of movement.

The proximity band itself is ATR-based (an independent volatility measure),
not derived from the anchor's own accumulated variance — a self-referential
band that widens to match the anchor's own spread would trivially enclose
most of its volume by construction, which would flatten this metric's
ability to discriminate between anchors.

Output columns:
  Per selected anchor "{high|low}_p{period}_r{rank}" (rank 1 = best by
  rank_by within that period):
    BFIT_{anchor}_avwap    — anchored VWAP (NaN before the anchor's bar)
    BFIT_{anchor}_volfrac  — fraction (0-1) of the anchor's total volume
                             that occurred near its line, last bar only
    BFIT_{anchor}_volnear  — the same volume, raw (not normalized),
                             last bar only. Computed and stored regardless
                             of rank_by, so both scores stay inspectable
                             no matter which one drove the ranking.
  Ticker-level summary (last bar only, computed across ALL candidates —
  not just the selected top-N — so period/top_n choices don't skew it):
    BFIT_summary_mean_volfrac — average volume-crossing fraction, a
                                 chart-level "how much does this ticker's
                                 volume concentrate near its own aVWAPs"
                                 read, comparable ticker-to-ticker. Always
                                 the fraction, even under rank_by='volume'
                                 — raw volume isn't comparable across
                                 tickers with different typical volumes,
                                 so it wouldn't serve this stat's purpose.
"""

import numpy as np
import pandas as pd

display_name = "aVWAP — Volume Fit"

param_labels = {
    'periods':      'Swing Windows (periods)',
    'vol_mult':     'Volume Qualifier (×avg)',
    'top_n':        'Anchors Kept per Side',
    'band_k':       'Proximity Band (×ATR)',
    'atr_period':   'ATR Period',
    'min_history':  'Minimum Bars Required',
    'rank_by':      'Rank Anchors By',
}

param_descriptions = {
    'periods':     "Swing-detection window size(s) in bars, used to find candidate peaks/valleys at "
                    "different scales. Each period is ranked separately, so a small value surfaces "
                    "minor structure and a large value surfaces major structure.",
    'vol_mult':    "Minimum volume on a candidate swing bar, as a multiple of the trailing average, "
                    "required for that swing to qualify as a legitimate anchor. Filters out price "
                    "extremes nobody was actually trading at.",
    'top_n':       "How many top-ranked anchors to keep per side (high/low) per period, ordered by "
                    "rank_by. Rank 1 renders boldest and most opaque; each lower rank fades and thins, "
                    "smoothly across however many are kept.",
    'band_k':      "Width of the proximity band around each anchor's aVWAP, in multiples of ATR, used "
                    "to decide whether a bar's volume counts as 'near' that line. Independent of the "
                    "anchor's own accumulated variance, so the ranking isn't self-referential.",
    'atr_period':  "Lookback period for the ATR used to size the proximity band around each anchor's aVWAP.",
    'min_history': "Minimum bars of history required before this indicator runs at all — returns "
                    "nothing for tickers with less.",
    'rank_by':     "How to rank and select the top_n anchors per side/period. 'volfrac' (self-relative) "
                    "— fraction of the anchor's OWN total volume that occurred near its line; a young "
                    "anchor can outrank an old one immediately if the market is concentrating there right "
                    "now. 'volume' (structural) — the same volume, raw and not normalized; favors anchors "
                    "that have had more time to accumulate volume, on the view that a level's absolute "
                    "traded volume is itself evidence of it being an established structural reference "
                    "(the volume-profile / point-of-control idea), not something to normalize away.",
}


def _atr(df, period=14):
    high, low, close = df['High'].values, df['Low'].values, df['Close'].values
    prev_close = pd.Series(close).shift(1).values
    tr = np.maximum(high - low, np.maximum(np.abs(high - prev_close), np.abs(low - prev_close)))
    return pd.Series(tr, index=df.index).rolling(period).mean().values


def _swing_candidates(df, window, vol_mult):
    """
    Every local price extreme (centered rolling window) that also clears a
    volume qualifier — same legitimacy requirement as aVWAP_flow_divergence.
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


def _avwap_and_volfrac(df, atr, anchor_pos, band_k):
    """
    aVWAP series (full-length, NaN before anchor_pos) + two scores for this
    anchor, both from the same volume-near-the-line measurement:
      volfrac    — that volume as a FRACTION of the anchor's own total volume
                   since it formed. Self-relative: an anchor only wins on
                   this if the market kept genuinely returning to it, not
                   merely for having existed a long time (see rank_by='volfrac'
                   in calculate_avwap_volume_fit).
      volume_near — the same volume, as a raw absolute sum. Not normalized,
                   so it reads as "how much real trading has concentrated at
                   this exact structural level" — the volume-profile /
                   point-of-control sense of significance (see
                   rank_by='volume'). This naturally tends to favor anchors
                   that have had more time to accumulate volume, which is a
                   feature here, not a bug: a level's absolute traded volume
                   is itself evidence of it being an established structural
                   reference, not a confound to normalize away.
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
    in_band = (low[seg] <= band_upper) & (high[seg] >= band_lower)
    volume_near  = np.where(np.nan_to_num(in_band), vol[seg], 0.0).sum()
    total_volume = cum_v[-1]
    with np.errstate(divide='ignore', invalid='ignore'):
        volfrac = volume_near / total_volume if total_volume else np.nan

    out = np.full(n, np.nan)
    out[seg] = avwap
    return pd.Series(out, index=df.index), volfrac, float(volume_near)


def calculate_avwap_volume_fit(df, periods=(10, 25, 50, 100), vol_mult=1.5, top_n=3,
                                band_k=1.0, atr_period=14, min_history=30, rank_by='volfrac'):
    if len(df) < min_history:
        return {}

    n = len(df)
    atr = _atr(df, atr_period)
    out = {}
    all_volfracs = []
    score_idx = 0 if rank_by == 'volfrac' else 1  # index into each scored tuple's (volfrac, volume_near)

    for period in periods:
        high_pos, low_pos = _swing_candidates(df, period, vol_mult)
        for side, positions in (('high', high_pos), ('low', low_pos)):
            scored = []
            for pos in positions:
                avwap_series, volfrac, volume_near = _avwap_and_volfrac(df, atr, pos, band_k)
                if volfrac is None or np.isnan(volfrac):
                    continue
                scored.append((volfrac, volume_near, pos, avwap_series))
                all_volfracs.append(volfrac)
            # rank_by='volfrac' (default): self-relative — an anchor wins by how
            #   much of ITS OWN volume concentrated near it, so a young anchor
            #   can outrank an old one immediately.
            # rank_by='volume': raw accumulated volume near the line — the
            #   volume-profile/point-of-control sense of "structural
            #   reference." Naturally favors anchors that have had more time
            #   to accumulate volume; that's intentional here; see
            #   _avwap_and_volfrac's docstring.
            scored.sort(key=lambda x: x[score_idx], reverse=True)

            for rank, (volfrac, volume_near, pos, avwap_series) in enumerate(scored[:top_n], start=1):
                label = f'{side}_p{period}_r{rank}'
                out[f'BFIT_{label}_avwap'] = avwap_series
                volfrac_col = np.full(n, np.nan)
                volfrac_col[-1] = volfrac
                out[f'BFIT_{label}_volfrac'] = pd.Series(volfrac_col, index=df.index)
                volnear_col = np.full(n, np.nan)
                volnear_col[-1] = volume_near
                out[f'BFIT_{label}_volnear'] = pd.Series(volnear_col, index=df.index)

    if all_volfracs:
        mean_col = np.full(n, np.nan)
        mean_col[-1] = float(np.mean(all_volfracs))
        out['BFIT_summary_mean_volfrac'] = pd.Series(mean_col, index=df.index)

    return out


def calculate_indicator(df, **params):
    return calculate_avwap_volume_fit(df, **params)
