/**
 * avwap_replay.js — client-side dynamic VWAP engine
 *
 * At each replay bar N this engine:
 *   - picks the most-recent max_peaks peaks from bars[0..N]
 *   - picks the most-recent max_valleys valleys from bars[0..N]
 *   - applies committed QQEMOD anchor events up to bar N
 * and renders one LineSeries per active anchor, growing in real time.
 *
 * VWAP values use pre-built cumulative sum arrays so each value is O(1).
 */

import { VolumeProfileSeries, RGB_DEFAULT as VP_RGB_DEFAULT, RGB_LVN_DEFAULT as VP_RGB_LVN } from './volume_profile_series.js';

// Default colours — match col_styles.py palette
const C_PEAK   = 'rgba(239, 83, 80, 0.75)';   // red   — peaks
const C_VALLEY = 'rgba(38, 166, 154, 0.75)';   // teal  — valleys
// aVWAP_peaks/aVWAP_valleys' own 'styling' = 'shades_orange' — same tiered-
// by-opacity treatment as 'shades', just matching Volume Profile's own
// default color instead of this indicator's usual red/teal.
const ORANGE_RGB = VP_RGB_DEFAULT.split(',').map(Number);
// QQEMOD: bear zone anchor → teal line (bullish support level)
//         bull zone anchor → red  line (bearish resistance level)
const C_QQ_BEAR = 'rgba(38, 166, 154, 0.75)';
const C_QQ_BULL = 'rgba(239, 83, 80, 0.75)';

// Generic anchor pool colour / style config
// Each entry: [color, lineWidth, lineStyle]  (lineStyle: 0=solid, 1=dotted, 2=dashed)
const ANCHOR_POOL_STYLE = {
  ob_bull:    ['rgba(38,166,154,0.85)', 2, 0],
  ob_bear:    ['rgba(239,83,80,0.85)',  2, 0],
  bos_bull:   ['rgba(38,166,154,0.5)',  1, 0],
  bos_bear:   ['rgba(239,83,80,0.5)',   1, 0],
  choch_bull: ['rgba(38,166,154,0.9)',  1, 0],
  choch_bear: ['rgba(239,83,80,0.9)',   1, 0],
  gap_up:     ['rgba(38,166,154,0.5)',  1, 2],
  gap_dn:     ['rgba(239,83,80,0.5)',   1, 2],
  pmm_valley:      ['rgba(38,166,154,0.75)', 2, 0],
  pmm_peak:        ['rgba(239,83,80,0.75)',  2, 0],
  qqemod_bull:     ['rgba(239,83,80,0.9)',  3, 0],
  qqemod_bear:     ['rgba(38,166,154,0.9)', 3, 0],
  qqemod_bull_dot: ['rgba(239,83,80,0.7)',  2, 1],
  qqemod_bear_dot: ['rgba(38,166,154,0.7)', 2, 1],
  avwap_max:       ['rgba(255,0,0,1.0)',      3, 0],
  avwap_min:       ['rgba(0,255,255,0.85)',  3, 0],
};

// Curve-to-straight per-point coloring for peaks/valleys — JS port of
// calculate_avwap_straightening / avwap_curve_color (backend/indicators/
// indicators_list/aVWAP.py), since these lines are built live here rather
// than from stored columns like aVWAP_minmax's chained lines. See that
// module's docstrings for the full math rationale; kept numerically
// identical here (same peak-normalized-slope + cummax formula).
const CURVE_BULL_RGB          = [0, 255, 255];   // heatmap — defining move was upward
const CURVE_BEAR_RGB          = [255, 0, 0];     // heatmap — defining move was downward
const CURVE_SETTLE_RGB        = [45, 45, 52];    // heatmap — flattened (settled)
const CURVE_OPACITY_MAX_ALPHA = 0.85;
const CURVE_OPACITY_MIN_ALPHA = 0.30;
const CURVE_HOT_RGB = {
  peak:   [255, 0, 0],     // red_dark — same escalating-intensity step as the Python side
  valley: [0, 255, 255],   // aqua
};
const CURVE_BASE_RGB = {
  peak:   [239, 83, 80],   // matches C_PEAK
  valley: [38, 166, 154],  // matches C_VALLEY
};

// 'styling' values that color each point individually at reveal() time instead
// of tiering the whole line by config rank — see _anchorPoolStyle.
const _PER_POINT_STYLES = new Set(['curve_opacity', 'curve_heatmap', 'slope_gradient']);

// slope_gradient — colors each point by its own instantaneous ATR-normalized
// slope alone, no memory of the line's own history (contrast with curve_opacity/
// curve_heatmap above, which normalize against this line's own sharpest move so
// far). Reuses the same bull/bear/settle hues as the heatmap style so the two
// "diverging" modes read as visually related.
const SLOPE_UP_RGB   = CURVE_BULL_RGB;    // rising
const SLOPE_DOWN_RGB = CURVE_BEAR_RGB;    // falling
const SLOPE_FLAT_RGB = CURVE_SETTLE_RGB;  // ~zero slope
// Alpha scales with steepness too, not just hue — flat stretches fade toward
// near-transparent "holes" instead of solid gray blobs, so a glance at the
// line's opacity alone tells you whether anything is happening there. These
// are just fallback defaults used in load() when a config doesn't set its own
// slope_alpha_min/slope_alpha_max — see aVWAP_peaks.py/aVWAP_valleys.py's own
// param, which is what actually drives it per-config.
const SLOPE_ALPHA_MAX_DEFAULT = 0.85;
const SLOPE_ALPHA_MIN_DEFAULT = 0.15;

// Manually placed (click-to-anchor) aVWAP — amber, distinct from all auto anchors
const C_MANUAL = 'rgba(255,193,7,0.95)';
// aVWAP fan — an aVWAP anchored at every candle across a span (hovered
// candle → current bar, or a ','-marked range), each line growing to "now" or
// stopping at the range's end. Every candle is classified by SIGNIFICANCE:
// the largest of FAN_PV_WINDOWS at which it's still a peak/valley (same swing
// rule as peaks_valleys.py — high/low equal to its centered window's max/min;
// 0 for an in-between candle). Swings are scaled 0..1 within the fan (log of
// the window survived); that sets each line's opacity (FAN_ALPHA_MIN ..
// FAN_ALPHA_MAX) and, for the top swings, width — the significant swings
// carry the fan's structure, minor swings and in-between candles stay faint.
// Every candle gets a line unless that would exceed FAN_POINT_BUDGET points
// drawn per frame (lines × their length — drawing cost, the only reason to
// thin): then swings are kept first (most significant first) and in-between
// candles fill the remaining budget evenly. A full-chart fan of ~1,200 lines
// would otherwise take ~100ms+ to repaint on every pan/zoom.
// Clicking a fan cycles FAN_MODES: amber (weighted) → peak red / valley teal,
// in-between grey (weighted, min/max aVWAPs highlighted) → every line grey at
// one flat FAN_FLAT_ALPHA, 1px, with only the min/max aVWAPs in color,
// plus the fan's average aVWAP in amber → every line colored point by point
// by its own slope (grey flat, teal rising, red falling) → amber.
const C_MANUAL_RGB          = '255,193,7';
const C_PEAK_RGB            = '239,83,80';
const C_VALLEY_RGB          = '38,166,154';
const C_FAN_GREY_RGB        = '150,150,150';
const FAN_PV_WINDOWS        = [3, 5, 7, 10, 15, 20, 25, 35, 50, 75, 100, 150, 200, 300];
const FAN_POINT_BUDGET      = 400000;
const FAN_ALPHA_MIN         = 0.08;   // in-between candles
const FAN_ALPHA_SWING_MIN   = 0.18;   // the least significant swing
const FAN_ALPHA_MAX         = 0.8;    // the most significant swing
const FAN_WIDE_MIN          = 0.75;   // significance at/above which a line is 2px
const FAN_FLAT_ALPHA        = 0.3;    // every line's opacity in 'flat' mode
// 'flat' mode also draws the fan's average aVWAP: at each bar, the mean of
// every fan line that exists there (anchored at or before it).
const C_FAN_AVG             = `rgba(${C_MANUAL_RGB},1)`;
const FAN_AVG_WIDTH         = 2;
// 'slope' mode: each 1px segment by the line's slope into that bar, in ATR
// per bar (ATR FAN_SLOPE_ATR): grey and faint when flat, shading to teal
// rising / red falling and more opaque as it steepens, full at
// FAN_SLOPE_SCALE. Quantized to FAN_SLOPE_LEVELS steps each way so the fan
// strokes in a few batches.
const FAN_SLOPE_ATR         = 14;
const FAN_SLOPE_SCALE       = 0.1;
const FAN_SLOPE_LEVELS      = 8;
const FAN_SLOPE_ALPHA_MIN   = 0.15;
const FAN_SLOPE_ALPHA_MAX   = 0.6;
const FAN_MODES             = ['amber', 'pv', 'flat', 'slope'];
// In the red/teal coloring, the fan's min/max aVWAPs — anchored at its
// highest peak and lowest valley — are highlighted in the same colors the
// aVWAP Min|Max lines use (avwap_max / avwap_min below), and wider.
// Ctrl+. 'vp' fan — the same full aVWAP set, all in volume orange, each line
// shaded point by point by the Volume Profile of the fan's span (bars from
// its first anchor to the current/end bar) at that point's price: bright
// through heavily traded levels (HVNs), faint through thin ones (LVNs).
// Opacity follows the level's share of the busiest level raised to
// FAN_VP_GAMMA (>1 keeps only the busiest levels bright — with hundreds of
// overlapping lines, linear shading saturates into a solid band), quantized
// into FAN_VP_LEVELS steps so segments batch into a few strokes; drawing
// per segment costs more than per line, hence its smaller point budget.
const FAN_VP_BINS         = 100;
// Every segment at a level that traded at all gets at least FAN_VP_ALPHA_FLOOR
// (the line stays visible there) and the shading adds up to FAN_VP_ALPHA_MAX
// on top; only a level with truly zero volume is left out, in the mode where
// it would be the faintest ('hvn' — in 'both' a zero-volume level is the
// brightest).
const FAN_VP_ALPHA_FLOOR  = 0.1;
const FAN_VP_ALPHA_MAX    = 0.45;
const FAN_VP_GAMMA        = 2;
const FAN_VP_LEVELS       = 20;
const FAN_VP_POINT_BUDGET = 250000;
// Clicking a 'vp' fan cycles FAN_VP_MODES — the in-chart Volume Profile's own
// modes ('<') applied to the fan: 'hvn' volume orange, bright
// through heavily traded levels → 'anchor' each WHOLE line one color, from
// its anchor candle's close as the HVN / LVN split candle coloring reads it:
// orange if that close's level is above half the POC's volume, indigo below,
// brighter the further from the midpoint, the POC yellow (C_FAN_ANCHOR_POC)
// — do lines launched from busy vs thin prices behave differently? →
// 'both' orange where a level's volume is above half the POC's, indigo where
// below, brighter the further from that midpoint → 'barvol' every line shaded
// by each BAR's own volume instead (time, not price: at bar i all lines take
// bar i's shade, so the volume histogram reads as vertical bands across the
// fan — bar volume / the span's FAN_BARVOL_PCTL percentile, capped at 1, so
// one spike doesn't flatten the rest) → 'hvn'.
const FAN_VP_MODES        = ['hvn', 'anchor', 'both', 'barvol'];
const C_FAN_ANCHOR_POC    = 'rgba(255,214,0,0.9)';
const FAN_BARVOL_PCTL     = 0.95;
const C_FAN_MAX      = 'rgba(255,0,0,1.0)';
const C_FAN_MIN      = 'rgba(0,255,255,0.85)';
const FAN_MINMAX_WIDTH = 2;
// Shift+. also draws stdev bands (vwap +/- k*stdev) around a manual anchor —
// same rgb (amber), dashed, tiered opacity by k using the identical formula
// col_styles.py uses for aVWAP_pinch's own stdev bands (tightest band most
// visible, wider bands fade out).
const C_MANUAL_STDEV_RGB     = '255,193,7';
const MANUAL_STDEV_MAX_ALPHA = 0.65;
const MANUAL_STDEV_MIN_ALPHA = 0.45;
const MANUAL_STDEV_MULTIPLES = [1, 2]; // matches aVWAP_pinch's default stdev_multiples
// Clicking inside a Shift+. anchor's ±STDEV_CLOUD_K σ envelope cycles
// STDEV_CLOUD_MODES: 'bands' (the dashed ±1/±2σ above) → a σ-band CLOUD —
// band lines every STDEV_CLOUD_STEP σ out to ±STDEV_CLOUD_K σ, drawn by
// StdevCloudPrimitive — shaded 'vp' (volume orange by the Volume Profile of
// the anchor's span at each point's price, like the Ctrl+. fan's first mode)
// → 'mixed' (orange above half the POC's volume, indigo below) → 'sigma' (by
// distance from the aVWAP: bright near it, fading to ±3σ; teal below, red
// above) → 'bands'. Every cloud mode also draws faint dashed σ ticks at the
// whole multiples (±1, ±2, ±3σ) so distances stay readable.
const STDEV_CLOUD_MODES = ['bands', 'vp', 'mixed', 'sigma'];
const STDEV_CLOUD_K     = 3;
const STDEV_CLOUD_STEP  = 0.1;
const STDEV_TICK_COLOR  = 'rgba(200,200,200,0.5)';
const SIGMA_ALPHA_MAX   = 0.6;
const SIGMA_ALPHA_MIN   = 0.04;
// In cloud modes the anchor's own aVWAP line is drawn by the cloud primitive
// (its chart series goes transparent) so it can vary per segment: 'vp' —
// volume orange, width AVWAP_VP_WIDTH_MIN..MAX by the Volume Profile share at
// its price (thickest at the most volume); 'mixed' — orange above half the
// POC's volume, indigo below; 'sigma' — by slope, grey when flat shading to
// teal as it slopes up and red as it slopes down (slope scaled to the line's
// own AVWAP_SLOPE_PCTL percentile, so the full range gets used).
const AVWAP_VP_WIDTH_MIN = 1;
const AVWAP_VP_WIDTH_MAX = 5;
const AVWAP_SLOPE_PCTL   = 0.95;
const C_SLOPE_FLAT       = [150, 150, 150];
const C_SLOPE_UP         = [38, 166, 154];
const C_SLOPE_DOWN       = [239, 83, 80];
// The Alt+. fan's 'slope' mode styles (see FAN_SLOPE_*): [up, down][level].
const FAN_SLOPE_STYLES = [C_SLOPE_UP, C_SLOPE_DOWN].map(to_ =>
  Array.from({ length: FAN_SLOPE_LEVELS + 1 }, (_, k) => {
    const t = k / FAN_SLOPE_LEVELS;
    const rgb = C_SLOPE_FLAT.map((f, q) => Math.round(f + (to_[q] - f) * t));
    return `rgba(${rgb.join(',')},${(FAN_SLOPE_ALPHA_MIN + (FAN_SLOPE_ALPHA_MAX - FAN_SLOPE_ALPHA_MIN) * t).toFixed(3)})`;
  }));

// ',' ',' (or '<') also pairs a Volume Profile with a manual anchor — fixed, sensible
// defaults rather than exposing the full configurable-indicator param set,
// since this tool is deliberately parameter-free (press a key, get a
// result). Reuses VolumeProfileSeries for rendering, so it looks identical
// to the real indicator's own 'bars' style; same POC/Value Area convention.
const MANUAL_VP_NUM_BINS       = 200;
const MANUAL_VP_FILL_OPACITY   = 0.4;
const MANUAL_VP_VALUE_AREA_PCT = 0.7;
// Clicking a paired profile cycles its display mode (see VP_MODE_*). LVN
// mode: bars widest at the thinnest levels, POC moved to the deepest LVN,
// profile + lines recolored indigo; see volume_profile.py's
// heatmap_emphasis docs.
// Locality 0 = an exact mirror of the HVN widths (full width minus the
// normal bar), so bar length stays true to each level's real volume.
// Locality 1 (judge each bin against its own neighborhood) gave cleaner
// troughs but turned small local dips into full-width bars, burying the
// POC. Even so, the profile's thin top/bottom tails are usually its widest
// bars here — the LVN POC deliberately skips them (see _vpLvnPoc), so it
// marks the deepest real trough, not necessarily the widest bar. Node window (used by the LVN
// POC's trough detection) scales with the bin count: 16 of 200 bins is the
// same ~8%-per-side reach as the indicator's own 2-of-24 default.
const MANUAL_VP_LVN_LOCALITY = 0;
const MANUAL_VP_NODE_WINDOW  = 16;
// '<' cycle order: normal → LVN → both histograms + both POCs (orange
// busiest level + indigo deepest LVN) → bars hidden (line-only) → back to
// normal.
const VP_MODE_NORMAL = 0;
const VP_MODE_LVN    = 1;
const VP_MODE_BOTH   = 2;
const VP_MODE_POCS   = 3;
const VP_MODE_COUNT  = 4;
// When a profile is paired ('<'), its aVWAP — and a second aVWAP
// anchored at the range's "other side" extremum (see _otherSideExtremum) —
// are drawn by ProfileLinePrimitive, coded like the profile's histogram;
// their chart series stay transparent.
// Bars after the anchor used to class it as a peak or valley (see
// _otherSideExtremum).
const OTHER_SIDE_WINDOW = 10;

// Opacity range for multi-config anchor types (currently peaks/valleys). All configs
// stay solid at the same width — line STYLE is reserved for signifying different data
// types elsewhere in the app (dashed = gaps, dotted = QQEMOD, etc.) — so within one
// type (all peaks, or all valleys) only opacity varies. The full range is spread
// evenly across however many configs of that type are actually present (computed per
// reveal in _buildAnchorPools), so contrast stays proportional to config count: with
// only 2 configs the gap is large and obvious; with more, steps shrink but stay evenly
// spaced across the same full range rather than bunching up or running out.
const CFG_OPACITY_MAX = 0.95;
const CFG_OPACITY_MIN = 0.22;

function _cfgTierColor(r, g, b, rank, total) {
  const alpha = total > 1
    ? CFG_OPACITY_MAX - (rank / (total - 1)) * (CFG_OPACITY_MAX - CFG_OPACITY_MIN)
    : CFG_OPACITY_MAX;
  return [`rgba(${r},${g},${b},${alpha.toFixed(2)})`, 2, 0];
}

// 'highlight_first' peaks/valleys styling: config 0 stays at full peak/valley hue
// and full line width; every other config is a thinner shade of grey instead of a
// shade of that hue, so the primary config reads clearly against a muted backdrop
// of the rest, instead of every config competing in the same color and weight.
//
// Opacity alone wasn't enough separation at solid width 2 — grey and the highlight
// color read as equally "bold" lines just in different hues. Contrast now comes from
// three stacked cues: grey uses the app's existing muted-gray rgb (same as gray_trans,
// used for All_avg) rather than a lighter ad-hoc one, its own opacity ceiling well
// below the highlight's (capped independently of CFG_OPACITY_MAX so a lone "other"
// config can't hit full opacity via _cfgTierColor's single-item branch), AND a
// narrower line width — so even a single other config is unambiguously secondary.
const GREY_TIER_RGB     = [100, 100, 100];
const GREY_OPACITY_MAX  = 0.4;
const GREY_OPACITY_MIN  = 0.15;

function _highlightFirstColor(r, g, b, rank, total) {
  if (rank === 0) return [`rgba(${r},${g},${b},${CFG_OPACITY_MAX})`, 2, 0];
  const greyRank  = rank - 1;
  const greyTotal = Math.max(total - 1, 1);
  const alpha = greyTotal > 1
    ? GREY_OPACITY_MAX - (greyRank / (greyTotal - 1)) * (GREY_OPACITY_MAX - GREY_OPACITY_MIN)
    : GREY_OPACITY_MAX;
  const [gr, gg, gb] = GREY_TIER_RGB;
  return [`rgba(${gr},${gg},${gb},${alpha.toFixed(2)})`, 1, 0];
}

// 'grayscale' peaks/valleys styling: every config (not just "the others") renders
// in the same muted grey family, tiered by opacity exactly like 'shades' would tier
// hue — so multiple configs stay distinguishable from each other, but none of them
// compete with price action for attention. Ignores the hue passed in (r,g,b) entirely,
// unlike 'highlight_first' which still uses it for the first config. Thin (width 1)
// like highlight_first's grey tier, but its own opacity ceiling — a bit higher than
// GREY_OPACITY_MAX/MIN since here grey is the only color in play, not a muted backdrop
// next to a full-color highlight.
const GRAYSCALE_OPACITY_MAX = 0.6;
const GRAYSCALE_OPACITY_MIN = 0.3;

function _grayscaleColor(r, g, b, rank, total) {
  const alpha = total > 1
    ? GRAYSCALE_OPACITY_MAX - (rank / (total - 1)) * (GRAYSCALE_OPACITY_MAX - GRAYSCALE_OPACITY_MIN)
    : GRAYSCALE_OPACITY_MAX;
  const [gr, gg, gb] = GREY_TIER_RGB;
  return [`rgba(${gr},${gg},${gb},${alpha.toFixed(2)})`, 1, 0];
}


// Draws one aVWAP fan (see FAN_* above) on a single canvas layer — a
// lightweight-charts series primitive on the fan's carrier line — instead of
// one chart series per anchor: hundreds of separate series made creating or
// rebuilding a fan take seconds. Values come straight from the engine's
// cumulative price·volume / volume arrays (no per-line storage); only bars in
// the visible range are drawn, and lines are batched by style (color, alpha,
// width) into a few Path2D strokes, faintest first so significant swings and
// the min/max lines sit on top.
class FanPrimitive {
  constructor(engine, fan) {
    this._engine = engine;
    this._fan = fan;
    const renderer = { draw: target => this._draw(target) };
    this._views = [{ renderer: () => renderer, zOrder: () => 'normal' }];
  }
  attached({ chart, series, requestUpdate }) { this._chart = chart; this._series = series; this._request = requestUpdate; }
  detached() { this._chart = this._series = this._request = null; }
  paneViews() { return this._views; }
  update() { this._request?.(); }

  _draw(target) {
    const fan = this._fan, eng = this._engine;
    if (!this._chart || !this._series || fan._toIdx == null) return;
    const ts = this._chart.timeScale();
    const range = ts.getVisibleLogicalRange();
    if (!range) return;
    const toIdx = fan._toIdx, n = fan._n;
    const from = Math.max(0, Math.floor(range.from) - 1), to = Math.min(toIdx, Math.ceil(range.to) + 1);
    if (to < from) return;
    const xs = new Float64Array(to - from + 1);
    for (let i = from; i <= to; i++) xs[i - from] = ts.logicalToCoordinate(i) ?? NaN;
    const cumPV = eng._cumPV, cumVol = eng._cumVol, series = this._series;
    // Price → y. On a linear price scale that's a straight line, so derive it
    // once from two reference prices instead of calling priceToCoordinate for
    // every point (hundreds of thousands per frame for a full-chart fan).
    // Log / percentage scales fall back to the API.
    let toY = p => series.priceToCoordinate(p);
    if ((series.priceScale().options().mode ?? 0) === 0) {
      const y1 = series.priceToCoordinate(1), y2 = series.priceToCoordinate(2);
      if (y1 != null && y2 != null) { const k = y2 - y1, c = y1 - k; toY = p => c + k * p; }
    }
    if (fan.kind === 'vp') return this._drawVp(target, { from, to, toIdx, n, xs, toY, cumPV, cumVol });
    // Style buckets: key -> {style, width, order, path}
    const buckets = new Map();
    // 'flat' mode: per-bar sum / count of every drawn line, for the average aVWAP.
    const avg = fan.colorMode === 'flat' ? { sum: new Float64Array(to - from + 1), cnt: new Uint32Array(to - from + 1) } : null;
    // 'slope' mode: a path per direction and level (see FAN_SLOPE_*).
    const slope = fan.colorMode === 'slope'
      ? { paths: FAN_SLOPE_STYLES.map(lvls => lvls.map(() => new Path2D())), atr: eng._getAtr(FAN_SLOPE_ATR) }
      : null;
    fan.anchors.forEach((a, k) => {
      const st = fan.styles[k];
      if (!st || !st.visible || a > to || a > toIdx || fan.confirm[k] > n) return;
      let b = null;
      if (!slope) {
        b = buckets.get(st.key);
        if (!b) { b = { color: st.color, width: st.width, order: st.order, path: new Path2D() }; buckets.set(st.key, b); }
      }
      const pvBase = a > 0 ? cumPV[a - 1] : 0, volBase = a > 0 ? cumVol[a - 1] : 0;
      let pen = false, px = 0, py = 0, pv = 0;
      for (let i = Math.max(a, from); i <= to; i++) {
        const vol = cumVol[i] - volBase;
        if (!(vol > 0)) continue;
        const v = (cumPV[i] - pvBase) / vol;
        if (avg) { avg.sum[i - from] += v; avg.cnt[i - from]++; }
        const y = toY(v);
        const x = xs[i - from];
        if (y == null || Number.isNaN(x)) { pen = false; continue; }
        if (slope) {
          if (pen) {
            const atr = slope.atr[i], t = atr > 0 ? Math.min(1, Math.abs(v - pv) / atr / FAN_SLOPE_SCALE) : 0;
            const path = slope.paths[v >= pv ? 0 : 1][Math.round(t * FAN_SLOPE_LEVELS)];
            path.moveTo(px, py); path.lineTo(x, y);
          }
          px = x; py = y; pv = v; pen = true;
        } else if (pen) b.path.lineTo(x, y); else { b.path.moveTo(x, y); pen = true; }
      }
    });
    let avgPath = null;
    if (avg) {
      avgPath = new Path2D();
      let pen = false;
      for (let i = from; i <= to; i++) {
        const c = avg.cnt[i - from], x = xs[i - from];
        const y = c ? toY(avg.sum[i - from] / c) : null;
        if (y == null || Number.isNaN(x)) { pen = false; continue; }
        if (pen) avgPath.lineTo(x, y); else { avgPath.moveTo(x, y); pen = true; }
      }
    }
    target.useMediaCoordinateSpace(({ context: ctx }) => {
      ctx.save();
      ctx.lineJoin = 'round';
      for (const b of [...buckets.values()].sort((p, q) => p.order - q.order)) {
        ctx.strokeStyle = b.color;
        ctx.lineWidth = b.width;
        ctx.stroke(b.path);
      }
      if (slope) {
        ctx.lineWidth = 1;
        // Faintest first, so steep segments draw over flat ones.
        for (let k = 0; k <= FAN_SLOPE_LEVELS; k++) for (let d = 0; d < 2; d++) {
          ctx.strokeStyle = FAN_SLOPE_STYLES[d][k]; ctx.stroke(slope.paths[d][k]);
        }
      }
      if (avgPath) {
        ctx.strokeStyle = C_FAN_AVG;
        ctx.lineWidth = FAN_AVG_WIDTH;
        ctx.stroke(avgPath);
      }
      ctx.restore();
    });
  }

  /** 'vp' fan: each segment colored from the Volume Profile share of the
   * price level it sits at (segment's end point) per the fan's mode (see
   * FAN_VP_MODES), batched by color and level. */
  _drawVp(target, { from, to, toIdx, n, xs, toY, cumPV, cumVol }) {
    const fan = this._fan, vp = fan.vp, mode = fan.colorMode;
    if (!vp) return;
    const { priceMin, binSize, bins } = vp;
    let maxBin = 0;
    for (const v of bins) if (v > maxBin) maxBin = v;
    if (!(maxBin > 0)) return;
    const nb = bins.length;
    // Two palettes (volume orange / LVN indigo), FAN_VP_LEVELS paths each;
    // 'barvol' uses the orange paths, by bar volume instead of price level.
    const orange = Array.from({ length: FAN_VP_LEVELS }, () => new Path2D());
    const indigo = Array.from({ length: FAN_VP_LEVELS }, () => new Path2D());
    const zero = new Path2D();   // zero-volume levels in 'hvn' — not drawn
    // 'barvol': per-bar volume level for each visible bar.
    let barLv = null;
    if (mode === 'barvol') {
      const vols = this._engine._volumes, ref = fan.volRef || 1;
      barLv = new Int16Array(to - from + 1);
      for (let i = from; i <= to; i++) barLv[i - from] = Math.min(FAN_VP_LEVELS - 1, Math.floor(Math.min(1, vols[i] / ref) * FAN_VP_LEVELS));
    }
    const lv = t => Math.min(FAN_VP_LEVELS - 1, Math.max(0, Math.floor(t * FAN_VP_LEVELS)));
    const pocPath = new Path2D();   // 'anchor': lines anchored at a POC-level close
    // 'anchor': one path per line, from its anchor candle's close level.
    const binOf = price => Math.min(nb - 1, Math.max(0, Math.floor((price - priceMin) / binSize)));
    const anchorPath = a => {
      const b = binOf(this._engine._closes[a]), s = bins[b] / maxBin;
      if (bins[b] === maxBin) return pocPath;
      return s >= 0.5 ? orange[lv((s - 0.5) * 2)] : indigo[lv((0.5 - s) * 2)];
    };
    const pathOf = (price, i) => {
      if (mode === 'barvol') return orange[barLv[i - from]];
      const b = Math.min(nb - 1, Math.max(0, Math.floor((price - priceMin) / binSize)));
      const s = bins[b] / maxBin;
      if (mode === 'hvn' && !(bins[b] > 0)) return zero;
      if (mode === 'both') return s >= 0.5 ? orange[lv((s - 0.5) * 2)] : indigo[lv((0.5 - s) * 2)];
      return orange[lv(s)];
    };
    fan.anchors.forEach((a, k) => {
      if (a > to || a > toIdx || fan.confirm[k] > n) return;
      const pvBase = a > 0 ? cumPV[a - 1] : 0, volBase = a > 0 ? cumVol[a - 1] : 0;
      const linePath = mode === 'anchor' ? anchorPath(a) : null;
      let px = NaN, py = NaN;
      for (let i = Math.max(a, from); i <= to; i++) {
        const vol = cumVol[i] - volBase;
        if (!(vol > 0)) continue;
        const price = (cumPV[i] - pvBase) / vol;
        const x = xs[i - from], y = toY(price);
        if (y == null || Number.isNaN(x)) { px = NaN; continue; }
        if (!Number.isNaN(px)) {
          const path = linePath ?? pathOf(price, i);
          path.moveTo(px, py); path.lineTo(x, y);
        }
        px = x; py = y;
      }
    });
    target.useMediaCoordinateSpace(({ context: ctx }) => {
      ctx.save();
      ctx.lineWidth = 1;
      ctx.lineCap = 'round';
      for (const [paths, rgb] of [[orange, VP_RGB_DEFAULT], [indigo, VP_RGB_LVN]]) {
        paths.forEach((path, k) => {
          const alpha = FAN_VP_ALPHA_FLOOR + (FAN_VP_ALPHA_MAX - FAN_VP_ALPHA_FLOOR) * Math.pow(k / (FAN_VP_LEVELS - 1), FAN_VP_GAMMA);
          ctx.strokeStyle = `rgba(${rgb},${alpha.toFixed(3)})`;
          ctx.stroke(path);
        });
      }
      ctx.strokeStyle = C_FAN_ANCHOR_POC;
      ctx.stroke(pocPath);
      ctx.restore();
    });
  }
}

// Price → y for a series: on a linear price scale a straight line through two
// reference prices (far cheaper than priceToCoordinate per point), otherwise
// the API.
function priceToYFn(series) {
  let toY = p => series.priceToCoordinate(p);
  if ((series.priceScale().options().mode ?? 0) === 0) {
    const y1 = series.priceToCoordinate(1), y2 = series.priceToCoordinate(2);
    if (y1 != null && y2 != null) { const k = y2 - y1, c = y1 - k; toY = p => c + k * p; }
  }
  return toY;
}

// σ-band cloud for a Shift+. anchor (see STDEV_CLOUD_MODES), a series
// primitive on the anchor's aVWAP line. Reads the per-bar aVWAP / σ arrays
// and span Volume Profile the engine keeps in entry.cloud (refreshed every
// replay step); draws only visible bars, batched into a few strokes.
class StdevCloudPrimitive {
  constructor(engine, entry) {
    this._engine = engine;
    this._entry = entry;
    const renderer = { draw: target => this._draw(target) };
    this._views = [{ renderer: () => renderer, zOrder: () => 'normal' }];
  }
  attached({ chart, series, requestUpdate }) { this._chart = chart; this._series = series; this._request = requestUpdate; }
  detached() { this._chart = this._series = this._request = null; }
  paneViews() { return this._views; }
  update() { this._request?.(); }

  _draw(target) {
    const entry = this._entry, c = entry.cloud, mode = entry.stdevMode;
    if (!this._chart || !this._series || !c || mode === 'bands') return;
    const ts = this._chart.timeScale();
    const range = ts.getVisibleLogicalRange();
    if (!range) return;
    const from = Math.max(c.from, Math.floor(range.from) - 1), to = Math.min(c.to, Math.ceil(range.to) + 1);
    if (to < from) return;
    const xs = new Float64Array(to - from + 1);
    for (let i = from; i <= to; i++) xs[i - from] = ts.logicalToCoordinate(i) ?? NaN;
    const toY = priceToYFn(this._series);
    const vw = c.vwap, sd = c.sd;
    // Volume Profile share at a price (vp/mixed), null outside the traded range.
    let shareAt = () => null;
    if (c.vp && (mode === 'vp' || mode === 'mixed')) {
      const { priceMin, binSize, bins } = c.vp;
      let maxBin = 0; for (const v of bins) if (v > maxBin) maxBin = v;
      const nb = bins.length;
      shareAt = p => {
        const b = Math.floor((p - priceMin) / binSize);
        return (b < 0 || b >= nb || !(maxBin > 0)) ? null : bins[b] / maxBin;
      };
    }
    const L = FAN_VP_LEVELS;
    const orange = Array.from({ length: L }, () => new Path2D());
    const indigo = Array.from({ length: L }, () => new Path2D());
    const sigmaPaths = [];   // [{rgb, alpha, path}] — one per cloud line in 'sigma'
    const lv = t => Math.min(L - 1, Math.max(0, Math.floor(t * L)));
    const steps = Math.round(STDEV_CLOUD_K / STDEV_CLOUD_STEP);
    for (let s = -steps; s <= steps; s++) {
      if (s === 0) continue;                     // the aVWAP line itself
      const k = s * STDEV_CLOUD_STEP;
      let sigmaPath = null;
      if (mode === 'sigma') {
        const t = 1 - Math.abs(k) / STDEV_CLOUD_K;
        sigmaPath = new Path2D();
        sigmaPaths.push({ rgb: k < 0 ? C_VALLEY_RGB : C_PEAK_RGB,
                          alpha: SIGMA_ALPHA_MIN + (SIGMA_ALPHA_MAX - SIGMA_ALPHA_MIN) * t * t, path: sigmaPath });
      }
      let px = NaN, py = NaN;
      for (let i = from; i <= to; i++) {
        const j = i - c.from;
        const v = vw[j], d = sd[j];
        const x = xs[i - from];
        if (Number.isNaN(v) || Number.isNaN(d) || Number.isNaN(x)) { px = NaN; continue; }
        const price = v + k * d, y = toY(price);
        if (y == null) { px = NaN; continue; }
        if (!Number.isNaN(px)) {
          let path = sigmaPath;
          if (!path) {
            const sh = shareAt(price);
            if (sh == null) { px = x; py = y; continue; }
            path = mode === 'mixed'
              ? (sh >= 0.5 ? orange[lv((sh - 0.5) * 2)] : indigo[lv((0.5 - sh) * 2)])
              : (sh > 0 ? orange[lv(sh)] : null);
          }
          if (path) { path.moveTo(px, py); path.lineTo(x, y); }
        }
        px = x; py = y;
      }
    }
    // The anchor's own aVWAP, per segment (see AVWAP_VP_WIDTH_* / C_SLOPE_*).
    const main = [];   // [{x0, y0, x1, y1, color, width}]
    {
      let px = NaN, py = NaN;
      for (let i = from; i <= to; i++) {
        const j = i - c.from, v = vw[j], x = xs[i - from];
        const y = Number.isNaN(v) ? null : toY(v);
        if (y == null || Number.isNaN(x)) { px = NaN; continue; }
        if (!Number.isNaN(px)) {
          let color, width = 2;
          if (mode === 'sigma') {
            const t = Math.max(-1, Math.min(1, c.slope[j] / (c.slopeRef || 1)));
            const to_ = t >= 0 ? C_SLOPE_UP : C_SLOPE_DOWN, a = Math.abs(t);
            const rgb = C_SLOPE_FLAT.map((f, q) => Math.round(f + (to_[q] - f) * a));
            color = `rgba(${rgb.join(',')},0.95)`;
          } else {
            const sh = shareAt(v) ?? 0;
            if (mode === 'mixed') color = `rgba(${sh >= 0.5 ? VP_RGB_DEFAULT : VP_RGB_LVN},0.95)`;
            else { color = `rgba(${VP_RGB_DEFAULT},0.95)`; width = AVWAP_VP_WIDTH_MIN + (AVWAP_VP_WIDTH_MAX - AVWAP_VP_WIDTH_MIN) * sh; }
          }
          main.push({ x0: px, y0: py, x1: x, y1: y, color, width });
        }
        px = x; py = y;
      }
    }
    // σ ticks at the whole multiples.
    const ticks = new Path2D();
    for (let m = 1; m <= STDEV_CLOUD_K; m++) {
      for (const sign of [-1, 1]) {
        let pen = false;
        for (let i = from; i <= to; i++) {
          const j = i - c.from, v = vw[j], d = sd[j], x = xs[i - from];
          const y = Number.isNaN(v) || Number.isNaN(d) ? null : toY(v + sign * m * d);
          if (y == null || Number.isNaN(x)) { pen = false; continue; }
          if (pen) ticks.lineTo(x, y); else { ticks.moveTo(x, y); pen = true; }
        }
      }
    }
    target.useMediaCoordinateSpace(({ context: ctx }) => {
      ctx.save();
      ctx.lineWidth = 1;
      if (mode === 'sigma') {
        for (const { rgb, alpha, path } of sigmaPaths) { ctx.strokeStyle = `rgba(${rgb},${alpha.toFixed(3)})`; ctx.stroke(path); }
      } else {
        for (const [paths, rgb] of [[orange, VP_RGB_DEFAULT], [indigo, VP_RGB_LVN]]) {
          paths.forEach((path, q) => {
            const alpha = FAN_VP_ALPHA_FLOOR + (FAN_VP_ALPHA_MAX - FAN_VP_ALPHA_FLOOR) * Math.pow(q / (L - 1), FAN_VP_GAMMA);
            ctx.strokeStyle = `rgba(${rgb},${alpha.toFixed(3)})`;
            ctx.stroke(path);
          });
        }
      }
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = STDEV_TICK_COLOR;
      ctx.stroke(ticks);
      ctx.setLineDash([]);
      ctx.lineCap = 'round';
      for (const sgm of main) {
        ctx.strokeStyle = sgm.color;
        ctx.lineWidth = sgm.width;
        ctx.beginPath(); ctx.moveTo(sgm.x0, sgm.y0); ctx.lineTo(sgm.x1, sgm.y1); ctx.stroke();
      }
      ctx.restore();
    });
  }
}

// The '<' profile anchor's own aVWAP — and its other-side aVWAP — drawn
// by ProfileLinePrimitive in every profile mode (their chart series stay
// transparent), per segment, coded like the mode's histogram:
//   normal (VP_MODE_NORMAL) — volume orange, width PROFILE_LINE_WIDTH_MIN..MAX
//     and opacity PROFILE_LINE_ALPHA_MIN..0.95 by the level's volume share of
//     the POC (bold through heavily traded levels);
//   LVN (VP_MODE_LVN) — indigo, the same scales by 1 − share (bold through
//     thin / untraded levels);
//   Both (VP_MODE_BOTH) / line-only (VP_MODE_POCS) — orange above half the
//     POC's volume, indigo below (the mixed histogram's split), width by node
//     strength: the level's distance from that midpoint.
// Wherever a segment crosses one of the mode's peak levels (profilePeakColors)
// it takes that peak's color instead — the POC yellow, HVN peaks bright
// orange, LVN troughs electric violet. The histogram itself stays plain.
const PROFILE_LINE_WIDTH_MIN = 1;
const PROFILE_LINE_WIDTH_MAX = 5;
const PROFILE_LINE_ALPHA_MIN = 0.35;
const C_PROFILE_LINE_POC     = 'rgba(255,214,0,1)';
const C_PROFILE_PEAK_HVN     = 'rgba(255,190,90,1)';
const C_PROFILE_PEAK_LVN     = 'rgba(190,40,255,1)';
const PROFILE_PEAK_WINDOW    = 4;   // levels each side a local peak must top
// Line-only mode also flattens the mixed histogram into one vertical strip at
// the profile's left edge (the anchor bar, growing right), spanning its price
// range: each level a slice in its color, width PROFILE_STRIP_WIDTH_MIN..MAX
// and opacity PROFILE_STRIP_ALPHA_MIN..1 by node strength; peak levels keep
// their size but take their peak color.
const PROFILE_STRIP_WIDTH_MIN = 1;
const PROFILE_STRIP_WIDTH_MAX = 8;
const PROFILE_STRIP_ALPHA_MIN = 0.25;

/** Peak levels of a profile for a display mode, as Map(bin → color): the
 * POC (yellow) always, plus
 *   'hvn'  — every local maximum: a level at least as busy as everything
 *            within PROFILE_PEAK_WINDOW levels each side (bright orange);
 *   'lvn'  — every local minimum, at least as thin, a full node window in
 *            from the profile's edges (its thin top / bottom aren't troughs),
 *            plus the deepest trough by the LVN POC rule (electric violet);
 *   'both' — per HVN / LVN zone (contiguous levels on one side of half the
 *            POC's volume): an orange zone's local maxima and busiest level,
 *            an indigo zone's local minima and deepest trough.
 * Tied runs collapse to their middle. */
function profilePeakColors(bins, mode) {
  const n = bins.length, out = new Map();
  const poc = Math.max(...bins);
  if (!(poc > 0)) return out;
  const K = PROFILE_PEAK_WINDOW, W = MANUAL_VP_NODE_WINDOW;
  const hvnOf = b => mode === 'hvn' ? true : mode === 'lvn' ? false : bins[b] / poc >= 0.5;
  // zones ('both' only splits the profile; 'hvn' / 'lvn' are one zone each)
  const zoneOf = new Int32Array(n);
  let z = 0;
  for (let b = 1; b < n; b++) { if (hvnOf(b) !== hvnOf(b - 1)) z++; zoneOf[b] = z; }
  const add = (b, hvn) => out.set(b, bins[b] === poc ? C_PROFILE_LINE_POC : hvn ? C_PROFILE_PEAK_HVN : C_PROFILE_PEAK_LVN);
  // Local extremes within each zone.
  const isPk = new Array(n).fill(false);
  for (let b = 0; b < n; b++) {
    const hvn = hvnOf(b);
    if (!hvn && (b < W || b >= n - W)) continue;
    let ok = true, strict = false;
    for (let j = Math.max(0, b - K); j <= Math.min(n - 1, b + K) && ok; j++) {
      if (j === b) continue;
      if (hvn ? bins[j] > bins[b] : bins[j] < bins[b]) ok = false;
      else if (bins[j] !== bins[b]) strict = true;
    }
    isPk[b] = ok && strict;
  }
  for (let b = 0; b < n; b++) {
    if (!isPk[b]) continue;
    let e = b;
    while (e + 1 < n && isPk[e + 1] && bins[e + 1] === bins[b] && zoneOf[e + 1] === zoneOf[b]) e++;
    add(Math.floor((b + e) / 2), hvnOf(b));
    b = e;
  }
  // Each zone's main peak: orange — its busiest level (middle of a tie);
  // indigo — its deepest trough by the LVN POC rule (bins equal to their full
  // centered node window's min, widest run on ties), else its thinnest level
  // a window in from the edges (else just off them).
  const trough = new Array(n).fill(false);
  for (let i = W; i < n - W; i++) {
    let mn = Infinity;
    for (let j = i - W; j <= i + W; j++) if (bins[j] < mn) mn = bins[j];
    trough[i] = bins[i] === mn;
  }
  for (let zz = 0; zz <= z; zz++) {
    let first = -1, last = -1;
    for (let b = 0; b < n; b++) if (zoneOf[b] === zz) { if (first < 0) first = b; last = b; }
    if (first < 0) continue;
    if (hvnOf(first)) {
      let m = first;
      for (let b = first; b <= last; b++) if (bins[b] > bins[m]) m = b;
      let e = m;
      while (e + 1 <= last && bins[e + 1] === bins[m]) e++;
      add(Math.floor((m + e) / 2), true);
      continue;
    }
    let best = null;
    for (let i = first; i <= last; i++) {
      if (!trough[i]) continue;
      let j = i;
      while (j + 1 <= last && trough[j + 1]) j++;
      if (!best || bins[i] < bins[best[0]] || (bins[i] === bins[best[0]] && j - i > best[1] - best[0])) best = [i, j];
      i = j;
    }
    if (best) { add(Math.floor((best[0] + best[1]) / 2), false); continue; }
    for (const [lo2, hi2] of [[Math.max(first, W), Math.min(last, n - 1 - W)], [Math.max(first, 1), Math.min(last, n - 2)]]) {
      let m = null;
      for (let b = lo2; b <= hi2; b++) if (m == null || bins[b] < bins[m]) m = b;
      if (m != null) { add(m, false); break; }
    }
  }
  // The POC itself, in every mode.
  for (let b = 0; b < n; b++) if (bins[b] === poc) { out.set(b, C_PROFILE_LINE_POC); }
  return out;
}

class ProfileLinePrimitive {
  constructor(engine, entry) {
    this._engine = engine;
    this._entry = entry;
    const renderer = { draw: target => this._draw(target) };
    this._views = [{ renderer: () => renderer, zOrder: () => 'top' }];
  }
  attached({ chart, series, requestUpdate }) { this._chart = chart; this._series = series; this._request = requestUpdate; }
  detached() { this._chart = this._series = this._request = null; }
  paneViews() { return this._views; }
  update() { this._request?.(); }

  _draw(target) {
    const entry = this._entry, vp = entry._vp, eng = this._engine;
    if (!this._chart || !this._series || !vp || entry._toIdx == null) return;
    const mode = entry.vpMode;
    const lineOnly = mode === VP_MODE_POCS, split = mode === VP_MODE_BOTH || lineOnly;
    const ts = this._chart.timeScale();
    const range = ts.getVisibleLogicalRange();
    if (!range) return;
    const { lo, bs, bins } = vp;
    const poc = Math.max(...bins);
    if (!(poc > 0)) return;
    const toY = priceToYFn(this._series);
    const toIdx = entry._toIdx;
    const peakColor = entry._peaks ?? new Map();
    const wOf = t => PROFILE_LINE_WIDTH_MIN + (PROFILE_LINE_WIDTH_MAX - PROFILE_LINE_WIDTH_MIN) * t;
    // Mode coding for a level's volume share of the POC → {color, width}.
    const styleOf = share => {
      if (split) {
        return { color: `rgba(${share >= 0.5 ? VP_RGB_DEFAULT : VP_RGB_LVN},0.95)`,
                 width: wOf(Math.min(1, Math.abs(share - 0.5) * 2)) };
      }
      const t = mode === VP_MODE_LVN ? 1 - share : share;
      return { color: `rgba(${mode === VP_MODE_LVN ? VP_RGB_LVN : VP_RGB_DEFAULT},${(PROFILE_LINE_ALPHA_MIN + (0.95 - PROFILE_LINE_ALPHA_MIN) * t).toFixed(3)})`,
               width: wOf(t) };
    };
    // The anchor's aVWAP, plus the other-side aVWAP when present.
    const lines = [entry.anchorIdx];
    if (entry._otherIdx != null) lines.push(entry._otherIdx);
    const segsOf = a => {
      const from = Math.max(a, Math.floor(range.from) - 1), to = Math.min(toIdx, Math.ceil(range.to) + 1);
      const pvBase = a > 0 ? eng._cumPV[a - 1] : 0, volBase = a > 0 ? eng._cumVol[a - 1] : 0;
      const segs = [];
      let px = NaN, py = NaN, pv = NaN;
      for (let i = from; i <= to; i++) {
        const vol = eng._cumVol[i] - volBase;
        const x = ts.logicalToCoordinate(i);
        if (!(vol > 0) || x == null) { px = NaN; continue; }
        const v = (eng._cumPV[i] - pvBase) / vol, y = toY(v);
        if (y == null) { px = NaN; continue; }
        if (!Number.isNaN(px)) {
          const b = Math.floor((v - lo) / bs);
          const st = styleOf(b >= 0 && b < bins.length ? bins[b] / poc : 0);
          // A peak level anywhere the segment crosses (not just at its end —
          // a fast-moving aVWAP can jump several levels in one bar); the
          // POC wins over other peaks.
          let peak = null;
          if (peakColor.size) {
            const bA = Math.max(0, Math.floor((Math.min(v, pv) - lo) / bs));
            const bB = Math.min(bins.length - 1, Math.floor((Math.max(v, pv) - lo) / bs));
            for (let k = bA; k <= bB; k++) {
              const c = peakColor.get(k);
              if (c) { peak = c; if (c === C_PROFILE_LINE_POC) break; }
            }
          }
          segs.push({ x0: px, y0: py, x1: x, y1: y, color: peak ?? st.color, width: st.width });
        }
        px = x; py = y; pv = v;
      }
      return segs;
    };
    // Line-only: the flattened histogram strip at the profile's left edge.
    const strip = [];
    const xL = lineOnly ? ts.logicalToCoordinate(entry.anchorIdx) : null;
    if (xL != null) {
      for (let b = 0; b < bins.length; b++) {
        const yA = toY(lo + b * bs), yB = toY(lo + (b + 1) * bs);
        if (yA == null || yB == null) continue;
        const t = Math.min(1, Math.abs(bins[b] / poc - 0.5) * 2);
        strip.push({ x: xL, y: Math.min(yA, yB), h: Math.max(1, Math.abs(yB - yA)),
                     w: PROFILE_STRIP_WIDTH_MIN + (PROFILE_STRIP_WIDTH_MAX - PROFILE_STRIP_WIDTH_MIN) * t,
                     color: peakColor.get(b)      // a peak: its own size, special color
                       ?? `rgba(${bins[b] / poc >= 0.5 ? VP_RGB_DEFAULT : VP_RGB_LVN},${(PROFILE_STRIP_ALPHA_MIN + (1 - PROFILE_STRIP_ALPHA_MIN) * t).toFixed(3)})` });
      }
    }
    target.useMediaCoordinateSpace(({ context: ctx }) => {
      ctx.save();
      for (const sl of strip) { ctx.fillStyle = sl.color; ctx.fillRect(sl.x, sl.y, sl.w, sl.h); }
      ctx.lineCap = 'round';
      for (const a of lines) {
        for (const sg of segsOf(a)) {
          ctx.strokeStyle = sg.color;
          ctx.lineWidth = sg.width;
          ctx.beginPath(); ctx.moveTo(sg.x0, sg.y0); ctx.lineTo(sg.x1, sg.y1); ctx.stroke();
        }
      }
      ctx.restore();
    });
  }
}

export class DynamicVWAPEngine {
  /**
   * @param {object} lwChart  — raw LightweightCharts chart instance
   */
  constructor(lwChart) {
    this._chart   = lwChart;
    this._bars    = [];
    this._highs   = null;   // Float64Array — bar highs for PMM peak detection
    this._lows    = null;   // Float64Array — bar lows  for PMM valley detection
    this._closes  = null;   // Float64Array — bar closes, for ATR (curve coloring)
    this._atrCache = {};    // period -> Float64Array, memoized across reveal() calls
    this._cumPV   = null;   // Float64Array — cumulative (typical_price × volume)
    this._cumVol  = null;   // Float64Array — cumulative volume
    this._peaks   = [];
    this._valleys = [];
    this._qqEvts  = [];     // [{committed_bar, anchor_bar, direction}] sorted by committed_bar
    this._maxP    = 0;
    this._maxV    = 0;
    this._maxQQ   = 0;
    this._peaksHalf   = 0;
    this._valleysHalf = 0;
    this._pPool   = [];
    this._vPool   = [];
    this._qbPool  = [];     // LineSeries pool — QQEMOD bear anchors (teal)
    this._qlPool  = [];     // LineSeries pool — QQEMOD bull anchors (red)
    // Generic anchor pools for OB / BoS / CHoCH / gap / peaks / valleys aVWAPs
    this._anchorPools = {};
    // PMM — recomputed via greedyExtrema at every reveal(n)
    // Array of {valleys, peaks, maxAnchors, spacing, vSeries[], pSeries[]}
    this._pmmPools = [];
    // Manual (click-placed) anchors — ephemeral, keyed by anchor bar index
    // Manual anchors by unique id ('m1', 'm2', ...) — not by bar index, so
    // different kinds (plain '.', Shift+. stdev, '<' profile) can share
    // a candle. Each entry carries its own anchorIdx and kind.
    this._manualSeries = {};
    this._manualSeq    = 0;
    this._manualOrder  = []; // anchor ids (or {fan} entries) in placement order, for undo (LIFO)
    this._manualFans   = []; // Alt+. fans (see createManualFan)
    this._lastN = 0; // last n passed to reveal() — for clamping a hold-and-drag's end point
  }

  // ── Setup ──────────────────────────────────────────────────────────────────

  _series(color, width = 2, lineStyle = 0) {
    return this._chart.addSeries(LightweightCharts.LineSeries, {
      color,
      lineWidth:              width,
      lineStyle,
      priceLineVisible:       false,
      lastValueVisible:       false,
      crosshairMarkerVisible: false,
    });
  }

  _buildPools() {
    this._destroyPools();
    this._pPool  = Array.from({ length: this._maxP  }, () => this._series(C_PEAK));
    this._vPool  = Array.from({ length: this._maxV  }, () => this._series(C_VALLEY));
    this._qbPool = Array.from({ length: this._maxQQ }, () => this._series(C_QQ_BEAR, 1));
    this._qlPool = Array.from({ length: this._maxQQ }, () => this._series(C_QQ_BULL, 1));
  }

  _destroyPools() {
    for (const s of [...this._pPool, ...this._vPool, ...this._qbPool, ...this._qlPool]) {
      try { this._chart.removeSeries(s); } catch (_) {}
    }
    this._pPool = []; this._vPool = []; this._qbPool = []; this._qlPool = [];
    for (const pool of Object.values(this._anchorPools)) {
      for (const s of pool.series) { try { this._chart.removeSeries(s); } catch (_) {} }
      for (const slotBands of pool.bands || []) {
        for (const band of slotBands) {
          try { this._chart.removeSeries(band.upper); } catch (_) {}
          try { this._chart.removeSeries(band.lower); } catch (_) {}
        }
      }
    }
    this._anchorPools = {};
    for (const p of this._pmmPools) {
      for (const s of [...p.vSeries, ...p.pSeries]) { try { this._chart.removeSeries(s); } catch (_) {} }
    }
    this._pmmPools = [];
    for (const entry of Object.values(this._manualSeries)) this._removeManualEntry(entry);
    this._manualSeries = {};
    this._manualOrder  = [];
    for (const fan of this._manualFans) this._removeFan(fan);
    this._manualFans = [];
  }

  // ── Manual (click-placed) anchors ───────────────────────────────────────

  /** Tear down one manual anchor's vwap line + any stdev band series + any paired profile + its other-side aVWAP. */
  _removeManualEntry(entry) {
    if (entry.cloudPrim) { try { entry.vwap.detachPrimitive(entry.cloudPrim); } catch (_) {} }
    if (entry.profileLinePrim) { try { entry.vwap.detachPrimitive(entry.profileLinePrim); } catch (_) {} }
    try { this._chart.removeSeries(entry.vwap); } catch (_) {}
    for (const band of entry.bands) {
      try { this._chart.removeSeries(band.upper); } catch (_) {}
      try { this._chart.removeSeries(band.lower); } catch (_) {}
    }
    if (entry.profile) { try { this._chart.removeSeries(entry.profile); } catch (_) {} }
    if (entry.otherSide?.line) { try { this._chart.removeSeries(entry.otherSide.line); } catch (_) {} }
  }

  /**
   * Volume-at-price histogram over [anchorIdx, toIdx] — same binning
   * technique as volume_profile.py's own _histogram (each bar's volume
   * distributed evenly across its own high-low range, into numBins equal
   * price buckets over the window's real nonzero-volume extent), ported
   * here against the already-built _highs/_lows/_volumes Float64Arrays
   * instead of a fresh numpy slice. Returns null if the range has no real
   * volume to build a histogram from.
   */
  _vpHistogram(anchorIdx, toIdx, numBins) {
    let priceMin = Infinity, priceMax = -Infinity;
    for (let i = anchorIdx; i <= toIdx; i++) {
      if (this._volumes[i] > 0) {
        if (this._lows[i]  < priceMin) priceMin = this._lows[i];
        if (this._highs[i] > priceMax) priceMax = this._highs[i];
      }
    }
    if (!Number.isFinite(priceMin) || priceMax <= priceMin) return null;

    const binSize = (priceMax - priceMin) / numBins;
    const bins = new Float64Array(numBins);
    for (let i = anchorIdx; i <= toIdx; i++) {
      const vol = this._volumes[i];
      if (vol <= 0) continue;
      const loBin = Math.max(0, Math.min(numBins - 1, Math.floor((this._lows[i]  - priceMin) / binSize)));
      const hiBin = Math.max(0, Math.min(numBins - 1, Math.floor((this._highs[i] - priceMin) / binSize)));
      const perBin = vol / (hiBin - loBin + 1);
      for (let b = loBin; b <= hiBin; b++) bins[b] += perBin;
    }
    return { priceMin, binSize, bins };
  }

  /** Point of Control + Value Area bounds — same expand-from-the-peak-bin
   * algorithm as volume_profile.py's own _poc_value_area. */
  _vpPocValueArea(priceMin, binSize, bins, targetPct) {
    const n = bins.length;
    let total = 0, pocBin = 0, pocVol = -Infinity;
    for (let b = 0; b < n; b++) {
      total += bins[b];
      if (bins[b] > pocVol) { pocVol = bins[b]; pocBin = b; }
    }
    const poc = priceMin + (pocBin + 0.5) * binSize;
    if (total <= 0) return { poc, vah: poc, val: poc };

    const target = total * targetPct;
    let lo = pocBin, hi = pocBin, acc = bins[pocBin];
    while (acc < target && (lo > 0 || hi < n - 1)) {
      const volBelow = lo > 0     ? bins[lo - 1] : -1;
      const volAbove = hi < n - 1 ? bins[hi + 1] : -1;
      if (volAbove >= volBelow) { hi++; acc += bins[hi]; }
      else                      { lo--; acc += bins[lo]; }
    }
    return { poc, val: priceMin + lo * binSize, vah: priceMin + (hi + 1) * binSize };
  }

  /** LVN-emphasis POC — same rule as volume_profile.py's _lvn_poc: midpoint
   * of the deepest local trough (bins equal to their own full centered
   * window's min, tied runs collapsed), widest run on ties; edge bins never
   * get a full window, so the line can't pin to the profile's thin top or
   * bottom. Falls back to the thinnest interior bin. */
  _vpLvnPoc(priceMin, binSize, bins, nodeWindow) {
    const n = bins.length;
    const isLvn = new Array(n).fill(false);
    for (let i = nodeWindow; i < n - nodeWindow; i++) {
      let mn = Infinity;
      for (let j = i - nodeWindow; j <= i + nodeWindow; j++) if (bins[j] < mn) mn = bins[j];
      isLvn[i] = bins[i] === mn;
    }
    let best = null;
    for (let i = 0; i < n; i++) {
      if (!isLvn[i]) continue;
      let j = i;
      while (j + 1 < n && isLvn[j + 1]) j++;
      if (!best || bins[i] < bins[best[0]] || (bins[i] === bins[best[0]] && j - i > best[1] - best[0])) best = [i, j];
      i = j;
    }
    if (best) return priceMin + (best[0] + best[1] + 1) / 2 * binSize;
    let minBin = n > 2 ? 1 : 0;
    for (let b = minBin; b < (n > 2 ? n - 1 : n); b++) if (bins[b] < bins[minBin]) minBin = b;
    return priceMin + (minBin + 0.5) * binSize;
  }

  /** Build the {lo, bs, bins, ...} payload VolumeProfileSeries expects, or
   * null if there's no real volume in [anchorIdx, toIdx] yet to show. lvn
   * switches it to LVN emphasis (see MANUAL_VP_LVN_LOCALITY). */
  _vpPayload(anchorIdx, toIdx, lvn = false) {
    const hist = this._vpHistogram(anchorIdx, toIdx, MANUAL_VP_NUM_BINS);
    if (!hist) return null;
    const { priceMin, binSize, bins } = hist;
    // Just POC, no Value Area — the dashed VAH/VAL lines and the dimming
    // VolumeProfileSeries applies to bars outside the value area both come
    // from passing vah/val, so omitting them (poc is a plain solid line,
    // unaffected) gives every bar the same flat fillOpacity with no dashes.
    const poc = lvn
      ? this._vpLvnPoc(priceMin, binSize, bins, MANUAL_VP_NODE_WINDOW)
      : this._vpPocValueArea(priceMin, binSize, bins, MANUAL_VP_VALUE_AREA_PCT).poc;
    // heatmapContrast 1 = plain proportional widths — the renderer's own
    // default (2.0) is tuned for the indicator's heatmap, not this tool.
    return {
      lo: priceMin, bs: binSize, bins: Array.from(bins), fillOpacity: MANUAL_VP_FILL_OPACITY,
      showHistogram: true, directionalColor: false, barStyle: 'bars', poc,
      heatmapContrast: 1, heatmapEmphasis: lvn ? 'lvn' : 'hvn',
      heatmapLocality: lvn ? MANUAL_VP_LVN_LOCALITY : 0, nodeWindow: MANUAL_VP_NODE_WINDOW,
    };
  }

  /**
   * Id of the existing manual anchor of the same `kind` within `tolerance`
   * bars of barIdx (the closest one) — hovering the exact bar you placed an
   * anchor on is brittle at typical zoom (a few px per bar), so removal looks
   * anchors up loosely. Only the same kind: a Shift+. tap never removes a
   * '<' profile anchor on that candle (or vice versa), so both can sit
   * on one candle.
   */
  _nearestManualAnchor(barIdx, kind, tolerance = 2) {
    let best = null, bestDist = Infinity;
    for (const [id, entry] of Object.entries(this._manualSeries)) {
      if (entry.kind !== kind) continue;
      const dist = Math.abs(entry.anchorIdx - barIdx);
      if (dist <= tolerance && dist < bestDist) { best = id; bestDist = dist; }
    }
    return best;
  }

  /** The manual entry of `kind` whose anchor — or, for a ranged one, its
   * end — is closest to barIdx within `tolerance` bars (newest on a tie),
   * or null: what a repeat key press over it cycles. */
  _manualEntryAt(barIdx, kind, tolerance = 2) {
    let best = null, bestDist = Infinity;
    for (const id of this._manualOrder) {
      const entry = typeof id === 'string' ? this._manualSeries[id] : null;
      if (!entry || entry.kind !== kind) continue;
      const dist = Math.min(Math.abs(entry.anchorIdx - barIdx),
        entry.fixedEnd != null ? Math.abs(entry.fixedEnd - barIdx) : Infinity);
      if (dist <= tolerance && dist <= bestDist) { best = entry; bestDist = dist; }
    }
    return best;
  }

  /** Remove a manual entry and its undo step. */
  _dropManualEntry(entry) {
    const id = Object.keys(this._manualSeries).find(k => this._manualSeries[k] === entry);
    if (id == null) return;
    this._removeManualEntry(entry);
    delete this._manualSeries[id];
    const i = this._manualOrder.indexOf(id);
    if (i !== -1) this._manualOrder.splice(i, 1);
  }

  static _manualKind(withStdev, withProfile) {
    return withProfile ? 'profile' : withStdev ? 'stdev' : 'plain';
  }

  /**
   * Place or remove a manually-anchored VWAP at anchorIdx, drawn out to
   * toIdx. withStdev also draws vwap +/- k*stdev bands (Shift+.) around it —
   * see _vwapStdevBands. withProfile (',' ',' or '<') also pairs a Volume Profile
   * with it, same anchor-to-toIdx span, removed together as one unit.
   * Returns true if an anchor was added, false if an existing one of the
   * same kind (plain / bands / profile) was removed.
   */
  toggleManualAnchor(anchorIdx, toIdx, withStdev = false, withProfile = false) {
    if (anchorIdx == null || anchorIdx < 0 || anchorIdx >= this._bars.length) return null;
    const kind = DynamicVWAPEngine._manualKind(withStdev, withProfile);
    // A repeat press of the key that made a bands / profile anchor, over its
    // anchor (or a ranged one's end), cycles its display mode, and past the
    // last mode removes it — as Shift+K / Shift+J cycle the candle coloring
    // back to standard. The next press starts the cycle over.
    if (kind !== 'plain') {
      const entry = this._manualEntryAt(anchorIdx, kind);
      if (entry) {
        const next = kind === 'profile' ? this._cycleProfileMode(entry) : this._cycleStdevMode(entry);
        if (next) return 'cycled';
        this._dropManualEntry(entry);
        return false;
      }
    }
    const existing = this._nearestManualAnchor(anchorIdx, kind);
    if (existing != null) {
      this._removeManualEntry(this._manualSeries[existing]);
      delete this._manualSeries[existing];
      const i = this._manualOrder.indexOf(existing);
      if (i !== -1) this._manualOrder.splice(i, 1);
      return false;
    }
    this._createManualAnchor(anchorIdx, toIdx, withStdev, withProfile, null);
    return true;
  }

  /**
   * Create a manual anchor spanning the fixed range [anchorIdx, toIdx] —
   * used when ',' marked anchorIdx as a range-start and '.'/Shift+./',' again
   * then finalizes it at toIdx (see replay.js's ',' and '.' keydown
   * handling). Unlike toggleManualAnchor, this always creates — it never
   * toggles off an existing nearby anchor, since ',' then '.' is a
   * distinct enough gesture from a plain tap that silently removing
   * something would be surprising.
   */
  createRangedManualAnchor(anchorIdx, toIdx, withStdev = false, withProfile = false) {
    if (anchorIdx == null || anchorIdx < 0 || anchorIdx >= this._bars.length) return null;
    if (toIdx == null || toIdx < 0 || toIdx >= this._bars.length) return null;
    const lo = Math.min(anchorIdx, toIdx), hi = Math.max(anchorIdx, toIdx);
    this._createManualAnchor(lo, hi, withStdev, withProfile, hi);
    return true;
  }

  /**
   * Shared creation body for toggleManualAnchor and createRangedManualAnchor
   * — a plain tap passes fixedEnd=null (grows to "now" on every reveal); a
   * ranged creation passes fixedEnd=toIdx (stays put at that range forever).
   */
  _createManualAnchor(anchorIdx, toIdx, withStdev, withProfile, fixedEnd) {
    // A profile's aVWAP is drawn by ProfileLinePrimitive (every mode) — its series stays transparent.
    const vwap = this._series(withProfile ? 'rgba(0,0,0,0)' : C_MANUAL, 2, 0);
    vwap.setData(this._vwapLine(anchorIdx, toIdx));

    const bands = [];
    if (withStdev) {
      const { bands: bandData, kMin, kMax } = this._vwapStdevBands(anchorIdx, toIdx, MANUAL_STDEV_MULTIPLES);
      for (const { k, upper, lower } of bandData) {
        const alpha = this._manualStdevAlpha(k, kMin, kMax);
        const upperSeries = this._series(`rgba(${C_MANUAL_STDEV_RGB},${alpha})`, 1, 2);
        const lowerSeries = this._series(`rgba(${C_MANUAL_STDEV_RGB},${alpha})`, 1, 2);
        upperSeries.setData(upper);
        lowerSeries.setData(lower);
        bands.push({ k, upper: upperSeries, lower: lowerSeries });
      }
    }

    let profile = null;
    if (withProfile) {
      const payload = this._vpPayload(anchorIdx, toIdx);
      if (payload) {
        profile = this._chart.addCustomSeries(new VolumeProfileSeries(), {
          priceLineVisible: false,
          lastValueVisible: false,
        });
        const startTime = (this._bars[anchorIdx].Date || this._bars[anchorIdx].date || '').slice(0, 10);
        const endTime   = (this._bars[toIdx].Date     || this._bars[toIdx].date     || '').slice(0, 10);
        profile.setData([{ time: startTime, ...payload }, { time: endTime, ...payload }]);
      }
    }

    // otherSide: {} means "wanted, not yet created" (its line is created
    // lazily on the first render, once we know whether it's a high or low
    // and can pick its color) — see _renderManualEntry.
    const id = `m${++this._manualSeq}`;
    this._manualSeries[id] = {
      anchorIdx, kind: DynamicVWAPEngine._manualKind(withStdev, withProfile),
      vwap, bands, profile, fixedEnd, vpMode: VP_MODE_NORMAL,
      stdevMode: 'bands', cloud: null, cloudPrim: null,
      otherSide: withProfile ? {} : null,
    };
    this._manualOrder.push(id);
    this._renderManualEntry(anchorIdx, this._manualSeries[id]);
  }

  /**
   * Undo the most recently placed manual anchor (LIFO), one per call.
   * Returns the removed anchor's bar index, or null if there are none left.
   */
  undoManualAnchor() {
    const last = this._manualOrder.pop();
    if (last === undefined) return null;
    if (last?.candle) return last;           // chart-level step (Shift+K candle mode) — chart.js restores it
    if (last?.fan) {                         // a whole fan is one undo step
      this._removeFan(last.fan);
      this._manualFans = this._manualFans.filter(f => f !== last.fan);
      return last.fan.anchors[0];
    }
    const entry = this._manualSeries[last];
    if (entry) this._removeManualEntry(entry);
    delete this._manualSeries[last];
    return entry ? entry.anchorIdx : null;
  }

  /** Bars a centered swing window of size `window` spans before / after its
   * bar — pandas rolling(window, center=True)'s split (peaks_valleys.py), so
   * an even window has one more bar before than after (10 → 5 / 4). */
  static _swingSides(window) {
    const before = Math.floor(window / 2);
    return { before, after: window - 1 - before };
  }

  /** Significance of bar idx: the largest window in FAN_PV_WINDOWS at
   * which it's a peak (kind 'peak') / valley ('valley'), or 0 if it isn't
   * one even at the smallest. Windows are clipped to the data available
   * (bar 0 .. n), so recent swings aren't penalised for having few bars
   * after them yet. */
  _swingSignificance(idx, kind, n) {
    const last = Math.min(n, this._bars.length - 1);
    let sig = 0;
    for (const w of FAN_PV_WINDOWS) {
      const { before, after } = DynamicVWAPEngine._swingSides(w);
      const from = Math.max(0, idx - before), to = Math.min(last, idx + after);
      let ok = true;
      for (let j = from; j <= to && ok; j++) {
        ok = kind === 'peak' ? this._highs[j] <= this._highs[idx] : this._lows[j] >= this._lows[idx];
      }
      if (!ok) break;
      sig = w;
    }
    return sig;
  }

  /**
   * aVWAP fan across [fromIdx, toIdx] — see the FAN_* constants. Lines grow
   * to "now" (fixedEnd null) or stop at fixedEnd (',' then the fan key). One
   * undo step for the whole fan.
   */
  createManualFan(fromIdx, toIdx, fixedEnd = null, kind = 'sig') {
    if (fromIdx == null || toIdx == null) return null;
    const lo = Math.max(0, Math.min(fromIdx, toIdx)), hi = Math.min(this._bars.length - 1, Math.max(fromIdx, toIdx));
    if (hi < lo) return null;
    const n = this._lastN;
    // Classify every candle: peak / valley (whichever survives the larger
    // window if both) with its significance, or in-between.
    let cands = [];
    for (let i = lo; i <= hi; i++) {
      const sp = this._swingSignificance(i, 'peak', n), sv = this._swingSignificance(i, 'valley', n);
      const kind = sp === 0 && sv === 0 ? null : (sp >= sv ? 'peak' : 'valley');
      cands.push({ idx: i, kind, raw: Math.max(sp, sv) });
    }
    // Drawing budget (FAN_POINT_BUDGET): each line costs its length in
    // points, up to the fan's end bar. Over budget → swings first (most
    // significant first), then evenly spaced in-between candles in what's left.
    const endBar = fixedEnd != null ? hi : n;
    const cost = c => Math.max(1, endBar - c.idx + 1);
    const budget = kind === 'vp' ? FAN_VP_POINT_BUDGET : FAN_POINT_BUDGET;
    if (cands.reduce((t, c) => t + cost(c), 0) > budget) {
      let left = budget;
      const keep = [];
      for (const c of cands.filter(c => c.kind).sort((x, y) => y.raw - x.raw)) {
        if (cost(c) > left) continue;
        keep.push(c); left -= cost(c);
      }
      const between = cands.filter(c => !c.kind);
      const avg = between.length ? between.reduce((t, c) => t + cost(c), 0) / between.length : 1;
      const room = Math.min(between.length, Math.floor(left / avg));
      for (let k = 0; k < room; k++) keep.push(between[Math.floor(k * between.length / room)]);
      cands = keep.sort((x, y) => x.idx - y.idx);
    }
    // Significance 0..1: in-between 0; swings on a log scale of the window
    // survived, relative to the fan's own most significant swing.
    const top = Math.max(0, ...cands.map(c => c.raw));
    const base = FAN_PV_WINDOWS[0];
    const sig = cands.map(c => !c.kind ? 0
      : top > base ? Math.log(c.raw / base) / Math.log(top / base) : 1);
    let maxI = -1, minI = -1;
    cands.forEach((c, i) => {
      if (c.kind === 'peak'   && (maxI < 0 || this._highs[c.idx] > this._highs[cands[maxI].idx])) maxI = i;
      if (c.kind === 'valley' && (minI < 0 || this._lows[c.idx]  < this._lows[cands[minI].idx]))  minI = i;
    });
    const fan = {
      kind, fixedEnd, lo, colorMode: kind === 'vp' ? 'hvn' : 'amber', maxI, minI, sig, vp: null,
      anchors: cands.map(c => c.idx),
      kinds:   cands.map(c => c.kind),
      confirm: cands.map(c => c.idx),
      styles:  [],
      _bounds: null,
    };
    // One invisible carrier series holds the fan's widest line (so the price
    // scale and the primitive's price conversion have real data); the
    // FanPrimitive attached to it draws every line.
    fan.carrier = this._series('rgba(0,0,0,0)', 1, 0);
    fan.carrierAnchor = Math.min(...fan.anchors);
    fan.primitive = new FanPrimitive(this, fan);
    fan.carrier.attachPrimitive(fan.primitive);
    this._applyFanColors(fan);
    this._manualFans.push(fan);
    this._manualOrder.push({ fan });
    this._renderFan(fan);
    return fan;
  }

  /** Line styling for the fan's current mode (see FAN_MODES): amber, or
   * peak red / valley teal with in-between candles grey, opacity and width
   * from significance — except 'flat': every line grey at FAN_FLAT_ALPHA,
   * 1px. In both non-amber modes the min/max aVWAPs (highest peak / lowest
   * valley) are drawn in the Min|Max colors. */
  _applyFanColors(fan) {
    if (fan.kind === 'vp') { fan.primitive?.update(); return; }   // drawn per mode in FanPrimitive._drawVp
    const redTeal = fan.colorMode !== 'amber';
    fan.styles = fan.anchors.map((_, i) => {
      const sg = fan.sig[i], kind = fan.kinds[i];
      const visible = true;
      if (redTeal && (i === fan.maxI || i === fan.minI)) {
        const color = i === fan.maxI ? C_FAN_MAX : C_FAN_MIN;
        return { visible, color, width: FAN_MINMAX_WIDTH, order: 2, key: color + '|w' + FAN_MINMAX_WIDTH };
      }
      const flat = fan.colorMode === 'flat';
      const rgb = !redTeal ? C_MANUAL_RGB
        : flat ? C_FAN_GREY_RGB
        : kind === 'peak' ? C_PEAK_RGB : kind === 'valley' ? C_VALLEY_RGB : C_FAN_GREY_RGB;
      // Opacity quantized to 0.02 steps so lines batch into few strokes.
      const raw = flat ? FAN_FLAT_ALPHA
        : !kind ? FAN_ALPHA_MIN : FAN_ALPHA_SWING_MIN + (FAN_ALPHA_MAX - FAN_ALPHA_SWING_MIN) * sg;
      const alpha = Math.round(raw * 50) / 50;
      const width = !flat && sg >= FAN_WIDE_MIN ? 2 : 1;
      const color = `rgba(${rgb},${alpha})`;
      return { visible, color, width, order: alpha + width, key: color + '|w' + width };
    });
    fan.primitive?.update();
  }

  /** aVWAP value from anchor a at bar i, or null where there's no volume yet. */
  _vwapAt(a, i) {
    const pvBase  = a > 0 ? this._cumPV[a - 1]  : 0;
    const volBase = a > 0 ? this._cumVol[a - 1] : 0;
    const vol = this._cumVol[i] - volBase;
    return vol > 0 ? (this._cumPV[i] - pvBase) / vol : null;
  }

  /** Bring a fan to the current replay bar: its end bar, the carrier line
   * (the fan's oldest anchor — appended one point per forward step, rebuilt
   * otherwise) and its bounding box (_bounds, extended incrementally on
   * forward steps). Drawing itself is FanPrimitive's. */
  _renderFan(fan) {
    const n = this._lastN;
    const toIdx = fan.fixedEnd != null ? Math.min(fan.fixedEnd, n) : n;
    const shown = i => fan.anchors[i] <= toIdx && fan.confirm[i] <= n;
    const step = fan._n === n - 1 && fan._bounds;
    if (step && toIdx > fan._toIdx) {
      const b = fan._bounds;
      const time = (this._bars[toIdx].Date || this._bars[toIdx].date || '').slice(0, 10);
      const cv = this._vwapAt(fan.carrierAnchor, toIdx);
      if (cv != null) fan.carrier.update({ time, value: cv });
      fan.anchors.forEach((a, i) => {
        if (!shown(i)) return;
        const v = this._vwapAt(a, toIdx);
        if (v == null) return;
        if (v < b.priceLo) b.priceLo = v; if (v > b.priceHi) b.priceHi = v;
        if (a < b.loBar) b.loBar = a;
      });
      b.hiBar = toIdx;
    } else if (!step) {
      fan.carrier.setData(fan.carrierAnchor <= toIdx ? this._vwapLine(fan.carrierAnchor, toIdx) : []);
      let pLo = Infinity, pHi = -Infinity, bLo = Infinity;
      fan.anchors.forEach((a, i) => {
        if (!shown(i)) return;
        const pvBase = a > 0 ? this._cumPV[a - 1] : 0, volBase = a > 0 ? this._cumVol[a - 1] : 0;
        for (let j = a; j <= toIdx; j++) {
          const vol = this._cumVol[j] - volBase;
          if (!(vol > 0)) continue;
          const v = (this._cumPV[j] - pvBase) / vol;
          if (v < pLo) pLo = v; if (v > pHi) pHi = v;
        }
        if (a < bLo) bLo = a;
      });
      fan._bounds = Number.isFinite(pLo) ? { loBar: bLo, hiBar: toIdx, priceLo: pLo, priceHi: pHi } : null;
    }
    // 'vp' fan: Volume Profile of the span so far (first anchor → end bar).
    if (fan.kind === 'vp') {
      const first = Math.min(...fan.anchors);
      fan.vp = first <= toIdx ? this._vpHistogram(first, toIdx, FAN_VP_BINS) : null;
      // Reference volume for 'barvol' per-bar shading: the span's
      // FAN_BARVOL_PCTL percentile of bar volume.
      if (first <= toIdx) {
        const v = Array.from(this._volumes.subarray(first, toIdx + 1)).sort((a, b) => a - b);
        fan.volRef = v[Math.min(v.length - 1, Math.floor(FAN_BARVOL_PCTL * (v.length - 1)))] || 1;
      }
    }
    fan._n = n; fan._toIdx = toIdx;
    fan.primitive.update();
  }

  _removeFan(fan) {
    try { fan.carrier.detachPrimitive(fan.primitive); } catch (_) {}
    try { this._chart.removeSeries(fan.carrier); } catch (_) {}
  }

  /** The fan of `kind` whose first anchor — or, for a ranged one, its end —
   * is closest to barIdx within `tolerance` bars (newest on a tie), or null. */
  _fanAt(barIdx, kind, tolerance = 2) {
    let best = null, bestDist = Infinity;
    for (const fan of this._manualFans) {
      if (fan.kind !== kind) continue;
      const dist = Math.min(Math.abs(fan.lo - barIdx),
        fan.fixedEnd != null ? Math.abs(fan.fixedEnd - barIdx) : Infinity);
      if (dist <= tolerance && dist <= bestDist) { best = fan; bestDist = dist; }
    }
    return best;
  }

  /** A repeat Alt+. / Ctrl+. over a fan's first anchor (or a ranged fan's
   * end): advance it to the next of FAN_MODES (amber → red/teal weighted →
   * grey flat → slope-colored) or FAN_VP_MODES, and past the last removes
   * it. Returns true if a fan was cycled or removed. */
  cycleFanAt(barIdx, kind) {
    const fan = this._fanAt(barIdx, kind);
    if (!fan) return false;
    const modes = fan.kind === 'vp' ? FAN_VP_MODES : FAN_MODES;
    const next = modes.indexOf(fan.colorMode) + 1;
    if (next >= modes.length) {
      // Past the last mode: the fan goes away (and its undo step with it).
      this._removeFan(fan);
      this._manualFans = this._manualFans.filter(f => f !== fan);
      this._manualOrder = this._manualOrder.filter(o => o?.fan !== fan);
      return true;
    }
    fan.colorMode = modes[next];
    this._applyFanColors(fan);
    return true;
  }

  // ── PMM greedy extrema ────────────────────────────────────────────────────

  /**
   * Greedy backward-looking extrema selection. Picks the global max/min, masks
   * out a spacing window around it, and repeats until nAnchors are found.
   * Returns an array of bar indices (ascending), length ≤ nAnchors.
   */
  _greedyExtrema(values, n, mode, nAnchors, spacing) {
    const mask = new Uint8Array(n + 1).fill(1);
    const selected = [];
    for (let iter = 0; iter < nAnchors; iter++) {
      let bestIdx = -1;
      let bestVal = mode === 'valley' ? Infinity : -Infinity;
      for (let i = 0; i <= n; i++) {
        if (!mask[i]) continue;
        const v = values[i];
        if (mode === 'valley' ? v < bestVal : v > bestVal) { bestVal = v; bestIdx = i; }
      }
      if (bestIdx === -1) break;
      selected.push(bestIdx);
      const lo = Math.max(0, bestIdx - spacing);
      const hi = Math.min(n + 1, bestIdx + spacing + 1);
      for (let j = lo; j < hi; j++) mask[j] = 0;
    }
    return selected.sort((a, b) => a - b);
  }

  /**
   * Find the "other side" extremum bar within (anchorIdx, toIdx] to pair a
   * second aVWAP with a manual anchor's Volume Profile — the swing-high
   * aVWAP complementing a swing-low anchor, or vice versa, so the profile
   * reads with both channel boundaries drawn in, not just the one the user
   * happened to anchor on. The anchor is classed as a peak or valley by the
   * bars after it (see below) and the other side is always the opposite
   * extreme: the range's lowest low after a peak, highest high after a
   * valley. Returns { idx, isHigh } or null if the range is too short.
   */
  /** Other-side aVWAP's series color — transparent: ProfileLinePrimitive
   * draws it, in every profile mode. */
  _otherSideColor(entry) {
    return 'rgba(0,0,0,0)';
  }

  _otherSideExtremum(anchorIdx, toIdx) {
    if (toIdx <= anchorIdx) return null;
    // Which side the anchor is on, judged by what price does AFTER it (the
    // aVWAP and profile both run forward from it, so how price got there —
    // e.g. a big gap up into the anchor candle — doesn't matter): a peak if
    // its high stands above more of the next OTHER_SIDE_WINDOW bars' highs
    // than its low stands below their lows, a valley otherwise; a tie goes
    // by its close vs those bars' average close. Near the latest bar, with
    // too few bars after it, the bars before it fill out the window.
    const n = this._highs.length;
    let jEnd = Math.min(n - 1, anchorIdx + OTHER_SIDE_WINDOW);
    let jStart = anchorIdx + 1;
    if (jEnd - anchorIdx < 3) jStart = Math.max(0, anchorIdx - OTHER_SIDE_WINDOW);
    let peakScore = 0, valleyScore = 0, closeSum = 0, cnt = 0;
    for (let j = jStart; j <= jEnd; j++) {
      if (j === anchorIdx) continue;
      if (this._highs[j] < this._highs[anchorIdx]) peakScore++;
      if (this._lows[j]  > this._lows[anchorIdx])  valleyScore++;
      closeSum += this._closes[j]; cnt++;
    }
    const isPeak = peakScore !== valleyScore ? peakScore > valleyScore
      : cnt > 0 && this._closes[anchorIdx] >= closeSum / cnt;
    // The other side: the range's lowest low after a peak, highest high
    // after a valley.
    let idx = -1, val = isPeak ? Infinity : -Infinity;
    for (let i = anchorIdx + 1; i <= toIdx; i++) {
      const v = isPeak ? this._lows[i] : this._highs[i];
      if (isPeak ? v < val : v > val) { val = v; idx = i; }
    }
    return idx === -1 ? null : { idx, isHigh: !isPeak };
  }

  _buildPmmPools(configs) {
    // Same proportional-contrast opacity ramp as peaks/valleys (see _cfgTierColor):
    // each PMM config's rank among however many configs are actually enabled for that
    // side (valleys / peaks) determines its opacity, instead of every config sharing
    // one fixed 0.75 regardless of count.
    const cfgList = configs || [];
    const valleyCfgs = cfgList.filter(c => c.valleys);
    const peakCfgs   = cfgList.filter(c => c.peaks);
    let vRank = 0, pRank = 0;
    for (const cfg of cfgList) {
      const vSeries = cfg.valleys
        ? Array.from({ length: cfg.max_anchors },
            () => this._series(_cfgTierColor(38, 166, 154, vRank, valleyCfgs.length)[0], 2))
        : [];
      if (cfg.valleys) vRank++;
      const pSeries = cfg.peaks
        ? Array.from({ length: cfg.max_anchors },
            () => this._series(_cfgTierColor(239, 83, 80, pRank, peakCfgs.length)[0], 2))
        : [];
      if (cfg.peaks) pRank++;
      this._pmmPools.push({ ...cfg, vSeries, pSeries });
    }
  }

  // rankMaps: { peak: Map<cfgIdx, {rank, total}>, valley: Map<...> } — built per
  // reveal by _buildAnchorPools from whichever configs actually produced anchors,
  // so opacity spacing reflects how many configs of that type are really present.
  _anchorPoolStyle(key, rankMaps = {}) {
    if (ANCHOR_POOL_STYLE[key]) return ANCHOR_POOL_STYLE[key];
    // Dynamic per-config peaks/valleys: peak_c0, peak_c1, valley_c0, valley_c1, ...
    let m = key.match(/^peak_c(\d+)$/);
    if (m) {
      // Per-point styles (curve_opacity/curve_heatmap/slope_gradient) color every
      // point individually at reveal() time (see _vwapLineColored/_vwapLineSlope) —
      // rank-tiering the base series color/width here would be pointless (hue gets
      // overridden) and misleading (implies configs are still distinguishable by
      // rank, which these modes intentionally give up). Flat base color instead,
      // same as C_PEAK's own default — but thinner (1px) than the usual width-2
      // lines, since these modes are meant to be layered/compared against each
      // other and a thin line makes overlaps and crossings easier to read.
      if (_PER_POINT_STYLES.has(this._peaksStyle)) {
        return [C_PEAK, 1, 0];
      }
      const info = rankMaps.peak?.get(parseInt(m[1])) ?? { rank: 0, total: 1 };
      // 'shades_orange' — same tiered-by-opacity treatment as 'shades',
      // just a different base hue (matches Volume Profile's own default
      // color), so it's its own mutually-exclusive styling choice rather
      // than a separate toggle layered on top of the others.
      if (this._peaksStyle === 'shades_orange') {
        return _cfgTierColor(...ORANGE_RGB, info.rank, info.total);
      }
      const colorFn = this._peaksStyle === 'highlight_first' ? _highlightFirstColor
                    : this._peaksStyle === 'grayscale'       ? _grayscaleColor
                    : _cfgTierColor;
      return colorFn(239, 83, 80, info.rank, info.total);
    }
    m = key.match(/^valley_c(\d+)$/);
    if (m) {
      if (_PER_POINT_STYLES.has(this._valleysStyle)) {
        return [C_VALLEY, 1, 0];
      }
      const info = rankMaps.valley?.get(parseInt(m[1])) ?? { rank: 0, total: 1 };
      if (this._valleysStyle === 'shades_orange') {
        return _cfgTierColor(...ORANGE_RGB, info.rank, info.total);
      }
      const colorFn = this._valleysStyle === 'highlight_first' ? _highlightFirstColor
                     : this._valleysStyle === 'grayscale'      ? _grayscaleColor
                     : _cfgTierColor;
      return colorFn(38, 166, 154, info.rank, info.total);
    }
    return null;
  }

  _buildAnchorPools(anchors) {
    // Collect, per type (peak / valley), the set of config indices that actually
    // produced anchors — ranked so opacity spacing reflects the real count, not gaps
    // left by a config that produced zero anchors (e.g. too little history).
    const idxByType = {};
    for (const [key, events] of Object.entries(anchors || {})) {
      if (!events.length) continue;
      const m = key.match(/^(peak|valley)_c(\d+)$/);
      if (m) (idxByType[m[1]] ??= new Set()).add(parseInt(m[2]));
    }
    const rankMaps = {};
    for (const [type, idxSet] of Object.entries(idxByType)) {
      const sorted = [...idxSet].sort((a, b) => a - b);
      rankMaps[type] = new Map(sorted.map((idx, rank) => [idx, { rank, total: sorted.length }]));
    }

    for (const [key, events] of Object.entries(anchors || {})) {
      if (!events.length) continue;
      const style = this._anchorPoolStyle(key, rankMaps);
      if (!style) continue;
      const [color, lineWidth, lineStyle] = style;
      const series = events.map(() => this._series(color, lineWidth, lineStyle));
      // StDev bands — one reusable {k, upper, lower} series-set per slot,
      // same "N reusable slots filled by rank" convention as series itself
      // (all slots in one pool share this pool's own color/multiples
      // regardless of which specific anchor currently fills them).
      let bands = null;
      const isPeakKey   = /^peak_c\d+$/.test(key);
      const isValleyKey = /^valley_c\d+$/.test(key);
      const showStdev = isPeakKey ? this._peaksShowStdev : isValleyKey ? this._valleysShowStdev : false;
      if (showStdev) {
        const multiples = isPeakKey ? this._peaksStdevMults : this._valleysStdevMults;
        const kMin = Math.min(...multiples), kMax = Math.max(...multiples);
        bands = events.map(() => multiples.map(k => {
          const alpha = this._manualStdevAlpha(k, kMin, kMax);
          return {
            k,
            upper: this._series(`rgba(${color.match(/[\d.]+/g).slice(0, 3).join(',')},${alpha})`, 1, 2),
            lower: this._series(`rgba(${color.match(/[\d.]+/g).slice(0, 3).join(',')},${alpha})`, 1, 2),
          };
        }));
      }
      this._anchorPools[key] = {
        events: [...events].sort((a, b) => a.anchor_bar - b.anchor_bar),
        series,
        bands,
      };
    }
  }

  /**
   * Load event data and pre-build cumulative arrays.
   * Call once after bars are available.
   */
  load(bars, events) {
    this._bars    = bars;
    this._peaks       = [];   // retired — peaks/valleys now handled via _anchorPools
    this._valleys     = [];
    this._qqEvts      = [...(events.qqemod_events || [])].sort((a, b) => a.committed_bar - b.committed_bar);
    this._maxP        = 0;
    this._maxV        = 0;
    this._maxQQ       = events.max_qqemod   || 0;
    this._peaksHalf   = 0;
    this._valleysHalf = 0;
    // Single merged style choice — 'shades'/'highlight_first'/'grayscale' (rank-based,
    // see _anchorPoolStyle), 'curve_opacity'/'curve_heatmap' (per-point curvature
    // relative to this line's own history, see _vwapLineColored), or 'slope_gradient'
    // (per-point instantaneous slope, no history, see _vwapLineSlope) — all consulted
    // at reveal() time. curve_slope_window/curve_atr_period/slope_scale are separate
    // tuning knobs, only used when the style is one of the three per-point ones.
    this._peaksStyle   = events.peaks_style   || 'shades';
    this._valleysStyle = events.valleys_style || 'shades';
    // StDev bands (vwap +/- k*stdev) around every peak/valley anchor line —
    // one shared on/off + multiples per indicator (see _buildAnchorPools/
    // reveal(), which draw them via the same _vwapStdevBands the manual
    // anchor tool's Shift+. bands already use).
    this._peaksShowStdev    = !!events.peaks_show_stdev;
    this._peaksStdevMults   = events.peaks_stdev_mults   || [1, 2];
    this._valleysShowStdev  = !!events.valleys_show_stdev;
    this._valleysStdevMults = events.valleys_stdev_mults || [1, 2];
    // ?? (not ||) for the alpha bounds — 0 is a meaningful, deliberate choice
    // (fully transparent "holes" at alphaMin) that || would wrongly discard.
    this._peaksCurveParams = {
      slopeWindow: events.peaks_curve_slope_window  || 5,
      atrPeriod:   events.peaks_curve_atr_period    || 14,
      slopeScale:  events.peaks_slope_scale         || 0.15,
      alphaMin:    events.peaks_slope_alpha_min     ?? SLOPE_ALPHA_MIN_DEFAULT,
      alphaMax:    events.peaks_slope_alpha_max     ?? SLOPE_ALPHA_MAX_DEFAULT,
    };
    this._valleysCurveParams = {
      slopeWindow: events.valleys_curve_slope_window || 5,
      atrPeriod:   events.valleys_curve_atr_period    || 14,
      slopeScale:  events.valleys_slope_scale         || 0.15,
      alphaMin:    events.valleys_slope_alpha_min     ?? SLOPE_ALPHA_MIN_DEFAULT,
      alphaMax:    events.valleys_slope_alpha_max     ?? SLOPE_ALPHA_MAX_DEFAULT,
    };
    this._atrCache = {};

    // Build O(1) VWAP lookup tables + price arrays for PMM
    const N = bars.length;
    this._cumPV   = new Float64Array(N);
    this._cumVol  = new Float64Array(N);
    this._highs   = new Float64Array(N);
    this._lows    = new Float64Array(N);
    // Per-bar (not cumulative) volume + typical price — needed by
    // _vwapStdevBands, which can't reuse the cumulative arrays the way
    // _vwapLine does (the running vwap term varies per anchor, so the
    // squared-deviation sum isn't a fixed prefix sum reusable across anchors).
    this._volumes = new Float64Array(N);
    this._typical = new Float64Array(N);
    this._closes  = new Float64Array(N);
    let pv = 0, vol = 0;
    for (let i = 0; i < N; i++) {
      const b = bars[i];
      const h = b.High ?? b.high, l = b.Low ?? b.low, c = b.Close ?? b.close;
      const v = b.Volume ?? b.volume;
      this._highs[i]   = h;
      this._lows[i]    = l;
      this._closes[i]  = c;
      this._volumes[i] = v;
      this._typical[i] = (h + l + c) / 3;
      pv  += this._typical[i] * v;
      vol += v;
      this._cumPV[i]  = pv;
      this._cumVol[i] = vol;
    }

    this._buildPools();
    this._buildAnchorPools(events.avwap_anchors);
    this._buildPmmPools(events.pmm_configs);
  }

  // ── VWAP computation ──────────────────────────────────────────────────���───

  /**
   * Build a LightweightCharts line-data array for a VWAP anchored at
   * anchorIdx and running from anchorIdx to toIdx (inclusive).
   */
  _vwapLine(anchorIdx, toIdx) {
    const pvBase  = anchorIdx > 0 ? this._cumPV[anchorIdx - 1]  : 0;
    const volBase = anchorIdx > 0 ? this._cumVol[anchorIdx - 1] : 0;
    const data = [];
    for (let i = anchorIdx; i <= toIdx; i++) {
      const vol = this._cumVol[i] - volBase;
      if (vol > 0) {
        data.push({
          time:  (this._bars[i].Date || this._bars[i].date || '').slice(0, 10),
          value: (this._cumPV[i] - pvBase) / vol,
        });
      }
    }
    return data;
  }

  /**
   * Rolling-mean True Range (ATR) over the whole loaded series, memoized by
   * period — shared across every curve-colored line regardless of anchor,
   * same as calculate_avwap_atr (aVWAP.py) being computed once per df.
   */
  _getAtr(period) {
    if (this._atrCache[period]) return this._atrCache[period];
    const N = this._bars.length;
    const tr  = new Float64Array(N);
    const atr = new Float64Array(N).fill(NaN);
    for (let i = 0; i < N; i++) {
      const h = this._highs[i], l = this._lows[i];
      // Bar 0 has no prior close (Python's version leaves it NaN, poisoning
      // one extra bar's worth of rolling windows near the very start of the
      // series) — using plain high-low here instead is a deliberate, harmless
      // simplification: it only affects anchors within the first `period`
      // bars of the whole loaded series, which swing peaks/valleys never are.
      if (i === 0) {
        tr[i] = h - l;
      } else {
        const pc = this._closes[i - 1];
        tr[i] = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
      }
    }
    let sum = 0;
    for (let i = 0; i < N; i++) {
      sum += tr[i];
      if (i >= period) sum -= tr[i - period];
      if (i >= period - 1) atr[i] = sum / period;
    }
    this._atrCache[period] = atr;
    return atr;
  }

  /**
   * Per-bar rgba(...) color from a straightening score — JS port of
   * avwap_curve_color (aVWAP.py). direction: +1/-1/0 (0 = not yet resolved).
   */
  _curveColor(s, style, baseRgb, hotRgb, direction) {
    const [br, bg, bb] = baseRgb;
    if (style === 'heatmap') {
      const [sr, sg, sb] = CURVE_SETTLE_RGB;
      const hot = direction > 0 ? CURVE_BULL_RGB : direction < 0 ? CURVE_BEAR_RGB : baseRgb;
      const r = Math.round(hot[0] + (sr - hot[0]) * s);
      const g = Math.round(hot[1] + (sg - hot[1]) * s);
      const b = Math.round(hot[2] + (sb - hot[2]) * s);
      return `rgba(${r},${g},${b},0.85)`;
    }
    // 'opacity' style — first half (s: 0->0.5): hue only, hotRgb -> baseRgb,
    // full opacity. Second half (s: 0.5->1): hue fixed at baseRgb, alpha only.
    const [hr, hg, hb] = hotRgb || baseRgb;
    const tHue   = Math.min(s / 0.5, 1);
    const tAlpha = Math.max((s - 0.5) / 0.5, 0);
    const r = Math.round(hr + (br - hr) * tHue);
    const g = Math.round(hg + (bg - hg) * tHue);
    const b = Math.round(hb + (bb - hb) * tHue);
    const alpha = (CURVE_OPACITY_MAX_ALPHA - (CURVE_OPACITY_MAX_ALPHA - CURVE_OPACITY_MIN_ALPHA) * tAlpha).toFixed(2);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  /**
   * Plain identity color (peak red / valley teal, same alpha as C_PEAK/
   * C_VALLEY) for the stretch right after an anchor where a per-point style
   * can't measure anything yet — shown as-is instead of running the "unknown"
   * case through the style's own hot/settle math, so every colored line
   * visibly starts as a normal peak/valley line before its coloring kicks in.
   */
  _identityColor(baseRgb) {
    return `rgba(${baseRgb[0]},${baseRgb[1]},${baseRgb[2]},0.75)`;
  }

  /**
   * Same as _vwapLine, but with a per-point 'color' field driven by the
   * line's own curve-to-straight state — JS port of
   * calculate_avwap_straightening (aVWAP.py), walked incrementally over the
   * rendered (vol > 0) points as they're built rather than a separate pass.
   * Deterministic regardless of toIdx (each point's color only depends on
   * bars from anchorIdx up to itself), so recomputing on every reveal() is
   * safe — same no-look-ahead property _vwapLine already has.
   */
  _vwapLineColored(anchorIdx, toIdx, style, baseRgb, hotRgb, slopeWindow, atrPeriod) {
    const pvBase  = anchorIdx > 0 ? this._cumPV[anchorIdx - 1]  : 0;
    const volBase = anchorIdx > 0 ? this._cumVol[anchorIdx - 1] : 0;
    const atr = this._getAtr(atrPeriod);
    const data = [];
    let bestAbsSlope = -Infinity;
    let sign = 0;
    for (let i = anchorIdx; i <= toIdx; i++) {
      const vol = this._cumVol[i] - volBase;
      if (vol <= 0) continue;
      const value = (this._cumPV[i] - pvBase) / vol;
      const pointIdx = data.length;

      let straightening = null;
      let known = false;
      if (pointIdx >= slopeWindow) {
        const atrVal = atr[i];
        if (atrVal > 0) {
          known = true;
          const prevValue = data[pointIdx - slopeWindow].value;
          const normSlope = (value - prevValue) / slopeWindow / atrVal;
          const absSlope  = Math.abs(normSlope);
          if (absSlope >= bestAbsSlope) {
            bestAbsSlope = absSlope;
            if (normSlope !== 0) sign = normSlope > 0 ? 1 : -1;
          }
          if (bestAbsSlope > 0) straightening = 1.0 - absSlope / bestAbsSlope;
        }
      }

      let color;
      if (!known) {
        color = this._identityColor(baseRgb);
      } else {
        const s = straightening == null ? 0.0 : Math.min(Math.max(straightening, 0), 1);
        color = this._curveColor(s, style, baseRgb, hotRgb, sign);
      }

      data.push({
        time:  (this._bars[i].Date || this._bars[i].date || '').slice(0, 10),
        value,
        color,
      });
    }
    return data;
  }

  /**
   * Per-bar rgba(...) color from a signed ATR-normalized slope alone — no
   * reference to the line's own history (contrast with _curveColor above,
   * which normalizes against this line's own running-peak slope). Rising
   * fades in toward SLOPE_UP_RGB, falling toward SLOPE_DOWN_RGB, near-zero
   * stays at SLOPE_FLAT_RGB; intensity (both hue and alpha) saturates at
   * |normSlope| = scale, so flat stretches don't just gray out — they fade
   * toward near-transparent, leaving visible "holes" where nothing's moving.
   */
  _slopeColor(normSlope, scale, alphaMin, alphaMax) {
    const s = scale > 0 ? scale : 1;
    const t = Math.min(Math.abs(normSlope) / s, 1);
    const hot = normSlope > 0 ? SLOPE_UP_RGB : normSlope < 0 ? SLOPE_DOWN_RGB : SLOPE_FLAT_RGB;
    const [nr, ng, nb] = SLOPE_FLAT_RGB;
    const r = Math.round(nr + (hot[0] - nr) * t);
    const g = Math.round(ng + (hot[1] - ng) * t);
    const b = Math.round(nb + (hot[2] - nb) * t);
    const alpha = (alphaMin + (alphaMax - alphaMin) * t).toFixed(2);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  /**
   * Same as _vwapLine, but with a per-point 'color' field driven purely by
   * that point's own instantaneous slope — deliberately simpler than
   * _vwapLineColored: no running-peak tracking, no "how far has this line
   * settled from its own sharpest move" framing, just the current derivative.
   * Points before slopeWindow bars (or wherever ATR isn't defined yet) render
   * as the plain peak/valley identity color instead — there's no slope to
   * measure yet, so showing an assumed value (even neutral) would be a guess;
   * the plain color makes clear the algorithm hasn't started yet, same as
   * _vwapLineColored's own pre-measurement stretch.
   */
  _vwapLineSlope(anchorIdx, toIdx, baseRgb, slopeWindow, atrPeriod, slopeScale, alphaMin, alphaMax) {
    const pvBase  = anchorIdx > 0 ? this._cumPV[anchorIdx - 1]  : 0;
    const volBase = anchorIdx > 0 ? this._cumVol[anchorIdx - 1] : 0;
    const atr = this._getAtr(atrPeriod);
    const data = [];
    for (let i = anchorIdx; i <= toIdx; i++) {
      const vol = this._cumVol[i] - volBase;
      if (vol <= 0) continue;
      const value = (this._cumPV[i] - pvBase) / vol;
      const pointIdx = data.length;

      let normSlope = 0;
      let known = false;
      if (pointIdx >= slopeWindow) {
        const atrVal = atr[i];
        if (atrVal > 0) {
          known = true;
          const prevValue = data[pointIdx - slopeWindow].value;
          normSlope = (value - prevValue) / slopeWindow / atrVal;
        }
      }

      data.push({
        time:  (this._bars[i].Date || this._bars[i].date || '').slice(0, 10),
        value,
        color: known ? this._slopeColor(normSlope, slopeScale, alphaMin, alphaMax) : this._identityColor(baseRgb),
      });
    }
    return data;
  }

  /**
   * Build vwap +/- k*stdev band line-data (one {upper, lower} pair per k in
   * multiples) for a VWAP anchored at anchorIdx, running through toIdx.
   * Same formula as the server's calculate_avwap_stdev (aVWAP.py): cumulative
   * volume-weighted squared deviation of each bar's typical price from the
   * RUNNING vwap at that same bar (not the final vwap) — so a manually
   * placed anchor's bands match what aVWAP_pinch's own show_stdev_bands
   * would draw for the same anchor point.
   *
   * Can't reuse the global _cumPV/_cumVol prefix-sum trick _vwapLine uses:
   * that trick works because plain vwap is a ratio of prefix-sum
   * differences, but here the per-bar term depends on that bar's own running
   * vwap, which is different for every possible anchor — so this walks the
   * range directly, same O(range) cost per call as _vwapLine itself.
   */
  _vwapStdevBands(anchorIdx, toIdx, multiples) {
    const pvBase  = anchorIdx > 0 ? this._cumPV[anchorIdx - 1]  : 0;
    const volBase = anchorIdx > 0 ? this._cumVol[anchorIdx - 1] : 0;
    const kMin = Math.min(...multiples), kMax = Math.max(...multiples);
    const bands = multiples.map(k => ({ k, upper: [], lower: [] }));
    let cumSqDev = 0;
    for (let i = anchorIdx; i <= toIdx; i++) {
      const vol = this._cumVol[i] - volBase;
      if (vol <= 0) continue;
      const vwap = (this._cumPV[i] - pvBase) / vol;
      const dev  = this._typical[i] - vwap;
      cumSqDev += this._volumes[i] * dev * dev;
      const stdev = Math.sqrt(cumSqDev / vol);
      const time  = (this._bars[i].Date || this._bars[i].date || '').slice(0, 10);
      for (const band of bands) {
        band.upper.push({ time, value: vwap + band.k * stdev });
        band.lower.push({ time, value: vwap - band.k * stdev });
      }
    }
    return { bands, kMin, kMax };
  }

  /** Tightest band (smallest k) most visible, wider bands fade out — same
   * interpolation col_styles.py uses for aVWAP_pinch's own stdev bands. */
  _manualStdevAlpha(k, kMin, kMax) {
    const t = kMax > kMin ? (k - kMin) / (kMax - kMin) : 0;
    return MANUAL_STDEV_MAX_ALPHA - (MANUAL_STDEV_MAX_ALPHA - MANUAL_STDEV_MIN_ALPHA) * t;
  }

  /** Per-bar aVWAP and σ over [anchorIdx, toIdx] (same running-σ math as
   * _vwapStdevBands; NaN before the first traded bar) plus the span's
   * Volume Profile — the data a σ-band cloud is drawn from. */
  _stdevCloudData(anchorIdx, toIdx) {
    const len = Math.max(0, toIdx - anchorIdx + 1);
    const vwap = new Float64Array(len).fill(NaN), sd = new Float64Array(len).fill(NaN);
    const pvBase  = anchorIdx > 0 ? this._cumPV[anchorIdx - 1]  : 0;
    const volBase = anchorIdx > 0 ? this._cumVol[anchorIdx - 1] : 0;
    let cumSqDev = 0;
    for (let i = anchorIdx; i <= toIdx; i++) {
      const vol = this._cumVol[i] - volBase;
      if (vol <= 0) continue;
      const v = (this._cumPV[i] - pvBase) / vol;
      const dev = this._typical[i] - v;
      cumSqDev += this._volumes[i] * dev * dev;
      vwap[i - anchorIdx] = v;
      sd[i - anchorIdx] = Math.sqrt(cumSqDev / vol);
    }
    // Per-bar slope of the aVWAP (relative change per bar) and its
    // AVWAP_SLOPE_PCTL magnitude, for the 'sigma' mode's slope coloring.
    const slope = new Float64Array(len).fill(0);
    for (let j = 1; j < len; j++) {
      if (!Number.isNaN(vwap[j]) && !Number.isNaN(vwap[j - 1]) && vwap[j - 1] !== 0) slope[j] = (vwap[j] - vwap[j - 1]) / vwap[j - 1];
    }
    const mags = Array.from(slope, Math.abs).filter(m => m > 0).sort((a, b) => a - b);
    const slopeRef = mags.length ? mags[Math.min(mags.length - 1, Math.floor(AVWAP_SLOPE_PCTL * (mags.length - 1)))] : 1;
    return { from: anchorIdx, to: toIdx, vwap, sd, slope, slopeRef,
             vp: len ? this._vpHistogram(anchorIdx, toIdx, FAN_VP_BINS) : null };
  }

  /** Record a chart-level undo step (Shift+K candle mode) in the shared undo
   * order, so Shift+X / Ctrl+Z undo it in sequence with anchors and fans.
   * undoManualAnchor hands it back as-is. */
  pushUndoStep(step) {
    this._manualOrder.push(step);
  }

  /** Latest Shift+. anchor entry, else the latest manual anchor of any kind, or null. */
  _referenceAnchorEntry() {
    const ids = this._manualOrder.filter(o => typeof o === 'string' && this._manualSeries[o]);
    const pick = [...ids].reverse().find(id => this._manualSeries[id].kind === 'stdev') ?? ids[ids.length - 1];
    return pick ? this._manualSeries[pick] : null;
  }

  /** Bar index of that reference anchor (see _referenceAnchorEntry), or null. */
  referenceAnchorIdx() {
    return this._referenceAnchorEntry()?.anchorIdx ?? null;
  }

  /** Reference for the chart's 'sigma' candle mode: per-bar aVWAP / σ of
   * the most recently placed Shift+. anchor (else the most recent manual
   * anchor of any kind) up to bar n, or null if there's none. */
  sigmaReference(n) {
    const e = this._referenceAnchorEntry();
    if (!e) return null;
    const toIdx = e.fixedEnd != null ? Math.min(e.fixedEnd, n) : n;
    return toIdx >= e.anchorIdx ? this._stdevCloudData(e.anchorIdx, toIdx) : null;
  }

  /** A repeat Shift+. over a bands anchor: advance it to the next of
   * STDEV_CLOUD_MODES (the dashed ±1/±2σ band series show only in 'bands');
   * false past the last (the caller removes it). */
  _cycleStdevMode(entry) {
    const next = STDEV_CLOUD_MODES.indexOf(entry.stdevMode) + 1;
    if (next >= STDEV_CLOUD_MODES.length) return false;
    entry.stdevMode = STDEV_CLOUD_MODES[next];
    const showBands = entry.stdevMode === 'bands';
    for (const b of entry.bands) { b.upper.applyOptions({ visible: showBands }); b.lower.applyOptions({ visible: showBands }); }
    // Cloud modes draw the aVWAP line themselves (per-segment color/width);
    // its series stays (price scale, data) but goes transparent.
    entry.vwap.applyOptions({ color: showBands ? C_MANUAL : 'rgba(0,0,0,0)' });
    entry.cloudPrim?.update();
    return true;
  }

  // ── Reveal ────────────────────────────────────────────────────────────────

  reveal(n) {
    if (!this._cumPV) return;
    this._lastN = n;

    // ── Peaks ────────────────────────────────────────────────────────────
    // A peak at bar P is only visible once bar P + peaksHalf has been reached
    // (the centered rolling window requires that many future bars to confirm it).
    const activePeaks = [];
    for (let i = this._peaks.length - 1; i >= 0 && activePeaks.length < this._maxP; i--) {
      if (this._peaks[i] + this._peaksHalf <= n) activePeaks.push(this._peaks[i]);
    }
    for (let i = 0; i < this._maxP; i++) {
      const a = activePeaks[i];
      this._pPool[i].setData(a !== undefined ? this._vwapLine(a, n) : []);
    }

    // ── Valleys ────────────────────────────────────────────────────────────
    const activeValleys = [];
    for (let i = this._valleys.length - 1; i >= 0 && activeValleys.length < this._maxV; i--) {
      if (this._valleys[i] + this._valleysHalf <= n) activeValleys.push(this._valleys[i]);
    }
    for (let i = 0; i < this._maxV; i++) {
      const a = activeValleys[i];
      this._vPool[i].setData(a !== undefined ? this._vwapLine(a, n) : []);
    }

    // ── QQEMOD ───────────────────────────────────────────────────────────
    if (this._maxQQ > 0) {
      const bearAnchors = [];
      const bullAnchors = [];
      for (const ev of this._qqEvts) {
        if (ev.committed_bar > n) break;
        if (ev.direction === 'bear') {
          bearAnchors.push(ev.anchor_bar);
          if (bearAnchors.length > this._maxQQ) bearAnchors.shift();
        } else {
          bullAnchors.push(ev.anchor_bar);
          if (bullAnchors.length > this._maxQQ) bullAnchors.shift();
        }
      }
      for (let i = 0; i < this._maxQQ; i++) {
        this._qbPool[i].setData(bearAnchors[i] !== undefined ? this._vwapLine(bearAnchors[i], n) : []);
        this._qlPool[i].setData(bullAnchors[i] !== undefined ? this._vwapLine(bullAnchors[i], n) : []);
      }
    }

    // ── Generic anchor pools (OB / BoS / CHoCH / gap / peaks / valleys) ───
    for (const [key, pool] of Object.entries(this._anchorPools)) {
      const active = [];
      for (let i = pool.events.length - 1; i >= 0; i--) {
        const ev = pool.events[i];
        if (ev.vf > n) continue;
        if (ev.da !== undefined && n >= ev.da) continue;
        // eb (end_bar): freeze the line at this bar rather than extending to n
        active.push({ ab: ev.anchor_bar, toIdx: ev.eb !== undefined ? Math.min(ev.eb, n) : n });
      }
      // Per-point coloring — one of the merged 'styling' choices (see CURVE_*/
      // SLOPE_* constants above and _anchorPoolStyle) — overrides the pool's flat
      // series color when that's what this config's own styling picked.
      const isPeak   = /^peak_c\d+$/.test(key);
      const isValley = /^valley_c\d+$/.test(key);
      const styleVal   = isPeak ? this._peaksStyle : isValley ? this._valleysStyle : null;
      const curveStyle = styleVal === 'curve_opacity' ? 'opacity'
                        : styleVal === 'curve_heatmap' ? 'heatmap'
                        : 'none';
      const isSlope    = styleVal === 'slope_gradient';
      const curveKind  = isPeak ? 'peak' : isValley ? 'valley' : null;
      const curveParams = isPeak ? this._peaksCurveParams : this._valleysCurveParams;
      for (let i = 0; i < pool.series.length; i++) {
        const item = active[i];
        if (item === undefined) {
          pool.series[i].setData([]);
        } else if (isSlope) {
          pool.series[i].setData(this._vwapLineSlope(
            item.ab, item.toIdx, CURVE_BASE_RGB[curveKind],
            curveParams.slopeWindow, curveParams.atrPeriod, curveParams.slopeScale,
            curveParams.alphaMin, curveParams.alphaMax,
          ));
        } else if (curveStyle !== 'none') {
          pool.series[i].setData(this._vwapLineColored(
            item.ab, item.toIdx, curveStyle,
            CURVE_BASE_RGB[curveKind], CURVE_HOT_RGB[curveKind],
            curveParams.slopeWindow, curveParams.atrPeriod,
          ));
        } else {
          pool.series[i].setData(this._vwapLine(item.ab, item.toIdx));
        }
        const slotBands = pool.bands?.[i];
        if (slotBands) {
          if (item === undefined) {
            for (const band of slotBands) { band.upper.setData([]); band.lower.setData([]); }
          } else {
            const { bands: bandData } = this._vwapStdevBands(item.ab, item.toIdx, slotBands.map(b => b.k));
            for (let bi = 0; bi < slotBands.length; bi++) {
              slotBands[bi].upper.setData(bandData[bi].upper);
              slotBands[bi].lower.setData(bandData[bi].lower);
            }
          }
        }
      }
    }

    // ── PMM — recompute greedy anchors on bars[0..n] at every step ───────
    for (const p of this._pmmPools) {
      if (p.valleys && p.vSeries.length) {
        const anchors = this._greedyExtrema(this._lows, n, 'valley', p.max_anchors, p.spacing);
        for (let i = 0; i < p.vSeries.length; i++) {
          p.vSeries[i].setData(anchors[i] !== undefined ? this._vwapLine(anchors[i], n) : []);
        }
      }
      if (p.peaks && p.pSeries.length) {
        const anchors = this._greedyExtrema(this._highs, n, 'peak', p.max_anchors, p.spacing);
        for (let i = 0; i < p.pSeries.length; i++) {
          p.pSeries[i].setData(anchors[i] !== undefined ? this._vwapLine(anchors[i], n) : []);
        }
      }
    }

    // ── Manual (click-placed) anchors ─────────────────────────────────────
    for (const entry of Object.values(this._manualSeries)) {
      this._renderManualEntry(entry.anchorIdx, entry);
    }
    for (const fan of this._manualFans) this._renderFan(fan);
  }

  /**
   * Recompute and set one manual anchor's vwap/bands/profile data for its
   * current end point — fixedEnd (set at creation time for a ranged
   * anchor, see createRangedManualAnchor) caps how far it grows: it still
   * tracks this._lastN normally until replay reaches fixedEnd, then
   * freezes there instead of continuing to extend to "now" like a plain
   * (unranged) manual anchor does. Called from reveal()'s main loop.
   */
  _renderManualEntry(anchorIdx, entry) {
    const n = this._lastN;
    const toIdx = entry.fixedEnd != null ? Math.min(entry.fixedEnd, n) : n;
    entry.vwap.setData(this._vwapLine(anchorIdx, toIdx));
    if (entry.bands.length) {
      const { bands: bandData } = this._vwapStdevBands(anchorIdx, toIdx, entry.bands.map(b => b.k));
      for (let i = 0; i < entry.bands.length; i++) {
        entry.bands[i].upper.setData(bandData[i].upper);
        entry.bands[i].lower.setData(bandData[i].lower);
      }
      // σ-band cloud (Shift+. repeat-press modes): per-bar aVWAP / σ arrays and the
      // span's Volume Profile, for StdevCloudPrimitive.
      if (!entry.cloudPrim) {
        entry.cloudPrim = new StdevCloudPrimitive(this, entry);
        entry.vwap.attachPrimitive(entry.cloudPrim);
      }
      entry.cloud = this._stdevCloudData(anchorIdx, toIdx);
      entry.cloudPrim.update();
    }
    if (entry.profile) {
      const payload = this._vpPayload(anchorIdx, toIdx, entry.vpMode === VP_MODE_LVN);
      // Profile data for ProfileLinePrimitive ("Both" mode aVWAP coloring).
      entry._vp = payload ? { lo: payload.lo, bs: payload.bs, bins: payload.bins } : null;
      entry._toIdx = toIdx;
      // The mode's peak levels — colored on the aVWAPs (and the line-only strip).
      entry._peaks = payload ? profilePeakColors(payload.bins,
        entry.vpMode === VP_MODE_NORMAL ? 'hvn' : entry.vpMode === VP_MODE_LVN ? 'lvn' : 'both') : null;

      if (!entry.profileLinePrim) {
        entry.profileLinePrim = new ProfileLinePrimitive(this, entry);
        entry.vwap.attachPrimitive(entry.profileLinePrim);
      }
      entry.profileLinePrim.update();
      if (payload) {
        if (entry.vpMode === VP_MODE_BOTH) {
          payload.lvnPoc = this._vpLvnPoc(payload.lo, payload.bs, payload.bins, MANUAL_VP_NODE_WINDOW);
          payload.dualHistogram = true;
        } else if (entry.vpMode === VP_MODE_POCS) {
          // Line-only: no histogram and no floating POC lines — the aVWAP
          // (ProfileLinePrimitive) carries the profile, POC marked yellow.
          payload.showHistogram = false;
          payload.poc = null;
        }
        const startTime = (this._bars[anchorIdx].Date || this._bars[anchorIdx].date || '').slice(0, 10);
        const endTime   = (this._bars[toIdx].Date     || this._bars[toIdx].date     || '').slice(0, 10);
        entry.profile.setData([{ time: startTime, ...payload }, { time: endTime, ...payload }]);
      } else {
        entry.profile.setData([]);
      }
    }
    if (entry.otherSide) {
      const ext = this._otherSideExtremum(anchorIdx, toIdx);
      if (ext) {
        if (!entry.otherSide.line) {
          entry.otherSide.line = this._series(this._otherSideColor(entry), 2, 1); // lineStyle 1 = dotted
        }
        entry.otherSide.line.setData(this._vwapLine(ext.idx, toIdx));
        entry._otherIdx = ext.idx;
      } else {
        entry.otherSide.line?.setData([]);
        entry._otherIdx = null;
      }
      entry.profileLinePrim?.update();
    }
  }

  /** A repeat '<' over a profile's anchor (or a ranged one's end):
   * advance it to its next display mode (normal → LVN → both → line-only);
   * false past the last (the caller removes it). Its aVWAP and other-side lines are recoded to match on render. */
  _cycleProfileMode(entry) {
    if (entry.vpMode + 1 >= VP_MODE_COUNT) return false;
    entry.vpMode++;
    this._renderManualEntry(entry.anchorIdx, entry);
    return true;
  }

  // ── Show/hide a generic anchor-pool kind (e.g. 'avwap_max', 'avwap_min') ──
  // Safe to call before the pool exists (e.g. events haven't loaded yet) —
  // reveal() never touches `visible`, so this sticks across future reveals.

  setKindVisible(key, visible) {
    const pool = this._anchorPools[key];
    if (!pool) return;
    for (const s of pool.series) s.applyOptions({ visible });
  }

  // ── Cleanup ───────────────────────────────────────────────────────────────

  destroy() {
    this._destroyPools();
    this._bars = []; this._cumPV = null; this._cumVol = null;
    this._highs = null; this._lows = null;
  }
}
