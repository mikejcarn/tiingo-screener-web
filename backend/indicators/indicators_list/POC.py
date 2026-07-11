import numpy as np
import pandas as pd


def calculate_poc(df, num_bins=200, num_bars=200):
    """
    Point of Control: the price bin with the highest cumulative volume.
    num_bars: how many recent real bars to include (None = all history).
    Returns a constant horizontal level across those bars.
    """
    close = df['Close'].values
    volume = df['Volume'].fillna(0).values

    real_mask = volume > 0
    if not real_mask.any():
        return {'POC': pd.Series(np.nan, index=df.index)}

    real_indices = np.where(real_mask)[0]
    if num_bars is not None:
        real_indices = real_indices[-num_bars:]

    real_close = close[real_indices]
    real_volume = volume[real_indices]

    price_min = real_close.min()
    price_max = real_close.max()
    price_range = price_max - price_min

    if price_range == 0:
        poc_price = float(price_min)
    else:
        bin_size = price_range / num_bins
        bins = np.floor((real_close - price_min) / bin_size).astype(int)
        bins = np.clip(bins, 0, num_bins - 1)
        volume_by_bin = np.zeros(num_bins)
        np.add.at(volume_by_bin, bins, real_volume)
        poc_bin = int(np.argmax(volume_by_bin))
        poc_price = float(price_min + (poc_bin + 0.5) * bin_size)

    window_mask = np.zeros(len(df), dtype=bool)
    window_mask[real_indices] = True
    poc_series = pd.Series(
        np.where(window_mask, poc_price, np.nan),
        index=df.index
    )

    return {'POC': poc_series}


def calculate_indicator(df, **params):
    return calculate_poc(df, **params)
