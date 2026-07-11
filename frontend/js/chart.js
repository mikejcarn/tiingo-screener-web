/**
 * chart.js — lightweight-charts wrapper
 *
 * Two rendering paths:
 *   Static  — server-sent pre-computed values (SMA, Supertrend, etc.)
 *             styled by col_styles and rendered via LineSeries.setData per reveal.
 *   Dynamic — aVWAP lines computed bar-by-bar by DynamicVWAPEngine
 *             (peaks, valleys, QQEMOD anchors).
 */

import { DynamicVWAPEngine } from './avwap_replay.js';

const C_UP   = 'rgba(38,166,154,1)';
const C_DOWN = 'rgba(239,83,80,1)';

export class ChartManager {
  constructor(container) {
    this._container = container;
    this._chart     = null;
    this._candles   = null;
    this._lines     = {};   // col → static LineSeries
    this._engine    = null; // DynamicVWAPEngine
    this._bars      = [];
    this._N         = 0;
    this._curN      = -1;   // last bar rendered
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

  // ── Static series setup ────────────────────��─────────────────────��────────

  /**
   * Load bars and create static indicator series from server-sent styles.
   * @param {object[]} bars
   * @param {object}   styles  — {col: {color, width, lineStyle}} from server
   */
  load(bars, styles = {}) {
    this._bars = bars;
    this._N    = bars.length;

    // Remove old static series
    for (const s of Object.values(this._lines)) {
      this._chart.removeSeries(s);
    }
    this._lines = {};

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

    // (Re)create dynamic VWAP engine — attached to raw LW chart
    if (this._engine) this._engine.destroy();
    this._engine = new DynamicVWAPEngine(this._chart);

    this._curN = -1;
    this.reveal(this._N - 1);
  }

  // ── Dynamic events setup ─────────────────────────────────────────────────

  /**
   * Called once after bars are loaded, when the server sends replay_events.
   * @param {object} events  — {peaks, valleys, max_peaks, max_valleys, qqemod_events, max_qqemod}
   */
  loadEvents(events) {
    if (!this._engine) return;
    this._engine.load(this._bars, events);
    // Re-render at current position so dynamic lines appear immediately
    if (this._curN >= 0) this._engine.reveal(this._curN);
  }

  // ── Reveal ───────────────────────────────────────────────────────────────

  reveal(n) {
    n = Math.max(0, Math.min(this._N - 1, n));
    const slice = this._bars.slice(0, n + 1);
    if (!slice.length) return;
    this._curN = n;

    // ── Candles with per-bar color overrides from the `color` column ────────
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

    // ── Static indicator lines (null-safe) ────────────���─────────────────────
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

    // ── Dynamic VWAP lines ────────────��────────────────────────────────────���─
    if (this._engine) this._engine.reveal(n);
  }

  fitContent() {
    if (this._chart) this._chart.timeScale().fitContent();
  }

  destroy() {
    if (this._engine) { this._engine.destroy(); this._engine = null; }
    if (this._chart)  { this._chart.remove(); this._chart = null; this._candles = null; }
    this._lines = {};
    this._bars  = [];
    this._N     = 0;
    this._curN  = -1;
  }

  get total() { return this._N; }
}
