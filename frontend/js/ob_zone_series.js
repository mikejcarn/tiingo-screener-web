/**
 * ob_zone_series.js — custom lightweight-charts series that draws Order
 * Block zones as real filled rectangles (real price height, real width in
 * time), instead of the fixed-pixel-thickness LineSeries hack every other
 * segment type (FVG/BoS/liquidity/gap) still uses in chart.js.
 *
 * Two data points per zone — { time, high, low, dir, mitigated, fillOpacity }
 * at the zone's start and end bar — same shape convention as the flat-line
 * segments elsewhere in chart.js (start point, end point), just carrying the
 * real top/bottom instead of a collapsed midpoint. Fill only, no outline —
 * the filled area alone reads clearly enough without a border competing
 * with price action at the zone's edges.
 */

const RGB_BULL = '38,166,154';
const RGB_BEAR = '239,83,80';
// A mitigated zone stays visually subordinate to active ones at any
// fillOpacity setting, rather than being its own fixed alpha.
const MITIGATED_RATIO = 0.375;

export class OBZoneRenderer {
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

    const baseOpacity = fillOpacity ?? 0.32;
    const opacity = mitigated ? baseOpacity * MITIGATED_RATIO : baseOpacity;
    ctx.fillStyle = `rgba(${dir === 'bull' ? RGB_BULL : RGB_BEAR},${opacity})`;
    ctx.fillRect(x0, top, x1 - x0, bottom - top);
  }
}

export class OBZoneSeries {
  constructor() {
    this._renderer = new OBZoneRenderer();
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
