/**
 * qqemod.js — QQEMOD in the browser, for the live candle coloring (Shift+K /
 * Shift+J). A port of backend/indicators/indicators_list/QQEMOD.py and the
 * candle_colors indicator's map_QQEMOD, same defaults.
 *
 * Every step only reads the previous bar's state, so besides the normal pass
 * over the closes, any bar can be re-run with a hypothetical close (whatIf):
 * the state that bar would have had if it had closed at that price — what
 * Shift+J draws price by price inside each candle.
 *
 * States (map_QQEMOD's branches):
 *   1  QQE1 above its upper band and QQE2 above +threshold, QQE2 ≥ its trend line → teal
 *   2  … QQE2 below its trend line                                              → teal 0.75
 *   3  QQE2 above +threshold only                                               → teal 0.5
 *   4  QQE1 below its lower band and QQE2 below −threshold, QQE2 < its trend line → red
 *   5  … QQE2 at / above its trend line                                         → red 0.75
 *   6  QQE2 below −threshold only                                               → red 0.5
 *   0  none of these (the indicator's black → hollow candle)
 */

export const QQE_DEFAULTS = {
  rsi_period: 6, rsi_period2: 5, sf: 5, sf2: 5,
  qqe_factor: 3.0, qqe_factor2: 1.61, threshold: 3, bb_length: 50, bb_multi: 0.35,
};

// pandas ewm(adjust=False): starts at the first finite value.
const ewm = (prev, x, a) => (Number.isNaN(x) ? prev : Number.isNaN(prev) ? x : prev + a * (x - prev));

/** One QQE line's per-bar state arrays + its step function. */
function qqeLine(closes, rsiPeriod, sf, factor) {
  const N = closes.length, wp = rsiPeriod * 2 - 1;
  const aW = 1 / wp, aSf = 2 / (sf + 1), aSp = 2 / (wp + 1);
  const S = { g: new Float64Array(N), l: new Float64Array(N), rsiMa: new Float64Array(N),
    maAtr: new Float64Array(N), darS: new Float64Array(N), long: new Float64Array(N),
    short: new Float64Array(N), trend: new Int8Array(N), tl: new Float64Array(N) };
  // Bar i's state from bar i−1's, closing at c. Returns the new values (doesn't store).
  const step = (i, c) => {
    if (i === 0) return { g: 0, l: 0, rsiMa: NaN, maAtr: NaN, darS: NaN, long: NaN, short: NaN, trend: 1, tl: NaN };
    const d = c - closes[i - 1];
    const g = ewm(S.g[i - 1], d > 0 ? d : 0, aW), l = ewm(S.l[i - 1], d < 0 ? -d : 0, aW);
    const rsi = 100 - 100 / (1 + g / l);
    const rsiMa = ewm(S.rsiMa[i - 1], rsi, aSf);
    const atr = Math.abs(rsiMa - S.rsiMa[i - 1]);
    const maAtr = ewm(S.maAtr[i - 1], atr, aSp);
    const darS = ewm(S.darS[i - 1], maAtr, aSp), dar = darS * factor;
    const pr = S.rsiMa[i - 1], pl = S.long[i - 1], ps = S.short[i - 1];
    const nl = rsiMa - dar, ns = rsiMa + dar;
    const long = pr > pl && rsiMa > pl ? Math.max(pl, nl) : nl;
    const short = pr < ps && rsiMa < ps ? Math.min(ps, ns) : ns;
    const trend = rsiMa > ps ? 1 : rsiMa < pl ? -1 : S.trend[i - 1];
    return { g, l, rsiMa, maAtr, darS, long, short, trend, tl: trend === 1 ? long : short };
  };
  for (let i = 0; i < N; i++) {
    const r = step(i, closes[i]);
    for (const k in S) S[k][i] = r[k];
  }
  return { S, step };
}

/** QQEMOD over closes: { stateAt(i), whatIf(i, close) } (see the module doc for states). */
export function buildQqemod(closes, p = QQE_DEFAULTS) {
  const N = closes.length, L = p.bb_length;
  const q1 = qqeLine(closes, p.rsi_period, p.sf, p.qqe_factor);
  const q2 = qqeLine(closes, p.rsi_period2, p.sf2, p.qqe_factor2);
  // Prefix sums of (QQE1 trend line − 50) for its rolling Bollinger band (NaN-counted).
  const s1 = new Float64Array(N + 1), s2 = new Float64Array(N + 1), nan = new Int32Array(N + 1);
  for (let i = 0; i < N; i++) {
    const v = q1.S.tl[i] - 50, bad = Number.isNaN(v);
    s1[i + 1] = s1[i] + (bad ? 0 : v); s2[i + 1] = s2[i] + (bad ? 0 : v * v); nan[i + 1] = nan[i] + (bad ? 1 : 0);
  }
  // The band at bar i from the L−1 bars before it plus this bar's trend line value.
  const band = (i, tl) => {
    const lo = i - L + 1;
    if (lo < 0) return null;
    const v = tl - 50;
    if (Number.isNaN(v) || nan[i] - nan[lo] > 0) return null;
    const sum = s1[i] - s1[lo] + v, sq = s2[i] - s2[lo] + v * v;
    const mean = sum / L, sd = Math.sqrt(Math.max(0, (sq - sum * sum / L) / (L - 1)));
    return { upper: mean + p.bb_multi * sd, lower: mean - p.bb_multi * sd };
  };
  const classify = (i, r1, r2) => {
    const bb = band(i, r1.tl);
    const v1 = r1.rsiMa - 50, v2 = r2.rsiMa - 50;
    const above = bb != null && v1 > bb.upper, below = bb != null && v1 < bb.lower;
    const up2 = v2 > p.threshold, dn2 = v2 < -p.threshold, aboveTl = r2.rsiMa >= r2.tl;
    if (above && up2) return aboveTl ? 1 : 2;
    if (below && dn2) return !aboveTl ? 4 : 5;
    if (up2) return 3;
    if (dn2) return 6;
    return 0;
  };
  const stored = (q, i) => { const o = {}; for (const k in q.S) o[k] = q.S[k][i]; return o; };
  const states = new Int8Array(N);
  for (let i = 0; i < N; i++) states[i] = classify(i, stored(q1, i), stored(q2, i));
  return {
    stateAt: i => states[i],
    whatIf: (i, c) => classify(i, q1.step(i, c), q2.step(i, c)),
  };
}
