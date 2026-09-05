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
      const info = rankMaps.peak?.get(parseInt(m[1])) ?? { rank: 0, total: 1 };
      const colorFn = this._peaksStyle === 'highlight_first' ? _highlightFirstColor
                    : this._peaksStyle === 'grayscale'       ? _grayscaleColor
                    : _cfgTierColor;
      return colorFn(239, 83, 80, info.rank, info.total);
    }
    m = key.match(/^valley_c(\d+)$/);
    if (m) {
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
    this._peaksStyle   = events.peaks_style   || 'shades';
    this._valleysStyle = events.valleys_style || 'shades';

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
    let pv = 0, vol = 0;
    for (let i = 0; i < N; i++) {
      const b = bars[i];
      const h = b.High ?? b.high, l = b.Low ?? b.low, c = b.Close ?? b.close;
      const v = b.Volume ?? b.volume;
      this._highs[i]   = h;
      this._lows[i]    = l;
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
    for (const pool of Object.values(this._anchorPools)) {
      const active = [];
      for (let i = pool.events.length - 1; i >= 0; i--) {
        const ev = pool.events[i];
        if (ev.vf > n) continue;
        if (ev.da !== undefined && n >= ev.da) continue;
        // eb (end_bar): freeze the line at this bar rather than extending to n
        active.push({ ab: ev.anchor_bar, toIdx: ev.eb !== undefined ? Math.min(ev.eb, n) : n });
      }
      for (let i = 0; i < pool.series.length; i++) {
        const item = active[i];
        pool.series[i].setData(item !== undefined ? this._vwapLine(item.ab, item.toIdx) : []);
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
