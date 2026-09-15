/**
 * fvg_zone_series.js — custom lightweight-charts series that draws Fair
 * Value Gap zones as real filled rectangles, same underlying approach as
 * ob_zone_series.js (real price height instead of a single collapsed edge
 * line), but styled distinctly from OB's plain solid fill so the two don't
 * read as the same shape on a chart with both enabled:
 *   - a dashed outline, carrying forward FVG's existing dashed-line identity
 *     instead of dropping it now that it's a filled zone
 *   - a dashed midline at 50% of the gap — the "consequent encroachment"
 *     level ICT/SMC traders watch as the first real reaction point before a
 *     gap fully closes; real information specific to FVGs, not decoration
 *
 * Two data points per zone — { time, high, low, dir, mitigated, fillOpacity }
 * at the zone's start and end bar, same shape convention as ob_zone_series.js.
 */

const RGB_BULL = '38,166,154';
const RGB_BEAR = '239,83,80';
// A mitigated zone stays visually subordinate to active ones at any
// fillOpacity setting, rather than being its own fixed alpha — same ratio
// ob_zone_series.js uses, kept in sync so mitigated OB/FVG zones read as
// equally "faded" against each other.
const MITIGATED_RATIO = 0.375;
const BORDER_ALPHA = 0.9;
const MID_ALPHA = 0.55;

export class FVGZoneRenderer {
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

    const rgb = dir === 'bull' ? RGB_BULL : RGB_BEAR;
    const fade = mitigated ? MITIGATED_RATIO : 1;
    const baseOpacity = fillOpacity ?? 0.32;

    ctx.fillStyle = `rgba(${rgb},${baseOpacity * fade})`;
    ctx.fillRect(x0, top, x1 - x0, bottom - top);

    const dash = [4 * hr, 3 * hr];
    ctx.lineWidth = Math.max(1, Math.round(hr));

    ctx.strokeStyle = `rgba(${rgb},${BORDER_ALPHA * fade})`;
    ctx.setLineDash(dash);
    ctx.strokeRect(x0, top, x1 - x0, bottom - top);

    const midY = (top + bottom) / 2;
    ctx.strokeStyle = `rgba(${rgb},${MID_ALPHA * fade})`;
    ctx.setLineDash([2 * hr, 2 * hr]);
    ctx.beginPath();
    ctx.moveTo(x0, midY);
    ctx.lineTo(x1, midY);
    ctx.stroke();

    ctx.setLineDash([]);
  }
}

export class FVGZoneSeries {
  constructor() {
    this._renderer = new FVGZoneRenderer();
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
