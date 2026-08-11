/**
 * browse.js — ticker cycling + timeframe/conf selector
 *
 * Manages the nav bar: ticker search/dropdown, prev/next cycling,
 * timeframe select, and ind_conf select. Calls initReplay() from
 * replay.js whenever the user loads a new ticker.
 */

import { initReplay, jump, getCurrentBarInfo, applyRangeLock } from './replay.js';
import { initHelp, isHelpVisible } from './help.js';
import { api } from './api.js';
import { initTheme, toggleTheme } from './theme.js';

let tickers    = [];
let timeframes = [];
let confs      = [];
let dropIdx    = -1;
let tickerIdx  = 0;
let _lists     = ['ALL'];
let _listIdx   = 0;
let _scanListName = null;  // name of the virtual scan-results list, if present
let _scanLocked   = false; // true while _applyScanRun is programmatically setting controls
let _refreshGen   = 0;     // incremented each call; stale async responses are dropped
let _loadGen      = 0;     // same pattern for _loadTicker async conf-validity check
const _indTickerCache = new Map(); // "confId:tf" → Set<ticker>, populated lazily

// Per-TF preferences: { tf: { min_bars, conf_id } } — persisted to localStorage
const _tfPrefs = (() => { try { return JSON.parse(localStorage.getItem('tf_prefs') || '{}'); } catch { return {}; } })();
let _prevTf = ''; // tracks the last active TF so we can save its prefs before switching

const tickerInput  = document.getElementById('ticker-input');
const tickerCount  = document.getElementById('ticker-count');
const dropdown     = document.getElementById('dropdown');
const tfSelect     = document.getElementById('tf-select');
const confSelect   = document.getElementById('conf-select');
const btnPrev      = document.getElementById('btn-prev-ticker');
const btnNext      = document.getElementById('btn-next-ticker');
const listSelect   = document.getElementById('list-select');
const scanSelect   = document.getElementById('scan-select');
const minBarsInput = document.getElementById('min-bars-input');

// ── Bootstrap ─────────────────────────────────────────────────

export async function initBrowse() {
  const data = await api.get('/api/tickers');

  tickers    = data.tickers    || [];
  timeframes = data.timeframes || [];
  confs      = data.ind_confs  || [];
  // Check for scan results stored by the scanner page
  const _scanTickers = (() => { try { const t = localStorage.getItem('scan_tickers'); return t ? JSON.parse(t) : null; } catch { return null; } })();
  const _scanLabel   = (() => { try { return localStorage.getItem('scan_label') || 'Scan Results'; } catch { return 'Scan Results'; } })();
  if (_scanTickers?.length) {
    _scanListName = `⊕ ${_scanLabel}`;
    _lists = [_scanListName, 'All', ...(data.lists || [])];
  } else {
    _lists = ['All', ...(data.lists || [])];
  }
  _buildListSelect();

  // Auto-select scan results list if navigating from scanner page
  const fromScan = new URLSearchParams(location.search).get('from_scan');
  if (fromScan && _scanListName) {
    listSelect.value = _scanListName;
    tickers = _scanTickers;
  }

  // Populate timeframe select
  for (const tf of timeframes) {
    const opt = document.createElement('option');
    opt.value = tf; opt.textContent = tf;
    tfSelect.appendChild(opt);
  }
  // Prefer 'daily' as default
  if (timeframes.includes('daily')) tfSelect.value = 'daily';

  // Populate conf select — confs is [{id, name}]
  const noneOpt = document.createElement('option');
  noneOpt.value = ''; noneOpt.textContent = '— none —';
  confSelect.appendChild(noneOpt);
  for (const c of confs) {
    const opt = document.createElement('option');
    opt.value = c.id; opt.textContent = c.name;
    confSelect.appendChild(opt);
  }

  // Populate scan select
  await _loadScanRuns();

  // Restore per-TF preferences for the default TF (no flash on initial load)
  _prevTf = tfSelect.value;
  _applyTfPrefs(tfSelect.value, false);

  _wireNav();

  // Initial load: filter by default TF, try to honour URL ticker (query param or hash)
  const _qp          = new URLSearchParams(location.search);
  const preferTicker = (_qp.get('ticker') || decodeURIComponent(location.hash.slice(1)) || '').toUpperCase() || undefined;
  await _refreshTickers(preferTicker);
}

// ── Per-TF preferences ────────────────────────────────────────

function _saveTfPrefs() {
  try { localStorage.setItem('tf_prefs', JSON.stringify(_tfPrefs)); } catch {}
}


// Briefly flash an element to signal that its value was auto-applied from prefs
function _flashEl(el) {
  el.classList.remove('nav-pref-applied');
  void el.offsetWidth; // force reflow so animation restarts
  el.classList.add('nav-pref-applied');
  el.addEventListener('animationend', () => el.classList.remove('nav-pref-applied'), { once: true });
}

// Save current min_bars + conf for the given TF
function _saveTfState(tf) {
  if (!tf) return;
  _tfPrefs[tf] = {
    min_bars: parseInt(minBarsInput.value) || 0,
    conf_id:  confSelect.value,
  };
  _saveTfPrefs();
}

// Increment or decrement min_bars by the input's step value
function _stepMinBars(dir) {
  const step = parseInt(minBarsInput.step) || 100;
  const cur  = parseInt(minBarsInput.value) || 0;
  const next = Math.max(0, cur + dir * step);
  minBarsInput.value = next || '';
  minBarsInput.dispatchEvent(new Event('change'));
}

// Toggle teal highlight on the min-bars input when it has an active value
function _updateMinBarsActive() {
  minBarsInput.classList.toggle('active', (parseInt(minBarsInput.value) || 0) > 0);
}

// Restore saved min_bars + conf for a TF; flash changed controls if flash=true
function _applyTfPrefs(tf, flash = true) {
  const p = _tfPrefs[tf] || {};

  const mb = p.min_bars > 0 ? String(p.min_bars) : '';
  if (minBarsInput.value !== mb) {
    minBarsInput.value = mb;
    if (flash) _flashEl(minBarsInput);
  }

  const confId = p.conf_id !== undefined ? String(p.conf_id) : '';
  const confExists = [...confSelect.options].some(o => o.value === confId);
  const targetConf = confExists ? confId : '';
  if (confSelect.value !== targetConf) {
    confSelect.value = targetConf;
    if (flash) _flashEl(confSelect);
  }

  _updateMinBarsActive();
}

// ── Load a ticker ─────────────────────────────────────────────

// Returns true if the conf has data for ticker+tf; caches per conf+tf to avoid redundant fetches.
async function _validConf(ticker, tf, confId) {
  const key = `${confId}:${tf}`;
  if (!_indTickerCache.has(key)) {
    try {
      const data = await api.get(`/api/indicators/tickers-list?config_id=${confId}&timeframe=${tf}`);
      _indTickerCache.set(key, new Set(data.tickers || []));
    } catch {
      return true; // on network error, don't discard the conf selection
    }
  }
  return _indTickerCache.get(key).has(ticker);
}

async function _loadTicker(idx) {
  if (!tickers.length) return;
  const myGen  = ++_loadGen;
  const safeIdx = ((idx % tickers.length) + tickers.length) % tickers.length;
  const ticker = tickers[safeIdx];
  const tf     = tfSelect.value;
  let conf     = parseInt(confSelect.value) || 0;

  if (conf) {
    const valid = await _validConf(ticker, tf, conf);
    if (myGen !== _loadGen) return; // a newer _loadTicker superseded this one
    if (!valid) { confSelect.value = ''; conf = 0; }
  }

  tickerIdx = safeIdx;
  const restoreDate = getCurrentBarInfo()?.date || null;

  tickerInput.value        = ticker;
  tickerCount.textContent  = `${tickerIdx + 1} / ${tickers.length}`;
  location.hash            = ticker;
  document.getElementById('ticker-watermark').textContent = ticker;
  _updateNavTitles();

  // Re-initialise replay, restoring the current date if possible
  initReplay(ticker, tf, conf, restoreDate);
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

// Re-fetches the ticker list based on current TF + list selection, then loads a ticker.
// ind_conf is intentionally excluded — it affects what the chart shows, not which tickers
// are browseable. The WS falls back to OHLCV for tickers without computed indicators.
// preferTicker overrides the "keep current ticker" logic (used on initial load for hash nav).
async function _refreshTickers(preferTicker) {
  // DB scan run controls the ticker list — don't re-filter
  if (scanSelect.value) return;

  const myGen = ++_refreshGen;

  const tf   = tfSelect.value;
  const list = listSelect.value;
  _listIdx   = _lists.indexOf(list);
  const prev = preferTicker ?? tickers[tickerIdx];

  // Virtual scan list (localStorage) — treat as fixed
  if (_scanListName && list === _scanListName) {
    try { tickers = JSON.parse(localStorage.getItem('scan_tickers') || '[]'); } catch { tickers = []; }
    const i = tickers.indexOf(prev);
    if (!tickers.length) { document.getElementById('chart-empty').style.display = 'flex'; return; }
    _loadTicker(i >= 0 ? i : 0);
    return;
  }

  const params = new URLSearchParams();
  if (tf)             params.set('timeframe', tf);
  if (list !== 'All') params.set('ticker_list', list);
  const minBars = parseInt(minBarsInput.value);
  if (minBars > 0)    params.set('min_bars', String(minBars));

  const data = await api.get(`/api/tickers?${params}`);
  if (myGen !== _refreshGen) return; // a newer refresh started while we were awaiting

  tickers = data.tickers || [];
  if (!tickers.length) { document.getElementById('chart-empty').style.display = 'flex'; return; }
  document.getElementById('chart-empty').style.display = 'none';
  const i = tickers.indexOf(prev);
  _loadTicker(i >= 0 ? i : 0);
}

// ── Scan runs ─────────────────────────────────────────────────

async function _loadScanRuns() {
  try {
    const data = await api.get('/api/scan/runs');
    const runs = data.runs || [];
    scanSelect.innerHTML = '';
    const none = document.createElement('option');
    none.value = ''; none.textContent = '— none —';
    scanSelect.appendChild(none);
    for (const r of runs) {
      const opt = document.createElement('option');
      opt.value = r.id;
      opt.textContent = `${r.config_name} · ${r.ran_at.slice(0, 10)} · ${r.matched}/${r.total}`;
      opt.dataset.indConfId  = r.ind_conf_id || '';
      opt.dataset.timeframes = JSON.stringify(r.timeframes || []);
      scanSelect.appendChild(opt);
    }
  } catch {}
}

async function _applyScanRun() {
  const runId = scanSelect.value;
  if (!runId) {
    // Scan cleared — restore saved prefs for the current TF
    _applyTfPrefs(tfSelect.value);
    await _refreshTickers();
    return;
  }
  try {
    const data = await api.get(`/api/scan/runs/${runId}`);
    tickers = data.tickers || [];
    if (!tickers.length) return;

    _scanLocked = true;
    const opt = scanSelect.selectedOptions[0];
    // Auto-set timeframe
    const tfs = JSON.parse(opt.dataset.timeframes || '[]');
    if (tfs.length && timeframes.includes(tfs[0])) {
      tfSelect.value = tfs[0];
      _prevTf = tfs[0]; // keep _prevTf in sync with programmatic TF change
    }
    // Auto-set indicator conf
    const confId = opt.dataset.indConfId;
    if (confId) confSelect.value = confId;
    _scanLocked = false;

    _loadTicker(0);
  } catch { _scanLocked = false; }
}

// ── Nav wiring ────────────────────────────────────────────────

function _wireNav() {
  document.getElementById('btn-prev-ticker').addEventListener('click', () => _loadTicker(tickerIdx - 1));
  document.getElementById('btn-next-ticker').addEventListener('click', () => _loadTicker(tickerIdx + 1));
  listSelect.addEventListener('change', () => {
    listSelect.blur();
    if (!_scanLocked) { scanSelect.value = ''; scanSelect.classList.remove('active'); _refreshTickers(); }
  });
  tfSelect.addEventListener('change', () => {
    tfSelect.blur();
    if (!_scanLocked) {
      _saveTfState(_prevTf);          // persist prefs for the TF we're leaving
      _prevTf = tfSelect.value;
      scanSelect.value = ''; scanSelect.classList.remove('active');
      _applyTfPrefs(tfSelect.value);  // restore prefs for the new TF (flashes changed controls)
      _refreshTickers();
    }
  });
  confSelect.addEventListener('change', () => {
    confSelect.blur();
    if (!_scanLocked) {
      // Persist conf selection for the current TF
      _tfPrefs[tfSelect.value] = { ...(_tfPrefs[tfSelect.value] || {}), conf_id: confSelect.value };
      _saveTfPrefs();
      scanSelect.value = ''; scanSelect.classList.remove('active');
      _refreshTickers();
    }
  });
  scanSelect.addEventListener('change', () => { scanSelect.blur(); scanSelect.classList.toggle('active', !!scanSelect.value); _applyScanRun(); });
  minBarsInput.addEventListener('change', () => {
    const v = parseInt(minBarsInput.value) || 0;
    if (!v) minBarsInput.value = '';
    // Persist min_bars for the current TF
    _tfPrefs[tfSelect.value] = { ...(_tfPrefs[tfSelect.value] || {}), min_bars: v };
    _saveTfPrefs();
    _updateMinBarsActive();
    _refreshTickers();
  });
  document.getElementById('min-bars-up').addEventListener('click',   () => _stepMinBars(1));
  document.getElementById('min-bars-down').addEventListener('click', () => _stepMinBars(-1));

  // Ticker search
  tickerInput.addEventListener('focus', () => { tickerInput.select(); _buildDropdown(''); document.body.classList.add('fs-searching'); });
  tickerInput.addEventListener('blur',  () => { setTimeout(() => { dropdown.style.display = 'none'; dropIdx = -1; tickerInput.value = tickers[tickerIdx] || ''; document.body.classList.remove('fs-searching'); }, 150); });
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

  initTheme();
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
    if (e.key === '~') { e.preventDefault(); window.location.href = '/pipeline'; return; }
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
    if (e.key === 'ArrowUp'   && e.shiftKey) { e.preventDefault(); e.stopImmediatePropagation(); _stepMinBars(1);  return; }
    if (e.key === 'ArrowDown' && e.shiftKey) { e.preventDefault(); e.stopImmediatePropagation(); _stepMinBars(-1); return; }
    if (e.key === '{' ) { e.preventDefault(); _cycleSelect(confSelect,  -1); }
    if (e.key === '}' ) { e.preventDefault(); _cycleSelect(confSelect,   1); }
    if (e.key === ':' ) { e.preventDefault(); _cycleSelect(confSelect,  -1); }
    if (e.key === ';' ) { e.preventDefault(); _cycleSelect(confSelect,   1); }
    if (e.key === "'")  { e.preventDefault(); _cycleSelect(confSelect,  -1); }
    if (e.key === '/' ) { e.preventDefault(); toggleTheme(); return; }
    if (e.key === 'C' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); window.location.href = '/'; return; }
    if (e.key === 'T' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); window.location.href = '/fetch'; return; }
    if (e.key === 'I' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); window.location.href = '/indicators'; return; }
    if (e.key === 'S' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); window.location.href = '/scanner'; return; }
    if (e.key === 'P' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); window.location.href = '/pipeline'; return; }
    if (e.key.length === 1 && /[a-z]/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      document.body.classList.add('fs-searching'); // reveal #nav (fullscreen hides it) before focusing — focus() no-ops on a display:none descendant
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

