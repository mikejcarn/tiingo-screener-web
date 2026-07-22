import pandas as pd
from smartmoneyconcepts import smc


display_name = "Break of Structure / Change of Character (BoS/CHoCH)"
def _to_list(val):
    if val is None or val == []:
        return None
    return [val] if isinstance(val, (int, float)) else list(val)


def calculate_BoS_CHoCH(df, swing_lengths=[25],
                         show_bos=True, show_choch=True,
                         BoS_swing_lengths=[], CHoCH_swing_lengths=[]):
    BoS_swing_lengths   = _to_list(BoS_swing_lengths)
    CHoCH_swing_lengths = _to_list(CHoCH_swing_lengths)

    if BoS_swing_lengths is not None or CHoCH_swing_lengths is not None:
        _bos_sls   = set(BoS_swing_lengths)   if BoS_swing_lengths   is not None else None
        _choch_sls = set(CHoCH_swing_lengths) if CHoCH_swing_lengths is not None else None
        explicit = (_bos_sls or set()) | (_choch_sls or set())
        fallback = set(swing_lengths) if (_bos_sls is None or _choch_sls is None) else set()
        swing_lengths = sorted(explicit | fallback)
    else:
        _bos_sls   = None
        _choch_sls = None

    if not swing_lengths:
        return {}

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

param_labels = {
    'BoS_swing_lengths':   'BoS_swing_lengths [override]',
    'CHoCH_swing_lengths': 'CHoCH_swing_lengths [override]',
}


def calculate_indicator(df, **params):
    """
    Wrapper function to calculate:
        - Break of Structure (BoS)
        - Change of Character (CHoCH)
    """
    return calculate_BoS_CHoCH(df, **params)
