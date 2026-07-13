/**
 * chart.js — lightweight-charts wrapper
 *
 * Rendering paths:
 *   Static   — pre-computed server values (SMA, etc.) styled via col_styles,
 *              one LineSeries per column, setData on every reveal.
 *   Supertrend — synthetic two-series split: teal when uptrend (lower band),
 *              red when downtrend (upper band). Computed from Supertrend_Direction.
 *   Dynamic  — aVWAP lines (peaks, valleys, QQEMOD) via DynamicVWAPEngine.
 *   Segments — FVG, OB, BoS/CHoCH, Liquidity horizontal line segments.
 *              One pre-allocated LineSeries per event; dirty-checked per bar.
 */

import { DynamicVWAPEngine } from './avwap_replay.js';

const C_UP   = 'rgba(38,166,154,1)';
const C_DOWN = 'rgba(239,83,80,1)';

// Segment colours
const SEG_COLORS = {
  fvg_bull:   'rgba(38,166,154,0.7)',
  fvg_bear:   'rgba(239,83,80,0.7)',
  ob_bull:    'rgba(38,166,154,0.8)',
  ob_bear:    'rgba(239,83,80,0.8)',
  bos_bull:   'rgba(38,166,154,0.9)',
  bos_bear:   'rgba(239,83,80,0.9)',
  choch_bull: 'rgba(38,166,154,0.45)',
  choch_bear: 'rgba(239,83,80,0.45)',
  liq_bull:   'rgba(255,165,0,0.8)',
  liq_bear:   'rgba(255,165,0,0.8)',
};

// Segment line widths and styles (match original app)
const SEG_WIDTH  = { fvg: 1, ob: 8, bos: 1, liq: 1 };
const SEG_LSTYLE = { fvg: 2, ob: 0, bos: 0, liq: 0 };  // 0=solid, 2=dashed

export class ChartManager {
  constructor(container) {
    this._container = container;
    this._chart     = null;
    this._candles   = null;
    this._lines     = {};      // col -> static LineSeries
    this._engine    = null;    // DynamicVWAPEngine
    this._stLine    = null;    // Supertrend — single series, per-point color
    this._segSeries = {};      // type -> LineSeries[]
    this._segEvents = {};      // type -> event[]
    this._segKeys   = {};      // type -> number[] (dirty-check)
    this._bars      = [];
    this._N         = 0;
    this._curN      = -1;
    this._init();
  }

  _init() {
    this._chart = LightweightCharts.createChart(this._container, {
      layout:          { background: { color: '#000000' }, textColor: '#555555' },
      grid:            { vertLines: { color: '#111111' }, horzLines: { color: '#111111' } },
      crosshair:       { mode: LightweightCharts.CrosshairMode.Normal },
      rightPriceScale: { borderColor: '#222222' },
      timeScale:       { borderColor: '#222222', timeVisible: true },
    });

    this._candles = this._chart.addCandlestickSeries({
      upColor:        C_UP,   downColor:       C_DOWN,
      borderUpColor:  C_UP,   borderDownColor: C_DOWN,
      wickUpColor:    C_UP,   wickDownColor:   C_DOWN,
    });

    window.addEventListener('resize', () => {
      if (this._chart) {
        this._chart.resize(this._container.clientWidth, this._container.clientHeight);
      }
    });
  }

  // ── Static + Supertrend series setup ────────────────────────────────────

  load(bars, styles = {}) {
    this._bars = bars;
    this._N    = bars.length;

    // Remove old static series
    for (const s of Object.values(this._lines)) this._chart.removeSeries(s);
    this._lines = {};

    // Remove old Supertrend series
    if (this._stLine) { try { this._chart.removeSeries(this._stLine); } catch (_) {} this._stLine = null; }

    // Remove old segment series
    this._destroySegments();

    // Create one LineSeries per styled column
    for (const [col, st] of Object.entries(styles)) {
      this._lines[col] = this._chart.addLineSeries({
        color:                  st.color,
        lineWidth:              st.width,
        lineStyle:              st.lineStyle,
        priceLineVisible:       false,
        lastValueVisible:       false,
        crosshairMarkerVisible: false,
      });
    }

    // Supertrend: single series with per-point color (teal = uptrend, red = downtrend)
    if (bars.length > 0 && 'Supertrend_Direction' in bars[0]) {
      this._stLine = this._chart.addLineSeries({
        lineWidth: 2,
        priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
      });
    }

    // (Re)create dynamic VWAP engine
    if (this._engine) this._engine.destroy();
    this._engine = new DynamicVWAPEngine(this._chart);

    this._curN = -1;
    this.reveal(this._N - 1);
  }

  // ── Dynamic events + segment setup ──────────────────────────────────────

  loadEvents(events) {
    if (!this._engine) return;
    this._engine.load(this._bars, events);

    // Destroy any previous segment series and rebuild from new events
    this._destroySegments();
    this._buildSegments(events);

    if (this._curN >= 0) {
      this._engine.reveal(this._curN);
      this._revealSegments(this._curN);
    }
  }

  // ── Reveal ───────────────────────────────────────────────────────────────

  reveal(n) {
    n = Math.max(0, Math.min(this._N - 1, n));
    const slice = this._bars.slice(0, n + 1);
    if (!slice.length) return;
    this._curN = n;

    // Candles with per-bar color overrides
    const candles = slice.map(b => {
      const time  = (b.Date || b.date || '').slice(0, 10);
      const entry = {
        time,
        open:  b.Open  ?? b.open,
        high:  b.High  ?? b.high,
        low:   b.Low   ?? b.low,
        close: b.Close ?? b.close,
      };
      const clr = b.color;
      if (clr && clr !== '#000000') {
        const opaque = clr.replace(/rgba\((\d+),\s*(\d+),\s*(\d+),[^)]+\)/, 'rgba($1,$2,$3,1.0)');
        entry.color       = clr;
        entry.borderColor = opaque;
        entry.wickColor   = opaque;
      } else if (clr === '#000000') {
        const ud = entry.close >= entry.open;
        entry.color       = 'rgba(0,0,0,0)';
        entry.borderColor = ud ? C_UP : C_DOWN;
        entry.wickColor   = ud ? C_UP : C_DOWN;
      }
      return entry;
    });
    this._candles.setData(candles);

    // Static indicator lines
    for (const [col, series] of Object.entries(this._lines)) {
      const data = [];
      for (const b of slice) {
        const v = b[col];
        if (v != null && !Number.isNaN(v)) {
          data.push({ time: (b.Date || b.date || '').slice(0, 10), value: v });
        }
      }
      series.setData(data);
    }

    // Supertrend — single line, per-point color switches at direction changes
    if (this._stLine) {
      const stData = [];
      for (const b of slice) {
        const time = (b.Date || b.date || '').slice(0, 10);
        const dir  = b.Supertrend_Direction;
        const up   = b.Supertrend_Lower;
        const dn   = b.Supertrend_Upper;
        if (dir == null) continue;
        const val = dir >= 0 ? up : dn;
        if (val == null || Number.isNaN(val)) continue;
        stData.push({ time, value: val, color: dir >= 0 ? C_UP : C_DOWN });
      }
      this._stLine.setData(stData);
    }

    // Dynamic VWAP engine
    if (this._engine) this._engine.reveal(n);

    // Segment indicators
    this._revealSegments(n);
  }

  // ── Segment helpers ──────────────────────────────────────────────────────

  _segColor(type, ev) {
    if (type === 'fvg')  return ev.dir === 'bull' ? SEG_COLORS.fvg_bull  : SEG_COLORS.fvg_bear;
    if (type === 'ob')   return ev.dir === 'bull' ? SEG_COLORS.ob_bull   : SEG_COLORS.ob_bear;
    if (type === 'liq')  return ev.dir === 'bull' ? SEG_COLORS.liq_bull  : SEG_COLORS.liq_bear;
    if (type === 'bos')  {
      const isBos = ev.sig === 'bos' || ev.sig === undefined;
      return ev.dir === 'bull'
        ? (isBos ? SEG_COLORS.bos_bull  : SEG_COLORS.choch_bull)
        : (isBos ? SEG_COLORS.bos_bear  : SEG_COLORS.choch_bear);
    }
    return 'rgba(150,150,150,0.6)';
  }

  _buildSegments(events) {
    this._segSeries = {};
    this._segEvents = {};
    this._segKeys   = {};

    for (const type of ['fvg', 'ob', 'bos', 'liq']) {
      const evts = events[type] || [];
      this._segEvents[type] = evts;
      this._segSeries[type] = [];
      this._segKeys[type]   = new Array(evts.length).fill(-2);

      for (const ev of evts) {
        this._segSeries[type].push(this._chart.addLineSeries({
          color:                  this._segColor(type, ev),
          lineWidth:              SEG_WIDTH[type]  || 1,
          lineStyle:              SEG_LSTYLE[type] || 0,
          priceLineVisible:       false,
          lastValueVisible:       false,
          crosshairMarkerVisible: false,
        }));
      }
    }
  }

  _revealSegments(n) {
    for (const type of ['fvg', 'ob', 'bos', 'liq']) {
      const evts   = this._segEvents[type];
      const series = this._segSeries[type];
      const keys   = this._segKeys[type];
      if (!evts) continue;

      for (let i = 0; i < evts.length; i++) {
        const ev  = evts[i];
        const vf  = ev.vf ?? ev.s;    // visible_from (default = start bar)

        let key;
        if (n < vf) {
          key = -2;                    // not yet visible
        } else if (ev.da !== undefined && n >= ev.da) {
          key = -1;                    // displaced / off the cap
        } else {
          const endBar = Math.min(ev.e, n);
          key = endBar > ev.s ? endBar : -2;  // need at least 2 distinct timestamps
        }

        if (key === keys[i]) continue;
        keys[i] = key;

        if (key < 0) {
          series[i].setData([]);
        } else {
          const startTime = (this._bars[ev.s].Date || this._bars[ev.s].date || '').slice(0, 10);
          const endTime   = (this._bars[key].Date  || this._bars[key].date  || '').slice(0, 10);
          series[i].setData([
            { time: startTime, value: ev.p },
            { time: endTime,   value: ev.p },
          ]);
        }
      }
    }
  }

  _destroySegments() {
    for (const seriesList of Object.values(this._segSeries)) {
      for (const s of seriesList) {
        try { this._chart.removeSeries(s); } catch (_) {}
      }
    }
    this._segSeries = {};
    this._segEvents = {};
    this._segKeys   = {};
  }

  // ── Utilities ────────────────────────────────────────────────────────────

  fitContent() {
    if (this._chart) this._chart.timeScale().fitContent();
  }

  logicalAtX(x) {
    if (!this._chart) return null;
    return this._chart.timeScale().coordinateToLogical(x);
  }

  getVisibleRange() {
    if (!this._chart) return null;
    return this._chart.timeScale().getVisibleRange();
  }

  setVisibleRange(from, to) {
    if (!this._chart) return;
    try { this._chart.timeScale().setVisibleRange({ from, to }); } catch (_) {}
  }

  destroy() {
    this._destroySegments();
    if (this._engine)  { this._engine.destroy(); this._engine = null; }
    if (this._stLine)  { try { this._chart.removeSeries(this._stLine); } catch (_) {} this._stLine = null; }
    if (this._chart)  { this._chart.remove(); this._chart = null; this._candles = null; }
    this._lines = {};
    this._bars  = [];
    this._N     = 0;
    this._curN  = -1;
  }

  get total() { return this._N; }
}
