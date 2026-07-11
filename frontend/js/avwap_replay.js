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


export class DynamicVWAPEngine {
  /**
   * @param {object} lwChart  — raw LightweightCharts chart instance
   */
  constructor(lwChart) {
    this._chart   = lwChart;
    this._bars    = [];
    this._cumPV   = null;   // Float64Array — cumulative (typical_price × volume)
    this._cumVol  = null;   // Float64Array — cumulative volume
    this._peaks   = [];     // sorted ascending integer bar indices
    this._valleys = [];
    this._qqEvts  = [];     // [{committed_bar, anchor_bar, direction}] sorted by committed_bar
    this._maxP    = 1;
    this._maxV    = 1;
    this._maxQQ   = 0;
    this._peaksHalf   = 0;  // bars to wait before a peak is "confirmed" (periods // 2)
    this._valleysHalf = 0;
    this._pPool   = [];     // LineSeries pool — peaks
    this._vPool   = [];     // LineSeries pool — valleys
    this._qbPool  = [];     // LineSeries pool — QQEMOD bear anchors (teal)
    this._qlPool  = [];     // LineSeries pool — QQEMOD bull anchors (red)
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
  }

  /**
   * Load event data and pre-build cumulative arrays.
   * Call once after bars are available.
   */
  load(bars, events) {
    this._bars    = bars;
    this._peaks       = [...(events.peaks   || [])].sort((a, b) => a - b);
    this._valleys     = [...(events.valleys || [])].sort((a, b) => a - b);
    this._qqEvts      = [...(events.qqemod_events || [])].sort((a, b) => a.committed_bar - b.committed_bar);
    this._maxP        = events.max_peaks    || 1;
    this._maxV        = events.max_valleys  || 1;
    this._maxQQ       = events.max_qqemod   || 0;
    this._peaksHalf   = events.peaks_half   || 0;
    this._valleysHalf = events.valleys_half || 0;

    // Build O(1) VWAP lookup tables
    const N = bars.length;
    this._cumPV  = new Float64Array(N);
    this._cumVol = new Float64Array(N);
    let pv = 0, vol = 0;
    for (let i = 0; i < N; i++) {
      const b = bars[i];
      const h = b.High ?? b.high, l = b.Low ?? b.low, c = b.Close ?? b.close;
      const v = b.Volume ?? b.volume;
      pv  += ((h + l + c) / 3) * v;
      vol += v;
      this._cumPV[i]  = pv;
      this._cumVol[i] = vol;
    }

    this._buildPools();
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

    // ── QQEMOD ───────────────────────────��────────────────────────────────
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
  }

  // ── Cleanup ───────────────────────────────────────────────────────────────

  destroy() {
    this._destroyPools();
    this._bars = []; this._cumPV = null; this._cumVol = null;
  }
}
