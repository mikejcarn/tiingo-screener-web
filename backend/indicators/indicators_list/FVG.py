import pandas as pd

display_name = "Fair Value Gap (FVG)"

def calculate_fvg(df, max_mitigated=10, max_unmitigated=10, join_consecutive=False):
    from smartmoneyconcepts import smc
    df = df.rename(columns={
        'Open': 'open',
        'Close': 'close',
        'Low': 'low',
        'High': 'high',
        'Volume': 'volume'
    }).copy()

    result = smc.fvg(df, join_consecutive=join_consecutive)
    result.index = df.index

    df = pd.concat([df, result], axis=1)

    df = df.drop(columns=['Valleys', 'Peaks'], errors='ignore')
    df = df.rename(columns={'Top': 'FVG_High'}, errors='ignore')
    df = df.rename(columns={'Bottom': 'FVG_Low'}, errors='ignore')
    df = df.rename(columns={'MitigatedIndex': 'FVG_Mitigated_Index'}, errors='ignore')
    df = df.fillna(0)

    return {
        'FVG': df['FVG'],
        'FVG_High': df['FVG_High'],
        'FVG_Low': df['FVG_Low'],
        'FVG_Mitigated_Index': df['FVG_Mitigated_Index'] 
    }

def calculate_indicator(df, **params):
    return calculate_fvg(df, **params)
