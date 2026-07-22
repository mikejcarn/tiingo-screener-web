import pandas as pd
from backend.indicators.indicators import get_indicators
from backend.indicators.indicators_list.aVWAP import calculate_avwap



display_name = "aVWAP — Order Blocks (OB)"
def calculate_aVWAP_OB(
    df,
    periods=25,
    include_bull=True,
    include_bear=True,
    include_OB_lines=False,
    max_aVWAPs=None,
    max_mitigated=None,
    max_unmitigated=None,
    extend_to_end=False,
    faded=False,
):
    """
    Anchor aVWAPs at Order Block bars.

    include_bull:     draw aVWAP lines from bullish OB anchors
    include_bear:     draw aVWAP lines from bearish OB anchors
    include_OB_lines: also output OB horizontal segment columns
    extend_to_end:    if True, aVWAPs run to the last bar (mitigated OBs not truncated)
    faded:            if True, add a ghost extension after the mitigation point

    Output columns:
        aVWAP_OB_bull_c0_{anchor_bar}
        aVWAP_OB_bear_c0_{anchor_bar}
        aVWAP_OB_bull_ghost_c0_{anchor_bar}  (when faded=True and OB is mitigated)
        aVWAP_OB_bear_ghost_c0_{anchor_bar}
        OB, OB_High, OB_Low, OB_Mitigated_Index  (when include_OB_lines=True)
    """
    df = df.reset_index()
    df['date'] = pd.to_datetime(df['date'])

    base_cols = [c for c in ['Open', 'High', 'Low', 'Close', 'Volume', 'date'] if c in df.columns]
    ob_df = get_indicators(df[base_cols].copy(), ['OB'], {'OB': {'periods': periods}})

    if 'OB' not in ob_df.columns:
        df.set_index('date', inplace=True)
        return df[[]]

    mit_col = 'OB_Mitigated_Index'
    has_mit = mit_col in ob_df.columns

    def _pool(val):
        indices = sorted(ob_df[ob_df['OB'] == val].index.tolist(), reverse=True)
        if max_mitigated is not None or max_unmitigated is not None:
            mit_list, unmit_list = [], []
            for idx in indices:
                try:
                    m = int(ob_df.at[idx, mit_col]) if has_mit else 0
                except (ValueError, TypeError):
                    m = 0
                if 0 < m < len(ob_df):
                    mit_list.append(idx)
                else:
                    unmit_list.append(idx)
            kept  = (mit_list[:max_mitigated]   if max_mitigated   is not None else mit_list)
            kept += (unmit_list[:max_unmitigated] if max_unmitigated is not None else unmit_list)
            return kept
        if max_aVWAPs is not None:
            return indices[:max_aVWAPs]
        return indices

    result = {}

    for val, direction in [(1, 'bull'), (-1, 'bear')]:
        if (val == 1 and not include_bull) or (val == -1 and not include_bear):
            continue
        prefix     = f'aVWAP_OB_{direction}_c0'
        ghost_pfx  = f'aVWAP_OB_{direction}_ghost_c0'
        for idx in _pool(val):
            avwap = calculate_avwap(df, idx).copy()
            if has_mit and (not extend_to_end or faded):
                try:
                    mit_val = int(ob_df.at[idx, mit_col])
                except (ValueError, TypeError):
                    mit_val = 0
                if 0 < mit_val < len(df):
                    if extend_to_end and faded:
                        ghost = avwap.copy()
                        ghost[ghost.index < mit_val] = float('nan')
                        result[f'{ghost_pfx}_{idx}'] = ghost
                    avwap[avwap.index > mit_val] = float('nan')
            result[f'{prefix}_{idx}'] = avwap

    for col, series in result.items():
        df[col] = series

    ob_segment_cols = []
    if include_OB_lines:
        for col in ['OB', 'OB_High', 'OB_Low', 'OB_Mitigated_Index']:
            if col in ob_df.columns:
                df[col] = ob_df[col].values
                ob_segment_cols.append(col)

    df.set_index('date', inplace=True)
    all_cols = list(result.keys()) + ob_segment_cols
    return df[all_cols] if all_cols else df[[]]


def calculate_indicator(df, **params):
    return calculate_aVWAP_OB(df, **params)
