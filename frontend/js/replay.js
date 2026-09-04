/**
 * replay.js — bar-by-bar replay controller
 *
 * Connects to /ws/replay/{ticker}/{timeframe}/{ind_conf} and drives
 * ChartManager one bar at a time. Also handles the controls bar UI.
 */

import { ChartManager } from './chart.js';

const API = window.location.origin;

let chart    = null;
let ws       = null;
let bars     = [];        // full preloaded bar array
let styles   = {};        // col → {color,width,lineStyle} from server
let N        = 0;
let current  = 0;
let playing  = false;
let fps      = 8;
let playTimer = null;
let autoFit    = localStorage.getItem('replay_autofit') === 'true';
let lockMode   = localStorage.getItem('replay_lock_mode')   || null;
let lockValue  = localStorage.getItem('replay_lock_value')  || null;
let lockValue2 = localStorage.getItem('replay_lock_value2') || null;
let _lastChartX     = null;  // last known mouse x over the chart, in #chart-local px — for '.' hover-anchor
let _lastChartY     = null;  // last known mouse y over the chart, in #chart-local px — for Alt+Space measurement
let _measureActive  = false; // mid live-measurement (started by Alt+Click or Alt+Space)
let _measureStart   = null;  // {x, y} in #chart-local pixel coords — the locked start point

// DOM refs
const scrubber    = document.getElementById('scrubber');
const barInput    = document.getElementById('bar-input');
const barTotal    = document.getElementById('bar-total');
const dateInput   = document.getElementById('date-input');
const dateEnd     = document.getElementById('date-end');
const fpsInput    = document.getElementById('fps-input');
const btnPlay     = document.getElementById('btn-play');
const btnAutoFit  = document.getElementById('btn-autofit');
const status      = document.getElementById('status');

// ── Init ─────────────────────────────────────────────────────

let controlsWired = false;
let keysWired     = false;
let _restoreDate  = null;

export function initReplay(ticker, timeframe, indConf, restoreDate = null) {
  // Clean up previous instance
  if (ws)    { ws.close(); ws = null; }
  if (chart) { chart.destroy(); }
  bars    = [];
  styles  = {};
  N       = 0;
  current = 0;
  _restoreDate = restoreDate || null;
  setPlaying(false);
  _measureActive = false;
  _measureStart  = null;
  _lastChartX    = null;
  _lastChartY    = null;

  chart = new ChartManager(document.getElementById('chart'));
  _setStatus('connecting…');
  _connectWS(ticker, timeframe, indConf);
  if (!controlsWired) { _wireControls(); controlsWired = true; }
  if (!keysWired)     { _wireKeys();     keysWired     = true; }
}

function _findBarByDate(targetDate) {
  for (let i = bars.length - 1; i >= 0; i--) {
    const d = (bars[i]?.Date || bars[i]?.date || '').slice(0, 10);
    if (d <= targetDate) return i;
  }
  return 0;
}

function _dateAt(idx) {
  const b = bars[Math.max(0, Math.min(N - 1, idx))];
  return (b?.Date || b?.date || '').slice(0, 10);
}

// Resolves a lock-value string to a bar index — plain digits are a bar #,
// anything else is treated as a date (first bar on/after it).
function _resolveIndex(value, fallback) {
  if (value == null || value === '') return fallback;
  if (/^\d+$/.test(value)) return parseInt(value, 10);
  let idx = N - 1;
  for (let i = 0; i < N; i++) {
    if ((bars[i]?.Date || bars[i]?.date || '').slice(0, 10) >= value) { idx = i; break; }
  }
  return idx;
}

// ── WebSocket ─────────────────────────────────────────────────

function _connectWS(ticker, timeframe, indConf) {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const url   = `${proto}://${location.host}/ws/replay/${ticker}/${timeframe}/${indConf}`;

  ws = new WebSocket(url);

  ws.onopen = () => { _setStatus('loading…'); };

  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'meta') {
      N      = msg.total;
      styles = msg.styles || {};
      return;
    }
    if (msg.type === 'bars') {
      bars = msg.data;
      _onAllLoaded();
      return;
    }
    if (msg.type === 'replay_events') {
      chart.loadEvents(msg);
      return;
    }
    if (msg.type === 'error') {
      _setStatus(msg.detail);
    }
  };

  ws.onerror = () => _setStatus('connection error');
}

function _onAllLoaded() {
  _setStatus('');
  scrubber.max = N - 1;
  barTotal.textContent = N - 1;
  const lastBar = bars[N - 1];
  dateEnd.textContent = (lastBar?.Date || lastBar?.date || '').slice(0, 10) || '—';
  chart.load(bars, styles);
  chart.fitContent();
  const target = _restoreDate ? _findBarByDate(_restoreDate) : N - 1;
  _restoreDate = null;
  jump(target);
  _applyLock();
}

// ── Playback ──────────────────────────────────────────────────

export function getChartRange() {
  return chart ? chart.getVisibleRange() : null;
}

export function getCurrentBarInfo() {
  if (!bars.length) return null;
  const b = bars[current];
  return { bar: current, date: (b?.Date || b?.date || '').slice(0, 10) };
}

export function applyRangeLock(mode, value, value2) {
  lockMode   = mode   || null;
  lockValue  = value  || null;
  lockValue2 = value2 || null;
  _applyLock();
}

export function clearRangeLock() {
  lockMode = null;
  lockValue = null;
  lockValue2 = null;
}

function _applyLock() {
  if (!chart || !lockMode || !bars.length) return;
  if (lockMode === 'start') {
    jump(0);
  } else if (lockMode === 'end') {
    jump(N - 1);
  } else if (lockMode === 'bar' && lockValue) {
    jump(parseInt(lockValue));
  } else if (lockMode === 'date' && lockValue) {
    let idx = N - 1;
    for (let i = 0; i < N; i++) {
      if ((bars[i]?.Date || bars[i]?.date || '').slice(0, 10) >= lockValue) { idx = i; break; }
    }
    jump(idx);
  } else if (lockMode === 'range' && lockValue) {
    // Windows the initial view to [start, end] — full history stays loaded
    // underneath, so scrubbing/stepping/playing past either edge still works.
    const startIdx = _resolveIndex(lockValue, 0);
    const endIdx   = _resolveIndex(lockValue2, N - 1);
    jump(endIdx);
    chart.setVisibleRange(_dateAt(startIdx), _dateAt(endIdx));
  } else if (lockMode === 'recent' && lockValue) {
    const count    = Math.max(1, parseInt(lockValue) || N);
    const endIdx   = N - 1;
    const startIdx = Math.max(0, endIdx - count + 1);
    jump(endIdx);
    chart.setVisibleRange(_dateAt(startIdx), _dateAt(endIdx));
  }
}

export function jump(n) {
  current = Math.max(0, Math.min(N - 1, n));
  chart.reveal(current);
  _updateBarInfo();
  if (autoFit) chart.fitContent();
}

function setPlaying(val) {
  // If starting play from the last bar, rewind to 0 first
  if (val && N > 0 && current >= N - 1) jump(0);
  playing = val;
  btnPlay.textContent = playing ? '⏸' : '▶';
  if (playing) {
    _tick();
  } else {
    clearTimeout(playTimer);
  }
}

function _tick() {
  if (!playing) return;
  if (current >= N - 1) { setPlaying(false); return; }
  jump(current + 1);
  playTimer = setTimeout(_tick, 1000 / fps);
}

function _updateBarInfo() {
  const b = bars[current];
  const date = b ? (b.Date || b.date || '').slice(0, 10) : '';
  barInput.value = current;
  scrubber.value = current;
  if (date) dateInput.value = date;
}

// ── Auto-fit ─────────────────────────────────────────────────

function _setAutoFit(val) {
  autoFit = val;
  btnAutoFit.classList.toggle('active', autoFit);
  try { localStorage.setItem('replay_autofit', autoFit); } catch {}
  if (autoFit && chart) chart.fitContent();
}

// ── Controls wiring ───────────────────────────────────────────

function _wireControls() {
  fpsInput.value = fps;
  btnAutoFit.classList.toggle('active', autoFit);

  // Blur after click so spacebar doesn't also fire the keydown handler (double-toggle)
  btnPlay.addEventListener('click', () => { btnPlay.blur(); setPlaying(!playing); });
  btnAutoFit.addEventListener('click', () => { btnAutoFit.blur(); _setAutoFit(!autoFit); });

  document.getElementById('btn-step-back').addEventListener('click',  () => { setPlaying(false); jump(current - 1); });
  document.getElementById('btn-step-fwd').addEventListener('click',   () => { setPlaying(false); jump(current + 1); });
  document.getElementById('btn-first').addEventListener('click', () => { setPlaying(false); jump(0); });
  document.getElementById('btn-last').addEventListener('click',  () => { setPlaying(false); jump(N - 1); });

  scrubber.addEventListener('input',  () => { setPlaying(false); jump(parseInt(scrubber.value)); });
  scrubber.addEventListener('change', () => { setPlaying(false); jump(parseInt(scrubber.value)); });

  document.getElementById('chart').addEventListener('dblclick', (e) => {
    if (!chart || !N) return;
    const rect    = e.currentTarget.getBoundingClientRect();
    const logical = chart.logicalAtX(e.clientX - rect.left);
    if (logical == null) return;
    setPlaying(false);
    jump(Math.round(logical));
  });

  // '.' — place/remove a manual anchored VWAP at whichever candle is under the cursor.
  // Alt+Click or Alt+Space — lock a measurement start point (at the click position,
  // or wherever the mouse last was over the chart for the keyboard version); move
  // the mouse freely to explore the $ / % change live; click again, or press
  // Alt+Space again, to dismiss it.
  const chartEl = document.getElementById('chart');

  chartEl.addEventListener('mousemove', (e) => {
    const rect = chartEl.getBoundingClientRect();
    _lastChartX = e.clientX - rect.left;
    _lastChartY = e.clientY - rect.top;
  });
  chartEl.addEventListener('mouseleave', () => { _lastChartX = null; _lastChartY = null; });

  // Toggles the live measurement: starts it locked at (x, y) if idle, clears it
  // if already active — shared by Alt+Click (event coords) and Alt+Space (last
  // known mouse position over the chart, since a keypress has no coords of its own).
  function _toggleMeasureAt(x, y) {
    if (_measureActive) {
      chart.clearMeasure();
      _measureActive = false;
      _measureStart  = null;
      return;
    }
    _measureStart  = { x, y };
    _measureActive = true;
    chart.updateMeasure(_measureStart.x, _measureStart.y, _measureStart.x, _measureStart.y);
  }

  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    if (document.activeElement?.tagName === 'INPUT') return;
    if (!chart || !N) return;

    if ((e.key === '.' && e.altKey) || (e.key.toLowerCase() === 'z' && (e.ctrlKey || e.metaKey))) {
      e.preventDefault();
      chart.undoManualAnchor();
      return;
    }
    if (e.key === '.' && !e.altKey) {
      if (_lastChartX == null) return;
      chart.toggleManualAnchorAtX(_lastChartX);
      return;
    }
    if (e.key === ' ' && e.altKey) {
      e.preventDefault();
      if (!_measureActive && (_lastChartX == null || _lastChartY == null)) return;
      _toggleMeasureAt(_lastChartX, _lastChartY);
    }
  });

  chartEl.addEventListener('click', (e) => {
    if (!chart || !N) return;
    const rect = chartEl.getBoundingClientRect();

    if (_measureActive) {
      _toggleMeasureAt(); // args unused when clearing
      return;
    }
    if (e.altKey) _toggleMeasureAt(e.clientX - rect.left, e.clientY - rect.top);
  });

  window.addEventListener('mousemove', (e) => {
    if (!_measureActive || !_measureStart || !chart) return;
    const rect = chartEl.getBoundingClientRect();
    chart.updateMeasure(_measureStart.x, _measureStart.y, e.clientX - rect.left, e.clientY - rect.top);
  });

  // Recover from a lost keyup/mouseup (e.g. Alt+Tab stole focus mid-gesture)
  window.addEventListener('blur', () => {
    _measureActive = false;
    _measureStart  = null;
    if (chart) chart.clearMeasure();
  });

  fpsInput.addEventListener('change', () => {
    fps = Math.max(1, Math.min(60, parseInt(fpsInput.value) || 8));
    fpsInput.value = fps;
  });
  document.getElementById('fps-spin-up').addEventListener('click',   () => { fps = Math.min(60, fps + 1); fpsInput.value = fps; });
  document.getElementById('fps-spin-down').addEventListener('click', () => { fps = Math.max(1,  fps - 1); fpsInput.value = fps; });

  barInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const n = parseInt(barInput.value);
      if (!isNaN(n)) { setPlaying(false); jump(n); }
      barInput.blur();
    }
    if (e.key === 'Escape') { barInput.value = current; barInput.blur(); }
  });
  barInput.addEventListener('focus', () => barInput.select());
  barInput.addEventListener('blur',  () => { barInput.value = current; });
  barInput.addEventListener('input', () => { barInput.value = barInput.value.replace(/[^0-9]/g, ''); });

  dateInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const q = dateInput.value.trim();
      let target = N - 1;
      for (let i = 0; i < N; i++) {
        const d = (bars[i]?.Date || bars[i]?.date || '').slice(0, 10);
        if (d >= q) { target = i; break; }
      }
      setPlaying(false); jump(target); dateInput.blur();
    }
    if (e.key === 'Escape') { dateInput.blur(); }
  });
  dateInput.addEventListener('input', () => {
    dateInput.value = dateInput.value.replace(/[^0-9\-]/g, '');
  });
}

// ── Keyboard ──────────────────────────────────────────────────

function _wireKeys() {
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (_measureActive) {
        if (chart) chart.clearMeasure();
        _measureActive = false;
        _measureStart  = null;
      }
      document.activeElement?.blur();
      return;
    }
    if (document.activeElement.tagName === 'INPUT') return;
    if (e.key === ' ' && !e.altKey) { e.preventDefault(); setPlaying(!playing); } // Alt+Space is the measurement shortcut instead
    const ctrl = e.ctrlKey || e.metaKey;
    if (e.key === 'ArrowRight' && !e.shiftKey && !ctrl) { e.preventDefault(); setPlaying(false); jump(current + 1); }
    if (e.key === 'ArrowLeft'  && !e.shiftKey && !ctrl) { e.preventDefault(); setPlaying(false); jump(current - 1); }
    if (e.key === 'ArrowRight' && e.shiftKey)  { e.preventDefault(); setPlaying(false); jump(current + 20); }
    if (e.key === 'ArrowLeft'  && e.shiftKey)  { e.preventDefault(); setPlaying(false); jump(current - 20); }
    if (e.key === 'Home' || (e.key === 'ArrowLeft'  && ctrl)) { e.preventDefault(); setPlaying(false); jump(0); }
    if (e.key === 'End'  || (e.key === 'ArrowRight' && ctrl)) { e.preventDefault(); setPlaying(false); jump(N - 1); }
    if (e.key === 'ArrowUp'   && !e.shiftKey) { e.preventDefault(); fps = Math.min(60, fps + 1); fpsInput.value = fps; }
    if (e.key === 'ArrowDown' && !e.shiftKey) { e.preventDefault(); fps = Math.max(1, fps - 1);  fpsInput.value = fps; }
    if (e.key === 'Backspace') { e.preventDefault(); _setAutoFit(!autoFit); }
    if (/^[0-9]$/.test(e.key)) { e.preventDefault(); barInput.focus(); barInput.value = e.key; }
  });
}

// ── Helpers ───────────────────────────────────────────────────

function _setStatus(msg) {
  status.textContent = msg;
  status.style.display = msg ? 'block' : 'none';
}
