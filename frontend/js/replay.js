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
let autoFit  = true;

// DOM refs
const barInput  = document.getElementById('bar-input');
const dateInput = document.getElementById('date-input');
const fpsInput  = document.getElementById('fps-input');
const barInfo   = document.getElementById('bar-info');
const btnPlay   = document.getElementById('btn-play');
const status    = document.getElementById('status');

// ── Init ─────────────────────────────────────────────────────

let controlsWired = false;
let keysWired     = false;

export function initReplay(ticker, timeframe, indConf) {
  // Clean up previous instance
  if (ws)    { ws.close(); ws = null; }
  if (chart) { chart.destroy(); }
  bars    = [];
  styles  = {};
  N       = 0;
  current = 0;
  setPlaying(false);

  chart = new ChartManager(document.getElementById('chart'));
  _setStatus('connecting…');
  _connectWS(ticker, timeframe, indConf);
  if (!controlsWired) { _wireControls(); controlsWired = true; }
  if (!keysWired)     { _wireKeys();     keysWired     = true; }
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
  chart.load(bars, styles);
  chart.fitContent();
  jump(N - 1);  // start at last bar (most recent)
  _updateBarInfo();
}

// ── Playback ──────────────────────────────────────────────────

export function jump(n) {
  current = Math.max(0, Math.min(N - 1, n));
  chart.reveal(current);
  _updateBarInfo();
  if (autoFit) chart.fitContent();
}

function setPlaying(val) {
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
  barInfo.textContent = `${date}  ${current} / ${N - 1}`;
  barInput.value  = current;
  if (date) dateInput.value = date;
}

// ── Controls wiring ───────────────────────────────────────────

function _wireControls() {
  fpsInput.value = fps;

  btnPlay.addEventListener('click', () => setPlaying(!playing));

  document.getElementById('btn-step-back').addEventListener('click',  () => { setPlaying(false); jump(current - 1); });
  document.getElementById('btn-step-fwd').addEventListener('click',   () => { setPlaying(false); jump(current + 1); });
  document.getElementById('btn-first').addEventListener('click', () => { setPlaying(false); jump(0); });
  document.getElementById('btn-last').addEventListener('click',  () => { setPlaying(false); jump(N - 1); });

  fpsInput.addEventListener('change', () => {
    fps = Math.max(1, Math.min(60, parseInt(fpsInput.value) || 8));
    fpsInput.value = fps;
  });

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
    if (document.activeElement.tagName === 'INPUT') return;
    if (e.key === ' ')          { e.preventDefault(); setPlaying(!playing); }
    if (e.key === 'ArrowRight') { e.preventDefault(); setPlaying(false); jump(current + 1); }
    if (e.key === 'ArrowLeft')  { e.preventDefault(); setPlaying(false); jump(current - 1); }
    if (e.key === 'ArrowRight' && e.shiftKey) { e.preventDefault(); setPlaying(false); jump(current + 20); }
    if (e.key === 'ArrowLeft'  && e.shiftKey) { e.preventDefault(); setPlaying(false); jump(current - 20); }
    if (e.key === 'Home') { e.preventDefault(); setPlaying(false); jump(0); }
    if (e.key === 'End')  { e.preventDefault(); setPlaying(false); jump(N - 1); }
    if (e.key === 'ArrowUp')   { e.preventDefault(); fps = Math.min(60, fps + 1); fpsInput.value = fps; }
    if (e.key === 'ArrowDown') { e.preventDefault(); fps = Math.max(1, fps - 1);  fpsInput.value = fps; }
    if (e.key === 'Backspace') { e.preventDefault(); autoFit = !autoFit; }
    if (/^[0-9]$/.test(e.key)) { e.preventDefault(); barInput.focus(); barInput.value = e.key; }
  });
}

// ── Helpers ───────────────────────────────────────────────────

function _setStatus(msg) {
  status.textContent = msg;
  status.style.display = msg ? 'block' : 'none';
}
