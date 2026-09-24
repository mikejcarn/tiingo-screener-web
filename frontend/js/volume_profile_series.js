/**
 * volume_profile_series.js — custom lightweight-charts series that draws a
 * volume-at-price histogram as horizontal bars anchored at a peak/valley,
 * extending rightward from the anchor bar — the classic volume-profile look,
 * distinct from every other zone type in this app (which are all filled
 * rectangles/lines spanning a time range, not a sideways bar chart).
 *
 * Two data points per profile — { time, lo, bs, bins, dir, fillOpacity, poc,
 * vah, val, hvn, lvn, showHistogram, directionalColor, barStyle,
 * heatmapOpacity, heatmapContrast, histogramGrayscale } at the anchor's
 * start and end bar, same start/end convention as the other zone series.
 * lo/bs are the histogram's price origin and bin size, bins the per-bin
 * volume totals, poc/vah/val the Point of Control and Value Area bounds,
 * hvn/lvn arrays of [lo, hi] High/Low Volume Node price ranges (see
 * volume_profile.py for how all of these are computed).
 */

const RGB_BULL    = '38,166,154';
const RGB_BEAR    = '239,83,80';
// Default (non-directional) profile color — a profile's own shape, not its
// anchor's bull/bear direction, is usually the point of looking at it.
const RGB_DEFAULT = '255,127,0';
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
      heatmapOpacity, heatmapContrast, histogramGrayscale,
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
    const forEachBin = cb => {
      for (let i = 0; i < bins.length; i++) {
        if (bins[i] <= 0) continue;
        const priceLo = lo + i * bs;
        const priceHi = priceLo + bs;
        const yLo = priceToCoordinate(priceLo);
        const yHi = priceToCoordinate(priceHi);
        if (yLo == null || yHi == null) continue;
        const top    = Math.min(yLo, yHi) * vr;
        const bottom = Math.max(yLo, yHi) * vr;
        const inVA   = !hasValueArea || (priceHi > val && priceLo < vah);
        cb(bins[i], top, bottom, inVA);
      }
    };

    if (showHistogram ?? true) {
      if (barStyle === 'heatmap') {
        // Every bin spans the profile's full width; volume is read from
        // opacity instead of width — the highest-volume bins read darkest.
        // heatmapOpacity (its own control, separate from fillOpacity — bars
        // has width to lean on, heatmap only has opacity) is the ceiling at
        // the peak bin. heatmapContrast is the curve's exponent: >1 (the
        // default) suppresses lower-volume bins faster than high ones so
        // distinct levels stand out against a fainter background; <1 does
        // the opposite, boosting faint bins at the cost of that distinctness.
        const heatCeiling = heatmapOpacity ?? 0.85;
        const heatGamma   = heatmapContrast ?? 2.0;
        forEachBin((v, top, bottom, inVA) => {
          const intensity = Math.pow(v / maxBin, heatGamma);
          const opacity = intensity * heatCeiling * (inVA ? 1 : VA_DIM_FACTOR);
          ctx.fillStyle = `rgba(${histRgb},${opacity})`;
          ctx.fillRect(x0, top, x1 - x0, Math.max(bottom - top, vr));
        });
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
