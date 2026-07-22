"""
Shared divergence detection logic used by all divergence_*.py indicators.

Correct algorithm: compare consecutive swing pivot pairs rather than comparing
the current value against a fixed offset N bars ago.
"""
import numpy as np
import pandas as pd


def find_price_pivots(series: pd.Series, left: int, right: int):
    """
    Identify pivot highs and lows in a price series.

    A bar at index i is a pivot high if its value is the strict maximum in
    vals[i-left : i+right+1] (no ties allowed — ensures a clean peak).
    Similarly for pivot lows.

    Returns (highs, lows) as numpy bool arrays aligned to series.
    """
    vals = series.values
    n = len(vals)
    highs = np.zeros(n, dtype=bool)
    lows  = np.zeros(n, dtype=bool)

    for i in range(left, n - right):
        window = vals[i - left : i + right + 1]
        if np.isnan(window).any():
            continue
        v = vals[i]
        if np.isnan(v):
            continue
        if v == window.max() and (window == v).sum() == 1:
            highs[i] = True
        if v == window.min() and (window == v).sum() == 1:
            lows[i] = True

    return highs, lows


def detect_divergences(price_series: pd.Series, indicator_series: pd.Series,
                       left: int = 5, right: int = 5):
    """
    Detect regular and hidden divergences by comparing consecutive pivot pairs.

    For each pair of consecutive pivot lows (i_prev, i_curr):
      - Regular bullish:  price[i] < price[prev]  AND  ind[i] > ind[prev]
      - Hidden  bullish:  price[i] > price[prev]  AND  ind[i] < ind[prev]

    For each pair of consecutive pivot highs (i_prev, i_curr):
      - Regular bearish:  price[i] > price[prev]  AND  ind[i] < ind[prev]
      - Hidden  bearish:  price[i] < price[prev]  AND  ind[i] > ind[prev]

    The indicator value is sampled at the same bar as the price pivot —
    no requirement for the indicator to be independently at its own pivot.

    Returns (reg_bull, reg_bear, hid_bull, hid_bear) as boolean pd.Series.
    """
    price = price_series.values
    ind   = indicator_series.values
    n     = len(price)

    highs, lows = find_price_pivots(price_series, left, right)
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
        if price[i] < price[prev_i] and ind[i] > ind[prev_i]:
            reg_bull[i] = True
        if price[i] > price[prev_i] and ind[i] < ind[prev_i]:
            hid_bull[i] = True

    for k in range(1, len(high_idx)):
        i      = high_idx[k]
        prev_i = high_idx[k - 1]
        if np.isnan(ind[i]) or np.isnan(ind[prev_i]):
            continue
        if price[i] > price[prev_i] and ind[i] < ind[prev_i]:
            reg_bear[i] = True
        if price[i] < price[prev_i] and ind[i] > ind[prev_i]:
            hid_bear[i] = True

    idx = price_series.index
    return (
        pd.Series(reg_bull, index=idx),
        pd.Series(reg_bear, index=idx),
        pd.Series(hid_bull, index=idx),
        pd.Series(hid_bear, index=idx),
    )
