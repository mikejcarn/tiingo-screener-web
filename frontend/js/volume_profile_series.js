/**
 * volume_profile_series.js — custom lightweight-charts series that draws a
 * volume-at-price histogram as horizontal bars anchored at a peak/valley,
 * extending rightward from the anchor bar — the classic volume-profile look,
 * distinct from every other zone type in this app (which are all filled
 * rectangles/lines spanning a time range, not a sideways bar chart).
 *
 * Two data points per profile — { time, lo, bs, bins, dir, fillOpacity, poc,
 * vah, val, hvn, lvn, showHistogram, directionalColor, barStyle,
 * heatmapEmphasis, heatmapOpacity, heatmapContrast, heatmapLocality,
 * nodeWindow, histogramGrayscale } at the anchor's start and end bar, same
 * start/end convention as the other zone series.
 * lo/bs are the histogram's price origin and bin size, bins the per-bin
 * volume totals, poc/vah/val the Point of Control and Value Area bounds,
 * hvn/lvn arrays of [lo, hi] High/Low Volume Node price ranges (see
 * volume_profile.py for how all of these are computed).
 */

const RGB_BULL    = '38,166,154';
const RGB_BEAR    = '239,83,80';
// Default (non-directional) profile color — a profile's own shape, not its
// anchor's bull/bear direction, is usually the point of looking at it.
// Exported so other callers (e.g. avwap_replay.js's manual Ctrl+. pairing)
// can match their own line color to it rather than hardcoding a lookalike.
export const RGB_DEFAULT = '255,127,0';
// Bars extend at most this fraction of the anchor-to-end pixel span, so a
// profile never visually swallows the whole time range it covers — the
// classic volume-profile convention of a narrow sidebar-style histogram.
const MAX_WIDTH_FRACTION = 0.3;
// Bins outside the value area (VAL-VAH) are dimmed to this fraction of the
// normal bar opacity, so the value area reads as the "core" of the profile.
const VA_DIM_FACTOR = 0.45;
// Histogram's neutral fill when histogramGrayscale is on (bars or heatmap
// style, either one) — width/opacity still encode volume, only the hue is
// dropped. POC/Value Area lines keep the profile's real color regardless.
const RGB_GRAYSCALE = '200,200,200';
// HVN/LVN nodes use fixed, direction-independent colors — they describe the
// profile's own shape, not its bull/bear anchor — plain fills, no border,
// distinguished from each other by color alone.
const RGB_HVN = '255,196,0';
const RGB_LVN = '140,150,170';

// For heatmapLocality > 0 — each bin's min/max over a centered window of its
// own neighbors (same window peaks_valleys-style node detection uses), so a
// bin's intensity can be judged against its local surroundings instead of
// only the profile's single global peak. Window shrinks gracefully at the
// array edges rather than going undefined, since every bin needs a usable
// local reference for a continuous gradient (unlike the discrete HVN/LVN
// detector, which deliberately excludes edges it can't fully window).
function _localMinMax(bins, window) {
  const n = bins.length;
  const w = Math.max(0, window | 0);
  const localMin = new Array(n);
  const localMax = new Array(n);
  for (let i = 0; i < n; i++) {
    let mn = Infinity, mx = -Infinity;
    for (let j = Math.max(0, i - w); j <= Math.min(n - 1, i + w); j++) {
      if (bins[j] < mn) mn = bins[j];
      if (bins[j] > mx) mx = bins[j];
    }
    localMin[i] = mn;
    localMax[i] = mx;
  }
  return { localMin, localMax };
}

export class VolumeProfileRenderer {
  constructor() {
    this._data = null;
  }

  draw(target, priceConverter) {
    target.useBitmapCoordinateSpace(scope => this._drawImpl(scope, priceConverter));
  }

  update(data) {
    this._data = data;
  }

  _drawImpl(scope, priceToCoordinate) {
    const data = this._data;
    if (!data || data.bars.length < 2 || !data.visibleRange) return;

    const { context: ctx, horizontalPixelRatio: hr, verticalPixelRatio: vr } = scope;
    const first = data.bars[0];
    const last  = data.bars[data.bars.length - 1];
    const {
      lo, bs, bins, dir, fillOpacity, poc, vah, val, hvn, lvn,
      showHistogram, directionalColor, barStyle,
      heatmapEmphasis, heatmapOpacity, heatmapContrast, heatmapLocality, nodeWindow,
      histogramGrayscale,
    } = first.originalData;
    if (lo == null || bs == null || !bins || !bins.length) return;

    const x0 = Math.round(first.x * hr);
    const x1 = Math.round(last.x  * hr);
    if (x1 <= x0) return;

    const maxBin = Math.max(...bins);
    if (maxBin <= 0) return;

    const maxWidth = (x1 - x0) * MAX_WIDTH_FRACTION;
    const rgb = directionalColor ? (dir === 'bull' ? RGB_BULL : RGB_BEAR) : RGB_DEFAULT;
    // Histogram-only color — POC/Value Area lines below keep using rgb
    // itself, unaffected by histogramGrayscale.
    const histRgb = histogramGrayscale ? RGB_GRAYSCALE : rgb;
    const baseOpacity = fillOpacity ?? 0.4;
    const hasValueArea = val != null && vah != null;

    // Shared per-bin geometry — 'bars' and 'heatmap' both need each bin's
    // vertical pixel span and whether it falls inside the value area, they
    // just encode the bin's volume differently (width vs. opacity) below.
    // includeZero: LVN-emphasis heatmap needs zero-volume bins too (an
    // untraded gap is its strongest signal) — every other mode skips them,
    // since a zero-volume bin is invisible under those encodings anyway.
    const forEachBin = (cb, includeZero = false) => {
      for (let i = 0; i < bins.length; i++) {
        if (bins[i] <= 0 && !includeZero) continue;
        const priceLo = lo + i * bs;
        const priceHi = priceLo + bs;
        const yLo = priceToCoordinate(priceLo);
        const yHi = priceToCoordinate(priceHi);
        if (yLo == null || yHi == null) continue;
        const top    = Math.min(yLo, yHi) * vr;
        const bottom = Math.max(yLo, yHi) * vr;
        const inVA   = !hasValueArea || (priceHi > val && priceLo < vah);
        cb(bins[i], top, bottom, inVA, i);
      }
    };

    if (showHistogram ?? true) {
      if (barStyle === 'heatmap') {
        // Every bin spans the profile's full width; volume is read from
        // opacity instead of width. heatmapOpacity (its own control,
        // separate from fillOpacity — bars has width to lean on, heatmap
        // only has opacity) is the ceiling at the emphasized extreme.
        // heatmapContrast is the curve's exponent: >1 (the default)
        // suppresses bins further from that extreme faster than ones near
        // it, so distinct levels stand out against a fainter background;
        // <1 does the opposite, boosting distant bins at the cost of that
        // distinctness.
        const heatCeiling = heatmapOpacity ?? 0.85;
        const heatGamma   = heatmapContrast ?? 2.0;
        const lvnEmphasis = heatmapEmphasis === 'lvn';
        // 0 = judge every bin purely against the profile's one global peak
        // (today's behavior); 1 = judge each bin purely against the min/max
        // of its own local neighborhood instead, so a modest local hump can
        // stand out even if it's unremarkable on the global scale, and
        // 'hvn'/'lvn' emphasis stop being structurally lopsided (a global
        // single-peak reference makes 'hvn' a sparse spike and 'lvn' a
        // dense glow at the same contrast setting; a local min-max range is
        // always a fair 0-1 span on both ends). Values between blend the two.
        const locality = Math.min(1, Math.max(0, heatmapLocality ?? 0));
        const { localMin, localMax } = locality > 0
          ? _localMinMax(bins, nodeWindow ?? 2)
          : { localMin: null, localMax: null };
        forEachBin((v, top, bottom, inVA, i) => {
          let hvnShare = v / maxBin;
          if (locality > 0) {
            const lMin = localMin[i], lMax = localMax[i];
            const localShare = lMax > lMin ? (v - lMin) / (lMax - lMin) : hvnShare;
            hvnShare = (1 - locality) * hvnShare + locality * localShare;
          }
          // 'hvn' (default): share of the emphasized peak — highest bins
          // darkest. 'lvn': inverted — share of peak EMPTINESS, so the
          // thinnest/untraded bins darken instead, and busy bins fade away.
          // Value-area dimming is skipped in 'lvn' emphasis: VAH/VAL marks
          // the high-volume core, and LVNs live outside it by definition,
          // so dimming there would fight the whole point of this mode.
          const share = lvnEmphasis ? 1 - hvnShare : hvnShare;
          const intensity = Math.pow(share, heatGamma);
          const vaFactor = lvnEmphasis ? 1 : (inVA ? 1 : VA_DIM_FACTOR);
          const opacity = intensity * heatCeiling * vaFactor;
          ctx.fillStyle = `rgba(${histRgb},${opacity})`;
          ctx.fillRect(x0, top, x1 - x0, Math.max(bottom - top, vr));
        }, lvnEmphasis);
      } else {
        forEachBin((v, top, bottom, inVA) => {
          const width = (v / maxBin) * maxWidth;
          ctx.fillStyle = `rgba(${histRgb},${inVA ? baseOpacity : baseOpacity * VA_DIM_FACTOR})`;
          ctx.fillRect(x0, top, width, Math.max(bottom - top, vr));
        });
      }
    }

    // High/Low Volume Node zones — filled bands across the profile's full
    // anchor-to-end span (same "zone spans a time range" convention as the
    // OB/FVG/liquidity zone types elsewhere in the app), each the actual
    // bin-run width the node covers rather than a single point — so a wide
    // untraded LVN gap reads as a wide band, not a sliver. Fill only, no
    // border — the band's own top/bottom edge already marks its price
    // range, and a stroke's left/right edges would just retrace x0/x1,
    // which the bars/POC/VA lines already mark. HVN vs LVN read apart by
    // color alone. Drawn under the POC/value-area lines so those stay
    // crisp on top.
    const drawNodeZone = (zLo, zHi, rgb) => {
      const yLo = priceToCoordinate(zLo);
      const yHi = priceToCoordinate(zHi);
      if (yLo == null || yHi == null) return;
      const top    = Math.min(yLo, yHi) * vr;
      const bottom = Math.max(yLo, yHi) * vr;
      const height = Math.max(bottom - top, vr);
      ctx.fillStyle = `rgba(${rgb},0.22)`;
      ctx.fillRect(x0, top, x1 - x0, height);
    };
    if (lvn && lvn.length) {
      for (const [zLo, zHi] of lvn) drawNodeZone(zLo, zHi, RGB_LVN);
    }
    if (hvn && hvn.length) {
      for (const [zLo, zHi] of hvn) drawNodeZone(zLo, zHi, RGB_HVN);
    }

    // Value-area bounds (VAL/VAH) — thin dashed lines across the profile's
    // full anchor-to-end span, marking the band holding value_area_pct of
    // its volume.
    if (hasValueArea) {
      ctx.save();
      ctx.strokeStyle = `rgba(${rgb},0.55)`;
      ctx.lineWidth = Math.max(1, Math.round(vr));
      ctx.setLineDash([Math.round(4 * hr), Math.round(3 * hr)]);
      for (const price of [val, vah]) {
        const y = priceToCoordinate(price);
        if (y == null) continue;
        const yPix = Math.round(y * vr);
        ctx.beginPath();
        ctx.moveTo(x0, yPix);
        ctx.lineTo(x1, yPix);
        ctx.stroke();
      }
      ctx.restore();
    }

    // POC — the single highest-volume bin — drawn as a solid line across the
    // profile's full span so it reads as a level, not just the fattest bar.
    if (poc != null) {
      const y = priceToCoordinate(poc);
      if (y != null) {
        const yPix = Math.round(y * vr);
        ctx.save();
        ctx.strokeStyle = `rgba(${rgb},0.95)`;
        ctx.lineWidth = Math.max(2, Math.round(2 * vr));
        ctx.beginPath();
        ctx.moveTo(x0, yPix);
        ctx.lineTo(x1, yPix);
        ctx.stroke();
        ctx.restore();
      }
    }
  }
}

export class VolumeProfileSeries {
  constructor() {
    this._renderer = new VolumeProfileRenderer();
  }

  priceValueBuilder(plotRow) {
    const { lo, bs, bins } = plotRow;
    if (lo == null || bs == null || !bins) return [];
    return [lo, lo + bins.length * bs];
  }

  isWhitespace(data) {
    return data.lo === undefined || data.bs === undefined || !data.bins;
  }

  renderer() {
    return this._renderer;
  }

  update(data, options) {
    this._renderer.update(data, options);
  }

  defaultOptions() {
    return {};
  }
}
