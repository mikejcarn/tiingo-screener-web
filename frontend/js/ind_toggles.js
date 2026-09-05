/**
 * ind_toggles.js — per-indicator show/hide panel (chart page)
 *
 * A button next to the indicators (ind_conf) select opens a checklist of
 * whichever indicators the currently loaded chart can toggle — data stays
 * loaded either way, this only flips rendering on/off. Same
 * button+popover-panel pattern as the flagged-tickers panel (flags.js).
 *
 * Two instances share the same underlying state (replay.js's
 * getIndicatorState/toggleIndicatorVisible): the normal nav-bar one, and a
 * second one in #fs-header for fullscreen mode, where the nav bar is hidden
 * entirely — same relationship as #btn-flag-ticker / #fs-flag.
 */

import { api } from './api.js';
import { getIndicatorState, toggleIndicatorVisible } from './replay.js';

let _displayNames = {}; // {indicatorName: display_name} — best-effort, falls back to raw name

function _label(name) {
  return _displayNames[name] || name;
}

function _makeInstance(btnId, wrapId, panelId, listId) {
  const btnPanel = document.getElementById(btnId);
  const wrapEl   = document.getElementById(wrapId);
  const panelEl  = document.getElementById(panelId);
  const listEl   = document.getElementById(listId);
  if (!btnPanel || !wrapEl || !panelEl || !listEl) return null;
  return { btnPanel, wrapEl, panelEl, listEl };
}

function _renderPanel(inst) {
  inst.listEl.innerHTML = '';
  const state = getIndicatorState();
  if (!state.length) {
    const empty = document.createElement('div');
    empty.className = 'ind-toggle-empty';
    empty.textContent = 'No toggleable indicators loaded';
    inst.listEl.appendChild(empty);
    return;
  }
  for (const { name, visible } of state) {
    const row = document.createElement('label');
    row.className = 'ind-toggle-row';

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = visible;
    cb.addEventListener('change', () => toggleIndicatorVisible(name, cb.checked));

    const nameEl = document.createElement('span');
    nameEl.className = 'ind-toggle-name';
    nameEl.textContent = _label(name);

    row.append(cb, nameEl);
    inst.listEl.appendChild(row);
  }
}

function _openPanel(inst)   { inst.panelEl.classList.add('open'); _renderPanel(inst); }
function _closePanel(inst)  { inst.panelEl.classList.remove('open'); }
function _togglePanel(inst) { inst.panelEl.classList.contains('open') ? _closePanel(inst) : _openPanel(inst); }

function _wireInstance(inst) {
  inst.btnPanel.addEventListener('click', () => { inst.btnPanel.blur(); _togglePanel(inst); });

  document.addEventListener('click', (e) => {
    if (!inst.panelEl.classList.contains('open')) return;
    if (inst.wrapEl.contains(e.target)) return;
    _closePanel(inst);
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && inst.panelEl.classList.contains('open')) _closePanel(inst);
  });
}

export async function initIndToggles() {
  const instances = [
    _makeInstance('btn-ind-toggle-panel', 'ind-toggle-wrap', 'ind-toggle-panel', 'ind-toggle-list'),
    _makeInstance('btn-fs-ind-toggle-panel', 'fs-ind-toggle-wrap', 'fs-ind-toggle-panel', 'fs-ind-toggle-list'),
  ].filter(Boolean);
  if (!instances.length) return; // page doesn't have the toggle UI

  try {
    const { display_names } = await api.get('/api/indicator-defaults');
    _displayNames = display_names || {};
  } catch { _displayNames = {}; }

  for (const inst of instances) _wireInstance(inst);
}
