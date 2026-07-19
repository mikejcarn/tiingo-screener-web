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
  qqemod_bull:     ['rgba(239,83,80,0.75)',  1, 0],
  qqemod_bear:     ['rgba(38,166,154,0.75)', 1, 0],
  qqemod_bull_dot: ['rgba(239,83,80,0.45)',  1, 1],
  qqemod_bear_dot: ['rgba(38,166,154,0.45)', 1, 1],
  avwap_max:       ['rgba(239,83,80,0.85)',  2, 0],
  avwap_min:       ['rgba(38,166,154,0.85)', 2, 0],
};


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
    for (const cfg of (configs || [])) {
      const vSeries = cfg.valleys
        ? Array.from({ length: cfg.max_anchors }, () => this._series('rgba(38,166,154,0.75)', 2))
        : [];
      const pSeries = cfg.peaks
        ? Array.from({ length: cfg.max_anchors }, () => this._series('rgba(239,83,80,0.75)',  2))
        : [];
      this._pmmPools.push({ ...cfg, vSeries, pSeries });
    }
  }

  _anchorPoolStyle(key) {
    if (ANCHOR_POOL_STYLE[key]) return ANCHOR_POOL_STYLE[key];
    // Dynamic per-config peaks/valleys: peak_c0, peak_c1, valley_c0, valley_c1, ...
    let m = key.match(/^peak_c(\d+)$/);
    if (m) {
      const ci = parseInt(m[1]);
      return [`rgba(239,83,80,${ci === 0 ? '0.75' : '0.5'})`, ci === 0 ? 2 : 1, ci === 0 ? 0 : 1];
    }
    m = key.match(/^valley_c(\d+)$/);
    if (m) {
      const ci = parseInt(m[1]);
      return [`rgba(38,166,154,${ci === 0 ? '0.75' : '0.5'})`, ci === 0 ? 2 : 1, ci === 0 ? 0 : 1];
    }
    return null;
  }

  _buildAnchorPools(anchors) {
    for (const [key, events] of Object.entries(anchors || {})) {
      if (!events.length) continue;
      const style = this._anchorPoolStyle(key);
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

    // Build O(1) VWAP lookup tables + price arrays for PMM
    const N = bars.length;
    this._cumPV  = new Float64Array(N);
    this._cumVol = new Float64Array(N);
    this._highs  = new Float64Array(N);
    this._lows   = new Float64Array(N);
    let pv = 0, vol = 0;
    for (let i = 0; i < N; i++) {
      const b = bars[i];
      const h = b.High ?? b.high, l = b.Low ?? b.low, c = b.Close ?? b.close;
      const v = b.Volume ?? b.volume;
      this._highs[i] = h;
      this._lows[i]  = l;
      pv  += ((h + l + c) / 3) * v;
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
        active.push(ev.anchor_bar);
      }
      for (let i = 0; i < pool.series.length; i++) {
        pool.series[i].setData(active[i] !== undefined ? this._vwapLine(active[i], n) : []);
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
  }

  // ── Cleanup ───────────────────────────────────────────────────────────────

  destroy() {
    this._destroyPools();
    this._bars = []; this._cumPV = null; this._cumVol = null;
    this._highs = null; this._lows = null;
  }
}
