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
import { VolumeProfileSeries } from './volume_profile_series.js';
import { cssVar, onThemeChange } from './theme.js';

// Segment types with a real zone (top/bottom bounds) get a custom series that
// draws the actual filled rectangle instead of the flat-line-at-one-price
// hack every segment type used to use — see ob_zone_series.js/fvg_zone_series.js/
// gap_zone_series.js/liquidity_zone_series.js docstrings. bos is genuinely a
// single-price-level line (no second bound at all), so it stays on the plain
// LineSeries path below.
const ZONE_SERIES = { ob: OBZoneSeries, fvg: FVGZoneSeries, gap: GapZoneSeries, liq: LiquidityZoneSeries };

const C_UP   = 'rgba(38,166,154,1)';
const C_DOWN = 'rgba(239,83,80,1)';

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
  }

  _init() {
    const c = this._chartColors();
    this._chart = LightweightCharts.createChart(this._container, {
      layout:          { background: { color: c.bg }, textColor: c.text },
      grid:            { vertLines: { color: c.grid }, horzLines: { color: c.grid } },
      crosshair:       { mode: LightweightCharts.CrosshairMode.Normal },
      rightPriceScale: { borderColor: c.border, scaleMargins: { top: 0.03, bottom: 0.03 } },
      timeScale:       { borderColor: c.border, timeVisible: true },
    });

    this._candles = this._chart.addCandlestickSeries({
      upColor:        C_UP,   downColor:       C_DOWN,
      borderUpColor:  C_UP,   borderDownColor: C_DOWN,
      wickUpColor:    C_UP,   wickDownColor:   C_DOWN,
    });

    // Overlay series — transparent body, thick wicks/borders at divergence pivot bars
    this._divCandleSeries = this._chart.addCandlestickSeries({
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

  load(bars, styles = {}) {
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
            const payload = { lo: ev.lo, bs: ev.bs, bins: ev.bins, dir: ev.dir, fillOpacity: ev.fo ?? 0.4 };
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
    this._pocSeries = poc.starts.map(() => this._chart.addLineSeries({
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
      this._divLineSeries.push(this._chart.addLineSeries({
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
    this._candles.setMarkers(markers);
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

  /** Place/remove a manually-anchored VWAP at the candle under x. withStdev also draws +/- k*stdev bands around it. Returns true (added) / false (removed) / null (out of range). */
  toggleManualAnchorAtX(x, withStdev = false) {
    if (!this._engine || !this._chart || this._curN < 0) return null;
    const logical = this._chart.timeScale().coordinateToLogical(x);
    if (logical == null) return null;
    const barIdx = Math.round(logical);
    if (barIdx < 0 || barIdx > this._curN) return null;
    return this._engine.toggleManualAnchor(barIdx, this._curN, withStdev);
  }

  /** Undo the most recently placed manual aVWAP anchor (LIFO). Returns the removed bar index, or null if none. */
  undoManualAnchor() {
    if (!this._engine) return null;
    return this._engine.undoManualAnchor();
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

  setIndicatorVisible(cols, visible) {
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
