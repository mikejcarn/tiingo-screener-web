/**
 * flags.js — ticker flagging (chart page)
 *
 * A lightweight bookmark: Shift+L (or the star button) flags/unflags
 * whichever ticker is currently loaded. Flagged tickers persist server-side
 * and show up in an on-demand panel for quick review / jump-to / unflag.
 */

import { api } from './api.js';

let _flagged  = new Set();  // uppercase tickers currently flagged
let _current  = null;       // current chart ticker (uppercase), or null before first load
let _jumpTo   = null;       // (ticker) => void, provided by browse.js

const btnFlag  = document.getElementById('btn-flag-ticker');
const btnPanel = document.getElementById('btn-flagged-panel');
const countEl  = document.getElementById('flagged-count');
const wrapEl   = document.getElementById('flagged-wrap');
const panelEl  = document.getElementById('flagged-panel');
const listEl   = document.getElementById('flagged-list');
const fsFlagEl = document.getElementById('fs-flag');

function _renderButton() {
  if (!btnFlag || !_current) return;
  const on = _flagged.has(_current);
  btnFlag.classList.toggle('active', on);
  btnFlag.innerHTML = on ? '&#9733;' : '&#9734;'; // ★ / ☆
  btnFlag.title = `${on ? 'Unflag' : 'Flag'} ${_current} (Shift+L)`;
  if (fsFlagEl) fsFlagEl.innerHTML = on ? '&#9733;' : '';
}

function _renderCount() {
  if (!countEl) return;
  countEl.textContent = _flagged.size ? String(_flagged.size) : '';
}

function _renderPanel() {
  if (!listEl) return;
  listEl.innerHTML = '';
  if (!_flagged.size) {
    const empty = document.createElement('div');
    empty.className = 'flagged-empty';
    empty.textContent = 'No flagged tickers';
    listEl.appendChild(empty);
    return;
  }
  for (const t of [..._flagged].sort()) {
    const row = document.createElement('div');
    row.className = 'flagged-row';

    const nameEl = document.createElement('span');
    nameEl.className = 'flagged-row-ticker';
    nameEl.textContent = t;
    nameEl.addEventListener('click', () => {
      _closePanel();
      if (_jumpTo) _jumpTo(t);
    });

    const rmEl = document.createElement('button');
    rmEl.className = 'flagged-row-remove';
    rmEl.innerHTML = '&#10005;';
    rmEl.title = `Unflag ${t}`;
    rmEl.addEventListener('click', async (e) => {
      e.stopPropagation();
      await api.del(`/api/flags/${t}`);
      _flagged.delete(t);
      _renderButton(); _renderCount(); _renderPanel();
    });

    row.append(nameEl, rmEl);
    listEl.appendChild(row);
  }
}

function _openPanel()  { panelEl.classList.add('open'); }
function _closePanel() { panelEl.classList.remove('open'); }
function _togglePanel() { panelEl.classList.contains('open') ? _closePanel() : (_renderPanel(), _openPanel()); }

async function _toggleCurrent() {
  if (!_current) return;
  const { flagged } = await api.post(`/api/flags/${_current}`);
  if (flagged) _flagged.add(_current); else _flagged.delete(_current);
  _renderButton(); _renderCount();
  if (panelEl.classList.contains('open')) _renderPanel();
}

/** Uppercase tickers currently flagged, in no particular order. */
export function getFlaggedTickers() {
  return [..._flagged];
}

/** Call whenever the chart page loads a new ticker. */
export function setCurrentTicker(ticker) {
  _current = (ticker || '').toUpperCase() || null;
  _renderButton();
}

/** jumpToTicker: (ticker) => void — how the panel navigates to a flagged ticker. */
export async function initFlags(jumpToTicker) {
  _jumpTo = jumpToTicker;
  if (!btnFlag) return; // page doesn't have the flag UI

  try {
    const { flags } = await api.get('/api/flags');
    _flagged = new Set((flags || []).map(f => f.ticker.toUpperCase()));
  } catch { _flagged = new Set(); }
  _renderButton();
  _renderCount();

  btnFlag.addEventListener('click', () => { btnFlag.blur(); _toggleCurrent(); });
  btnPanel.addEventListener('click', () => { btnPanel.blur(); _togglePanel(); });

  document.addEventListener('click', (e) => {
    if (!panelEl.classList.contains('open')) return;
    if (wrapEl.contains(e.target)) return;
    _closePanel();
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && panelEl.classList.contains('open')) { _closePanel(); return; }
    if (e.key === 'L' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'SELECT') return;
      e.preventDefault();
      _toggleCurrent();
    }
  });
}
