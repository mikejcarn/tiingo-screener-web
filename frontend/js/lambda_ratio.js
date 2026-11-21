/**
 * lambda_ratio.js — pullback quality vs the preceding push, from an anchor
 * (the Shift+K / Shift+J 'lambda' candle mode, see chart.js).
 *
 * Effort vs result, Kyle's-lambda style: for each pullback bar, compare the
 * pullback's speed (price change per bar) and volume (per bar) with the push
 * before it, and colour by the (speed_ratio, vol_ratio) QUADRANT — not by
 * their ratio alone, which can't tell a slow light pullback from a fast
 * heavy one:
 *
 *   quiet     speed < 1, vol < 1   sellers inactive — normal healthy pullback
 *   absorbed  speed < 1, vol >= 1  heavy selling met by buyers — strongest
 *   thin      speed >= 1, vol < 1  falling with no bids — fragile
 *   pressure  speed >= 1, vol >= 1 supply in control — likely breakdown
 *
 * Long setup (anchor at a valley): a bar making a new high since the push
 * start is a PUSH bar; bars after the swing high, before a new high, are
 * PULLBACK bars. A new high after a significant pullback (≥ minPbBars bars,
 * or ≥ resetAtr × ATR deep) starts a new push from that pullback's low, so
 * the baseline is always the MOST RECENT push; a shallow 1–2 bar dip just
 * continues the current push instead of fragmenting it. A low below the
 * anchor's low breaks the setup: every bar from there on is 'broken'.
 * Short setups (anchor at a peak) mirror everything.
 *
 * The colour uses the pullback's last `window` bars vs the push (so the
 * transition — "quiet, then absorbed as it reaches the aVWAP" — shows up
 * instead of being averaged away); the whole-pullback ratios are kept too.
 *
 * Strictly as-of: bar t's result uses only bars ≤ t, so colours never change
 * when later bars arrive (replay-safe). O(n) via prefix sums.
 */

export const LAMBDA_COLORS = {
  quiet:    [127, 119, 221],   // #7F77DD
  absorbed: [29, 158, 117],    // #1D9E75
  thin:     [216, 90, 48],     // #D85A30
  pressure: [226, 75, 74],     // #E24B4A
  push:     [136, 135, 128],   // #888780
  forming:  [180, 178, 169],   // #B4B2A9
  broken:   [80, 80, 78],
};

// A pullback bar AT the aVWAP band (low within bandAtr × ATR of it, no
// close through it) — the decision bars — in the app's bright σ palette
// instead: the good quadrants aqua / neon green, the bad crimson / magenta.
export const LAMBDA_BAND_COLORS = {
  quiet:    [0, 229, 255],     // aqua
  absorbed: [57, 255, 20],     // neon green — the ideal pullback
  thin:     [220, 20, 60],     // crimson
  pressure: [255, 40, 220],    // magenta — don't buy the level
};

export const LAMBDA_LABELS = {
  quiet: 'Quiet', absorbed: 'Absorbed', thin: 'Thin', pressure: 'Selling pressure',
  push: 'Push', forming: 'Forming', broken: 'Broken (anchor taken out)',
};

export const LAMBDA_DEFAULTS = {
  minPbBars:  3,       // pullback bars before colouring ('forming' until then)
  minPushBars: 3,      // don't read pullbacks after a shorter push
  window:     4,       // colour from the pullback's last this-many bars
  deadband:   0,       // e.g. 0.1 → both ratios within 0.9–1.1 count as neutral
  speedMode:  'net',   // 'net' = displacement ÷ bars (ignores chop); 'gross' = mean |Δclose|
  resetAtr:   1,       // a pullback this many ATR deep starts a new push even if short
  bandAtr:    0.5,     // aVWAP band half-width for the 'ideal' marker
  atrLen:     14,
};

/** Quadrant of (speed ratio, vol ratio); 'forming' inside the deadband. */
export function lambdaQuadrant(sr, vr, deadband = 0) {
  if (deadband > 0 && Math.abs(Math.log(sr)) < Math.log1p(deadband) && Math.abs(Math.log(vr)) < Math.log1p(deadband)) return 'forming';
  if (sr < 1) return vr >= 1 ? 'absorbed' : 'quiet';
  return vr >= 1 ? 'pressure' : 'thin';
}

/** Long or short from the anchor bar's shape: a valley (lowest low of the
 * bars around it) is long, a peak short; if it's both or neither, by where
 * price went next. */
export function detectLambdaSide(bars, a, span = 5) {
  const H = i => bars[i].High ?? bars[i].high, L = i => bars[i].Low ?? bars[i].low, C = i => bars[i].Close ?? bars[i].close;
  const lo = Math.max(0, a - span), hi = Math.min(bars.length - 1, a + span);
  let isLow = true, isHigh = true;
  for (let i = lo; i <= hi; i++) {
    if (i === a) continue;
    if (L(i) < L(a)) isLow = false;
    if (H(i) > H(a)) isHigh = false;
  }
  if (isLow !== isHigh) return isLow ? 'long' : 'short';
  const j = Math.min(bars.length - 1, a + span);
  return j > a && C(j) < C(a) ? 'short' : 'long';
}

/**
 * Per-bar results from `anchor` to the end of `bars` (index i → out[i - anchor]).
 * Each: { phase: 'push'|'pullback'|'forming'|'broken', quadrant, pbBars,
 *         speedRatio, volRatio, lambdaRatio (recent window),
 *         speedFull, volFull, lambdaFull (whole pullback), atBand, ideal }
 * plus what-if helpers. Returns { side, from, out, vwap, whatIf(i, price) }.
 */
export function computeLambdaRatio(bars, anchor, side = 'long', opts = {}) {
  const o = { ...LAMBDA_DEFAULTS, ...opts };
  const n = bars.length;
  const sgn = side === 'short' ? -1 : 1;
  // Mirrored series: for a short, lows become highs (H = −low, L = −high, C = −close).
  const H = new Float64Array(n), L = new Float64Array(n), C = new Float64Array(n), V = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const b = bars[i];
    const h = b.High ?? b.high, l = b.Low ?? b.low;
    H[i] = sgn > 0 ? h : -l;
    L[i] = sgn > 0 ? l : -h;
    C[i] = sgn * (b.Close ?? b.close);
    V[i] = b.Volume ?? b.volume ?? 0;
  }
  // Prefix sums: SA = Σ|Δclose|, SV = Σvolume; sum over (a, b] = S[b] − S[a].
  const SA = new Float64Array(n), SV = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    SA[i] = (i ? SA[i - 1] + Math.abs(C[i] - C[i - 1]) : 0);
    SV[i] = (i ? SV[i - 1] : 0) + V[i];
  }
  // ATR (simple mean of true range, as-of).
  const atr = new Float64Array(n);
  {
    let sum = 0;
    const tr = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const b = bars[i], h = b.High ?? b.high, l = b.Low ?? b.low;
      const pc = i ? (bars[i - 1].Close ?? bars[i - 1].close) : null;
      tr[i] = pc == null ? h - l : Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
      sum += tr[i];
      if (i >= o.atrLen) sum -= tr[i - o.atrLen];
      atr[i] = sum / Math.min(i + 1, o.atrLen);
    }
  }
  // aVWAP from the anchor (typical price, as DynamicVWAPEngine), as-of.
  const vwap = new Float64Array(Math.max(0, n - anchor)).fill(NaN);
  {
    let pv = 0, vol = 0;
    for (let i = anchor; i < n; i++) {
      const b = bars[i];
      pv += ((b.High ?? b.high) + (b.Low ?? b.low) + (b.Close ?? b.close)) / 3 * V[i];
      vol += V[i];
      if (vol > 0) vwap[i - anchor] = pv / vol;
    }
  }

  const out = new Array(Math.max(0, n - anchor));
  if (!out.length) return { side, from: anchor, out, vwap, whatIf: () => null };
  out[0] = { phase: 'push', quadrant: 'push', pbBars: 0 };
  let pushStart = anchor, ext = anchor, broken = false;
  const forming = (k, extra) => ({ phase: 'forming', quadrant: 'forming', pbBars: k, ...extra });

  for (let t = anchor + 1; t < n; t++) {
    const j = t - anchor;
    if (broken || L[t] < L[anchor]) {
      broken = true;
      out[j] = { phase: 'broken', quadrant: 'broken', pbBars: t - ext };
      continue;
    }
    if (H[t] >= H[ext]) {                         // new swing extreme → push bar
      const k = t - ext - 1;                      // pullback bars just ended
      if (k >= 1) {
        let lowIdx = ext + 1;
        for (let i = ext + 2; i < t; i++) if (L[i] < L[lowIdx]) lowIdx = i;
        const depth = H[ext] - L[lowIdx];
        if (k >= o.minPbBars || depth >= o.resetAtr * atr[t - 1]) pushStart = lowIdx;
      }
      ext = t;
      out[j] = { phase: 'push', quadrant: 'push', pbBars: 0 };
      continue;
    }
    const m = ext - pushStart, k = t - ext;
    if (m < o.minPushBars || k < o.minPbBars || !(V[t] > 0)) { out[j] = forming(k); continue; }
    const ps = o.speedMode === 'gross' ? (SA[ext] - SA[pushStart]) / m : (C[ext] - C[pushStart]) / m;
    const pv = (SV[ext] - SV[pushStart]) / m;
    if (!(ps > 0) || !(pv > 0)) { out[j] = forming(k); continue; }
    const speedOver = (s, w) => o.speedMode === 'gross' ? (SA[t] - SA[s]) / w : Math.max(0, C[s] - C[t]) / w;
    // Recent window (colour) and whole pullback (readout).
    const s = Math.max(ext, t - o.window), w = t - s;
    const sr = speedOver(s, w) / ps, vr = (SV[t] - SV[s]) / w / pv;
    const srF = speedOver(ext, k) / ps, vrF = (SV[t] - SV[ext]) / k / pv;
    const quadrant = lambdaQuadrant(sr, vr, o.deadband);
    // aVWAP band: the bar's low reaches within bandAtr × ATR of the aVWAP
    // without closing through it (mirrored for shorts).
    const vw = sgn * vwap[j];
    const lowOk = !Number.isNaN(vw) && L[t] <= vw + o.bandAtr * atr[t];
    const atBand = lowOk && C[t] >= vw;
    out[j] = {
      phase: 'pullback', quadrant, pbBars: k,
      speedRatio: sr, volRatio: vr, lambdaRatio: vr > 0 ? sr / vr : NaN,
      speedFull: srF, volFull: vrF, lambdaFull: vrF > 0 ? srF / vrF : NaN,
      atBand, ideal: atBand && (quadrant === 'quiet' || quadrant === 'absorbed'),
      _wi: { s, w, ps, vr, gsum: SA[t - 1] - SA[s], prevC: C[t - 1], vw, lowOk },
    };
  }

  /** { quadrant, atBand } bar i WOULD have had closing at `price` (volume,
   * highs and lows unchanged — so only pullback bars can differ), or null. */
  const whatIf = (i, price) => {
    const r = out[i - anchor];
    if (!r) return null;
    if (r.phase !== 'pullback') return { quadrant: r.quadrant, atBand: false };
    const { s, w, ps, vr, gsum, prevC, vw, lowOk } = r._wi, cp = sgn * price;
    const bs = o.speedMode === 'gross' ? (gsum + Math.abs(cp - prevC)) / w : Math.max(0, C[s] - cp) / w;
    return { quadrant: lambdaQuadrant(bs / ps, vr, o.deadband), atBand: lowOk && cp >= vw };
  };

  return { side, from: anchor, out, vwap, whatIf };
}
