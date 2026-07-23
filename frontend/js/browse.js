/**
 * browse.js — ticker cycling + timeframe/conf selector
 *
 * Manages the nav bar: ticker search/dropdown, prev/next cycling,
 * timeframe select, and ind_conf select. Calls initReplay() from
 * replay.js whenever the user loads a new ticker.
 */

import { initReplay, jump, getCurrentBarInfo, applyRangeLock } from './replay.js';
import { initHelp, isHelpVisible } from './help.js';

let tickers    = [];
let timeframes = [];
let confs      = [];
let dropIdx    = -1;
let tickerIdx  = 0;
let _lists     = ['ALL'];
let _listIdx   = 0;

const tickerInput  = document.getElementById('ticker-input');
const tickerCount  = document.getElementById('ticker-count');
const dropdown     = document.getElementById('dropdown');
const tfSelect     = document.getElementById('tf-select');
const confSelect   = document.getElementById('conf-select');
const btnPrev      = document.getElementById('btn-prev-ticker');
const btnNext      = document.getElementById('btn-next-ticker');
const listSelect   = document.getElementById('list-select');

// ── Bootstrap ─────────────────────────────────────────────────

export async function initBrowse() {
  const res  = await fetch('/api/tickers');
  const data = await res.json();

  tickers    = data.tickers    || [];
  timeframes = data.timeframes || [];
  confs      = data.ind_confs  || [];
  _lists = ['All', ...(data.lists || [])];
  _buildListSelect();

  // Populate timeframe select
  for (const tf of timeframes) {
    const opt = document.createElement('option');
    opt.value = tf; opt.textContent = tf;
    tfSelect.appendChild(opt);
  }
  // Prefer 'daily' as default
  if (timeframes.includes('daily')) tfSelect.value = 'daily';

  // Populate conf select — confs is [{id, name}]
  for (const c of confs) {
    const opt = document.createElement('option');
    opt.value = c.id; opt.textContent = c.name;
    confSelect.appendChild(opt);
  }

  _wireNav();

  if (!tickers.length) {
    document.getElementById('chart-empty').style.display = 'flex';
    return;
  }

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

  tickerInput.value        = ticker;
  tickerCount.textContent  = `${tickerIdx + 1} / ${tickers.length}`;
  location.hash            = ticker;
  _updateNavTitles();

  // Re-initialise replay for the new ticker
  initReplay(ticker, tf, conf);
}

function _updateNavTitles() {
  if (tickers.length <= 1) {
    btnPrev.title = 'Previous ticker';
    btnNext.title = 'Next ticker';
    return;
  }
  const prevIdx = ((tickerIdx - 1) + tickers.length) % tickers.length;
  const nextIdx = (tickerIdx + 1) % tickers.length;
  btnPrev.title = tickers[prevIdx];
  btnNext.title = tickers[nextIdx];
}

function _buildListSelect() {
  listSelect.innerHTML = '';
  for (const name of _lists) {
    const opt = document.createElement('option');
    opt.value = name; opt.textContent = name;
    listSelect.appendChild(opt);
  }
  listSelect.value = _lists[_listIdx] || 'ALL';
}

function _cycleSelect(el, delta) {
  const n = el.options.length;
  if (n < 2) return;
  el.selectedIndex = ((el.selectedIndex + delta) % n + n) % n;
  el.dispatchEvent(new Event('change'));
}

async function _selectList() {
  const selected      = listSelect.value;
  _listIdx            = _lists.indexOf(selected);
  const currentTicker = tickers[tickerIdx];
  const url           = selected === 'All'
    ? '/api/tickers'
    : `/api/tickers?ticker_list=${encodeURIComponent(selected)}`;
  const data = await fetch(url).then(r => r.json());
  tickers = data.tickers || [];
  const newIdx = tickers.indexOf(currentTicker);
  _loadTicker(newIdx >= 0 ? newIdx : 0);
}

// ── Nav wiring ────────────────────────────────────────────────

function _wireNav() {
  document.getElementById('btn-prev-ticker').addEventListener('click', () => _loadTicker(tickerIdx - 1));
  document.getElementById('btn-next-ticker').addEventListener('click', () => _loadTicker(tickerIdx + 1));
  listSelect.addEventListener('change', _selectList);

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

  // Load position lock — always active, no button needed
  const lockModeEl  = document.getElementById('lock-mode');
  const lockValueEl = document.getElementById('lock-value');

  function _needsValue() {
    return lockModeEl.value === 'bar' || lockModeEl.value === 'date';
  }

  function _updateLockUI() {
    lockValueEl.style.display = _needsValue() ? '' : 'none';
    lockValueEl.placeholder   = lockModeEl.value === 'bar' ? 'bar #' : 'YYYY-MM-DD';
    lockModeEl.classList.toggle('active', lockModeEl.value !== 'start');
  }

  function _commitLock() {
    applyRangeLock(lockModeEl.value, _needsValue() ? (lockValueEl.value.trim() || null) : null);
  }

  function _saveLock() {
    try {
      localStorage.setItem('replay_lock_mode',  lockModeEl.value);
      localStorage.setItem('replay_lock_value', lockValueEl.value.trim());
    } catch {}
  }

  // Restore persisted lock state before first apply
  const _savedLockMode  = localStorage.getItem('replay_lock_mode');
  const _savedLockValue = localStorage.getItem('replay_lock_value');
  if (_savedLockMode) {
    lockModeEl.value  = _savedLockMode;
    lockValueEl.value = _savedLockValue || '';
  }

  lockModeEl.addEventListener('change', () => {
    _updateLockUI();
    _commitLock();
    _saveLock();
  });

  // Digits only for bar mode; commit on Enter or blur
  lockValueEl.addEventListener('input', () => {
    if (lockModeEl.value === 'bar') lockValueEl.value = lockValueEl.value.replace(/\D/g, '');
  });
  lockValueEl.addEventListener('change', () => { _commitLock(); _saveLock(); });
  lockValueEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') { lockValueEl.blur(); } });

  _updateLockUI();
  _commitLock(); // apply restored (or default) lock on page load

  initHelp('chart');

  // Fullscreen
  const btnFullscreen = document.getElementById('btn-fullscreen');
  function _toggleFullscreen() {
    const p = document.fullscreenElement
      ? document.exitFullscreen()
      : document.body.requestFullscreen();
    p.catch(() => {});
  }
  btnFullscreen.addEventListener('click', _toggleFullscreen);
  document.addEventListener('fullscreenchange', () => {
    const isFs = !!document.fullscreenElement;
    btnFullscreen.classList.toggle('active', isFs);
    try { localStorage.setItem('replay_fullscreen', isFs); } catch {}
    setTimeout(() => window.dispatchEvent(new Event('resize')), 50);
  });

  // Restore fullscreen on reload — glow immediately, attempt re-entry
  if (localStorage.getItem('replay_fullscreen') === 'true') {
    btnFullscreen.classList.add('active');
    document.body.requestFullscreen().catch(() => {
      btnFullscreen.classList.remove('active');
      try { localStorage.removeItem('replay_fullscreen'); } catch {}
    });
  }

  // Global keyboard shortcuts
  const _lockModes = ['start', 'end', 'bar', 'date'];
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { document.activeElement?.blur(); return; }
    if (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'SELECT') return;
    if (e.key === 'f' || e.key === 'F') { e.preventDefault(); _toggleFullscreen(); return; }
    if (e.key === '`') { e.preventDefault(); window.location.href = '/fetch'; return; }
    if (e.key === '~') { e.preventDefault(); window.location.href = '/indicators'; return; }
    if (isHelpVisible()) return;
    if (e.key === '\\') {
      e.preventDefault();
      const next = (_lockModes.indexOf(lockModeEl.value) + 1) % _lockModes.length;
      lockModeEl.value = _lockModes[next];
      _updateLockUI();
      _commitLock();
      _saveLock();
      return;
    }
    if (e.key === 'Enter' && _needsValue()) {
      e.preventDefault();
      lockValueEl.focus();
      lockValueEl.select();
      return;
    }
    if (e.key === '=' ) { e.preventDefault(); _loadTicker(tickerIdx - 1); }
    if (e.key === '-' ) { e.preventDefault(); _loadTicker(tickerIdx + 1); }
    if (e.key === '_' ) { e.preventDefault(); _cycleSelect(listSelect,  -1); }
    if (e.key === '+' ) { e.preventDefault(); _cycleSelect(listSelect,   1); }
    if (e.key === '[' ) { e.preventDefault(); _cycleSelect(tfSelect,    -1); }
    if (e.key === ']' ) { e.preventDefault(); _cycleSelect(tfSelect,     1); }
    if (e.key === '{' ) { e.preventDefault(); _cycleSelect(confSelect,  -1); }
    if (e.key === '}' ) { e.preventDefault(); _cycleSelect(confSelect,   1); }
    if (e.key === '/' ) { e.preventDefault(); tickerInput.focus(); }
    if (e.key === 'C' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); window.location.href = '/'; return; }
    if (e.key === 'T' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); window.location.href = '/fetch'; return; }
    if (e.key === 'I' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); window.location.href = '/indicators'; return; }
    if (e.key.length === 1 && /[a-z]/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
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

