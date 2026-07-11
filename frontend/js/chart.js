/**
 * chart.js — lightweight-charts wrapper
 *
 * Exposes a single ChartManager class that owns one LightweightCharts
 * instance and knows how to render OHLCV + arbitrary indicator columns.
 */

const OHLCV_COLS = new Set(['Date', 'Open', 'High', 'Low', 'Close', 'Volume',
                             'date', 'open', 'high', 'low', 'close', 'volume']);

// Colour palette for indicator lines (cycles if more than 8)
const LINE_COLORS = [
  '#2196f3', '#4caf50', '#ff9800', '#e91e63',
  '#9c27b0', '#00bcd4', '#cddc39', '#ff5722',
];

export class ChartManager {
  constructor(container) {
    this._container = container;
    this._chart = null;
    this._candleSeries = null;
    this._lines = {};      // column name → line series
    this._colorIdx = 0;
    this._bars = [];       // full bar array (for replay slicing)
    this._N = 0;
    this._init();
  }

  _init() {
    this._chart = LightweightCharts.createChart(this._container, {
      layout:     { background: { color: '#000000' }, textColor: '#555555' },
      grid:       { vertLines: { color: '#111111' }, horzLines: { color: '#111111' } },
      crosshair:  { mode: LightweightCharts.CrosshairMode.Normal },
      rightPriceScale: { borderColor: '#222222' },
      timeScale:  { borderColor: '#222222', timeVisible: true },
    });

    this._candleSeries = this._chart.addCandlestickSeries({
      upColor:   '#26a69a', downColor: '#ef5350',
      borderUpColor: '#26a69a', borderDownColor: '#ef5350',
      wickUpColor:   '#26a69a', wickDownColor:   '#ef5350',
    });

    window.addEventListener('resize', () => {
      this._chart.resize(this._container.clientWidth, this._container.clientHeight);
    });
  }

  /** Load a full array of bar objects (each has Date/Open/High/Low/Close/Volume + indicators). */
  load(bars) {
    this._bars = bars;
    this._N = bars.length;
    this._render(this._N - 1);
  }

  /** Replay: reveal only bars 0..n */
  reveal(n) {
    this._render(Math.max(0, Math.min(this._N - 1, n)));
  }

  _render(upToIdx) {
    const slice = this._bars.slice(0, upToIdx + 1);
    if (!slice.length) return;

    // OHLCV
    const candles = slice.map(b => ({
      time:  (b.Date || b.date).slice(0, 10),
      open:  b.Open  ?? b.open,
      high:  b.High  ?? b.high,
      low:   b.Low   ?? b.low,
      close: b.Close ?? b.close,
    }));
    this._candleSeries.setData(candles);

    // Indicator lines — all non-OHLCV numeric columns
    const sample = slice[slice.length - 1];
    const indCols = Object.keys(sample).filter(k => !OHLCV_COLS.has(k) && typeof sample[k] === 'number');

    for (const col of indCols) {
      if (!this._lines[col]) {
        this._lines[col] = this._chart.addLineSeries({
          color:       LINE_COLORS[this._colorIdx++ % LINE_COLORS.length],
          lineWidth:   1,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        });
      }
      const lineData = slice
        .filter(b => b[col] != null && !isNaN(b[col]))
        .map(b => ({ time: (b.Date || b.date).slice(0, 10), value: b[col] }));
      this._lines[col].setData(lineData);
    }

    // Remove series for columns no longer present
    for (const col of Object.keys(this._lines)) {
      if (!indCols.includes(col)) {
        this._chart.removeSeries(this._lines[col]);
        delete this._lines[col];
      }
    }
  }

  fitContent() {
    this._chart.timeScale().fitContent();
  }

  destroy() {
    this._chart.remove();
    this._lines = {};
    this._colorIdx = 0;
  }

  get total() { return this._N; }
}
