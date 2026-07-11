"""
Column style resolver — determines how each indicator column should be rendered.
Ported from tiingo-screener-python/src/visualization/src/replay/export_html.py.

Returns {col: {color, width, lineStyle}} where lineStyle is the lightweight-charts
numeric value (0=solid, 1=dotted, 2=dashed, 3=large_dashed, 4=sparse_dotted).
Only columns present in the returned dict should be drawn.
"""
import re
from backend.core.color_palette import get_color_palette

_LW = {'solid': 0, 'dotted': 1, 'dashed': 2, 'large_dashed': 3, 'sparse_dotted': 4}


def _cfg_idx(col: str) -> int:
    m = re.search(r'_c(\d+)_', col)
    return int(m.group(1)) if m else 0


def col_styles_for_columns(columns: list) -> dict:
    """
    Returns render-style dict for every column that belongs on the price chart.
    Columns absent from the result (flags, oscillators, segments) are skipped.
    """
    colors = get_color_palette()
    styles = {}

    def _add(col, color, width, style='solid'):
        styles[col] = {'color': color, 'width': width, 'lineStyle': _LW.get(style, 0)}

    def _w(cfg): return 2 if cfg == 0 else 1
    def _s(cfg): return 'solid' if cfg == 0 else 'dotted'

    for col in columns:
        cfg = _cfg_idx(col)

        # aVWAP_QQEMOD_*, aVWAP_peak_*, aVWAP_valley_* are handled by the
        # client-side DynamicVWAPEngine (replay_events).  Skip static rendering.
        if (col.startswith('aVWAP_QQEMOD_')
                or col.startswith('aVWAP_peak_')
                or col.startswith('aVWAP_valley_')):
            continue

        # ── aVWAP pinch ──────────────────────────────────────────────────────
        if col.startswith('aVWAP_pinch_peak_'):
            _add(col, colors['red_trans_3'],  1)
        elif col.startswith('aVWAP_pinch_valley_'):
            _add(col, colors['teal_trans_3'], 1)
        elif col.startswith('aVWAP_pinch_above_'):
            _add(col, colors['teal_trans_2'], 1, 'dotted')
        elif col.startswith('aVWAP_pinch_below_'):
            _add(col, colors['red_trans_2'],  1, 'dotted')

        # ── aVWAP anchor score (peaks / valleys) ────────────────────────────
        elif col.startswith('aVWAP_peak_'):
            _add(col, colors['red_trans_3'],  _w(cfg), _s(cfg))
        elif col.startswith('aVWAP_valley_'):
            _add(col, colors['teal_trans_3'], _w(cfg), _s(cfg))

        # ── aVWAP BoS / CHoCH ────────────────────────────────────────────────
        elif col.startswith('aVWAP_BoS_bear_'):
            _add(col, colors['red_trans_3'],  _w(cfg), _s(cfg))
        elif col.startswith('aVWAP_BoS_bull_'):
            _add(col, colors['teal_trans_3'], _w(cfg), _s(cfg))
        elif col.startswith('aVWAP_CHoCH_bear_'):
            _add(col, colors['red_trans_2'],  _w(cfg), _s(cfg))
        elif col.startswith('aVWAP_CHoCH_bull_'):
            _add(col, colors['teal_trans_2'], _w(cfg), _s(cfg))

        # ── aVWAP OB ─────────────────────────────────────────────────────────
        elif col.startswith('aVWAP_OB_bull_ghost_'):
            _add(col, colors['teal_OB_ghost'], 1)
        elif col.startswith('aVWAP_OB_bear_ghost_'):
            _add(col, colors['red_OB_ghost'],  1)
        elif col.startswith('aVWAP_OB_bull_'):
            _add(col, colors['teal_OB'], _w(cfg), _s(cfg))
        elif col.startswith('aVWAP_OB_bear_'):
            _add(col, colors['red_OB'],  _w(cfg), _s(cfg))

        # ── aVWAP gap ────────────────────────────────────────────────────────
        elif col.startswith('Gap_Up_aVWAP_'):
            _add(col, colors['teal_trans_2'], _w(cfg), _s(cfg))
        elif col.startswith('Gap_Down_aVWAP_'):
            _add(col, colors['red_trans_2'],  _w(cfg), _s(cfg))

        # ── Composite average lines ──────────────────────────────────────────
        elif col.startswith('Peaks_Valleys_avg'):
            mc = [c for c in columns if c.startswith('Peaks_Valleys_avg')]
            _add(col, colors['orange_aVWAP'], 4 if (col == 'Peaks_Valleys_avg' and len(mc) > 1) else 2)
        elif col.startswith('Peaks_avg'):
            mc = [c for c in columns if c.startswith('Peaks_avg')]
            _add(col, colors['red'],  4 if (col == 'Peaks_avg' and len(mc) > 1) else 2)
        elif col.startswith('Valleys_avg'):
            mc = [c for c in columns if c.startswith('Valleys_avg')]
            _add(col, colors['teal'], 4 if (col == 'Valleys_avg' and len(mc) > 1) else 2)
        elif col.startswith('OB_avg'):
            mc = [c for c in columns if c.startswith('OB_avg')]
            _add(col, colors['orange_aVWAP'], 3 if (col == 'OB_avg' and len(mc) > 1) else 2, 'dashed')
        elif col.startswith('Gaps_avg'):
            mc = [c for c in columns if c.startswith('Gaps_avg')]
            _add(col, colors['orange_aVWAP'], 4 if (col == 'Gaps_avg' and len(mc) > 1) else 2, 'dotted')
        elif col.startswith('BoS_CHoCH_avg'):
            mc = [c for c in columns if c.startswith('BoS_CHoCH_avg')]
            _add(col, colors['orange_aVWAP'], 3 if (col == 'BoS_CHoCH_avg' and len(mc) > 1) else 2, 'large_dashed')
        elif col.startswith('QQEMOD_avg'):
            mc = [c for c in columns if c.startswith('QQEMOD_avg')]
            _add(col, colors['orange_aVWAP'], 3 if (col == 'QQEMOD_avg' and len(mc) > 1) else 2)
        elif col.startswith('All_avg'):
            mc = [c for c in columns if c.startswith('All_avg')]
            _add(col, colors['gray_trans'], 5 if (col == 'All_avg' and len(mc) > 1) else 3)

        # ── SMA ──────────────────────────────────────────────────────────────
        elif col.startswith('SMA_'):
            try:
                period = int(col.split('_')[1])
            except Exception:
                period = 0
            w = 1 if period <= 10 else 2 if period <= 50 else 3 if period <= 100 else 4 if period <= 200 else 5
            _add(col, colors['blue_SMA'], w)

        # ── Supertrend ───────────────────────────────────────────────────────
        elif col in ('Supertrend_Upper', 'Supertrend_Lower'):
            _add(col, colors['orange'], 1)

    return styles
