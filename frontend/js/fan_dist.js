/**
 * fan_dist.js — the aVWAP fan as a distribution, bar by bar (the Shift+N
 * candle colorings, see chart.js DIST_MODES).
 *
 * From an anchor a, at every bar t the fan holds one aVWAP per candle
 * c ∈ [a, t] — the Alt+. fan's lines. Their values at t are a distribution
 * of "fair value" prices: where every participant who entered since the
 * anchor is, on average, positioned. Two distributions are kept side by side:
 *
 *   full   every line counts once — the Alt+. fan as a whole, the crowd
 *   wtd    every line weighted by its rank, as of the bar before, on the
 *          Ctrl+. ranked fan's measure (FanDist.measure — chart.js passes the
 *          newest Ctrl+. fan's step, else 'vol'): 'vol' crossed volume,
 *          'volfrac' crossed volume as a share of all volume since its anchor,
 *          'wick' wick crossings minus body crossings, 'wickfrac' wicks as a
 *          share of all crossings, 'liq' the summed liquidity of the crossed
 *          bars, 'liqfrac' that as a share of all liquidity since its anchor
 *          (both as avwap_replay.js FAN_RANK_MODES / _barLiq); 'avg_*' the same on
 *          the average aVWAPs (the lines themselves become each candle's
 *          average aVWAP, as the Ctrl+. fan draws them). With srView (the
 *          Ctrl+. fan clicked to support / resistance) lines on neither side
 *          drop to the minimum weight, as they turn grey there. Every line's
 *          tallies only accumulate, one pass per new bar, so the weights —
 *          and the median, percentiles and dense core built on them — move
 *          candle by candle as lines gain or lose importance: the dynamic
 *          distribution. weight = W_MIN + (1 − W_MIN) × rank² (rank = the
 *          line's percentile among the scored lines; unscorable → weakest).
 *
 * Per distribution and bar (all strictly as-of: bar t only uses bars ≤ t, so
 * nothing changes when later bars arrive — replay-safe, and computed lazily
 * up to the furthest bar asked for, then reused):
 *
 *   quantiles  at DIST_QLEVELS evenly spaced levels (0 = lowest line, 1 =
 *              highest), for percentile / density lookups
 *   core       the narrowest band holding DIST_CORE_SHARE of the weight
 *              (coreLo … coreHi) — where the fan bunches up. Not q10–q90: a
 *              fan from an old anchor keeps its trend-era lines far away
 *              forever, so a percentile width never shrinks in a later range,
 *              while the newer lines piling into that range do show up
 *   width      core width / ATR (small = the anchors agree — compression)
 *   wRank      that width's percentile among every width so far (after
 *              DIST_HIST_MIN bars) — compression against this fan's own history
 *   dRank      the share of the distribution the candle's range covers
 *              (pct(high) − pct(low)) as a percentile of its own history
 *
 * Touch, per bar: tW — what the bar did at the strongest of the DIST_TOUCH_TOP
 * top-ranked lines (by the measure, as of the bar before, kept apart as in
 * the Ctrl+. fan) it touched; tF — what it did at the full distribution's
 * median. Kinds: 'sup' (lower wick through, closed back above), 'res' (upper
 * wick through, closed back below), 'up' / 'dn' (body through it, closing
 * above / below).
 *
 * Cost: O(span log span) per bar, so O(span² log span) for a whole range the
 * first time; replay steps add one bar.
 */

export const DIST_QLEVELS    = 21;   // 0, 5, 10, … 100%
export const DIST_MIN_LINES  = 5;    // bars before this many lines exist stay uncolored
export const DIST_HIST_MIN   = 20;   // history needed before width / density ranks are trusted
export const DIST_TOUCH_TOP  = 5;
export const DIST_CORE_SHARE = 0.5;
const W_MIN = 0.05;
const FRAC_MIN_SPAN = 10;    // as avwap_replay.js MAXVOL_FRAC_MIN_SPAN
const FRAC_MIN_CROSS = 5;    // … MAXWICK_FRAC_MIN_CROSS
const DIST_ATR = 14;
const SEP_MIN = 3, SEP_FRAC = 0.03;  // as the Ctrl+. fan's FAN_RANK_SEP_*

/** Sorted insert into a growing plain array; returns the rank (count strictly below) before insert. */
function insertSorted(arr, v) {
  let lo = 0, hi = arr.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] < v) lo = m + 1; else hi = m; }
  arr.splice(lo, 0, v);
  return lo;
}

/** One distribution's per-bar state over [a, a + span). */
class Dist {
  constructor(a, span, atr) {
    this.a = a;
    this._atr = atr;
    this.q      = new Float64Array(span * DIST_QLEVELS).fill(NaN);
    this.width  = new Float64Array(span).fill(NaN);
    this.coreLo = new Float64Array(span).fill(NaN);
    this.coreHi = new Float64Array(span).fill(NaN);
    this.wRank  = new Float64Array(span).fill(NaN);
    this.dRank  = new Float64Array(span).fill(NaN);
    this._wHist = [];
    this._dHist = [];
  }

  /** Fill bar t from line values v (sorted ascending) with weights ww
   * (null = equal), plus its width / density ranks. */
  set(t, v, ww, lo, hi) {
    const j = t - this.a, QL = DIST_QLEVELS, n = v.length;
    let best, bi = 0, bk = n - 1;
    if (!ww) {
      for (let k = 0; k < QL; k++) {
        const pos = k / (QL - 1) * (n - 1), i0 = Math.floor(pos), f = pos - i0;
        this.q[j * QL + k] = i0 + 1 < n ? v[i0] + (v[i0 + 1] - v[i0]) * f : v[i0];
      }
      const m = Math.max(1, Math.ceil(DIST_CORE_SHARE * n) - 1);
      best = Infinity;
      for (let i = 0; i + m < n; i++) { const g = v[i + m] - v[i]; if (g < best) { best = g; bi = i; bk = i + m; } }
    } else {
      let W = 0;
      const mid = new Float64Array(n);   // cumulative weight at each line's middle, 0 … 1
      for (let i = 0; i < n; i++) { mid[i] = W + ww[i] / 2; W += ww[i]; }
      for (let i = 0; i < n; i++) mid[i] /= W;
      // Quantiles: 0 and 1 the fan's true edges; between, interpolated on the
      // cumulative-weight midpoints.
      let p = 0;
      for (let k = 0; k < QL; k++) {
        const f = k / (QL - 1);
        let q;
        if (k === 0 || f <= mid[0]) q = v[0];
        else if (k === QL - 1 || f >= mid[n - 1]) q = v[n - 1];
        else {
          while (p < n - 2 && mid[p + 1] < f) p++;
          const r = mid[p + 1] > mid[p] ? (f - mid[p]) / (mid[p + 1] - mid[p]) : 0;
          q = v[p] + (v[p + 1] - v[p]) * r;
        }
        this.q[j * QL + k] = q;
      }
      // Core: narrowest [i, k] holding DIST_CORE_SHARE of the weight (two pointers).
      const need = DIST_CORE_SHARE * W;
      let sum = 0, k = 0;
      best = Infinity;
      for (let i = 0; i < n; i++) {
        while (k < n && sum < need) sum += ww[k++];
        if (sum < need) break;
        if (v[k - 1] - v[i] < best) { best = v[k - 1] - v[i]; bi = i; bk = k - 1; }
        sum -= ww[i];
      }
    }
    this.coreLo[j] = v[bi]; this.coreHi[j] = v[bk];
    const atr = this._atr[t];
    if (atr > 0) {
      const w = best / atr;
      this.width[j] = w;
      const r = insertSorted(this._wHist, w);
      if (this._wHist.length >= DIST_HIST_MIN) this.wRank[j] = r / (this._wHist.length - 1);
    }
    const cover = Math.max(0, Math.min(1, this.pct(t, hi).p) - Math.max(0, this.pct(t, lo).p));
    const r = insertSorted(this._dHist, cover);
    if (this._dHist.length >= DIST_HIST_MIN) this.dRank[j] = r / (this._dHist.length - 1);
  }

  /** Quantile level f (0 … 1) at bar t, interpolated, or NaN. */
  quantile(t, f) {
    const j = t - this.a, QL = DIST_QLEVELS;
    if (j < 0) return NaN;
    const pos = f * (QL - 1), k = Math.floor(pos), r = pos - k;
    const q0 = this.q[j * QL + k];
    return k + 1 < QL ? q0 + (this.q[j * QL + k + 1] - q0) * r : q0;
  }

  /** Where price p sits at bar t: { p: percentile (may be < 0 / > 1 beyond
   * the edges, linear in the fan's full width), beyond: distance past the
   * nearest edge in ATR (0 inside) } or null. */
  pct(t, price) {
    const j = t - this.a, QL = DIST_QLEVELS, base = j * QL;
    if (j < 0 || Number.isNaN(this.q[base])) return null;
    const lo = this.q[base], hi = this.q[base + QL - 1];
    const atr = this._atr[t] > 0 ? this._atr[t] : Math.max(hi - lo, 1e-9);
    if (price <= lo) return { p: hi > lo ? (price - lo) / (hi - lo) : 0, beyond: (lo - price) / atr };
    if (price >= hi) return { p: hi > lo ? 1 + (price - hi) / (hi - lo) : 1, beyond: (price - hi) / atr };
    let k = 0;
    while (k < QL - 2 && this.q[base + k + 1] < price) k++;
    const q0 = this.q[base + k], q1 = this.q[base + k + 1];
    const f = q1 > q0 ? (price - q0) / (q1 - q0) : 0.5;
    return { p: (k + f) / (QL - 1), beyond: 0 };
  }

  /** Density at price p, bar t, as 0 … 1 of the bar's densest stretch
   * (quantile spacing), or null outside the fan. */
  density(t, price) {
    const j = t - this.a, QL = DIST_QLEVELS, base = j * QL;
    if (j < 0 || Number.isNaN(this.q[base])) return null;
    if (price < this.q[base] || price > this.q[base + QL - 1]) return null;
    let minGap = Infinity, gap = Infinity;
    for (let k = 0; k < QL - 1; k++) {
      const g = this.q[base + k + 1] - this.q[base + k];
      if (g > 0 && g < minGap) minGap = g;
      if (price >= this.q[base + k] && price <= this.q[base + k + 1]) gap = g;
    }
    if (!Number.isFinite(minGap)) return 1;
    return gap > 0 ? Math.min(1, minGap / gap) : 1;
  }

  /** Robust σ at bar t ((q75 − q25) / 1.349), floored at floorAtr × ATR so a
   * tight early fan doesn't blow distances up. */
  spread(t, floorAtr = 0.1) {
    const iqr = this.quantile(t, 0.75) - this.quantile(t, 0.25);
    const atr = this._atr[t];
    return Math.max(iqr / 1.349, atr > 0 ? floorAtr * atr : 0);
  }

  /** Whether bar t has a distribution. */
  has(t) { const j = t - this.a; return j >= 0 && !Number.isNaN(this.q[j * DIST_QLEVELS]); }
}

export class FanDist {
  /** measure: a Ctrl+. FAN_RANK_MODES step ('vol', 'avg_wick', 'liq', …);
   * srView: that fan's support / resistance view. */
  constructor(engine, a, measure = 'vol', srView = false) {
    this.eng = engine;
    this.a = a;
    this.measure = measure;
    this.srView = srView;
    this.avg = measure.startsWith('avg_');
    this._m = this.avg ? measure.slice(4) : measure;
    const N = engine._bars.length, span = N - a;
    this._atr = engine._getAtr(DIST_ATR);
    this.full = new Dist(a, span, this._atr);
    this.wtd  = new Dist(a, span, this._atr);
    this.tW = new Array(span).fill(null);
    this.tF = new Array(span).fill(null);
    // Per anchor c − a, tallies of the weighted lines (plain or average
    // aVWAPs) over the bars after it, so far.
    this._crossed = new Float64Array(span);
    this._wicks   = new Float64Array(span);
    this._bodies  = new Float64Array(span);
    this._lowW    = new Float64Array(span);
    this._liq     = new Float64Array(span);   // summed liquidity of the crossed bars
    this._sumL = 0;
    this._cumL = new Float64Array(span);       // L summed over bars a+1 … a+j, by j
    this.to = a - 1;
  }

  /** Compute every bar up to top (no-op for bars already done). */
  extend(top) {
    const eng = this.eng, a = this.a;
    const H = eng._highs, L = eng._lows, O = eng._opens, C = eng._closes, V = eng._volumes;
    top = Math.min(top, eng._bars.length - 1);
    for (let t = this.to + 1; t <= top; t++) {
      const j = t - a;
      // Plain line values at t by anchor; the weighted side's lines (plain,
      // or each anchor's average aVWAP — a running mean, newest anchor first).
      const byC = new Float64Array(j + 1).fill(NaN);
      for (let c = a; c <= t; c++) { const v = eng._vwapAt(c, t); if (v != null) byC[c - a] = v; }
      let lines = byC;
      if (this.avg) {
        lines = new Float64Array(j + 1).fill(NaN);
        let sum = 0, cnt = 0;
        for (let c = t; c >= a; c--) {
          const v = byC[c - a];
          if (!Number.isNaN(v)) { sum += v; cnt++; }
          if (cnt) lines[c - a] = sum / cnt;
        }
      }
      const plain = [];
      for (let k = 0; k <= j; k++) if (!Number.isNaN(byC[k])) plain.push(byC[k]);
      if (plain.length >= DIST_MIN_LINES) {
        plain.sort((p, q) => p - q);
        this.full.set(t, plain, null, L[t], H[t]);
        this._setWeighted(t, lines);
        this.tF[j] = this._touch(t, [this.full.quantile(t, 0.5)])?.[0] ?? null;
      }
      this.tW[j] = this._touchTop(t, lines);
      // Then add this bar to every older line's tallies (after scoring — no
      // self-influence).
      const vol = V[t] > 0 ? V[t] : 0;
      const bTop = Math.max(O[t], C[t]), bBot = Math.min(O[t], C[t]);
      const Lt = t > a ? eng._barLiq(t) : 0;
      this._cumL[j] = this._sumL += Lt;
      for (let c = a; c < t; c++) {
        const v = lines[c - a], k = c - a;
        if (!(v >= L[t] && v <= H[t])) continue;
        this._crossed[k] += vol;
        this._liq[k] += Lt;
        if (v >= bBot && v <= bTop) this._bodies[k]++;
        else { this._wicks[k]++; if (v < bBot) this._lowW[k]++; }
      }
    }
    if (top > this.to) this.to = top;
  }

  /** Line c's score under the measure as of bar t − 1 (tallies before bar
   * t), or null where it can't be scored (as avwap_replay.js _crossScore). */
  _score(c, t) {
    const k = c - this.a, to = t - 1;
    if (c >= to) return null;
    const crossed = this._crossed[k], wicks = this._wicks[k], bodies = this._bodies[k], n = wicks + bodies;
    switch (this._m) {
      case 'vol': return crossed;
      case 'volfrac': {
        const total = this.eng._cumVol[to] - this.eng._cumVol[c];
        return total > 0 && to - c >= Math.max(1, Math.min(FRAC_MIN_SPAN, to - this.a)) ? crossed / total : null;
      }
      case 'wick': return n > 0 ? wicks - bodies : null;
      case 'wickfrac': return n >= FRAC_MIN_CROSS ? wicks / n : null;
      case 'liq': return this._liq[k];
      case 'liqfrac': {
        const total = this._cumL[to - this.a] - this._cumL[k];
        return total > 0 && to - c >= Math.max(1, Math.min(FRAC_MIN_SPAN, to - this.a)) ? this._liq[k] / total : null;
      }
    }
    return null;
  }

  /** srView: line c's side from its wick direction, null where neither. */
  _side(c) {
    const k = c - this.a, low = this._lowW[k], up = this._wicks[k] - low;
    return low > up ? 'sup' : up > low ? 'res' : null;
  }

  _setWeighted(t, lines) {
    const a = this.a, idx = [], sc = [];
    for (let c = a; c <= t; c++) if (!Number.isNaN(lines[c - a])) {
      idx.push(c);
      sc.push(this.srView && (c >= t - 1 || !this._side(c)) ? null : this._score(c, t));
    }
    const n = idx.length;
    const scored = sc.filter(x => x != null).sort((p, q) => p - q);
    const below = x => { let lo = 0, hi = scored.length; while (lo < hi) { const m = (lo + hi) >> 1; if (scored[m] < x) lo = m + 1; else hi = m; } return lo; };
    const den = Math.max(1, scored.length - 1);
    const w = sc.map(x => { const r = x == null ? 0 : below(x) / den; return W_MIN + (1 - W_MIN) * r * r; });
    const ord = Array.from({ length: n }, (_, i) => i).sort((p, q) => lines[idx[p] - a] - lines[idx[q] - a]);
    this.wtd.set(t, ord.map(i => lines[idx[i] - a]), ord.map(i => w[i]), this.eng._lows[t], this.eng._highs[t]);
  }

  /** What bar t did at each of the given levels: [{ kind, level }] (kind
   * null where untouched), or null. */
  _touch(t, levels) {
    const eng = this.eng, lo = eng._lows[t], hi = eng._highs[t];
    const bTop = Math.max(eng._opens[t], eng._closes[t]), bBot = Math.min(eng._opens[t], eng._closes[t]);
    return levels.map(v => {
      if (!(v >= lo && v <= hi)) return { kind: null, level: v };
      const kind = v >= bBot && v <= bTop ? (eng._closes[t] >= v ? 'up' : 'dn') : v < bBot ? 'sup' : 'res';
      return { kind, level: v };
    });
  }

  /** Bar t against the top DIST_TOUCH_TOP lines by the measure (as of the
   * bar before, kept apart): the strongest one touched, with its rank, plus
   * the top list itself (anchors) for drawing. */
  _touchTop(t, lines) {
    const a = this.a, span = t - a;
    if (span < DIST_MIN_LINES) return null;
    const sep = Math.max(SEP_MIN, Math.round(SEP_FRAC * span));
    const pool = [];
    for (let c = a; c < t - 1; c++) {
      if (Number.isNaN(lines[c - a])) continue;
      if (this.srView && !this._side(c)) continue;
      const s = this._score(c, t);
      if (s != null) pool.push([c, s]);
    }
    pool.sort((p, q) => q[1] - p[1] || p[0] - q[0]);
    const strong = [];
    for (const [c] of pool) {
      if (strong.length >= DIST_TOUCH_TOP) break;
      if (strong.every(x => Math.abs(x - c) >= sep)) strong.push(c);
    }
    const hits = this._touch(t, strong.map(c => lines[c - a]));
    const r = hits.findIndex(h => h.kind);
    return r < 0 ? { kind: null, rank: 0, strong } : { kind: hits[r].kind, rank: r + 1, level: hits[r].level, strong };
  }

  /** The weighted side's line anchored at c, at bar t (plain or average aVWAP), or null. */
  lineAt(c, t) {
    return this.avg ? this.eng._avgVwapAt(c, t) : this.eng._vwapAt(c, t);
  }
}
