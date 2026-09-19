import pandas as pd

display_name = "Liquidity Sweeps"

param_labels = {
    'max_swept':    'Max Swept Levels Shown',
    'max_unswept':  'Max Unswept Levels Shown',
    'extend_lines': 'Extend Through Sweep',
    'fill_opacity': 'Line Opacity',
    'zone_opacity': 'Touch-Tolerance Band Opacity',
}

param_descriptions = {
    'fill_opacity': "Opacity of an active (unswept) liquidity line, 0-1 — the precise "
                    "average price of the grouped swing highs/lows. A swept level is drawn "
                    "at a fixed fraction of this value. Display-only — no effect on "
                    "liquidity detection itself.",
    'zone_opacity': "Opacity of the faint band drawn behind the line, 0-1, showing the "
                    "real range_percent tolerance smc.liquidity() used to decide which "
                    "swing highs/lows counted as 'touching' the same level and got grouped "
                    "together — not the group's true spread (which the library never "
                    "computes), but the actual threshold behind the grouping decision. "
                    "Kept well below fill_opacity by default so the precise line stays the "
                    "thing your eye lands on. Set to 0 to hide the band and show only the "
                    "line.",
}

def calculate_liquidity(df, swing_length=25, range_percent=0.1, max_swept=None,
                         max_unswept=None, extend_lines=False, fill_opacity=0.8,
                         zone_opacity=0.15):
    from smartmoneyconcepts import smc

    df = df.rename(columns={
        'Open': 'open',
        'Close': 'close',
        'Low': 'low',
        'High': 'high',
        'Volume': 'volume'
    }).copy()

    swing_highs_lows = smc.swing_highs_lows(df, swing_length=swing_length)

    result = smc.liquidity(df, swing_highs_lows, range_percent=range_percent)
    result.index = df.index

    df = pd.concat([df, result], axis=1)
    # 'End' is the bar of the last swing actually grouped into this level —
    # i.e. the real bar a multi-touch liquidity pool is confirmed, since a
    # single swing point isn't a liquidity level until a second one groups
    # with it. Kept (as Liquidity_End) instead of dropped so replay_events
    # can use it for the real confirmation delay, instead of guessing one
    # from swing_length alone.
    df = df.rename(columns={'End': 'Liquidity_End'}, errors='ignore')
    df = df.rename(columns={'Level': 'Liquidity_Level'}, errors='ignore')
    df = df.rename(columns={'Swept': 'Liquidity_Swept'}, errors='ignore')
    df = df.fillna(0)

    # pip_range is the real range_percent tolerance smc.liquidity() used to
    # decide whether a swing high/low counted as "touching" an existing
    # group — same formula as inside the library. Recorded here as a band
    # around the level (not a replacement for it) so the chart can show the
    # actual threshold behind the grouping decision alongside the precise
    # line, rather than only one or the other.
    pip_range = (df['high'].max() - df['low'].min()) * range_percent
    has_level = df['Liquidity'] != 0
    df['Liquidity_High'] = 0.0
    df['Liquidity_Low']  = 0.0
    df.loc[has_level, 'Liquidity_High'] = df.loc[has_level, 'Liquidity_Level'] + pip_range
    df.loc[has_level, 'Liquidity_Low']  = df.loc[has_level, 'Liquidity_Level'] - pip_range

    if max_swept is not None or max_unswept is not None:
        liq_indices = df[df['Liquidity'] != 0].index[::-1]
        swept, unswept = [], []
        for idx in liq_indices:
            sw = int(df.loc[idx, 'Liquidity_Swept'])
            if 0 < sw < len(df):
                swept.append(idx)
            else:
                unswept.append(idx)
        show = set()
        show.update(swept[:max_swept] if max_swept is not None else swept)
        show.update(unswept[:max_unswept] if max_unswept is not None else unswept)
        mask = df.index.isin(show)
        df.loc[~mask, ['Liquidity', 'Liquidity_Level', 'Liquidity_Swept', 'Liquidity_End',
                       'Liquidity_High', 'Liquidity_Low']] = 0

    if extend_lines:
        df['Liquidity_Swept'] = 0

    return {
        'Liquidity': df['Liquidity'],
        'Liquidity_Level': df['Liquidity_Level'],
        'Liquidity_Swept': df['Liquidity_Swept'],
        'Liquidity_End': df['Liquidity_End'],
        'Liquidity_High': df['Liquidity_High'],
        'Liquidity_Low': df['Liquidity_Low'],
    }

def calculate_indicator(df, **params):
    return calculate_liquidity(df, **params)
