/**
 * browse.js — ticker cycling + timeframe/conf selector
 *
 * Manages the nav bar: ticker search/dropdown, prev/next cycling,
 * timeframe select, and ind_conf select. Calls initReplay() from
 * replay.js whenever the user loads a new ticker.
 */

import { initReplay, jump, getCurrentBarInfo, applyRangeLock } from './replay.js';

let tickers    = [];
let timeframes = [];
let confs      = [];
let dropIdx    = -1;
let tickerIdx  = 0;

const tickerInput  = document.getElementById('ticker-input');
const tickerCount  = document.getElementById('ticker-count');
const dropdown     = document.getElementById('dropdown');
const tfSelect     = document.getElementById('tf-select');
const confSelect   = document.getElementById('conf-select');
const btnPrev      = document.getElementById('btn-prev-ticker');
const btnNext      = document.getElementById('btn-next-ticker');

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

  // Populate conf select — confs is [{id, name}]
  for (const c of confs) {
    const opt = document.createElement('option');
    opt.value = c.id; opt.textContent = c.name;
    confSelect.appendChild(opt);
  }

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

  // Load position lock — always active, no button needed
  const lockModeEl  = document.getElementById('lock-mode');
  const lockValueEl = document.getElementById('lock-value');

  function _needsValue() {
    return lockModeEl.value === 'bar' || lockModeEl.value === 'date';
  }

  function _updateLockUI() {
    lockValueEl.style.display = _needsValue() ? '' : 'none';
    lockValueEl.placeholder   = lockModeEl.value === 'bar' ? 'bar #' : 'YYYY-MM-DD';
  }

  function _commitLock() {
    applyRangeLock(lockModeEl.value, _needsValue() ? (lockValueEl.value.trim() || null) : null);
  }

  lockModeEl.addEventListener('change', () => {
    _updateLockUI();
    _commitLock();
  });

  // Digits only for bar mode; commit on Enter or blur
  lockValueEl.addEventListener('input', () => {
    if (lockModeEl.value === 'bar') lockValueEl.value = lockValueEl.value.replace(/\D/g, '');
  });
  lockValueEl.addEventListener('change', _commitLock);
  lockValueEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') { lockValueEl.blur(); } });

  _updateLockUI();
  _commitLock(); // apply start mode immediately on page load

  // Help overlay
  const helpOverlay = document.getElementById('help-overlay');
  const btnHelp     = document.getElementById('btn-help');

  function _toggleHelp(force) {
    const show = force !== undefined ? force : !helpOverlay.classList.contains('visible');
    helpOverlay.classList.toggle('visible', show);
    btnHelp.classList.toggle('active', show);
  }

  btnHelp.addEventListener('click', () => _toggleHelp());
  document.getElementById('help-close').addEventListener('click', () => _toggleHelp(false));
  helpOverlay.addEventListener('click', (e) => { if (e.target === helpOverlay) _toggleHelp(false); });

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
    btnFullscreen.classList.toggle('active', !!document.fullscreenElement);
    setTimeout(() => window.dispatchEvent(new Event('resize')), 50);
  });

  // Global keyboard shortcuts
  const _lockModes = ['start', 'end', 'bar', 'date'];
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { _toggleHelp(false); document.activeElement?.blur(); return; }
    if (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'SELECT') return;
    if (e.key === 'f' || e.key === 'F') { e.preventDefault(); _toggleFullscreen(); return; }
    if (e.key === '`') { e.preventDefault(); window.location.href = '/fetch'; return; }
    if (e.key === '?') { e.preventDefault(); _toggleHelp(); return; }
    if (helpOverlay.classList.contains('visible')) return;
    if (e.key === '\\') {
      e.preventDefault();
      const next = (_lockModes.indexOf(lockModeEl.value) + 1) % _lockModes.length;
      lockModeEl.value = _lockModes[next];
      _updateLockUI();
      _commitLock();
      return;
    }
    if (e.key === 'Enter' && _needsValue()) {
      e.preventDefault();
      lockValueEl.focus();
      lockValueEl.select();
      return;
    }
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

