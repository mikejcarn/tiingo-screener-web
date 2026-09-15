import pandas as pd

display_name = "Fair Value Gap (FVG)"

param_labels = {
    'max_mitigated':    'Max Mitigated Zones Shown',
    'max_unmitigated':  'Max Unmitigated Zones Shown',
    'join_consecutive': 'Merge Consecutive Gaps',
    'fill_opacity':     'Zone Fill Opacity',
    'max_extend_bars':  'Max Zone Width, Unmitigated (bars, blank = unlimited)',
}

param_descriptions = {
    'fill_opacity': "Opacity of an active (unmitigated) FVG's filled zone on the chart, "
                    "0-1. A mitigated zone is drawn at a fixed fraction of this value, so "
                    "it stays visually subordinate to still-active zones no matter what "
                    "this is set to. Display-only — has no effect on FVG detection itself. "
                    "Same knob as Order Blocks' own fill_opacity, but a separate value — "
                    "the two are drawn distinctly (FVG keeps a dashed outline plus a 50% "
                    "midline; OB is a plain solid fill) so they don't need matching opacity "
                    "to stay visually distinguishable.",
    'max_extend_bars': "How many bars past its own formation an unmitigated (never filled) "
                    "FVG zone is drawn — it has no natural end bar, so without a cap it "
                    "sprawls all the way to the current bar regardless of how old it is. "
                    "This keeps it a marker of where the gap happened instead of an implied "
                    "'still relevant zone all the way to today'. Doesn't affect mitigated "
                    "zones, which already stop at the real bar that filled them. Blank = "
                    "unlimited (the old always-extend-to-now behavior). Display-only — has "
                    "no effect on FVG detection itself.",
}

def calculate_fvg(df, max_mitigated=10, max_unmitigated=10, join_consecutive=False,
                   fill_opacity=0.32, max_extend_bars=30):
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
