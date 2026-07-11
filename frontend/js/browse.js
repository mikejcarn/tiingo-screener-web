/**
 * browse.js — ticker cycling + timeframe/conf selector
 *
 * Manages the nav bar: ticker search/dropdown, prev/next cycling,
 * timeframe select, and ind_conf select. Calls initReplay() from
 * replay.js whenever the user loads a new ticker.
 */

import { initReplay, jump } from './replay.js';

let tickers    = [];
let timeframes = [];
let confs      = [];
let dropIdx    = -1;
let tickerIdx  = 0;

const tickerInput = document.getElementById('ticker-input');
const dropdown    = document.getElementById('dropdown');
const tfSelect    = document.getElementById('tf-select');
const confSelect  = document.getElementById('conf-select');
const metaHint    = document.getElementById('meta-hint');

// ── Bootstrap ─────────────────────────────────────────────────

export async function initBrowse() {
  const res  = await fetch('/api/tickers');
  const data = await res.json();

  tickers    = data.tickers    || [];
  timeframes = data.timeframes || [];
  confs      = data.ind_confs  || [];

  // Populate timeframe select
  for (const tf of timeframes) {
    const opt = document.createElement('option');
    opt.value = tf; opt.textContent = tf;
    tfSelect.appendChild(opt);
  }
  // Prefer 'daily' as default
  if (timeframes.includes('daily')) tfSelect.value = 'daily';

  // Populate conf select
  for (const c of confs) {
    const opt = document.createElement('option');
    opt.value = c; opt.textContent = `conf ${c}`;
    confSelect.appendChild(opt);
  }

  _updateHint();
  _wireNav();

  // Load from URL hash or first ticker
  const hashTicker = decodeURIComponent(location.hash.slice(1)).toUpperCase();
  const startIdx   = tickers.indexOf(hashTicker);
  _loadTicker(startIdx >= 0 ? startIdx : 0);
}

// ── Load a ticker ─────────────────────────────────────────────

function _loadTicker(idx) {
  if (!tickers.length) return;
  tickerIdx = ((idx % tickers.length) + tickers.length) % tickers.length;
  const ticker = tickers[tickerIdx];
  const tf     = tfSelect.value;
  const conf   = parseInt(confSelect.value) || 0;

  tickerInput.value = ticker;
  location.hash     = ticker;
  _updateHint();

  // Re-initialise replay for the new ticker
  initReplay(ticker, tf, conf);
}

// ── Nav wiring ────────────────────────────────────────────────

function _wireNav() {
  document.getElementById('btn-prev-ticker').addEventListener('click', () => _loadTicker(tickerIdx - 1));
  document.getElementById('btn-next-ticker').addEventListener('click', () => _loadTicker(tickerIdx + 1));

  tfSelect.addEventListener('change',   () => _loadTicker(tickerIdx));
  confSelect.addEventListener('change', () => _loadTicker(tickerIdx));

  // Ticker search
  tickerInput.addEventListener('focus', () => { tickerInput.select(); _buildDropdown(''); });
  tickerInput.addEventListener('blur',  () => { setTimeout(() => { dropdown.style.display = 'none'; dropIdx = -1; tickerInput.value = tickers[tickerIdx] || ''; }, 150); });
  tickerInput.addEventListener('input', () => {
    const clean = tickerInput.value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    if (clean !== tickerInput.value) tickerInput.value = clean;
    _buildDropdown(clean);
  });
  tickerInput.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); _moveDrop(dropIdx < 0 ? 0 : 1); return; }
    if (e.key === 'ArrowUp')   { e.preventDefault(); _moveDrop(-1); return; }
    if (e.key === 'Enter') {
      const items = dropdown.querySelectorAll('.dd-item');
      if (dropIdx >= 0 && items[dropIdx]) {
        const i = tickers.indexOf(items[dropIdx].textContent);
        if (i >= 0) _loadTicker(i);
      } else if (items.length === 1) {
        const i = tickers.indexOf(items[0].textContent);
        if (i >= 0) _loadTicker(i);
      } else {
        const q = tickerInput.value.trim().toUpperCase();
        const i = tickers.indexOf(q);
        if (i >= 0) _loadTicker(i);
      }
      tickerInput.blur();
    }
    if (e.key === 'Escape') tickerInput.blur();
  });

  // Global keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'SELECT') return;
    if (e.key === '[' || e.key === '=') { e.preventDefault(); _loadTicker(tickerIdx - 1); }
    if (e.key === ']' || e.key === '-') { e.preventDefault(); _loadTicker(tickerIdx + 1); }
    if (e.key === '/' ) { e.preventDefault(); tickerInput.focus(); }
    if (e.key.length === 1 && /[a-zA-Z]/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      tickerInput.focus();
      tickerInput.value = e.key.toUpperCase();
      _buildDropdown(e.key.toUpperCase());
    }
  });
}

// ── Dropdown ──────────────────────────────────────────────────

function _buildDropdown(q) {
  dropdown.innerHTML = '';
  dropIdx = -1;
  const up = q.trim().toUpperCase();
  const matches = tickers.filter(t => !up || t.startsWith(up));
  if (!matches.length) { dropdown.style.display = 'none'; return; }
  matches.forEach(label => {
    const el = document.createElement('div');
    el.className = 'dd-item';
    el.textContent = label;
    el.addEventListener('mousedown', e => e.preventDefault());
    el.addEventListener('click', () => {
      const i = tickers.indexOf(label);
      if (i >= 0) _loadTicker(i);
      tickerInput.blur();
    });
    dropdown.appendChild(el);
  });
  dropdown.style.display = 'block';
}

function _moveDrop(delta) {
  const items = dropdown.querySelectorAll('.dd-item');
  if (!items.length) return;
  items[dropIdx] && items[dropIdx].classList.remove('hi');
  dropIdx = Math.max(0, Math.min(items.length - 1, dropIdx + delta));
  items[dropIdx].classList.add('hi');
  items[dropIdx].scrollIntoView({ block: 'nearest' });
}

function _updateHint() {
  const tf   = tfSelect.value   || '—';
  const conf = confSelect.value != null ? confSelect.value : '—';
  metaHint.textContent = `${tf} · conf ${conf}`;
}
