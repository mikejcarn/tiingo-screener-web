/**
 * volume_profile_series.js — custom lightweight-charts series that draws a
 * volume-at-price histogram as horizontal bars anchored at a peak/valley,
 * extending rightward from the anchor bar — the classic volume-profile look,
 * distinct from every other zone type in this app (which are all filled
 * rectangles/lines spanning a time range, not a sideways bar chart).
 *
 * Two data points per profile — { time, lo, bs, bins, dir, fillOpacity } at
 * the anchor's start and end bar, same start/end convention as the other
 * zone series. lo/bs are the histogram's price origin and bin size (see
 * volume_profile.py); bins is the array of per-bin volume totals.
 */

const RGB_BULL = '38,166,154';
const RGB_BEAR = '239,83,80';
// Bars extend at most this fraction of the anchor-to-end pixel span, so a
// profile never visually swallows the whole time range it covers — the
// classic volume-profile convention of a narrow sidebar-style histogram.
const MAX_WIDTH_FRACTION = 0.3;
// Bins outside the value area (VAL-VAH) are dimmed to this fraction of the
// normal bar opacity, so the value area reads as the "core" of the profile.
const VA_DIM_FACTOR = 0.45;

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
    const { lo, bs, bins, dir, fillOpacity, poc, vah, val } = first.originalData;
    if (lo == null || bs == null || !bins || !bins.length) return;

    const x0 = Math.round(first.x * hr);
    const x1 = Math.round(last.x  * hr);
    if (x1 <= x0) return;

    const maxBin = Math.max(...bins);
    if (maxBin <= 0) return;

    const maxWidth = (x1 - x0) * MAX_WIDTH_FRACTION;
    const rgb = dir === 'bull' ? RGB_BULL : RGB_BEAR;
    const baseOpacity = fillOpacity ?? 0.4;
    const hasValueArea = val != null && vah != null;

    for (let i = 0; i < bins.length; i++) {
      if (bins[i] <= 0) continue;
      const priceLo = lo + i * bs;
      const priceHi = priceLo + bs;
      const yLo = priceToCoordinate(priceLo);
      const yHi = priceToCoordinate(priceHi);
      if (yLo == null || yHi == null) continue;
      const top    = Math.min(yLo, yHi) * vr;
      const bottom = Math.max(yLo, yHi) * vr;
      const width  = (bins[i] / maxBin) * maxWidth;
      const inVA   = !hasValueArea || (priceHi > val && priceLo < vah);
      ctx.fillStyle = `rgba(${rgb},${inVA ? baseOpacity : baseOpacity * VA_DIM_FACTOR})`;
      ctx.fillRect(x0, top, width, Math.max(bottom - top, vr));
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
