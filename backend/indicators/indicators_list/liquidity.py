import pandas as pd
from smartmoneyconcepts import smc


display_name = "Liquidity Sweeps"
def calculate_liquidity(df, swing_length=25, range_percent=0.1, max_swept=None, max_unswept=None, extend_lines=False):

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
    df = df.drop(columns=['End'], errors='ignore')
    df = df.rename(columns={'Level': 'Liquidity_Level'}, errors='ignore')
    df = df.rename(columns={'Swept': 'Liquidity_Swept'}, errors='ignore')
    df = df.fillna(0)

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
        df.loc[~mask, ['Liquidity', 'Liquidity_Level', 'Liquidity_Swept']] = 0

    if extend_lines:
        df['Liquidity_Swept'] = 0

    return {
        'Liquidity': df['Liquidity'],
        'Liquidity_Level': df['Liquidity_Level'],
        'Liquidity_Swept': df['Liquidity_Swept'],
    }

def calculate_indicator(df, **params):
    return calculate_liquidity(df, **params)
