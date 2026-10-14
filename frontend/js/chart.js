/**
 * chart.js — lightweight-charts wrapper
 *
 * Rendering paths:
 *   Static   — pre-computed server values (SMA, etc.) styled via col_styles,
 *              one LineSeries per column, setData on every reveal.
 *   Supertrend — synthetic two-series split: teal when uptrend (lower band),
 *              red when downtrend (upper band). Computed from Supertrend_Direction.
 *   Dynamic  — aVWAP lines (peaks, valleys, QQEMOD) via DynamicVWAPEngine.
 *   Segments — BoS/CHoCH horizontal line segments (genuinely single-price-
 *              level events, no zone to recover).
 *              One pre-allocated LineSeries per event; dirty-checked per bar.
 *   Zones    — OB, FVG, Gap, Liquidity: real filled zone rectangles via a
 *              custom series each (real price height, not a fixed-pixel-
 *              thickness line), each styled distinctly (OB solid, FVG
 *              dashed+midline, Gap hatched, Liquidity a precise line over a
 *              faint touch-tolerance band) — see ob_zone_series.js /
 *              fvg_zone_series.js / gap_zone_series.js /
 *              liquidity_zone_series.js, and ZONE_SERIES below.
 *   Volume   — vp: a real volume-at-price histogram per peak/valley anchor,
 *   Profile    drawn as horizontal bars via its own custom series (see
 *              volume_profile_series.js) — handled separately from
 *              ZONE_SERIES below since its data shape (lo/bs/bins) doesn't
 *              fit the shared high/low/dir zone payload.
 */

import { DynamicVWAPEngine } from './avwap_replay.js';
import { OBZoneSeries } from './ob_zone_series.js';
import { FVGZoneSeries } from './fvg_zone_series.js';
import { GapZoneSeries } from './gap_zone_series.js';
import { LiquidityZoneSeries } from './liquidity_zone_series.js';
import { VolumeProfileSeries, RGB_DEFAULT as RGB_VOLUME } from './volume_profile_series.js';
import { cssVar, isDark, onThemeChange } from './theme.js';

// Segment types with a real zone (top/bottom bounds) get a custom series that
// draws the actual filled rectangle instead of the flat-line-at-one-price
// hack every segment type used to use — see ob_zone_series.js/fvg_zone_series.js/
// gap_zone_series.js/liquidity_zone_series.js docstrings. bos is genuinely a
// single-price-level line (no second bound at all), so it stays on the plain
// LineSeries path below.
const ZONE_SERIES = { ob: OBZoneSeries, fvg: FVGZoneSeries, gap: GapZoneSeries, liq: LiquidityZoneSeries };

const C_UP   = 'rgba(38,166,154,1)';
const C_DOWN = 'rgba(239,83,80,1)';
// Volume histogram — its own pane directly below price (a built-in pane
// definition ahead of any oscillator panes, see load()), in the app's volume
// orange (shared with the Volume Profile). Shorter than an oscillator pane
// (VOLUME_PANE_STRETCH vs 1). Shown/hidden by Shift+V, the show/hide panel's
// Volume row, or its own × — all one global setting (replay.js).
const C_VOLUME            = `rgba(${RGB_VOLUME},0.5)`;
const VOLUME_PANE_ID      = '__volume__';
const VOLUME_PANE_STRETCH = 0.6;
// Oscillator panes (oscillators indicator) — height shares as stretch
// factors: each oscillator pane 1, the price pane max(3, 1.5 × pane count),
// so price keeps 75% with one pane and ~60% with several instead of
// shrinking as panes are added. The separators can still be dragged.
const PRICE_PANE_MIN_STRETCH = 3;
const PRICE_PANE_PER_OSC     = 1.5;
const OSC_PANE_STRETCH       = 1;

// Oscillator panes' main line color — the 'fg' token from osc_panes.py:
// off-white on dark, dark grey on light, so the colored divergence lines are
// the only colored strokes in a pane. Re-applied on theme switch.
const PANE_FG = { dark: 'rgba(225,225,218,0.85)', light: 'rgba(60,60,60,0.85)' };
const paneColor = c => c === 'fg' ? PANE_FG[isDark() ? 'dark' : 'light'] : c;

// Oscillator panes' axis labels. Every pane shares one price-axis width —
// the widest label anywhere — so OBV / Volume MA's raw digits
// ('4000000000.00') would widen the axis for all panes, price included.
// Large magnitudes are abbreviated (4.00B, 35.8M, 12.3K); small ones keep
// two decimals exactly as before (RSI 60.50, MACD 3.79).
function compactNumber(v) {
  const a = Math.abs(v);
  // K only from 10,000 up — '4567.00' is no wider than '4.57K' and more exact.
  for (const [div, suffix, min] of [[1e12, 'T', 1e12], [1e9, 'B', 1e9], [1e6, 'M', 1e6], [1e3, 'K', 1e4]]) {
    if (a >= min) {
      const x = v / div, ax = Math.abs(x);
      return x.toFixed(ax >= 100 ? 0 : ax >= 10 ? 1 : 2) + suffix;
    }
  }
  return v.toFixed(2);
}
const PANE_PRICE_FORMAT = { type: 'custom', formatter: compactNumber, minMove: 0.01 };

// Stretch factor every other pane shrinks to while one oscillator pane is
// maximized — effectively zero height, without removing (and rebuilding) them.
const COLLAPSED_PANE_STRETCH = 0.0001;

// Divergence lines inside an oscillator pane (oscillators' show_divergences):
// one segment per divergence, between the oscillator's values at the two
// swings that were compared — the in-pane twin of the price chart's pivot
// lines (same colors). A series primitive on the line the divergences were
// measured on, so prices map through that line's own scale. Segments appear
// once replay reaches their confirmation bar (vf), like the price markers.
class DivLinesPrimitive {
  constructor(lines) {
    this._lines = lines;   // [{t0, v0, t1, v1, vf, bull}]
    this._n = -1;
    const renderer = { draw: target => this._draw(target) };
    this._views = [{ renderer: () => renderer, zOrder: () => 'top' }];
  }
  attached({ chart, series, requestUpdate }) { this._chart = chart; this._series = series; this._request = requestUpdate; }
  detached() { this._chart = this._series = this._request = null; }
  paneViews() { return this._views; }
  setRevealed(n) { if (n !== this._n) { this._n = n; this._request?.(); } }
  _draw(target) {
    if (!this._chart || !this._series) return;
    const ts = this._chart.timeScale();
    target.useMediaCoordinateSpace(({ context: ctx }) => {
      ctx.save();
      ctx.lineWidth = 1.5;
      for (const ln of this._lines) {
        if (ln.vf > this._n) continue;
        const x0 = ts.timeToCoordinate(ln.t0), x1 = ts.timeToCoordinate(ln.t1);
        const y0 = this._series.priceToCoordinate(ln.v0), y1 = this._series.priceToCoordinate(ln.v1);
        if (x0 == null || x1 == null || y0 == null || y1 == null) continue;
        ctx.strokeStyle = ln.bull ? DIV_BULL : DIV_BEAR;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();
      }
      ctx.restore();
    });
  }
}

// Divergence colours — aqua / strong red, distinct from candle teal/salmon
const DIV_BULL         = 'rgba(0,229,255,1)';
const DIV_BULL_HIDDEN  = 'rgba(0,229,255,0.55)';
const DIV_BEAR         = 'rgba(255,50,50,1)';
const DIV_BEAR_HIDDEN  = 'rgba(255,50,50,0.55)';

// Segment colours
// fvg/ob/gap/liq no longer appear here — all four are zone types (see
// ZONE_SERIES below), styled from their own event data (dir/mitigated/
// fillOpacity/zoneOpacity) inside their own ob_zone_series.js/
// fvg_zone_series.js/gap_zone_series.js/liquidity_zone_series.js instead of
// this flat color table.
const SEG_COLORS = {
  bos_bull:   'rgba(38,166,154,0.45)',
  bos_bear:   'rgba(239,83,80,0.45)',
  choch_bull: 'rgba(38,166,154,0.9)',
  choch_bear: 'rgba(239,83,80,0.9)',
};

// Segment line widths and styles (match original app)
const SEG_WIDTH  = { bos: 1 };
const SEG_LSTYLE = { bos: 0 };  // 0=solid, 2=dashed

export class ChartManager {
  constructor(container) {
    this._container = container;
    this._chart     = null;
    this._candles   = null;
    this._lines     = {};      // col -> static LineSeries
    this._paneDefs    = [];    // oscillator pane layouts from the server (osc_panes.py), in order
    this._paneHidden  = new Set(); // pane keys switched off in the show/hide panel
    this._paneSeries  = {};    // col -> series living in an oscillator pane
    this._paneData    = {};    // col -> per-bar data, built once per load, sliced in reveal()
    this._paneDivLines = {};   // pane id -> {target col: [divergence segments]}, built once per load
    this._paneDivPrims = [];   // attached DivLinesPrimitive instances (one per target line)
    this._engine    = null;    // DynamicVWAPEngine
    this._stLine    = null;    // Supertrend — single series, per-point color
    this._segSeries = {};      // type -> LineSeries[]
    this._segEvents = {};      // type -> event[]
    this._segKeys   = {};      // type -> number[] (dirty-check)
    this._pocSeries    = [];    // LineSeries[] — one per POC level
    this._pocData      = null;  // {starts, prices} from events
    this._divMarkers     = [];   // [{b, vf, kind, hidden, label}] from events
    this._divShowLabels  = true;
    this._divShowMarkers = true;
    this._divShowWicks   = true;
    this._divShowCandles = false;
    this._divLineSeries = [];   // LineSeries[] for pivot comparison lines
    this._divLineData   = [];   // [{s, e, p0, p1, vf}]
    this._divLineKeys   = [];   // dirty-check per line
    this._divCandleSeries = null; // overlay series — thick wicks at divergence bars
    this._bars      = [];
    this._N         = 0;
    this._curN      = -1;
    this._tintEnabled = true;  // candle_colors' color/Fill_Color tint — toggled via setIndicatorVisible
    this._measureEl          = null;  // live drag-measure overlay box
    this._measureLabelEl     = null;
    this._measureStartEl     = null;  // starting-price span within the label (neutral color)
    this._measureDeltaEl     = null;  // $ / % change span within the label (up/down color)
    this._measureCurrentLine = null;  // price-line axis marker at the live cursor price
    this._init();
  }

  _chartColors() {
    return {
      bg:     cssVar('--chart-bg')     || '#000',
      text:   cssVar('--chart-text')   || '#aaa',
      grid:   cssVar('--chart-grid')   || '#111',
      border: cssVar('--chart-border') || '#222',
    };
  }

  applyTheme() {
    if (!this._chart) return;
    const c = this._chartColors();
    this._chart.applyOptions({
      layout:          { background: { color: c.bg }, textColor: c.text },
      grid:            { vertLines: { color: c.grid }, horzLines: { color: c.grid } },
      rightPriceScale: { borderColor: c.border },
      timeScale:       { borderColor: c.border },
    });
    this._chart.applyOptions({ layout: { panes: { separatorColor: c.border } } });
    // Theme-dependent pane line colors ('fg').
    for (const pane of this._paneDefs || []) {
      for (const s of pane.series) {
        if (s.color === 'fg') this._paneSeries[s.col]?.applyOptions({ color: paneColor('fg') });
      }
    }
  }

  _init() {
    const c = this._chartColors();
    this._chart = LightweightCharts.createChart(this._container, {
      // attributionLogo off: the TradingView credit the library's license
      // asks for lives in the help panel's footer instead (see help.js).
      layout:          { background: { color: c.bg }, textColor: c.text, attributionLogo: false,
                         panes: { separatorColor: c.border } },
      grid:            { vertLines: { color: c.grid }, horzLines: { color: c.grid } },
      crosshair:       { mode: LightweightCharts.CrosshairMode.Normal },
      // v5.2 default: draw whichever series is under the mouse on top of the
      // rest. On a chart this dense that makes lines jump in front of the
      // candles as the cursor moves — keep v4's fixed drawing order.
      hoveredSeriesOnTop: false,
      rightPriceScale: { borderColor: c.border, scaleMargins: { top: 0.03, bottom: 0.03 } },
      timeScale:       { borderColor: c.border, timeVisible: true },
    });

    this._candles = this._chart.addSeries(LightweightCharts.CandlestickSeries, {
      upColor:        C_UP,   downColor:       C_DOWN,
      borderUpColor:  C_UP,   borderDownColor: C_DOWN,
      wickUpColor:    C_UP,   wickDownColor:   C_DOWN,
    });
    this._candleMarkers = LightweightCharts.createSeriesMarkers(this._candles, []);


    // Overlay series — transparent body, thick wicks/borders at divergence pivot bars
    this._divCandleSeries = this._chart.addSeries(LightweightCharts.CandlestickSeries, {
      upColor:          'rgba(0,0,0,0)',
      downColor:        'rgba(0,0,0,0)',
      borderUpColor:    'rgba(0,0,0,0)',
      borderDownColor:  'rgba(0,0,0,0)',
      wickUpColor:      'rgba(0,0,0,0)',
      wickDownColor:    'rgba(0,0,0,0)',
      wickWidth:        2,
      priceLineVisible:       false,
      lastValueVisible:       false,
      crosshairMarkerVisible: false,
    });

    onThemeChange(() => this.applyTheme());

    window.addEventListener('resize', () => {
      if (this._chart) {
        this._chart.resize(this._container.clientWidth, this._container.clientHeight);
      }
    });
  }

  // ── Static + Supertrend series setup ────────────────────────────────────

  load(bars, styles = {}, panes = []) {
    this._bars = bars;
    this._N    = bars.length;
    this.clearMeasure();

    // Remove old static series
    for (const s of Object.values(this._lines)) this._chart.removeSeries(s);
    this._lines = {};


    // Remove old Supertrend series
    if (this._stLine) { try { this._chart.removeSeries(this._stLine); } catch (_) {} this._stLine = null; }

    // Remove old segment series
    this._destroySegments();

    // Create one LineSeries per styled column
    for (const [col, st] of Object.entries(styles)) {
      this._lines[col] = this._chart.addSeries(LightweightCharts.LineSeries, {
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
      this._stLine = this._chart.addSeries(LightweightCharts.LineSeries, {
        lineWidth: 2,
        priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
      });
    }

    // Oscillator panes — per-bar data built once here (whitespace {time} where
    // a value is missing, so every column's array stays index-aligned with
    // the bars for reveal()'s slice), then the panes themselves.
    this._destroyPanes();
    // Volume first — its own built-in pane right under price.
    const volumePane = {
      id: VOLUME_PANE_ID, key: 'Volume', label: 'Volume', stretch: VOLUME_PANE_STRETCH,
      series: [{ col: VOLUME_PANE_ID, kind: 'histogram', color: C_VOLUME }],
      refs: [], div: [], margins: { top: 0.2, bottom: 0 },
    };
    this._paneDefs = [volumePane, ...(panes || [])];
    this._paneData = {
      [VOLUME_PANE_ID]: bars.map(b => ({ time: (b.Date || b.date || '').slice(0, 10), value: b.Volume ?? b.volume ?? 0 })),
    };
    for (const pane of this._paneDefs) {
      for (const s of pane.series) {
        if (s.col === VOLUME_PANE_ID) continue;
        this._paneData[s.col] = bars.map(b => {
          const time = (b.Date || b.date || '').slice(0, 10);
          const v = b[s.col];
          if (v == null || Number.isNaN(v)) return { time };
          if (s.kind === 'histogram') return { time, value: v, color: v >= 0 ? s.up : s.down };
          // color_vs: per-bar color by which side of a reference line this
          // one is on (MACD signal: red above the MACD line, teal below).
          if (s.color_vs) {
            const ref = b[s.color_vs.ref];
            if (ref != null && !Number.isNaN(ref)) return { time, value: v, color: v > ref ? s.color_vs.above : s.color_vs.below };
          }
          return { time, value: v };
        });
      }
    }
    // Divergence segments per pane, grouped by the line they sit on.
    this._paneDivLines = {};
    const dateOf = b => (b.Date || b.date || '').slice(0, 10);
    for (const pane of this._paneDefs) {
      const byTarget = {};
      for (const d of pane.div || []) {
        for (let i = 0; i < bars.length; i++) {
          const prev = bars[i][d.col];
          if (prev == null || Number.isNaN(prev)) continue;
          if (d.sig && !bars[i][d.sig]) continue;   // divergence source: gated by its signal column
          const v0 = bars[prev]?.[d.target], v1 = bars[i][d.target];
          if (v0 == null || v1 == null) continue;
          (byTarget[d.target] ??= []).push({ t0: dateOf(bars[prev]), v0, t1: dateOf(bars[i]), v1,
                                             vf: i + (pane.div_right ?? 5), bull: d.kind === 'bull' });
        }
      }
      this._paneDivLines[pane.id] = byTarget;
    }
    this._buildPanes();

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
    this._destroyPoc();
    this._buildPoc(events.poc);
    const div = events.divergences || {};
    this._divMarkers     = div.markers      || [];
    this._divShowLabels  = div.show_labels  ?? true;
    this._divShowMarkers = div.show_markers ?? true;
    this._divShowWicks   = div.show_wicks   ?? true;
    this._divShowCandles = div.show_candles ?? false;
    this._destroyDivLines();
    this._buildDivLines(div.lines || [], div.show_pivots ?? false);
    if (this._curN >= 0) {
      this._engine.reveal(this._curN);
      this._revealSegments(this._curN);
      this._revealPoc(this._curN);
      this._revealDivMarkers(this._curN);
      this._revealDivLines(this._curN);
    }
  }

  // ── Reveal ───────────────────────────────────────────────────────────────

  reveal(n) {
    n = Math.max(0, Math.min(this._N - 1, n));
    const slice = this._bars.slice(0, n + 1);
    if (!slice.length) return;
    // lightweight-charts v5 throws ('Value is null') when series data is cut
    // back while the mouse's crosshair sits in the price pane and oscillator
    // panes exist — e.g. double-click / Home / ← to an earlier bar with the
    // cursor over the chart. Clearing the crosshair first avoids it; it
    // reappears on the next mouse move. Only needed when moving backward, so
    // forward playback leaves the crosshair alone.
    if (n < this._curN) this._chart.clearCrosshairPosition();
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
      // candle_colors' entire output (Fill_Color or color) is gated behind
      // _tintEnabled — toggling that indicator off should fall back to plain
      // up/down candles exactly as if candle_colors weren't configured at all.
      // 'Fill_Color' in b (not just truthy) detects a Fill_Color-based mode
      // (RelVolume, aVWAPStDev) even on bars where it's null — outside any
      // selected anchor's range, e.g. before the aVWAP range starts.
      const fillTintActive = this._tintEnabled && ('Fill_Color' in b);
      const fillClr = fillTintActive ? b.Fill_Color : null;
      const clr     = this._tintEnabled ? b.color    : null;
      if (fillClr) {
        // Body-fill-only tint (RelVolume, aVWAPStDev) — border/wick stay on
        // normal up/down coloring so the tint's signal (volume, stdev zone)
        // never overrides whether the candle itself was bullish/bearish.
        const ud = entry.close >= entry.open;
        entry.color       = fillClr;
        entry.borderColor = ud ? C_UP : C_DOWN;
        entry.wickColor   = ud ? C_UP : C_DOWN;
      } else if (fillTintActive) {
        // Same mode, but this bar has no tint (outside the anchor's range) —
        // hollow candle: keep the normal up/down border/wick, empty the
        // fill, so untinted context reads as background instead of visually
        // competing with the tinted zone.
        const ud = entry.close >= entry.open;
        entry.color       = 'rgba(0,0,0,0)';
        entry.borderColor = ud ? C_UP : C_DOWN;
        entry.wickColor   = ud ? C_UP : C_DOWN;
      } else if (clr && clr !== '#000000') {
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
    for (const [col, series] of Object.entries(this._paneSeries)) {
      series.setData(this._paneData[col].slice(0, n + 1));
    }
    for (const { prim } of this._paneDivPrims) prim.setRevealed(n);

    // Static indicator lines. A column can opt into per-point color (e.g.
    // aVWAP_minmax's curve-to-straight coloring) by shipping a same-named
    // '{col}_curvecolor' companion column — generic hook, not specific to
    // any one indicator, same mechanism Supertrend below uses directly.
    for (const [col, series] of Object.entries(this._lines)) {
      const colorCol = col + '_curvecolor';
      const data = [];
      for (const b of slice) {
        const v = b[col];
        if (v != null && !Number.isNaN(v)) {
          const point = { time: (b.Date || b.date || '').slice(0, 10), value: v };
          const c = b[colorCol];
          if (c) point.color = c;
          data.push(point);
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
    this._revealPoc(n);
    this._revealDivMarkers(n);
    this._revealDivLines(n);
  }

  // ── Segment helpers ──────────────────────────────────────────────────────

  _segColor(type, ev) {
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

    for (const type of ['fvg', 'ob', 'bos', 'liq', 'gap', 'vp']) {
      const evts = events[type] || [];
      this._segEvents[type] = evts;
      this._segSeries[type] = [];
      this._segKeys[type]   = new Array(evts.length).fill(-2);

      const ZoneSeriesClass = ZONE_SERIES[type];
      for (const ev of evts) {
        if (type === 'vp') {
          this._segSeries[type].push(this._chart.addCustomSeries(new VolumeProfileSeries(), {
            priceLineVisible: false,
            lastValueVisible: false,
          }));
        } else if (ZoneSeriesClass) {
          this._segSeries[type].push(this._chart.addCustomSeries(new ZoneSeriesClass(), {
            priceLineVisible: false,
            lastValueVisible: false,
          }));
        } else {
          this._segSeries[type].push(this._chart.addSeries(LightweightCharts.LineSeries, {
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
  }

  _revealSegments(n) {
    for (const type of ['fvg', 'ob', 'bos', 'liq', 'gap', 'vp']) {
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
          if (type === 'vp') {
            const payload = {
              lo: ev.lo, bs: ev.bs, bins: ev.bins, dir: ev.dir, fillOpacity: ev.fo ?? 0.4,
              poc: ev.poc, vah: ev.vah, val: ev.val, hvn: ev.hvn, lvn: ev.lvn,
              showHistogram: ev.sh ?? true, directionalColor: ev.dc ?? false,
              barStyle: ev.bst ?? 'bars',
              heatmapEmphasis: ev.hem ?? 'hvn',
              heatmapOpacity: ev.hop ?? 0.85, heatmapContrast: ev.hct ?? 2.0,
              heatmapLocality: ev.hloc ?? 0.0, nodeWindow: ev.nw ?? 2,
              histogramGrayscale: ev.hgs ?? false,
            };
            series[i].setData([
              { time: startTime, ...payload },
              { time: endTime,   ...payload },
            ]);
          } else if (ZONE_SERIES[type]) {
            const fillOpacity = ev.fo ?? 0.32;
            // level/zoneOpacity only matter to LiquidityZoneSeries (its own
            // precise-line-over-a-band rendering) — harmless extra fields on
            // the other zone types' data points, which just ignore them.
            const zoneOpacity = ev.zo ?? 0.15;
            const level = ev.p;
            series[i].setData([
              { time: startTime, high: ev.hi, low: ev.lo, dir: ev.dir, mitigated: !!ev.m, fillOpacity, zoneOpacity, level },
              { time: endTime,   high: ev.hi, low: ev.lo, dir: ev.dir, mitigated: !!ev.m, fillOpacity, zoneOpacity, level },
            ]);
          } else {
            series[i].setData([
              { time: startTime, value: ev.p },
              { time: endTime,   value: ev.p },
            ]);
          }
        }
      }
    }
  }

  // ── POC dynamic flat segments ────────────────────────────────────────────

  _buildPoc(poc) {
    if (!poc || !poc.starts) return;
    this._pocData = poc;
    this._pocSeries = poc.starts.map(() => this._chart.addSeries(LightweightCharts.LineSeries, {
      color:                  'rgba(255,165,0,0.35)',
      lineWidth:              4,
      lineStyle:              0,
      priceLineVisible:       false,
      lastValueVisible:       false,
      crosshairMarkerVisible: false,
    }));
  }

  _revealPoc(n) {
    if (!this._pocData || !this._pocSeries.length) return;
    const { starts, prices } = this._pocData;
    for (let i = 0; i < this._pocSeries.length; i++) {
      const start = starts[i];
      if (n < start) { this._pocSeries[i].setData([]); continue; }
      const price = prices[i][n];
      if (price == null) { this._pocSeries[i].setData([]); continue; }
      const startTime = (this._bars[start].Date || this._bars[start].date || '').slice(0, 10);
      const endTime   = (this._bars[n].Date   || this._bars[n].date   || '').slice(0, 10);
      this._pocSeries[i].setData(
        startTime === endTime
          ? [{ time: startTime, value: price }]
          : [{ time: startTime, value: price }, { time: endTime, value: price }]
      );
    }
  }

  _destroyPoc() {
    for (const s of this._pocSeries) {
      try { this._chart.removeSeries(s); } catch (_) {}
    }
    this._pocSeries = [];
    this._pocData   = null;
  }

  _buildDivLines(lines, showPivots) {
    this._divLineData   = [];
    this._divLineSeries = [];
    this._divLineKeys   = [];
    if (!showPivots) return;
    for (const ln of lines) {
      const bull  = ln.kind === 'bull';
      const color = bull ? DIV_BULL : DIV_BEAR;
      this._divLineData.push({ s: ln.s, e: ln.e, p0: ln.p0, p1: ln.p1, vf: ln.vf });
      this._divLineKeys.push(-2);
      this._divLineSeries.push(this._chart.addSeries(LightweightCharts.LineSeries, {
        color,
        lineWidth:              Math.min(ln.count, 3),
        lineStyle:              0,
        priceLineVisible:       false,
        lastValueVisible:       false,
        crosshairMarkerVisible: false,
      }));
    }
  }

  _revealDivLines(n) {
    for (let i = 0; i < this._divLineData.length; i++) {
      const d   = this._divLineData[i];
      const key = d.vf <= n ? 1 : -1;
      if (key === this._divLineKeys[i]) continue;
      this._divLineKeys[i] = key;
      if (key < 0) {
        this._divLineSeries[i].setData([]);
      } else {
        const t0 = (this._bars[d.s].Date || this._bars[d.s].date || '').slice(0, 10);
        const t1 = (this._bars[d.e].Date || this._bars[d.e].date || '').slice(0, 10);
        this._divLineSeries[i].setData([
          { time: t0, value: d.p0 },
          { time: t1, value: d.p1 },
        ]);
      }
    }
  }

  _destroyDivLines() {
    for (const s of this._divLineSeries) {
      try { this._chart.removeSeries(s); } catch (_) {}
    }
    this._divLineSeries = [];
    this._divLineData   = [];
    this._divLineKeys   = [];
  }

  _revealDivMarkers(n) {
    const markers     = [];
    const overlayData = [];
    for (const m of this._divMarkers) {
      if ((m.vf ?? m.b) > n) continue;
      const bar   = this._bars[m.b];
      const time  = (bar.Date || bar.date || '').slice(0, 10);
      const bull  = m.kind === 'bull';
      const color = bull ? DIV_BULL : DIV_BEAR;
      if (this._divShowMarkers) {
        markers.push({
          time,
          position: bull ? 'belowBar' : 'aboveBar',
          color,
          shape:    this._divShowLabels ? (bull ? 'arrowUp' : 'arrowDown') : (m.hidden ? 'circle' : 'square'),
          text:     this._divShowLabels ? m.label : '',
          size:     1,
        });
      }
      if (this._divShowWicks || this._divShowCandles) {
        const entry = {
          time,
          open:  bar.Open  ?? bar.open,
          high:  bar.High  ?? bar.high,
          low:   bar.Low   ?? bar.low,
          close: bar.Close ?? bar.close,
        };
        if (this._divShowWicks)   { entry.borderColor = color; entry.wickColor = color; }
        if (this._divShowCandles) { entry.color = color; }
        overlayData.push(entry);
      }
    }
    markers.sort((a, b)     => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
    overlayData.sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
    // v5 moved markers out of the series API into a plugin, created once
    // per candle series (see _init) and fed the full marker list here.
    this._candleMarkers.setMarkers(markers);
    this._divCandleSeries.setData(overlayData);
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

  /**
   * fitContent(), but self-verifying instead of trusting the library blindly.
   *
   * lightweight-charts has a long-standing upstream bug (e.g. tradingview/
   * lightweight-charts#966, #814, #251): fitContent() called soon after fresh
   * setData() on a (re)created chart can fit to a range far short of the real
   * bar count, and how long it takes to self-correct isn't fixed — it varies
   * with how much work is happening on the main thread (which is exactly why
   * a flat setTimeout delay lined up for one indicator styling but not a
   * heavier one). So instead of guessing a delay, check the result against
   * our own known bar count (this._N) and keep retrying — a real redraw
   * (reveal) plus fitContent — on a backoff schedule until it actually
   * matches, or we give up after ~2s (at which point content is at least
   * approximately right, just not pixel-perfect).
   */
  fitContentReliably() {
    if (!this._chart || this._N === 0 || !this._bars.length) return;
    const ts = this._chart.timeScale();
    // Compare against the real first/last dates, not just the logical index
    // span — lightweight-charts can report a logical range that already
    // covers every bar while still mapping the low end of it to the wrong
    // calendar date (a corrupted index, not just a truncated one), which a
    // span-only check would miss entirely.
    const wantFrom = (this._bars[0].Date || this._bars[0].date || '').slice(0, 10);
    const wantTo   = (this._bars[this._bars.length - 1].Date || this._bars[this._bars.length - 1].date || '').slice(0, 10);
    const delays = [0, 60, 150, 300, 600, 1000];
    let i = 0;
    const attempt = () => {
      // A fast ticker/config switch can destroy() this chart (chart.js's own
      // this._chart -> null) while an earlier attempt's setTimeout is still
      // pending — bail out instead of calling into a removed chart.
      if (!this._chart) return;
      this.reveal(this._curN);
      ts.fitContent();
      const range = ts.getVisibleRange();
      i++;
      if ((!range || range.from !== wantFrom || range.to !== wantTo) && i < delays.length) {
        setTimeout(attempt, delays[i]);
      }
    };
    attempt();
  }

  logicalAtX(x) {
    if (!this._chart) return null;
    return this._chart.timeScale().coordinateToLogical(x);
  }

  /** Bar index under pixel x, clamped to the currently-revealed range, or null if out of range/no chart. */
  barIndexAtX(x) {
    if (!this._chart || this._curN < 0) return null;
    const logical = this._chart.timeScale().coordinateToLogical(x);
    if (logical == null) return null;
    const barIdx = Math.round(logical);
    if (barIdx < 0 || barIdx > this._curN) return null;
    return barIdx;
  }

  /** Place/remove a manually-anchored VWAP at the candle under x. withStdev also draws +/- k*stdev bands around it; withProfile also pairs a Volume Profile with it (same anchor, removed together). Returns true (added) / false (removed) / null (out of range). */
  toggleManualAnchorAtX(x, withStdev = false, withProfile = false) {
    if (!this._engine) return null;
    const barIdx = this.barIndexAtX(x);
    if (barIdx == null) return null;
    return this._engine.toggleManualAnchor(barIdx, this._curN, withStdev, withProfile);
  }

  /** Undo the most recently placed manual aVWAP anchor (LIFO). Returns the removed bar index, or null if none. */
  undoManualAnchor() {
    if (!this._engine) return null;
    return this._engine.undoManualAnchor();
  }

  /** Create a manual anchor spanning the fixed range [startIdx, candle under x] — withStdev/withProfile same meaning as toggleManualAnchorAtX. Used by ',' then '.'/Shift+./Ctrl+. (see replay.js). */
  createRangedAnchorAtX(startIdx, x, withStdev = false, withProfile = false) {
    if (!this._engine) return null;
    const barIdx = this.barIndexAtX(x);
    if (barIdx == null) return null;
    return this._engine.createRangedManualAnchor(startIdx, barIdx, withStdev, withProfile);
  }

  /** Alt+. — aVWAP fan anchored at every candle from the one under x to the current bar, all growing to "now". */
  createFanAtX(x) {
    if (!this._engine) return null;
    const barIdx = this.barIndexAtX(x);
    if (barIdx == null) return null;
    return this._engine.createManualFan(barIdx, this._curN, null);
  }

  /** ',' then Alt+. — aVWAP fan anchored at every candle across [startIdx, candle under x], each stopping at the range's end. */
  createRangedFanAtX(startIdx, x) {
    if (!this._engine) return null;
    const barIdx = this.barIndexAtX(x);
    if (barIdx == null) return null;
    const lo = Math.min(startIdx, barIdx), hi = Math.max(startIdx, barIdx);
    return this._engine.createManualFan(lo, hi, hi);
  }

  /** Show/hide the volume pane. */
  setVolumeVisible(visible) {
    this.setPaneVisible(VOLUME_PANE_ID, visible);
  }

  /** Click at (x, y) cycles a manual anchor's Volume Profile display mode (normal → LVN → both histograms + both POCs → both POCs, bars hidden) if the click landed inside it. Returns true if a profile was cycled. */
  cycleProfileModeAtXY(x, y) {
    if (!this._engine || !this._candles || !this._inPricePane(y)) return false;
    const barIdx = this.barIndexAtX(x);
    const price  = this._candles.coordinateToPrice(y);
    if (barIdx == null || price == null) return false;
    return this._engine.cycleProfileModeAt(barIdx, price);
  }

  /** Live price/percent-change measurement box from (x0,y0) to (x1,y1), in #chart-local pixel coords. */
  updateMeasure(x0, y0, x1, y1) {
    if (!this._candles) return;
    const p0 = this._candles.coordinateToPrice(y0);
    const p1 = this._candles.coordinateToPrice(y1);
    if (p0 == null || p1 == null) return;

    if (!this._measureEl) {
      this._measureEl = document.createElement('div');
      this._measureEl.className = 'chart-measure-box';
      this._measureLabelEl = document.createElement('div');
      this._measureLabelEl.className = 'chart-measure-label';
      this._measureStartEl = document.createElement('span');
      this._measureStartEl.className = 'chart-measure-start';
      this._measureDeltaEl = document.createElement('span');
      this._measureDeltaEl.className = 'chart-measure-delta';
      this._measureLabelEl.append(this._measureStartEl, this._measureDeltaEl);
      this._measureEl.appendChild(this._measureLabelEl);
      this._container.appendChild(this._measureEl);
    }

    const up = p1 >= p0;
    this._measureEl.style.left   = `${Math.min(x0, x1)}px`;
    this._measureEl.style.top    = `${Math.min(y0, y1)}px`;
    this._measureEl.style.width  = `${Math.abs(x1 - x0)}px`;
    this._measureEl.style.height = `${Math.abs(y1 - y0)}px`;
    this._measureEl.classList.toggle('up',   up);
    this._measureEl.classList.toggle('down', !up);

    const dollar = p1 - p0;
    const pct    = p0 !== 0 ? (dollar / p0) * 100 : 0;
    this._measureStartEl.textContent = `${p0.toFixed(2)}  `;
    this._measureDeltaEl.textContent =
      `${dollar >= 0 ? '+' : '-'}${Math.abs(dollar).toFixed(2)}  (${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%)`;

    // Live price marker moves onto the price axis itself (via a native price line)
    // instead of floating over the candles — the axis label shows the exact price
    // at that level; $ and % both stay on the floating label above.
    const color = up ? C_UP : C_DOWN;
    if (!this._measureCurrentLine) {
      this._measureCurrentLine = this._candles.createPriceLine({
        price: p1, color, lineWidth: 2, lineStyle: LightweightCharts.LineStyle.Dashed,
        axisLabelVisible: true, title: '',
      });
    } else {
      this._measureCurrentLine.applyOptions({ price: p1, color });
    }
  }

  clearMeasure() {
    if (this._measureEl) {
      this._measureEl.remove();
      this._measureEl = null; this._measureLabelEl = null;
      this._measureStartEl = null; this._measureDeltaEl = null;
    }
    if (this._candles && this._measureCurrentLine) {
      try { this._candles.removePriceLine(this._measureCurrentLine); } catch (_) {}
    }
    this._measureCurrentLine = null;
  }

  getVisibleRange() {
    if (!this._chart) return null;
    return this._chart.timeScale().getVisibleRange();
  }

  setVisibleRange(from, to) {
    if (!this._chart) return;
    try { this._chart.timeScale().setVisibleRange({ from, to }); } catch (_) {}
  }

  // ── Per-indicator show/hide (data stays loaded; only rendering changes) ──

  // ── Oscillator panes ──────────────────────────────────────────────────

  /** (Re)create every visible oscillator pane, in the server's order, below
   * the price pane. Pane i+1 for the i-th visible one — lightweight-charts
   * removes a pane by itself once its last series is gone, so hiding a pane
   * is just _destroyPanes + rebuild without it. */
  _buildPanes() {
    this._destroyPanes();
    const visible = this._paneDefs.filter(p => !this._paneHidden.has(p.id));
    visible.forEach((pane, i) => {
      const paneIndex = i + 1;
      pane.series.forEach((s, j) => {
        const common = { priceLineVisible: false, crosshairMarkerVisible: false,
                         priceFormat: PANE_PRICE_FORMAT,
                         // only the pane's main series shows its current value on the
                         // axis — its first line, or its histogram if it has no line (volume)
                         lastValueVisible: j === Math.max(0, pane.series.findIndex(x => x.kind === 'line')) };
        const series = s.kind === 'histogram'
          ? this._chart.addSeries(LightweightCharts.HistogramSeries,
              { ...common, ...(s.color ? { color: s.color } : { lastValueVisible: false }) }, paneIndex)
          : this._chart.addSeries(LightweightCharts.LineSeries, { ...common, color: paneColor(s.color), lineWidth: s.width }, paneIndex);
        this._paneSeries[s.col] = series;
        if (this._curN >= 0) series.setData(this._paneData[s.col].slice(0, this._curN + 1));
      });
      // Reference levels (RSI 30/50/70, MACD 0, ...) on the pane's first line.
      const anchor = this._paneSeries[(pane.series.find(x => x.kind === 'line') || pane.series[0]).col];
      // Headroom above the lines for the top-left label (Stochastic, RSI etc.
      // regularly touch their pane's top), a little below too.
      anchor.priceScale().applyOptions({ scaleMargins: pane.margins || { top: 0.2, bottom: 0.08 } });
      for (const price of pane.refs) {
        anchor.createPriceLine({ price, color: pane.ref_color, lineWidth: 1,
          lineStyle: LightweightCharts.LineStyle.Dashed, axisLabelVisible: false });
      }
      for (const [targetCol, lines] of Object.entries(this._paneDivLines[pane.id] || {})) {
        const prim = new DivLinesPrimitive(lines);
        this._paneSeries[targetCol].attachPrimitive(prim);
        prim.setRevealed(this._curN);
        this._paneDivPrims.push({ series: this._paneSeries[targetCol], prim });
      }
    });
    if (this._maxPaneId && !visible.some(p => p.id === this._maxPaneId)) {
      this._maxPaneId = null;          // the maximized pane was hidden
      try { navigator.keyboard?.unlock?.(); } catch (_) {}
    }
    this._visiblePanes = visible;
    this._applyPaneStretch();
    this._buildPaneOverlays();
  }

  /** Heights: normally price max(3, 1.5 × panes) : each pane 1; with a pane
   * maximized, that pane takes everything and the rest collapse. */
  _applyPaneStretch() {
    const chartPanes = this._chart.panes();
    const maxIdx = this._maxPaneId ? (this._visiblePanes || []).findIndex(p => p.id === this._maxPaneId) + 1 : 0;
    if (maxIdx > 0) {
      chartPanes.forEach((p, i) => p.setStretchFactor(i === maxIdx ? 1 : COLLAPSED_PANE_STRETCH));
    } else {
      const nOsc = chartPanes.length - 1;
      if (chartPanes.length) chartPanes[0].setStretchFactor(Math.max(PRICE_PANE_MIN_STRETCH, PRICE_PANE_PER_OSC * nOsc));
      for (let i = 1; i < chartPanes.length; i++) chartPanes[i].setStretchFactor(this._visiblePanes?.[i - 1]?.stretch ?? OSC_PANE_STRETCH);
    }
    this._applyCollapsedVisibility(maxIdx);
  }

  /** Collapsed panes still get a couple of pixels from lightweight-charts,
   * enough to show a smear of squashed candles/lines. While a pane is
   * maximized, make the collapsed panes' rows (price scale included) and the
   * pane separators invisible — visibility, not display, so the chart's own
   * layout is untouched — and clear it all again on restore. Rows may not
   * exist until the chart lays out, so retried on the next frame. */
  _applyCollapsedVisibility(maxIdx, attempt = 0) {
    const chartPanes = this._chart.panes();
    const rows = chartPanes.map(p => p.getHTMLElement());
    if (rows.some(r => !r) && attempt < 5) {
      requestAnimationFrame(() => this._applyCollapsedVisibility(maxIdx, attempt + 1));
      return;
    }
    rows.forEach((row, i) => { if (row) row.style.visibility = (maxIdx > 0 && i !== maxIdx) ? 'hidden' : ''; });
    const table = rows.find(Boolean)?.closest('table');
    for (const row of table?.rows || []) {
      if (row.cells.length === 1) row.style.visibility = maxIdx > 0 ? 'hidden' : '';   // pane separators
    }
  }

  /** Each oscillator pane's top-left overlay: its name + settings in quiet
   * grey, and a maximize toggle right next to it. HTML (not canvas) so the
   * button is clickable; placed inside the pane's own cell, which
   * lightweight-charts positions relatively, so it moves/resizes with it.
   * The pane's element may not exist until the chart lays out — retried on
   * the next frame. */
  _buildPaneOverlays(attempt = 0) {
    for (const el of this._paneOverlays || []) el.remove();
    this._paneOverlays = [];
    const chartPanes = this._chart.panes();
    (this._visiblePanes || []).forEach((pane, i) => {
      // While a pane is maximized the others are collapsed to ~0 height —
      // their overlays would just pile up over the time axis.
      if (this._maxPaneId && this._maxPaneId !== pane.id) return;
      const rowOrCell = chartPanes[i + 1]?.getHTMLElement();
      if (!rowOrCell) {
        if (attempt < 5) requestAnimationFrame(() => this._buildPaneOverlays(attempt + 1));
        return;
      }
      const cell = rowOrCell.tagName === 'TR' ? rowOrCell.cells[1] : rowOrCell;
      const maxed = this._maxPaneId === pane.id;
      const el = document.createElement('div');
      el.className = 'pane-overlay';
      el.innerHTML = `<span class="pane-overlay-label"></span>
        <button type="button" class="pane-max-btn${maxed ? ' active' : ''}"
                title="${maxed ? 'Restore pane (Esc)' : 'Maximize pane'}">${maxed ? '&#x2921;' : '&#x2922;'}</button>`;
      el.querySelector('.pane-overlay-label').textContent = pane.label || pane.key;
      const btn = el.querySelector('button');
      btn.addEventListener('mousedown', e => e.stopPropagation());   // keep the chart from starting a drag
      btn.addEventListener('click', e => { e.stopPropagation(); btn.blur(); this.togglePaneMaximized(pane.id); });
      cell.appendChild(el);
      this._paneOverlays.push(el);

      // × at the top-right closes (hides) the pane — routed through
      // onPaneClose (replay.js) so it goes through the same show/hide-panel
      // state as unticking it there, and comes back by re-ticking it.
      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'pane-close-btn';
      close.title = 'Close pane (re-enable it in the show/hide indicators panel)';
      close.innerHTML = '&#x2715;';
      close.addEventListener('mousedown', e => e.stopPropagation());
      close.addEventListener('click', e => {
        e.stopPropagation();
        if (this.onPaneClose) this.onPaneClose(pane.id); else this.setPaneVisible(pane.id, false);
      });
      cell.appendChild(close);
      this._paneOverlays.push(close);
    });
  }

  /** Maximize one oscillator pane to the whole chart area, or restore it.
   * In the app's fullscreen mode, Esc is held by Chrome's Keyboard Lock while
   * a pane is maximized, so its first press restores the pane instead of
   * leaving fullscreen (holding Esc still exits; browsers without Keyboard
   * Lock exit fullscreen as usual). */
  togglePaneMaximized(id) {
    this._maxPaneId = this._maxPaneId === id ? null : id;
    this._applyPaneStretch();
    this._buildPaneOverlays();
    try {
      if (this._maxPaneId && document.fullscreenElement) navigator.keyboard?.lock?.(['Escape']).catch(() => {});
      else navigator.keyboard?.unlock?.();
    } catch (_) {}
  }

  /** Esc handling: restore a maximized pane. True if there was one. */
  restoreMaximizedPane() {
    if (!this._maxPaneId) return false;
    this.togglePaneMaximized(this._maxPaneId);
    return true;
  }

  _destroyPanes() {
    for (const el of this._paneOverlays || []) el.remove();
    this._paneOverlays = [];
    for (const { series, prim } of this._paneDivPrims || []) {
      try { series.detachPrimitive(prim); } catch (_) {}
    }
    this._paneDivPrims = [];
    for (const s of Object.values(this._paneSeries)) {
      try { this._chart.removeSeries(s); } catch (_) {}
    }
    this._paneSeries = {};
  }

  /** Show/hide one oscillator pane by its id ('oscillators:RSI', 'divergence:MACD', ...). */
  setPaneVisible(id, visible) {
    if (visible) this._paneHidden.delete(id); else this._paneHidden.add(id);
    this._buildPanes();
  }

  /** True if (x, y), in #chart-local px, is inside the price pane — clicks
   * in an oscillator pane below shouldn't be read as price-pane clicks. */
  _inPricePane(y) {
    const p = this._chart?.panes()[0];
    return !p || y < p.getHeight();
  }

  setIndicatorVisible(cols, visible) {
    // An oscillator pane's columns → show/hide the whole pane (removed and
    // rebuilt, so hidden panes give their height back to the others).
    const pane = this._paneDefs.find(p => p.series.length === cols.length && p.series.every(s => cols.includes(s.col)));
    if (pane) { this.setPaneVisible(pane.id, visible); return; }
    let touchedTint = false;
    const engineKinds = new Set();
    for (const col of cols) {
      if (col === 'color' || col === 'Fill_Color') {
        this._tintEnabled = visible;
        touchedTint = true;
      } else if (col.startsWith('aVWAP_max_')) {
        engineKinds.add('avwap_max');
      } else if (col.startsWith('aVWAP_min_')) {
        engineKinds.add('avwap_min');
      } else {
        const s = this._lines[col];
        if (s) s.applyOptions({ visible });
      }
    }
    // Generic anchor-pool kinds (e.g. aVWAP_minmax) live in the dynamic engine,
    // not this._lines — same reveal-once-built lifecycle, just a different pool.
    for (const key of engineKinds) {
      if (this._engine) this._engine.setKindVisible(key, visible);
    }
    // Candle coloring isn't a series — it's baked into candle data on reveal —
    // so flipping the flag needs a re-reveal to actually take effect on screen.
    if (touchedTint && this._curN >= 0) this.reveal(this._curN);
  }

  setCandlesVisible(visible) {
    if (this._candles) this._candles.applyOptions({ visible });
  }

  /** Show/hide one segment type ('fvg'/'ob'/'bos'/'liq'/'gap' — see _buildSegments).
   * Safe to call before segments exist yet; replay.js re-applies after loadEvents(). */
  setSegmentVisible(type, visible) {
    const series = this._segSeries[type];
    if (!series) return;
    for (const s of series) s.applyOptions({ visible });
  }

  destroy() {
    this._divMarkers    = [];
    this._divShowLabels = true;
    this._destroyDivLines();
    this._destroyPoc();
    this._destroySegments();
    this._destroyPanes();
    this._paneDefs = [];
    if (this._maxPaneId) { this._maxPaneId = null; try { navigator.keyboard?.unlock?.(); } catch (_) {} }
    this.clearMeasure();
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
