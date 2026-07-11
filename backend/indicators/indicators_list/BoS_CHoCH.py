import pandas as pd
from smartmoneyconcepts import smc

def calculate_BoS_CHoCH(df, swing_lengths=None, swing_length=25,
                         show_bos=True, show_choch=True,
                         BoS_swing_lengths=None, CHoCH_swing_lengths=None):
    # Per-signal swing lengths: BoS and CHoCH can use different lookbacks.
    # When either is specified, only the listed swing lengths are active for that signal type.
    if BoS_swing_lengths is not None or CHoCH_swing_lengths is not None:
        _bos_sls   = set(BoS_swing_lengths  or [])
        _choch_sls = set(CHoCH_swing_lengths or [])
        # Compute the union so we only run each swing length once
        if swing_lengths is None:
            swing_lengths = sorted(_bos_sls | _choch_sls)
    else:
        _bos_sls   = None   # None = use global show_bos / show_choch flags
        _choch_sls = None
        if swing_lengths is None:
            swing_lengths = [swing_length]

    df = df.rename(columns={
        'Open': 'open', 'Close': 'close',
        'Low': 'low', 'High': 'high', 'Volume': 'volume',
    }).copy()

    out = {}
    for sl in swing_lengths:
        swing_highs_lows = smc.swing_highs_lows(df, swing_length=sl)
        result = smc.bos_choch(df, swing_highs_lows, close_break=True)
        result.index = df.index

        tmp = pd.concat([df, result], axis=1)
        tmp = tmp.rename(columns={
            'BOS': f'BoS_{sl}',
            'CHOCH': f'CHoCH_{sl}',
            'Level': f'BoS_CHoCH_Price_{sl}',
            'BrokenIndex': f'BoS_CHoCH_Break_Index_{sl}',
        }, errors='ignore').fillna(0)

        # Resolve per-sl show flags
        _show_bos   = show_bos   and (_bos_sls   is None or sl in _bos_sls)
        _show_choch = show_choch and (_choch_sls  is None or sl in _choch_sls)

        if not _show_bos:
            tmp[f'BoS_{sl}'] = 0
        if not _show_choch:
            tmp[f'CHoCH_{sl}'] = 0

        out[f'BoS_{sl}']                   = tmp[f'BoS_{sl}']
        out[f'CHoCH_{sl}']                 = tmp[f'CHoCH_{sl}']
        out[f'BoS_CHoCH_Price_{sl}']       = tmp[f'BoS_CHoCH_Price_{sl}']
        out[f'BoS_CHoCH_Break_Index_{sl}'] = tmp[f'BoS_CHoCH_Break_Index_{sl}']

    return out

def calculate_indicator(df, **params):
    """
    Wrapper function to calculate:
        - Break of Structure (BoS)
        - Change of Character (CHoCH)
    """
    return calculate_BoS_CHoCH(df, **params)
