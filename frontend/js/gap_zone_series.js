/**
 * gap_zone_series.js — custom lightweight-charts series that draws price-gap
 * zones as a diagonal hatch-pattern fill, same underlying approach as
 * ob_zone_series.js/fvg_zone_series.js (real price height instead of a pair
 * of flat edge lines), but styled distinctly from both:
 *   - OB is a plain solid fill
 *   - FVG is a solid fill with a dashed outline + 50% midline
 *   - Gap is a diagonal hatch, no solid fill underneath and no outline —
 *     a literal "nothing traded here" void, which is what a price gap
 *     actually is, unlike OB/FVG's order-flow zones
 *
 * Two data points per zone — { time, high, low, dir, mitigated, fillOpacity }
 * at the zone's start and end bar, same shape convention as the other two.
 */

const RGB_BULL = '38,166,154';
const RGB_BEAR = '239,83,80';
const MITIGATED_RATIO = 0.375;
const TILE_SIZE = 8;       // CSS px per hatch tile, before pixel-ratio scaling
const STRIPE_WIDTH = 1.5;  // CSS px

export class GapZoneRenderer {
  constructor() {
    this._data = null;
    this._patternCache = new Map();
  }

  draw(target, priceConverter) {
    target.useBitmapCoordinateSpace(scope => this._drawImpl(scope, priceConverter));
  }

  update(data) {
    this._data = data;
  }

  // Diagonal-stripe tile pattern, cached per (color, opacity, pixel-ratio) —
  // same caching idea as the gradient cache in TradingView's own
  // brushable-area-series example plugin, just for CanvasPattern instead.
  _getHatchPattern(ctx, rgb, opacity, pixelRatio) {
    const key = `${rgb}|${opacity}|${pixelRatio}`;
    let pattern = this._patternCache.get(key);
    if (pattern) return pattern;

    const size = Math.max(4, Math.round(TILE_SIZE * pixelRatio));
    const tile = document.createElement('canvas');
    tile.width = size;
    tile.height = size;
    const tctx = tile.getContext('2d');
    tctx.strokeStyle = `rgba(${rgb},${opacity})`;
    tctx.lineWidth = Math.max(1, STRIPE_WIDTH * pixelRatio);
    // A single diagonal plus its two wrap-around copies so the tile repeats
    // seamlessly with no visible seam at the edges.
    for (const offset of [-size, 0, size]) {
      tctx.beginPath();
      tctx.moveTo(offset, size);
      tctx.lineTo(offset + size, 0);
      tctx.stroke();
    }

    pattern = ctx.createPattern(tile, 'repeat');
    this._patternCache.set(key, pattern);
    return pattern;
  }

  _drawImpl(scope, priceToCoordinate) {
    const data = this._data;
    if (!data || data.bars.length < 2 || !data.visibleRange) return;

    const { context: ctx, horizontalPixelRatio: hr, verticalPixelRatio: vr } = scope;
    const first = data.bars[0];
    const last  = data.bars[data.bars.length - 1];
    const { high, low, dir, mitigated, fillOpacity } = first.originalData;
    if (high == null || low == null) return;

    const yHigh = priceToCoordinate(high);
    const yLow  = priceToCoordinate(low);
    if (yHigh == null || yLow == null) return;

    const x0 = Math.round(first.x * hr);
    const x1 = Math.round(last.x  * hr);
    const top    = Math.min(yHigh, yLow) * vr;
    const bottom = Math.max(yHigh, yLow) * vr;
    if (x1 <= x0 || bottom <= top) return;

    const rgb = dir === 'bull' ? RGB_BULL : RGB_BEAR;
    const baseOpacity = fillOpacity ?? 0.32;
    const opacity = mitigated ? baseOpacity * MITIGATED_RATIO : baseOpacity;
    // Hatch alpha needs to read clearly at typical stroke widths — boost it
    // relative to a flat fill's opacity, since stripes cover less area than
    // a solid rect at the same alpha would.
    const pixelRatio = Math.max(hr, vr);
    ctx.fillStyle = this._getHatchPattern(ctx, rgb, Math.min(1, opacity * 1.8), pixelRatio);
    ctx.fillRect(x0, top, x1 - x0, bottom - top);
  }
}

export class GapZoneSeries {
  constructor() {
    this._renderer = new GapZoneRenderer();
  }

  priceValueBuilder(plotRow) {
    return [plotRow.high, plotRow.low];
  }

  isWhitespace(data) {
    return data.high === undefined || data.low === undefined;
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
