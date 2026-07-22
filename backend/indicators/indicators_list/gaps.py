import numpy as np
import pandas as pd



display_name = "Price Gaps"
def calculate_gaps(df, max_mitigated=5, max_unmitigated=5):
    df = df.copy()
    prev_high = df['High'].shift(1)
    prev_low  = df['Low'].shift(1)

    gap_up   = df['Low']  > prev_high
    gap_down = df['High'] < prev_low

    n    = len(df)
    lows  = df['Low'].values
    highs = df['High'].values

    gap_up_mit   = np.zeros(n, dtype=int)
    gap_down_mit = np.zeros(n, dtype=int)

    for i in np.where(gap_up.values)[0]:
        fill_level = prev_high.iloc[i]
        future = np.where(lows[i + 1:] <= fill_level)[0]
        if len(future):
            gap_up_mit[i] = i + 1 + future[0]

    for i in np.where(gap_down.values)[0]:
        fill_level = prev_low.iloc[i]
        future = np.where(highs[i + 1:] >= fill_level)[0]
        if len(future):
            gap_down_mit[i] = i + 1 + future[0]

    return {
        'Gap_Up':             gap_up.astype(int),
        'Gap_Down':           gap_down.astype(int),
        'Gap_Up_High':        df['Low'].where(gap_up),
        'Gap_Up_Low':         prev_high.where(gap_up),
        'Gap_Down_High':      prev_low.where(gap_down),
        'Gap_Down_Low':       df['High'].where(gap_down),
        'Gap_Up_Mitigated':   pd.Series(gap_up_mit,   index=df.index),
        'Gap_Down_Mitigated': pd.Series(gap_down_mit, index=df.index),
    }


def calculate_indicator(df, **params):
    return calculate_gaps(df, **params)
