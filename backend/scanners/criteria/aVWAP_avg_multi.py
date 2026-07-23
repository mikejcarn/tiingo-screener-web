import pandas as pd
from typing import Literal, List

display_name = "aVWAP Multi-Average"
param_schema = {
    'mode': {'label': 'Average type', 'type': 'select',
             'options': ['combined', 'peaks', 'valleys'], 'default': 'combined'},
    'condition': {'label': 'Condition', 'type': 'select',
                  'options': ['stacked_bullish', 'stacked_bearish', 'crossover',
                              'fan_bullish', 'fan_bearish', 'compression', 'expansion',
                              'fast_above_slow', 'fast_below_slow', 'ribbon_compact', 'ribbon_wide'],
                  'default': 'stacked_bullish'},
    'threshold_pct':  {'label': 'Threshold %',      'type': 'number', 'default': 2.0, 'min': 0.0},
    'lookback_bars':  {'label': 'Lookback bars',     'type': 'int',    'default': 5,   'min': 1},
    'confirmation_bars': {'label': 'Confirmation bars', 'type': 'int', 'default': 1,   'min': 1},
}

_BASE = {'combined': 'Peaks_Valleys_avg', 'peaks': 'Peaks_avg', 'valleys': 'Valleys_avg'}


def aVWAP_avg_multi(df: pd.DataFrame, mode: str = 'combined',
                    condition: str = 'stacked_bullish',
                    slow_idx: int = 0, fast_idx: int = -1,
                    threshold_pct: float = 2.0,
                    lookback_bars: int = 5,
                    confirmation_bars: int = 1) -> pd.DataFrame:
    if len(df) == 0:
        return pd.DataFrame()
    base_col = _BASE.get(mode)
    if not base_col:
        return pd.DataFrame()

    sorted_cols = sorted([c for c in df.columns if c.startswith(base_col)],
                         key=lambda x: (x != base_col, x))
    if not sorted_cols:
        return pd.DataFrame()

    latest = df.iloc[-1]
    cur = {c: latest[c] for c in sorted_cols if pd.notna(latest.get(c))}
    if len(cur) < 2:
        return pd.DataFrame()
    vals = [cur[c] for c in sorted_cols if c in cur]

    slow_col = sorted_cols[slow_idx if slow_idx >= 0 else 0]
    fast_col = sorted_cols[fast_idx if fast_idx >= 0 else len(sorted_cols) - 1]

    # ── ribbon_compact / ribbon_wide ──────────────────────────
    if condition in ('ribbon_compact', 'ribbon_wide'):
        all_v = list(cur.values())
        mean_v = sum(all_v) / len(all_v)
        spread_pct = (max(all_v) - min(all_v)) / mean_v * 100
        ok = spread_pct <= threshold_pct if condition == 'ribbon_compact' else spread_pct > threshold_pct
        if ok:
            row = df.iloc[-1:].copy()
            row['Signal']     = f'{mode.upper()}_{condition.upper()}'
            row['Spread_Pct'] = spread_pct
            return row
        return pd.DataFrame()

    # ── crossover ─────────────────────────────────────────────
    if condition == 'crossover':
        if len(df) < 2:
            return pd.DataFrame()
        prev = df.iloc[-2]
        if any(pd.isna(v) for v in [latest.get(fast_col), latest.get(slow_col),
                                     prev.get(fast_col), prev.get(slow_col)]):
            return pd.DataFrame()
        cf, cs = float(latest[fast_col]), float(latest[slow_col])
        pf, ps = float(prev[fast_col]),   float(prev[slow_col])
        if pf <= ps and cf > cs:
            sig = 'CROSSOVER_BULLISH'
        elif pf >= ps and cf < cs:
            sig = 'CROSSOVER_BEARISH'
        else:
            return pd.DataFrame()
        row = df.iloc[-1:].copy()
        row['Signal'] = f'{mode.upper()}_{sig}'
        return row

    # ── fan_bullish / fan_bearish ──────────────────────────────
    if condition in ('fan_bullish', 'fan_bearish'):
        if len(df) <= lookback_bars:
            return pd.DataFrame()
        past = df.iloc[-lookback_bars - 1]
        if condition == 'fan_bullish':
            ok = all(pd.notna(latest.get(c)) and pd.notna(past.get(c)) and latest[c] > past[c]
                     for c in sorted_cols)
        else:
            ok = all(pd.notna(latest.get(c)) and pd.notna(past.get(c)) and latest[c] < past[c]
                     for c in sorted_cols)
        if ok:
            row = df.iloc[-1:].copy()
            row['Signal'] = f'{mode.upper()}_{condition.upper()}'
            return row
        return pd.DataFrame()

    # ── compression / expansion ───────────────────────────────
    if condition in ('compression', 'expansion'):
        if len(df) <= lookback_bars:
            return pd.DataFrame()
        past = df.iloc[-lookback_bars - 1]
        past_vals = [past[c] for c in sorted_cols if pd.notna(past.get(c))]
        if len(past_vals) < 2:
            return pd.DataFrame()
        cur_spread  = (max(vals) - min(vals)) / latest['Close'] * 100
        past_spread = (max(past_vals) - min(past_vals)) / past['Close'] * 100
        if condition == 'compression':
            ok = cur_spread < past_spread * (1 - threshold_pct / 100)
        else:
            ok = cur_spread > past_spread * (1 + threshold_pct / 100)
        if ok:
            row = df.iloc[-1:].copy()
            row['Signal'] = f'{mode.upper()}_{condition.upper()}'
            return row
        return pd.DataFrame()

    # ── stacked / fast_above / fast_below with confirmation ───
    def _check_bar(row_vals):
        if condition == 'stacked_bullish':
            return all(row_vals[i] < row_vals[i + 1] for i in range(len(row_vals) - 1))
        if condition == 'stacked_bearish':
            return all(row_vals[i] > row_vals[i + 1] for i in range(len(row_vals) - 1))
        if condition == 'fast_above_slow':
            sv = cur.get(slow_col); fv = cur.get(fast_col)
            return sv is not None and fv is not None and fv > sv
        if condition == 'fast_below_slow':
            sv = cur.get(slow_col); fv = cur.get(fast_col)
            return sv is not None and fv is not None and fv < sv
        return False

    if len(df) < confirmation_bars:
        return pd.DataFrame()
    confirmed = all(
        _check_bar([df.iloc[-(i + 1)][c] for c in sorted_cols
                    if pd.notna(df.iloc[-(i + 1)].get(c))])
        for i in range(confirmation_bars)
    )
    if confirmed:
        row = df.iloc[-1:].copy()
        row['Signal'] = f'{mode.upper()}_{condition.upper()}'
        return row
    return pd.DataFrame()


def calculate_indicator(df, **params):
    return aVWAP_avg_multi(df, **params)
