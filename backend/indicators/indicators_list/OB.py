import pandas as pd

display_name = "Order Blocks (OB)"

param_labels = {
    'periods':         'Swing Window (periods)',
    'max_mitigated':   'Max Mitigated Zones Shown',
    'max_unmitigated': 'Max Unmitigated Zones Shown',
    'fill_opacity':    'Zone Fill Opacity',
}

param_descriptions = {
    'fill_opacity': "Opacity of an active (unmitigated) order block's filled zone on the "
                    "chart, 0-1. A mitigated zone is drawn at a fixed fraction of this "
                    "value, so it stays visually subordinate to still-active zones no "
                    "matter what this is set to. Display-only — has no effect on OB "
                    "detection itself.",
}

def calculate_ob(df, periods=25, max_mitigated=None, max_unmitigated=None, fill_opacity=0.32):
    from smartmoneyconcepts import smc

    df = df.rename(columns={
        'Open': 'open',
        'Close': 'close',
        'Low': 'low',
        'High': 'high',
        'Volume': 'volume'
    }).copy()

    swing_highs_lows = smc.swing_highs_lows(df, swing_length=periods)

    result = smc.ob(df, swing_highs_lows, close_mitigation=False)
    result.index = df.index # to preserve the datetime index
    
    df = pd.concat([df, result], axis=1)
    
    df = df.drop(columns=['Percentage'], errors='ignore')
    df = df.rename(columns={'Top': 'OB_High'}, errors='ignore')
    df = df.rename(columns={'Bottom': 'OB_Low'}, errors='ignore')
    df = df.rename(columns={'OBVolume': 'OB_Volume'}, errors='ignore')
    df = df.rename(columns={'MitigatedIndex': 'OB_Mitigated_Index'}, errors='ignore')
    df = df.fillna(0)

    return {
        'OB': df['OB'],
        'OB_High': df['OB_High'],
        'OB_Low': df['OB_Low'],
        'OB_Mitigated_Index': df['OB_Mitigated_Index']
    }

def calculate_indicator(df, **params):
    return calculate_ob(df, **params)
