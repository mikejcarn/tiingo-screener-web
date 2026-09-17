import numpy as np
import pandas as pd



display_name = "Price Gaps"

param_labels = {
    'max_mitigated':    'Max Mitigated Zones Shown',
    'max_unmitigated':  'Max Unmitigated Zones Shown',
    'fill_opacity':     'Zone Fill Opacity',
    'max_extend_bars':  'Max Zone Width, Unmitigated (bars, blank = unlimited)',
}

param_descriptions = {
    'fill_opacity': "Opacity of an active (unfilled) gap's zone on the chart, 0-1. A "
                    "mitigated (filled) gap is drawn at a fixed fraction of this value, "
                    "so it stays visually subordinate to still-open gaps no matter what "
                    "this is set to. Display-only — has no effect on gap detection itself.",
    'max_extend_bars': "How many bars past its own formation an unmitigated (never filled) "
                    "gap zone is drawn — it has no natural end bar, so without a cap it "
                    "sprawls all the way to the current bar regardless of how old it is. "
                    "Doesn't affect mitigated zones, which already stop at the bar that "
                    "filled them. Blank = unlimited (the old always-extend-to-now behavior).",
}

def calculate_gaps(df, max_mitigated=5, max_unmitigated=5, fill_opacity=0.32, max_extend_bars=30):
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
