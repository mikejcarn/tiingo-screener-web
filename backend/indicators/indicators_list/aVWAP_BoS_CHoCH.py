import pandas as pd
from backend.indicators.indicators import get_indicators
from backend.indicators.indicators_list.aVWAP import calculate_avwap



display_name = "aVWAP — Break of Structure / Change of Character (BoS/CHoCH)"
def calculate_aVWAP_BoS_CHoCH(
    df,
    swing_length=25,
    include_bull_aVWAP=True,  # draw aVWAP lines anchored at bullish BoS/CHoCH signals
    include_bear_aVWAP=True,  # draw aVWAP lines anchored at bearish BoS/CHoCH signals
    include_BoS=True,         # output BoS horizontal segment columns
    include_CHoCH=True,       # output CHoCH horizontal segment columns
    max_aVWAPs=None,
):
    """
    Anchor aVWAPs at Break of Structure (BoS) and Change of Character (CHoCH) events.

    The anchor is placed at the extremum within the [signal_bar : break_bar] range:
      - Bullish BoS/CHoCH → Low minimum (support that was defended before the break)
      - Bearish BoS/CHoCH → High maximum (resistance that was defended before the break)

    include_bull_aVWAP — draw aVWAP lines from bullish BoS and CHoCH anchors
    include_bear_aVWAP — draw aVWAP lines from bearish BoS and CHoCH anchors
    include_BoS        — whether BoS horizontal segment columns are output
    include_CHoCH      — whether CHoCH horizontal segment columns are output

    Output columns (aVWAP lines):
        aVWAP_BoS_bull_c0_{signal_bar}
        aVWAP_BoS_bear_c0_{signal_bar}
        aVWAP_CHoCH_bull_c0_{signal_bar}
        aVWAP_CHoCH_bear_c0_{signal_bar}

    Output columns (horizontal segments, when include_* is True):
        BoS_{swing_length}
        CHoCH_{swing_length}
        BoS_CHoCH_Price_{swing_length}
        BoS_CHoCH_Break_Index_{swing_length}
    """
    df = df.reset_index()
    df['date'] = pd.to_datetime(df['date'])

    base_cols = [c for c in ['Open', 'High', 'Low', 'Close', 'Volume', 'date'] if c in df.columns]
    bc_df = get_indicators(
        df[base_cols].copy(), ['BoS_CHoCH'], {'BoS_CHoCH': {'swing_length': swing_length}}
    )

    bos_col   = f'BoS_{swing_length}'
    choch_col = f'CHoCH_{swing_length}'
    price_col = f'BoS_CHoCH_Price_{swing_length}'
    break_col = f'BoS_CHoCH_Break_Index_{swing_length}'

    def _avwap_for_range(signal_idx, brk, direction):
        if brk is None or pd.isna(brk) or brk <= signal_idx:
            return None
        brk = int(brk)
        rng = df.iloc[signal_idx:brk + 1]
        anchor = int(rng['Low'].idxmin()) if direction == 'bull' else int(rng['High'].idxmax())
        return calculate_avwap(df, anchor)

    result = {}

    for sig_col, use_avwap, direction, prefix in [
        (bos_col,   include_bull_aVWAP, 'bull', 'aVWAP_BoS_bull_c0'),
        (bos_col,   include_bear_aVWAP, 'bear', 'aVWAP_BoS_bear_c0'),
        (choch_col, include_bull_aVWAP, 'bull', 'aVWAP_CHoCH_bull_c0'),
        (choch_col, include_bear_aVWAP, 'bear', 'aVWAP_CHoCH_bear_c0'),
    ]:
        if not use_avwap or sig_col not in bc_df.columns:
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

    # Add horizontal segment columns so _extract_bos_choch_segments can draw them.
    segment_cols = []
    if include_BoS and bos_col in bc_df.columns:
        df[bos_col] = bc_df[bos_col].values
        segment_cols.append(bos_col)
    if include_CHoCH and choch_col in bc_df.columns:
        df[choch_col] = bc_df[choch_col].values
        segment_cols.append(choch_col)
    if segment_cols:
        if price_col in bc_df.columns:
            df[price_col] = bc_df[price_col].values
            segment_cols.append(price_col)
        if break_col in bc_df.columns:
            df[break_col] = bc_df[break_col].values
            segment_cols.append(break_col)

    df.set_index('date', inplace=True)
    all_output_cols = list(result.keys()) + segment_cols
    return df[all_output_cols] if all_output_cols else df[[]]


def calculate_indicator(df, **params):
    return calculate_aVWAP_BoS_CHoCH(df, **params)
