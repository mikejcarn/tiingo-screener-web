import numpy as np
import pandas as pd

display_name = "Point of Control (Volume Profile)"

_NUM_BINS = 500


def calculate_poc(df, num_levels=4, lookback_bars=None, **_):
    num_levels = max(1, int(num_levels))

    high   = df['High'].values
    low    = df['Low'].values
    volume = df['Volume'].fillna(0).values
    n      = len(df)

    base   = min(n, int(lookback_bars)) if lookback_bars else n
    offset = n - base

    high_w = high[-base:]
    low_w  = low[-base:]
    vol_w  = volume[-base:]

    real_mask = vol_w > 0
    if not real_mask.any():
        return {}

    price_min   = float(low_w[real_mask].min())
    price_max   = float(high_w[real_mask].max())
    price_range = price_max - price_min
    if price_range == 0:
        return {}

    bin_size = price_range / _NUM_BINS
    lo_bins  = np.clip(((low_w  - price_min) / bin_size).astype(int), 0, _NUM_BINS - 1)
    hi_bins  = np.clip(((high_w - price_min) / bin_size).astype(int), 0, _NUM_BINS - 1)

    bar_profile = np.zeros((base, _NUM_BINS))
    for i in range(base):
        if real_mask[i]:
            span = hi_bins[i] - lo_bins[i] + 1
            bar_profile[i, lo_bins[i]:hi_bins[i] + 1] = vol_w[i] / span

    cumsum = np.cumsum(bar_profile, axis=0)

    result = {}
    for level in range(num_levels):
        frac       = 1.0 - level / num_levels
        start_in_w = int((1.0 - frac) * base)
        start_bar  = offset + start_in_w

        lag     = cumsum[start_in_w - 1] if start_in_w > 0 else np.zeros(_NUM_BINS)
        rolling = cumsum[start_in_w:] - lag

        valid     = rolling.sum(axis=1) > 0
        poc_bins  = np.argmax(rolling, axis=1)
        poc_slice = (price_min + (poc_bins + 0.5) * bin_size).astype(float)
        poc_slice[~valid] = np.nan

        series = pd.Series(np.nan, index=df.index, dtype=float)
        series.iloc[start_bar:] = poc_slice

        result[f'POC_{level}'] = series

    return result


def calculate_indicator(df, **params):
    return calculate_poc(df, **params)
