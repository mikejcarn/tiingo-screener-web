import pandas as pd

display_name = "aVWAP Min/Max Bias"
required_columns = ['aVWAP_max_*', 'aVWAP_min_*']
param_schema = {
    'bias_direction': {'label': 'Bias', 'type': 'select',
                       'options': ['bullish', 'bearish', 'either'], 'default': 'either'},
    'min_bias_pct':   {'label': 'Minimum bias %', 'type': 'number', 'default': 20.0, 'min': 0.0, 'max': 100.0},
}


def aVWAP_minmax_bias(df: pd.DataFrame, bias_direction: str = 'either', min_bias_pct: float = 20.0) -> pd.DataFrame:
    if len(df) == 0:
        return pd.DataFrame()

    # aVWAP_min_* lines anchor at swing lows (support / bullish structure);
    # aVWAP_max_* lines anchor at swing highs (resistance / bearish structure).
    bull_cols = [c for c in df.columns if c.startswith('aVWAP_min_')]
    bear_cols = [c for c in df.columns if c.startswith('aVWAP_max_')]
    if not bull_cols or not bear_cols:
        return pd.DataFrame()

    # "Length" of a line = how many bars it spans (non-null count), since each
    # column is NaN before its anchor bar and populated from there to the end —
    # a line anchored further back covers more of the chart, i.e. that side's
    # structure has been running for longer.
    bull_len = sum(df[c].notna().sum() for c in bull_cols)
    bear_len = sum(df[c].notna().sum() for c in bear_cols)
    total = bull_len + bear_len
    if total == 0:
        return pd.DataFrame()

    bias_pct = (bull_len - bear_len) / total * 100  # +100 = fully bullish, -100 = fully bearish

    if bias_direction == 'bullish':
        ok = bias_pct >= min_bias_pct
    elif bias_direction == 'bearish':
        ok = bias_pct <= -min_bias_pct
    else:  # either
        ok = abs(bias_pct) >= min_bias_pct

    if ok:
        row = df.iloc[-1:].copy()
        row['Signal']       = 'aVWAP_minmax_bullish' if bias_pct > 0 else 'aVWAP_minmax_bearish'
        row['Bullish_Bars'] = int(bull_len)
        row['Bearish_Bars'] = int(bear_len)
        row['Bias_Pct']     = bias_pct
        return row
    return pd.DataFrame()


def calculate_indicator(df, **params):
    return aVWAP_minmax_bias(df, **params)
