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


def _clear_line_of_sight(vals, j, i, above, skip=0):
    """True if every value strictly between bars j and i stays on the correct
    side of the straight line from (j, vals[j]) to (i, vals[i]) — at or
    above it for a line joining lows (above=True), at or below it for one
    joining highs. skip ignores that many bars beside each endpoint. NaNs
    in between are skipped."""
    lo_b, hi_b = j + 1 + skip, i - skip
    if hi_b <= lo_b:
        return True
    mid = np.arange(lo_b, hi_b)
    line = vals[j] + (vals[i] - vals[j]) * (mid - j) / (i - j)
    seg = vals[lo_b:hi_b]
    ok = ~np.isnan(seg)
    return bool(np.all(seg[ok] >= line[ok]) if above else np.all(seg[ok] <= line[ok]))


# Bars of indicator history min_osc_change's standard deviation is measured
# over — long enough to be a stable yardstick for "a meaningful move in this
# oscillator", short enough to follow regime changes.
OSC_STD_WINDOW = 50


def detect_divergences(high: pd.Series, low: pd.Series, indicator_series: pd.Series,
                       left: int = 5, right: int = 5,
                       max_lookback_pivots: int = 3, max_pivot_distance: int = 60,
                       line_of_sight: bool = True, los_endpoint_bars: int = 2,
                       equal_swing_atr: float = 0.25, min_osc_change: float = 0.2,
                       atr: pd.Series = None, **_):
    """
    Detect regular and hidden divergences between price swing points and an
    indicator sampled at those same bars.

    For each pivot low i (on Low), compare it against earlier pivot lows j:
      - Regular bullish:  low[i] < low[j]  AND  ind[i] > ind[j]
      - Hidden  bullish:  low[i] > low[j]  AND  ind[i] < ind[j]
    For each pivot high i (on High), against earlier pivot highs j:
      - Regular bearish:  high[i] > high[j]  AND  ind[i] < ind[j]
      - Hidden  bearish:  high[i] < high[j]  AND  ind[i] > ind[j]

    Candidate j's are the up-to-max_lookback_pivots most recent earlier
    pivots of the same side, no more than max_pivot_distance bars back —
    so a divergence against the swing that matters is found even when a
    minor swing sits in between. The most recent qualifying j wins.
    (max_lookback_pivots=1 + line_of_sight=False is the old adjacent-pair-only
    behavior.)

    line_of_sight: a divergence claims the price line joining the two swings
    and the indicator line joining the same two bars disagree. If price or
    the indicator crosses its own line in between, the two points don't form
    one clean line, so the pair is rejected — lines joining lows must not be
    undercut, lines joining highs must not be exceeded. los_endpoint_bars
    exempts that many indicator bars beside each endpoint: the indicator is
    sampled at the PRICE swing bar, but its own turn is often a bar or two
    off, so it routinely pokes past its line right beside an endpoint
    without that being a real break (price endpoints are true pivots, so
    price gets no exemption).

    equal_swing_atr: two swings within this many ATRs of each other count as
    EQUAL rather than higher/lower — so a 1-cent difference no longer
    decides between regular and hidden. Equal swings with a diverging
    indicator count as REGULAR (the classic double-bottom/double-top
    divergence); they never count as hidden, which needs a real higher low /
    lower high. atr is the ATR series to measure with (divergence.py passes
    a standard 14-bar ATR); without one, the 14-bar average high-low range
    is used. 0 = off (strict higher/lower, the old behavior).

    min_osc_change: the indicator's difference between the two swings must
    exceed this many of its own rolling standard deviations (OSC_STD_WINDOW
    bars, at the newer swing) — scale-free, so one setting works for RSI
    (0-100), MACD (price units) and OBV (shares) alike. 0 = off.

    Pivots and the price comparison use the same series, so the pivot lines
    replay_events.py draws (High-to-High / Low-to-Low) connect exactly the
    two prices that were compared.

    Returns (reg_bull, reg_bear, hid_bull, hid_bear, prev):
      the four boolean pd.Series (True at the newer swing's bar), and prev,
      a dict of the same four keys ('reg_bull', ...) to float pd.Series
      holding the matched earlier swing's bar index on signal bars (NaN
      elsewhere) — see prev_columns().
    """
    hi  = high.values.astype(float)
    lo  = low.values.astype(float)
    ind = indicator_series.values.astype(float)
    n   = len(hi)

    if atr is None:
        atr = (high - low).rolling(14, min_periods=1).mean()
    atr_v   = np.asarray(atr, dtype=float)
    ind_std = indicator_series.rolling(OSC_STD_WINDOW, min_periods=20).std().values

    highs, lows = find_price_pivots(high, low, left, right)
    high_idx = np.where(highs)[0]
    low_idx  = np.where(lows)[0]

    flags = {k: np.zeros(n, dtype=bool) for k in ('reg_bull', 'reg_bear', 'hid_bull', 'hid_bear')}
    prevs = {k: np.full(n, np.nan) for k in flags}

    def scan(pivots, price, at_lows):
        reg, hid = ('reg_bull', 'hid_bull') if at_lows else ('reg_bear', 'hid_bear')
        for k in range(1, len(pivots)):
            i = pivots[k]
            if np.isnan(ind[i]):
                continue
            tol  = equal_swing_atr * atr_v[i] if equal_swing_atr and not np.isnan(atr_v[i]) else 0.0
            othr = min_osc_change * ind_std[i] if min_osc_change and not np.isnan(ind_std[i]) else 0.0
            for kind in (reg, hid):
                for back in range(1, max(1, max_lookback_pivots) + 1):
                    if k - back < 0:
                        break
                    j = pivots[k - back]
                    if max_pivot_distance and i - j > max_pivot_distance:
                        break
                    if np.isnan(ind[j]):
                        continue
                    d = price[i] - price[j]   # newer swing minus earlier swing
                    e = ind[i] - ind[j]
                    if at_lows:
                        if kind == reg:   # lower (or equal) low, higher indicator low
                            match = (d < 0 or (tol > 0 and d <= tol)) and e > othr
                        else:             # clearly higher low, lower indicator low
                            match = d > tol and e < -othr
                    else:
                        if kind == reg:   # higher (or equal) high, lower indicator high
                            match = (d > 0 or (tol > 0 and d >= -tol)) and e < -othr
                        else:             # clearly lower high, higher indicator high
                            match = d < -tol and e > othr
                    if not match:
                        continue
                    if line_of_sight and not (
                            _clear_line_of_sight(price, j, i, above=at_lows)
                            and _clear_line_of_sight(ind, j, i, above=at_lows,
                                                     skip=los_endpoint_bars)):
                        continue
                    flags[kind][i] = True
                    prevs[kind][i] = j
                    break

    scan(low_idx,  lo, at_lows=True)
    scan(high_idx, hi, at_lows=False)

    idx = high.index
    prev = {k: pd.Series(v, index=idx) for k, v in prevs.items()}
    return (
        pd.Series(flags['reg_bull'], index=idx),
        pd.Series(flags['reg_bear'], index=idx),
        pd.Series(flags['hid_bull'], index=idx),
        pd.Series(flags['hid_bear'], index=idx),
        prev,
    )


_PREV_SUFFIX = {
    'reg_bull': 'Regular_Bullish', 'reg_bear': 'Regular_Bearish',
    'hid_bull': 'Hidden_Bullish',  'hid_bear': 'Hidden_Bearish',
}


def prev_columns(label: str, prev: dict) -> dict:
    """'{label}_Regular_Bullish_prev'-style companion columns — the earlier
    swing bar each signal was matched against, so replay_events.py can draw
    each pivot line to the swing actually used (which, with
    max_lookback_pivots > 1, isn't always the immediately previous one)."""
    return {f'{label}_{_PREV_SUFFIX[k]}_prev': v for k, v in prev.items()}
