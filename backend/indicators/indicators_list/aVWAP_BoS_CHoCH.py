import pandas as pd
from backend.indicators.indicators import get_indicators
from backend.indicators.indicators_list.aVWAP import calculate_avwap


def calculate_aVWAP_BoS_CHoCH(
    df,
    swing_length=25,
    mode='combined',
    include_BoS=True,
    include_CHoCH=True,
    max_aVWAPs=None,
):
    """
    Anchor aVWAPs at Break of Structure (BoS) and Change of Character (CHoCH) events.

    The anchor is placed at the extremum within the [signal_bar : break_bar] range:
      - Bullish BoS/CHoCH → Low minimum (support that was defended before the break)
      - Bearish BoS/CHoCH → High maximum (resistance that was defended before the break)

    Because calculate_avwap starts at the actual anchor bar, first_valid_index() of
    the stored Series always returns the correct anchor for the replay engine.

    mode: 'combined' | 'bull' | 'bear'

    Output columns:
        aVWAP_BoS_bull_c0_{signal_bar}
        aVWAP_BoS_bear_c0_{signal_bar}
        aVWAP_CHoCH_bull_c0_{signal_bar}
        aVWAP_CHoCH_bear_c0_{signal_bar}
    """
    df = df.reset_index()
    df['date'] = pd.to_datetime(df['date'])

    base_cols = [c for c in ['Open', 'High', 'Low', 'Close', 'Volume', 'date'] if c in df.columns]
    bc_df = get_indicators(
        df[base_cols].copy(), ['BoS_CHoCH'], {'BoS_CHoCH': {'swing_length': swing_length}}
    )

    mode_lower = mode.lower()
    include_bull = mode_lower in ('combined', 'both', 'all', 'bull', 'bullish')
    include_bear = mode_lower in ('combined', 'both', 'all', 'bear', 'bearish')

    bos_col   = f'BoS_{swing_length}'
    choch_col = f'CHoCH_{swing_length}'
    break_col = f'BoS_CHoCH_Break_Index_{swing_length}'

    def _avwap_for_range(signal_idx, brk, direction):
        if brk is None or pd.isna(brk) or brk <= signal_idx:
            return None
        brk = int(brk)
        rng = df.iloc[signal_idx:brk + 1]
        anchor = int(rng['Low'].idxmin()) if direction == 'bull' else int(rng['High'].idxmax())
        return calculate_avwap(df, anchor)

    result = {}

    for sig_col, sig_name, direction, prefix in [
        (bos_col,   'BoS',   'bull',  'aVWAP_BoS_bull_c0'),
        (bos_col,   'BoS',   'bear',  'aVWAP_BoS_bear_c0'),
        (choch_col, 'CHoCH', 'bull',  'aVWAP_CHoCH_bull_c0'),
        (choch_col, 'CHoCH', 'bear',  'aVWAP_CHoCH_bear_c0'),
    ]:
        if sig_col not in bc_df.columns:
            continue
        if sig_name == 'BoS'   and not include_BoS:
            continue
        if sig_name == 'CHoCH' and not include_CHoCH:
            continue
        if direction == 'bull' and not include_bull:
            continue
        if direction == 'bear' and not include_bear:
            continue

        val = 1 if direction == 'bull' else -1
        indices = sorted(bc_df[bc_df[sig_col] == val].index.tolist(), reverse=True)
        if max_aVWAPs is not None:
            indices = indices[:max_aVWAPs]

        for idx in indices:
            brk = bc_df.at[idx, break_col] if break_col in bc_df.columns else None
            avwap = _avwap_for_range(idx, brk, direction)
            if avwap is not None:
                result[f'{prefix}_{idx}'] = avwap

    for col, series in result.items():
        df[col] = series

    df.set_index('date', inplace=True)
    return df[list(result.keys())] if result else df[[]]


def calculate_indicator(df, **params):
    return calculate_aVWAP_BoS_CHoCH(df, **params)
