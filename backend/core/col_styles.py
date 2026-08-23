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

    def _bfit_rank(col):
        m = re.search(r'_r(\d+)_avwap$', col)
        return int(m.group(1)) if m else 1

    # Interpolate across however many ranks actually exist in THIS config's
    # output (top_n varies), rather than fixed per-rank steps that bottom out
    # after 3-4 ranks and leave every rank past that visually identical.
    _bfit_ranks = [_bfit_rank(c) for c in columns if c.startswith('BFIT_') and c.endswith('_avwap')]
    _bfit_max_rank = max(_bfit_ranks) if _bfit_ranks else 1

    def _bfit_t(rank):
        return (rank - 1) / (_bfit_max_rank - 1) if _bfit_max_rank > 1 else 0.0

    def _bfit_alpha(rank): return round(0.9 - (0.9 - 0.4) * _bfit_t(rank), 2)
    def _bfit_width(rank): return max(1, round(3 - 2 * _bfit_t(rank)))

    for col in columns:
        cfg = _cfg_idx(col)

        # Divergence signals rendered as candle markers; oscillator values are
        # subplot indicators — neither belongs on the price chart as a line.
        if (col.endswith('_Regular_Bullish') or col.endswith('_Regular_Bearish')
                or col.endswith('_Hidden_Bullish') or col.endswith('_Hidden_Bearish')):
            continue
        if col in ('RSI', 'MACD', 'Signal', 'Histogram', 'OBV', 'OBV_Smoothed',
                   'ATR', 'Fisher', 'Fisher_Signal', 'Fractal_Energy',
                   'MFI', 'Momentum', 'Momentum_Smoothed',
                   'Stoch_%K', 'Stoch_%D', 'VI_plus', 'VI_minus', 'Volume_MA'):
            continue

        # These column types are all handled by the client-side DynamicVWAPEngine
        # via replay_events — skip static rendering entirely.
        if (col.startswith('aVWAP_QQEMOD_')
                or col.startswith('aVWAP_peak_')
                or col.startswith('aVWAP_valley_')
                or col.startswith('aVWAP_OB_')          # OB aVWAPs (incl. ghost)
                or col.startswith('aVWAP_BoS_')         # BoS aVWAPs
                or col.startswith('aVWAP_CHoCH_')       # CHoCH aVWAPs
                or col.startswith('Gap_Up_aVWAP_')      # Gap aVWAPs
                or col.startswith('Gap_Down_aVWAP_')
                or col.startswith('aVWAP_price_maxima_minima_')   # PMM aVWAPs
                or col.startswith('aVWAP_max_')
                or col.startswith('aVWAP_min_')):
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

        # ── ZScore bands ─────────────────────────────────────────────────────
        elif col == 'ZScore_Mean':
            _add(col, 'rgba(250,250,0,0.75)', 2, 'solid')
        elif col.startswith('ZScore_Upper_') or col.startswith('ZScore_Lower_'):
            _add(col, 'rgba(250,250,0,0.35)', 1, 'dashed')

        # POC_* columns are rendered as segment events — skip static line series

        # ── SMA ──────────────────────────────────────────────────────────────
        elif col.startswith('SMA_'):
            try:
                period = int(col.split('_')[1])
            except Exception:
                period = 0
            w = 1 if period <= 10 else 2 if period <= 50 else 3 if period <= 100 else 4 if period <= 200 else 5
            _add(col, colors['blue_SMA'], w)

        # Supertrend_Upper/Lower/Direction are rendered as a synthetic active
        # line in chart.js (teal below price in uptrend, red above in downtrend).
        # Skip static rendering here.
        elif col in ('Supertrend_Upper', 'Supertrend_Lower', 'Supertrend_Direction'):
            continue

        # ── aVWAP Best Fit — anchors ranked by volume-crossing fraction ─────
        # Rank (parsed from the column name's _r{n}_ suffix) drives width and
        # opacity instead of a flat style — rank 1 (highest fraction of its
        # own volume traded near its line) is boldest, fading and thinning as
        # rank gets worse, so the ranking itself is visible at a glance
        # rather than needing the scan/summary columns to tell them apart.
        # BFIT_*_volfrac and BFIT_summary_* are whole-life scores (last bar
        # only) — not price-scaled, stay scan-only. One color for both sides
        # (not the usual red/teal high-low split) — this ranking is agnostic
        # to whether the anchor is a high or a low, it's purely about fit
        # quality, so giving high/low different hues would imply a
        # directional meaning that isn't there.
        elif ((col.startswith('BFIT_high_') or col.startswith('BFIT_low_'))
              and col.endswith('_avwap')):
            rank = _bfit_rank(col)
            _add(col, f'rgba(255,165,0,{_bfit_alpha(rank)})', _bfit_width(rank), 'solid')

    return styles
