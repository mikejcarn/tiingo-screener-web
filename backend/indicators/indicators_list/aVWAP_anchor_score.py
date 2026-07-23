"""
aVWAP_anchor_score.py

Scores every candidate swing point and keeps only the best N anchors.
Three components are measured, each percentile-ranked (0→1) within the
current run, then combined as a weighted sum:

  1. Prominence        — how deep/significant the swing is vs surrounding bars
  2. Isolation         — how many bars on each side it remains the extreme point
  3. Reversal sharpness — fast move in + fast move out (V-shape) vs slow grind

  score = (w_prominence × prominence_pct)
        + (w_isolation  × isolation_pct)
        + (w_sharpness  × sharpness_pct)

Output columns: aVWAP_valley_q1, aVWAP_valley_q2, ... (q1 = highest score)
and/or aVWAP_peak_q1, aVWAP_peak_q2, ...
"""

import pandas as pd
import numpy as np

display_name = "Anchor Score"

# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

def calculate_avwap_quality(
    df,
    # --- Output control ---
    valleys=True,
    peaks=False,
    max_anchors=3,
    min_score_pct=None,
    keep_scores=False,
    # --- Candidate detection ---
    min_swing_spacing=5,
    atr_period=14,
    # --- Score component 2: Isolation (scoring mode only) ---
    isolation_max_bars=200,
    # --- Score component 3: Reversal Sharpness (scoring mode only) ---
    sharpness_bars_before=10,
    sharpness_bars_after=10,
    # --- Component weights (scoring mode only) ---
    w_prominence=1.0,
    w_isolation=1.0,
    w_sharpness=1.0,
    # --- Proximity filter ---
    max_atr_distance=None,
):
    """
    Score every candidate swing point and return aVWAPs anchored only to the
    best max_anchors per mode (valley/peak).

    OUTPUT CONTROL
        valleys           — score valley swings (support anchors)
        peaks             — score peak swings (resistance anchors)
        max_anchors       — how many top-scoring aVWAPs to keep per mode
        min_score_pct     — optional floor as a fraction of the max possible score
                            (0.0–1.0). 0.5 = top half, 0.8 = strong. None = no floor.
        keep_scores       — attach score/component columns per aVWAP for inspection

    CANDIDATE DETECTION
        min_swing_spacing — minimum bars between two candidate swings
        atr_period        — ATR lookback for normalization

    SCORING COMPONENTS
        w_prominence, w_isolation, w_sharpness — component weights
        isolation_max_bars                     — search radius for isolation score
        sharpness_bars_before/after            — window for sharpness slope measurement

    PROXIMITY FILTER (applied after scoring, before max_anchors cut)
        max_atr_distance  — discard any candidate whose aVWAP is more than N ATRs
                            from current close. None = no filter.
    """
    from scipy.signal import find_peaks
    from scipy.stats import rankdata

    if not valleys and not peaks:
        return pd.DataFrame(index=df.index)

    work = df.reset_index()
    high = work['High'].values
    low = work['Low'].values
    close = work['Close'].values

    prev_close = pd.Series(close).shift(1).values
    tr = np.maximum(
        high - low,
        np.maximum(np.abs(high - prev_close), np.abs(low - prev_close)),
    )
    atr = pd.Series(tr).rolling(atr_period).mean().values

    current_close = close[-1]
    current_atr = atr[-1]
    proximity_active = (
        max_atr_distance is not None
        and not np.isnan(current_close)
        and not np.isnan(current_atr)
        and current_atr > 0
    )

    # --- Scoring mode ---
    def collect_candidates(extreme_values, mode):
        search_arr = -extreme_values if mode == 'valley' else extreme_values
        cand_idx, props = find_peaks(search_arr, distance=min_swing_spacing, prominence=(None, None))
        sign = 1 if mode == 'valley' else -1

        rows = []
        for idx, prom in zip(cand_idx, props['prominences']):
            atr_val = atr[idx]
            if np.isnan(atr_val) or atr_val == 0:
                continue
            isolation = _isolation_window(extreme_values, idx, isolation_max_bars, mode)
            sharpness = _reversal_sharpness(
                close, idx, atr_val, sharpness_bars_before, sharpness_bars_after, sign
            )
            rows.append({
                'idx': idx,
                'mode': mode,
                'prominence_norm': prom / atr_val,
                'isolation_bars': isolation,
                'reversal_sharpness': sharpness,
            })
        return rows

    def apply_weighted_score(mode_rows):
        if not mode_rows:
            return mode_rows

        prom_vals  = np.array([r['prominence_norm']   for r in mode_rows])
        iso_vals   = np.array([r['isolation_bars']     for r in mode_rows])
        sharp_vals = np.array([r['reversal_sharpness'] for r in mode_rows])

        prom_pct  = _percentile_rank(prom_vals)
        iso_pct   = _percentile_rank(iso_vals)
        sharp_pct = _percentile_rank(sharp_vals)

        for i, row in enumerate(mode_rows):
            row['prominence_pct'] = prom_pct[i]
            row['isolation_pct']  = iso_pct[i]
            row['sharpness_pct']  = sharp_pct[i]
            row['score'] = (
                w_prominence * prom_pct[i]
                + w_isolation  * iso_pct[i]
                + w_sharpness  * sharp_pct[i]
            )
        return mode_rows

    all_rows = []
    if valleys:
        all_rows.extend(apply_weighted_score(collect_candidates(low, 'valley')))
    if peaks:
        all_rows.extend(apply_weighted_score(collect_candidates(high, 'peak')))

    aVWAP_series = {}
    for mode in ('valley', 'peak'):
        mode_rows = sorted(
            (r for r in all_rows if r['mode'] == mode),
            key=lambda r: (r['score'], r['idx']), reverse=True,
        )
        if min_score_pct is not None:
            max_score = w_prominence + w_isolation + w_sharpness
            mode_rows = [r for r in mode_rows if r['score'] >= min_score_pct * max_score]
        if proximity_active:
            mode_rows = [
                r for r in mode_rows
                if abs(calculate_avwap(work, r['idx']).iloc[-1] - current_close) / current_atr
                   <= max_atr_distance
            ]
        mode_rows = mode_rows[:max_anchors]

        for rank, r in enumerate(mode_rows, start=1):
            col = f'aVWAP_{mode}_q{rank}'
            aVWAP_series[col] = calculate_avwap(work, r['idx'])
            if keep_scores:
                aVWAP_series[f'{col}_score']          = pd.Series(r['score'],            index=work.index)
                aVWAP_series[f'{col}_prominence_pct'] = pd.Series(r['prominence_pct'],   index=work.index)
                aVWAP_series[f'{col}_isolation_pct']  = pd.Series(r['isolation_pct'],    index=work.index)
                aVWAP_series[f'{col}_sharpness_pct']  = pd.Series(r['sharpness_pct'],    index=work.index)

    out_df = pd.DataFrame(aVWAP_series, index=work.index)
    out_df['date'] = work['date']
    out_df.set_index('date', inplace=True)
    return out_df


# ---------------------------------------------------------------------------
# Scoring helpers
# ---------------------------------------------------------------------------

def _percentile_rank(values: np.ndarray) -> np.ndarray:
    """Convert an array of values to percentile ranks in [0, 1].
    Ties receive the average rank. Single-candidate runs return [1.0]."""
    n = len(values)
    if n == 1:
        return np.array([1.0])
    ranks = rankdata(values, method='average') - 1
    return ranks / (n - 1)


def _isolation_window(values: np.ndarray, idx: int, isolation_max_bars: int, mode: str) -> int:
    """Largest N such that values[idx] is the min (valley) or max (peak)
    over the window [idx-N, idx+N]. Bigger N = more dominant local extreme."""
    n = len(values)
    val = values[idx]
    best_n = 0
    for w in range(1, isolation_max_bars + 1):
        lo, hi = max(0, idx - w), min(n - 1, idx + w)
        window = values[lo:hi + 1]
        if mode == 'valley':
            if window.min() < val:
                break
        else:
            if window.max() > val:
                break
        best_n = w
        if lo == 0 and hi == n - 1:
            break
    return best_n


def _reversal_sharpness(close: np.ndarray, idx: int, atr_val: float,
                        bars_before: int, bars_after: int, sign: int) -> float:
    """ATR-normalized reversal slope: (slope out) minus (slope in), sign-adjusted
    for valley vs peak. Positive = sharp V/inverted-V reversal."""
    n = len(close)
    start, end = max(0, idx - bars_before), min(n - 1, idx + bars_after)
    pre  = close[start:idx + 1]
    post = close[idx:end + 1]

    pre_slope  = (pre[-1]  - pre[0])  / max(len(pre)  - 1, 1)
    post_slope = (post[-1] - post[0]) / max(len(post) - 1, 1)

    return sign * (post_slope / atr_val - pre_slope / atr_val)


def calculate_avwap(df: pd.DataFrame, anchor_index: int) -> pd.Series:
    """Cumulative typical-price VWAP anchored at anchor_index."""
    df_anchored = df.iloc[anchor_index:].copy()
    df_anchored['cumulative_volume'] = df_anchored['Volume'].cumsum()
    df_anchored['cumulative_volume_price'] = (
        df_anchored['Volume'] *
        (df_anchored['High'] + df_anchored['Low'] + df_anchored['Close']) / 3
    ).cumsum()
    return df_anchored['cumulative_volume_price'] / df_anchored['cumulative_volume']


def calculate_indicator(df, **params):
    return calculate_avwap_quality(df, **params)
