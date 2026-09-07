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

// Default colours — match col_styles.py palette
const C_PEAK   = 'rgba(239, 83, 80, 0.75)';   // red   — peaks
const C_VALLEY = 'rgba(38, 166, 154, 0.75)';   // teal  — valleys
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
const SLOPE_ALPHA    = 0.85;

// Manually placed (click-to-anchor) aVWAP — amber, distinct from all auto anchors
const C_MANUAL = 'rgba(255,193,7,0.95)';
// Shift+. also draws stdev bands (vwap +/- k*stdev) around a manual anchor —
// same rgb (amber), dashed, tiered opacity by k using the identical formula
// col_styles.py uses for aVWAP_pinch's own stdev bands (tightest band most
// visible, wider bands fade out).
const C_MANUAL_STDEV_RGB     = '255,193,7';
const MANUAL_STDEV_MAX_ALPHA = 0.65;
const MANUAL_STDEV_MIN_ALPHA = 0.45;
const MANUAL_STDEV_MULTIPLES = [1, 2]; // matches aVWAP_pinch's default stdev_multiples

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
    this._manualSeries = {};
    this._manualOrder  = []; // anchor bar indices in placement order, for undo (LIFO)
  }

  // ── Setup ──────────────────────────────────────────────────────────────────

  _series(color, width = 2, lineStyle = 0) {
    return this._chart.addLineSeries({
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
    }
    this._anchorPools = {};
    for (const p of this._pmmPools) {
      for (const s of [...p.vSeries, ...p.pSeries]) { try { this._chart.removeSeries(s); } catch (_) {} }
    }
    this._pmmPools = [];
    for (const entry of Object.values(this._manualSeries)) this._removeManualEntry(entry);
    this._manualSeries = {};
    this._manualOrder  = [];
  }

  // ── Manual (click-placed) anchors ───────────────────────────────────────

  /** Tear down one manual anchor's vwap line + any stdev band series. */
  _removeManualEntry(entry) {
    try { this._chart.removeSeries(entry.vwap); } catch (_) {}
    for (const band of entry.bands) {
      try { this._chart.removeSeries(band.upper); } catch (_) {}
      try { this._chart.removeSeries(band.lower); } catch (_) {}
    }
  }

  /**
   * Place or remove a manually-anchored VWAP at anchorIdx, drawn out to
   * toIdx. withStdev also draws vwap +/- k*stdev bands (Shift+.) around it —
   * see _vwapStdevBands. Returns true if an anchor was added, false if an
   * existing one (with or without bands) was removed.
   */
  toggleManualAnchor(anchorIdx, toIdx, withStdev = false) {
    if (anchorIdx == null || anchorIdx < 0 || anchorIdx >= this._bars.length) return null;
    if (this._manualSeries[anchorIdx]) {
      this._removeManualEntry(this._manualSeries[anchorIdx]);
      delete this._manualSeries[anchorIdx];
      const i = this._manualOrder.indexOf(anchorIdx);
      if (i !== -1) this._manualOrder.splice(i, 1);
      return false;
    }
    const vwap = this._series(C_MANUAL, 2, 0);
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

    this._manualSeries[anchorIdx] = { vwap, bands };
    this._manualOrder.push(anchorIdx);
    return true;
  }

  /**
   * Undo the most recently placed manual anchor (LIFO), one per call.
   * Returns the removed anchor's bar index, or null if there are none left.
   */
  undoManualAnchor() {
    const anchorIdx = this._manualOrder.pop();
    if (anchorIdx === undefined) return null;
    const entry = this._manualSeries[anchorIdx];
    if (entry) this._removeManualEntry(entry);
    delete this._manualSeries[anchorIdx];
    return anchorIdx;
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
      this._anchorPools[key] = {
        events: [...events].sort((a, b) => a.anchor_bar - b.anchor_bar),
        series,
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
    this._peaksCurveParams = {
      slopeWindow: events.peaks_curve_slope_window  || 5,
      atrPeriod:   events.peaks_curve_atr_period    || 14,
      slopeScale:  events.peaks_slope_scale         || 0.15,
    };
    this._valleysCurveParams = {
      slopeWindow: events.valleys_curve_slope_window || 5,
      atrPeriod:   events.valleys_curve_atr_period    || 14,
      slopeScale:  events.valleys_slope_scale         || 0.15,
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
   * stays at SLOPE_FLAT_RGB; intensity saturates at |normSlope| = scale.
   */
  _slopeColor(normSlope, scale) {
    const s = scale > 0 ? scale : 1;
    const t = Math.min(Math.abs(normSlope) / s, 1);
    const hot = normSlope > 0 ? SLOPE_UP_RGB : normSlope < 0 ? SLOPE_DOWN_RGB : SLOPE_FLAT_RGB;
    const [nr, ng, nb] = SLOPE_FLAT_RGB;
    const r = Math.round(nr + (hot[0] - nr) * t);
    const g = Math.round(ng + (hot[1] - ng) * t);
    const b = Math.round(nb + (hot[2] - nb) * t);
    return `rgba(${r},${g},${b},${SLOPE_ALPHA})`;
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
  _vwapLineSlope(anchorIdx, toIdx, baseRgb, slopeWindow, atrPeriod, slopeScale) {
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
        color: known ? this._slopeColor(normSlope, slopeScale) : this._identityColor(baseRgb),
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

  // ── Reveal ────────────────────────────────────────────────────────────────

  reveal(n) {
    if (!this._cumPV) return;

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
    for (const [anchorIdxStr, entry] of Object.entries(this._manualSeries)) {
      const anchorIdx = parseInt(anchorIdxStr, 10);
      entry.vwap.setData(this._vwapLine(anchorIdx, n));
      if (entry.bands.length) {
        const { bands: bandData } = this._vwapStdevBands(anchorIdx, n, entry.bands.map(b => b.k));
        for (let i = 0; i < entry.bands.length; i++) {
          entry.bands[i].upper.setData(bandData[i].upper);
          entry.bands[i].lower.setData(bandData[i].lower);
        }
      }
    }
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
