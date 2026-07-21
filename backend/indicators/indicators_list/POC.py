import numpy as np
import pandas as pd

display_name = "Point of Control (Volume Profile)"

_NUM_BINS = 500


def calculate_poc(df, num_levels=4, lookback_bars=None, **_):
    num_levels = max(1, int(num_levels))
    fractions  = [1.0 - i / num_levels for i in range(num_levels)]

    high   = df['High'].values
    low    = df['Low'].values
    volume = df['Volume'].fillna(0).values
    n      = len(df)

    base = min(n, int(lookback_bars)) if lookback_bars else n
    high_w, low_w, vol_w = high[-base:], low[-base:], volume[-base:]

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

    cumsum       = np.cumsum(bar_profile, axis=0)
    full_profile = cumsum[-1]

    result = {}
    for i, frac in enumerate(fractions):
        window     = max(1, int(base * frac))
        start_in_w = base - window
        start_bar  = n - base + start_in_w

        profile = full_profile - cumsum[start_in_w - 1] if start_in_w > 0 else full_profile

        poc_bin   = int(np.argmax(profile))
        poc_price = price_min + (poc_bin + 0.5) * bin_size

        series = pd.Series(np.nan, index=df.index, dtype=float)
        if 0 <= start_bar < n:
            series.iloc[start_bar] = poc_price

        label = f'POC_{i}'
        result[label] = series

    return result


def calculate_indicator(df, **params):
    return calculate_poc(df, **params)
