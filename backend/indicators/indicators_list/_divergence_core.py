"""
Shared divergence detection logic used by all divergence_*.py indicators.

Correct algorithm: compare consecutive swing pivot pairs rather than comparing
the current value against a fixed offset N bars ago.
"""
import numpy as np
import pandas as pd


def _strict_extrema(vals, left, right, want_max):
    """Bool array: True where vals[i] is the strict (untied) max — or min, if
    want_max is False — of vals[i-left : i+right+1]. Bars without a full
    window, or with NaN anywhere in it, are never flagged."""
    n = len(vals)
    out = np.zeros(n, dtype=bool)
    for i in range(left, n - right):
        window = vals[i - left : i + right + 1]
        if np.isnan(window).any():
            continue
        v = vals[i]
        ext = window.max() if want_max else window.min()
        if v == ext and (window == v).sum() == 1:
            out[i] = True
    return out


def find_price_pivots(high: pd.Series, low: pd.Series, left: int, right: int):
    """
    Identify swing highs and swing lows — highs on the High series, lows on
    the Low series (the standard convention: a swing high is the bar whose
    high is the highest around it, not its close).

    A bar at index i is a pivot high if High[i] is the strict maximum of
    High[i-left : i+right+1] (no ties allowed — ensures a clean peak).
    Similarly for pivot lows on Low.

    Returns (highs, lows) as numpy bool arrays aligned to the inputs.
    """
    return (_strict_extrema(high.values, left, right, want_max=True),
            _strict_extrema(low.values,  left, right, want_max=False))


def detect_divergences(high: pd.Series, low: pd.Series, indicator_series: pd.Series,
                       left: int = 5, right: int = 5):
    """
    Detect regular and hidden divergences by comparing consecutive pivot pairs.

    For each pair of consecutive pivot lows (i_prev, i_curr), on Low:
      - Regular bullish:  low[i] < low[prev]  AND  ind[i] > ind[prev]
      - Hidden  bullish:  low[i] > low[prev]  AND  ind[i] < ind[prev]

    For each pair of consecutive pivot highs (i_prev, i_curr), on High:
      - Regular bearish:  high[i] > high[prev]  AND  ind[i] < ind[prev]
      - Hidden  bearish:  high[i] < high[prev]  AND  ind[i] > ind[prev]

    Pivots and the price comparison use the same series, so the pivot lines
    replay_events.py draws (High-to-High / Low-to-Low) connect exactly the
    two prices that were compared.

    The indicator value is sampled at the same bar as the price pivot —
    no requirement for the indicator to be independently at its own pivot.

    Returns (reg_bull, reg_bear, hid_bull, hid_bear) as boolean pd.Series.
    """
    hi  = high.values
    lo  = low.values
    ind = indicator_series.values
    n   = len(hi)

    highs, lows = find_price_pivots(high, low, left, right)
    high_idx = np.where(highs)[0]
    low_idx  = np.where(lows)[0]

    reg_bull = np.zeros(n, dtype=bool)
    reg_bear = np.zeros(n, dtype=bool)
    hid_bull = np.zeros(n, dtype=bool)
    hid_bear = np.zeros(n, dtype=bool)

    for k in range(1, len(low_idx)):
        i      = low_idx[k]
        prev_i = low_idx[k - 1]
        if np.isnan(ind[i]) or np.isnan(ind[prev_i]):
            continue
        if lo[i] < lo[prev_i] and ind[i] > ind[prev_i]:
            reg_bull[i] = True
        if lo[i] > lo[prev_i] and ind[i] < ind[prev_i]:
            hid_bull[i] = True

    for k in range(1, len(high_idx)):
        i      = high_idx[k]
        prev_i = high_idx[k - 1]
        if np.isnan(ind[i]) or np.isnan(ind[prev_i]):
            continue
        if hi[i] > hi[prev_i] and ind[i] < ind[prev_i]:
            reg_bear[i] = True
        if hi[i] < hi[prev_i] and ind[i] > ind[prev_i]:
            hid_bear[i] = True

    idx = high.index
    return (
        pd.Series(reg_bull, index=idx),
        pd.Series(reg_bear, index=idx),
        pd.Series(hid_bull, index=idx),
        pd.Series(hid_bear, index=idx),
    )
