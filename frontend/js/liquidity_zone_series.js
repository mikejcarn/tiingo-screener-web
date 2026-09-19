/**
 * liquidity_zone_series.js — custom lightweight-charts series that draws a
 * liquidity level as a precise line (the exact average price of the grouped
 * swing highs/lows) PLUS a faint band behind it showing the real
 * range_percent touch-tolerance smc.liquidity() used to decide which swings
 * counted as "the same" level.
 *
 * Deliberately not a zone-only rendering (that was tried and reverted — see
 * git history — it buried the precise level inside an oversized box). The
 * line stays the dominant, unambiguous signal; the band is background
 * context at a much lower opacity by default.
 *
 * Two data points per level — { time, high, low, level, mitigated,
 * fillOpacity, zoneOpacity } at the level's start and end bar, same
 * start/end convention as the other zone series.
 */

const RGB_LIQUIDITY = '255,165,0';
const MITIGATED_RATIO = 0.375;

export class LiquidityZoneRenderer {
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
    const { high, low, level, mitigated, fillOpacity, zoneOpacity } = first.originalData;
    if (high == null || low == null || level == null) return;

    const yHigh  = priceToCoordinate(high);
    const yLow   = priceToCoordinate(low);
    const yLevel = priceToCoordinate(level);
    if (yHigh == null || yLow == null || yLevel == null) return;

    const x0 = Math.round(first.x * hr);
    const x1 = Math.round(last.x  * hr);
    if (x1 <= x0) return;

    const fade = mitigated ? MITIGATED_RATIO : 1;

    // Faint touch-tolerance band, behind the line.
    const top    = Math.min(yHigh, yLow) * vr;
    const bottom = Math.max(yHigh, yLow) * vr;
    const zOpacity = (zoneOpacity ?? 0.15) * fade;
    if (bottom > top && zOpacity > 0) {
      ctx.fillStyle = `rgba(${RGB_LIQUIDITY},${zOpacity})`;
      ctx.fillRect(x0, top, x1 - x0, bottom - top);
    }

    // Precise level line, on top — the dominant, unambiguous signal.
    const lineY = yLevel * vr;
    const lOpacity = (fillOpacity ?? 0.8) * fade;
    ctx.strokeStyle = `rgba(${RGB_LIQUIDITY},${lOpacity})`;
    ctx.lineWidth = Math.max(1, Math.round(hr));
    ctx.beginPath();
    ctx.moveTo(x0, lineY);
    ctx.lineTo(x1, lineY);
    ctx.stroke();
  }
}

export class LiquidityZoneSeries {
  constructor() {
    this._renderer = new LiquidityZoneRenderer();
  }

  priceValueBuilder(plotRow) {
    return [plotRow.high, plotRow.low, plotRow.level];
  }

  isWhitespace(data) {
    return data.high === undefined || data.low === undefined || data.level === undefined;
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
