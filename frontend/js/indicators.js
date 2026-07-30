import { initHelp } from './help.js';
import { initTheme, toggleTheme } from './theme.js';
import { api } from './api.js';

const ALL_TIMEFRAMES = ['daily', 'weekly', '1hour', '4hour', '5min'];

// Numeric params that are legitimately nullable (null = no limit / disabled).
// These always render as a checkbox + number input regardless of current value.
const NULLABLE_NUM_KEYS  = new Set(['max_aVWAPs', 'max_anchors', 'lookback_bars', 'max_mitigated', 'max_unmitigated']);
const NULLABLE_LIST_KEYS = new Set(['BoS_swing_lengths', 'CHoCH_swing_lengths', 'band_std', 'num_bars']);

// Params that should render as a dropdown instead of a text input.
const PARAM_ENUMS = {
  indicator_color: ['StDev', 'QQEMOD', 'ZScore', 'RSI', 'WAE', 'supertrend', 'TTM_squeeze', 'banker_RSI'],
  centreline: ['peaks_valleys_avg', 'gaps_avg', 'OB_avg', 'SMA'],
};


// When param key K changes, replace the value of param key V with the sub-defaults
// for the newly selected option. Populated from param_options API data.
const PARAM_CONTROLS = {
  indicator_color: 'custom_params',
  centreline:      'centreline_params',
};

// ── State ──────────────────────────────────────────────────────
let _configList  = [];   // [{id, name, created_at}]
let _selectedId  = null;
let _configData  = null; // {id, name, indicators: {tf: {ind: params}}}
let _defaults    = null; // {available: [...], defaults: {ind: params}}
let _paramOptions     = {}; // {ind: {param_key: {option_val: sub_params}}}
let _paramLabels      = {}; // {ind: {param_key: display_label}}
let _displayNames     = {}; // {ind: display_name} — optional long name for UI
let _descriptions     = {}; // {ind: description} — hover tooltip text
let _paramDescriptions = {}; // {param_key: description} — hover tooltip text for params
let _paramSeparators  = {}; // {ind: [key, ...]} — insert divider before these keys
let _currentParamLabels     = {}; // active indicator's labels during rendering
let _currentParamSeparators = []; // active indicator's separator keys during rendering
let _activeTf    = 'daily';
let _pending     = {};   // {tf: {ind: params}} unsaved per-tab state
let _dirty       = false;
let _pollTimer   = null;
let _searchQuery    = '';
let _focusedIndKey  = null; // keyboard-navigated indicator

// Multi-config run queue
let _runCheckedIds  = new Set();  // which configs are in the run queue
let _runQueue       = [];         // ordered config IDs for current batch run
let _runQueueIdx    = -1;         // index of currently-running config (-1 = not in a run)
const _confDataCache = {};        // { id: configData } — avoids re-fetching for queue summary
let   _runResults    = {};        // { id: { status, done, total, errors, current } } — per-conf run results

// ── Run queue persistence ──────────────────────────────────────

function _saveRunQueue() {
  try { localStorage.setItem('ind_run_queue', JSON.stringify([..._runCheckedIds])); } catch {}
}

function _loadRunQueue() {
  try {
    const saved  = JSON.parse(localStorage.getItem('ind_run_queue') || '[]');
    const valid  = new Set(_configList.map(c => c.id));
    _runCheckedIds = new Set(saved.filter(id => valid.has(id)));
  } catch { _runCheckedIds = new Set(); }
}

// ── Bootstrap ──────────────────────────────────────────────────

async function init() {
  _wireDbSummary();
  _wireTooltip();
  await Promise.all([_loadConfigList(), _loadDefaults()]);
  _loadRunQueue();   // restore queued confs before first render
  _wireStaticButtons();
  if (_configList.length) {
    await _selectConfig(_configList[0].id, { toggleQueue: false });
  } else {
    _showEmpty(true);
    _loadDbSummary();
  }
  const status = await api.get('/api/jobs/status');
  if (status.indicators.status === 'running') {
    _updateProgress(status.indicators);
    _startPolling();
  }
  // don't restore a stale done/cancelled state on reload
}

// ── Data loaders ───────────────────────────────────────────────

async function _loadConfigList() {
  const data = await api.get('/api/ind-configs');
  _configList = data.configs || [];
  _renderConfigList();
  _renderRunConfigs();
}

async function _loadDefaults() {
  _defaults = await api.get('/api/indicator-defaults');
  _paramOptions    = _defaults.param_options    || {};
  _paramLabels     = _defaults.param_labels     || {};
  _displayNames    = _defaults.display_names    || {};
  _descriptions      = _defaults.descriptions      || {};
  _paramDescriptions = _defaults.param_descriptions || {};
  _paramSeparators   = _defaults.param_separators  || {};
}

async function _selectConfig(id, { toggleQueue = true } = {}) {
  const prevSelected = _selectedId;
  _selectedId  = id;
  _pending     = {};
  _dirty       = false;
  _activeTf    = 'daily';
  _searchQuery = '';
  const searchEl = document.getElementById('ind-search');
  if (searchEl) searchEl.value = '';
  if (toggleQueue) {
    // Re-clicking the already-active conf removes it; first click on any conf adds it
    if (id === prevSelected && _runCheckedIds.has(id)) _runCheckedIds.delete(id);
    else _runCheckedIds.add(id);
    _saveRunQueue();
  }
  await _loadConfig(id);
  _renderConfigList();
  _showEmpty(false);
  _renderEditor();
  _renderRunConfigs();
  _loadDbSummary();
  _loadHistory();
}

async function _loadConfig(id) {
  _configData = await api.get(`/api/ind-configs/${id}`);
  _confDataCache[id] = _configData;
}

// ── Rendering ──────────────────────────────────────────────────

function _showEmpty(on) {
  document.getElementById('ind-empty').style.display  = on  ? '' : 'none';
  document.getElementById('ind-editor').style.display = on  ? 'none' : 'flex';
}

function _fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' });
}

function _renderConfigList() {
  const el = document.getElementById('config-list');
  if (!_configList.length) {
    el.innerHTML = '<div class="ind-loading" style="color:#333">No configs</div>';
    return;
  }
  el.innerHTML = _configList.map(c => {
    const queued = _runCheckedIds.has(c.id);
    return `
    <div class="ind-config-item${c.id === _selectedId ? ' active' : ''}${queued ? ' queued' : ''}" data-id="${c.id}" title="Open config — _ prev · + next">
      <div class="ind-config-info">
        <span class="ind-config-name">${_esc(c.name)}</span>
        <span class="ind-config-date">${_fmtDate(c.updated_at || c.created_at)}</span>
      </div>
      <button class="ind-queue-btn${queued ? ' queued' : ''}" data-id="${c.id}" title="${queued ? 'Remove from run queue (Space / \\)' : 'Add to run queue (Space / \\)'}">▶</button>
    </div>`;
  }).join('');
  for (const item of el.querySelectorAll('.ind-config-item')) {
    item.addEventListener('click', e => {
      if (!e.target.closest('.ind-queue-btn')) _selectConfig(+item.dataset.id);
    });
  }
  for (const btn of el.querySelectorAll('.ind-queue-btn')) {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const id = +btn.dataset.id;
      if (_runCheckedIds.has(id)) { _runCheckedIds.delete(id); delete _runResults[id]; }
      else _runCheckedIds.add(id);
      _saveRunQueue();
      _renderConfigList();
      _renderRunConfigs();
    });
  }
}

function _renderEditor() {
  document.getElementById('config-name').value = _configData?.name || '';
  _renderConfDates();
  _setActiveTab(_activeTf);
  _renderIndicatorList();
}

function _renderConfDates() {
  const el = document.getElementById('conf-dates');
  if (!el || !_configData) return;
  const created = _fmtDate(_configData.created_at);
  const updated = _fmtDate(_configData.updated_at);
  if (updated && updated !== created) {
    el.textContent = `created ${created} · updated ${updated}`;
  } else if (created) {
    el.textContent = `created ${created}`;
  } else {
    el.textContent = '';
  }
}

function _setActiveTab(tf) {
  _activeTf = tf;
  _updateTabCounts();
}

function _updateTabCounts() {
  for (const tab of document.querySelectorAll('.tf-tab')) {
    tab.classList.toggle('active', tab.dataset.tf === _activeTf);
    const tf    = tab.dataset.tf;
    const count = tf === _activeTf
      ? document.querySelectorAll('#ind-list .ind-card.enabled').length
      : Object.keys(_pending[tf] ?? _configData?.indicators?.[tf] ?? {}).length;
    let badge = tab.querySelector('.tf-count');
    if (count > 0) {
      if (!badge) { badge = document.createElement('span'); badge.className = 'tf-count'; tab.appendChild(badge); }
      badge.textContent = count;
    } else {
      badge?.remove();
    }
  }
}

function _renderIndicatorList() {
  const list = document.getElementById('ind-list');
  if (!_defaults?.available?.length) {
    list.innerHTML = '<div class="ind-list-empty">Loading indicators…</div>';
    return;
  }

  const savedForTf    = _pending[_activeTf] ?? _configData?.indicators?.[_activeTf] ?? {};
  const defaultsForTf = _defaults.defaults ?? {};

  const visible = _defaults.available
    .filter(ind => !_searchQuery || ind.toLowerCase().includes(_searchQuery)
      || (_displayNames[ind] ?? '').toLowerCase().includes(_searchQuery))
    .sort((a, b) => {
      const aOn = a in savedForTf;
      const bOn = b in savedForTf;
      return aOn === bOn ? 0 : aOn ? -1 : 1;
    });

  if (!visible.length) {
    list.innerHTML = `<div class="ind-list-empty">No indicators match "${_esc(_searchQuery)}"</div>`;
    _wireListEvents();
    return;
  }

  list.innerHTML = visible.map(ind => {
    const enabled = ind in savedForTf;
    const params  = { ...(defaultsForTf[ind] ?? {}), ...(savedForTf[ind] ?? {}) };
    return _renderIndicatorCard(ind, enabled, params);
  }).join('');

  _wireListEvents();
  if (_focusedIndKey) _setKeyboardFocus(_focusedIndKey);
  _updateTabCounts();
}

function _normalizeParams(ind, params) {
  const indOpts = _paramOptions[ind];
  if (!indOpts || !params || typeof params !== 'object') return params;
  const result = { ...params };
  // Fill any null/missing controlled sub-param group at this level.
  // Guard: only act when the controlling key is actually present here,
  // so nested levels don't pick up each other's rules.
  for (const [key, subOpts] of Object.entries(indOpts)) {
    const targetKey = PARAM_CONTROLS[key];
    if (!targetKey) continue;
    if (result[key] === undefined) continue;
    const defaults = subOpts[result[key]] ?? {};
    const existing = result[targetKey] ?? {};
    // Keep only keys that belong to this option's defaults, dropping stale keys
    const filtered = Object.fromEntries(
      Object.entries(existing).filter(([k]) => k in defaults)
    );
    result[targetKey] = { ...defaults, ...filtered };
  }
  // Recurse so nested levels (e.g. centreline→centreline_params inside custom_params)
  // are also normalized.
  for (const [k, v] of Object.entries(result)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      result[k] = _normalizeParams(ind, v);
    }
  }
  return result;
}

function _renderIndicatorCard(ind, enabled, params) {
  const normalized = _normalizeParams(ind, params);
  _currentParamLabels     = _paramLabels[ind]     || {};
  _currentParamSeparators = _paramSeparators[ind] || [];
  const bodyHtml = enabled
    ? `<div class="ind-card-body">
         <div class="param-tree">${_renderParamTree(normalized)}</div>
       </div>`
    : '';
  const arrow   = enabled ? '<span class="ind-expand-arrow">▾</span>' : '';
  const hasTip  = !!_descriptions[ind];
  const headTitle = enabled ? 'Click to deselect · Space to toggle' : 'Click to select · Space to toggle';
  return `<div class="ind-card${enabled ? ' enabled' : ''}" data-indicator="${_esc(ind)}">
    <div class="ind-card-head" title="${headTitle}">
      <label class="ind-toggle-wrap" title="Enable/disable this indicator">
        <input type="checkbox" class="ind-toggle"${enabled ? ' checked' : ''}>
      </label>
      <span class="ind-name">${hasTip
        ? `<span data-has-tip data-ind="${_esc(ind)}" title="">${_esc(_displayNames[ind] ?? ind)}</span>`
        : _esc(_displayNames[ind] ?? ind)}</span>
      ${arrow}
    </div>
    ${bodyHtml}
  </div>`;
}

// ── Param form renderer ────────────────────────────────────────

function _renderParamTree(params) {
  if (!params || typeof params !== 'object' || Array.isArray(params)) return '';
  return Object.entries(params).map(([k, v]) => {
    const sep = _currentParamSeparators.includes(k)
      ? '<div class="param-separator"></div>' : '';
    return sep + _renderParamValue(k, v);
  }).join('');
}

function _numSpin(disabled) {
  const dis = disabled ? ' disabled' : '';
  return `<span class="param-num-spin">
    <button type="button" class="param-num-up" tabindex="-1" title="Increment"${dis}>&#9650;</button>
    <button type="button" class="param-num-down" tabindex="-1" title="Decrement"${dis}>&#9660;</button>
  </span>`;
}

function _pdesc(key) {
  const d = _paramDescriptions[key];
  return d ? ` title="${_esc(d)}"` : '';
}

function _renderNullableNum(key, val) {
  const enabled = val !== null && val !== undefined;
  const label = _currentParamLabels[key] ?? key;
  return `<div class="param-field param-nullable" data-key="${_esc(key)}" data-type="nullable_num">
    <input type="checkbox" class="param-checkbox param-nullable-toggle"${enabled ? ' checked' : ''}>
    <span class="param-key"${_pdesc(key)}>${_esc(label)}</span>
    <span class="param-num-wrap">
      <input type="number" value="${enabled ? val : ''}" step="1" min="0"
        class="param-input param-num param-nullable-value"${enabled ? '' : ' disabled'}
        placeholder="∞">
      ${_numSpin(!enabled)}
    </span>
  </div>`;
}

function _renderNullableList(key, val) {
  const enabled = Array.isArray(val) && val.length > 0;
  const label = _currentParamLabels[key] ?? key;
  return `<div class="param-field param-nullable" data-key="${_esc(key)}" data-type="nullable_list">
    <input type="checkbox" class="param-checkbox param-nullable-list-toggle"${enabled ? ' checked' : ''}>
    <span class="param-key"${_pdesc(key)}>${_esc(label)}</span>
    <input type="text" value="${enabled ? val.join(', ') : ''}"
      class="param-input param-text param-nullable-list-value"${enabled ? '' : ' disabled'}
      placeholder="e.g. 5, 25">
  </div>`;
}

function _renderParamValue(key, val) {
  const label = _currentParamLabels[key] ?? key;
  if (val === null || val === undefined) {
    return _renderNullableNum(key, null);
  }
  if (NULLABLE_NUM_KEYS.has(key)) {
    const numVal = Array.isArray(val) ? (val[0] ?? null) : (typeof val === 'number' ? val : null);
    return _renderNullableNum(key, numVal);
  }
  if (NULLABLE_LIST_KEYS.has(key)) {
    return _renderNullableList(key, Array.isArray(val) ? val : []);
  }
  if (typeof val === 'boolean') {
    return `<label class="param-field param-bool" data-key="${_esc(key)}" data-type="bool">
      <input type="checkbox"${val ? ' checked' : ''} class="param-checkbox">
      <span class="param-key"${_pdesc(key)}>${_esc(label)}</span>
    </label>`;
  }
  if (typeof val === 'number') {
    if (NULLABLE_NUM_KEYS.has(key)) return _renderNullableNum(key, val);
    const isInt = Number.isInteger(val);
    return `<div class="param-field" data-key="${_esc(key)}" data-type="${isInt ? 'int' : 'float'}">
      <span class="param-key"${_pdesc(key)}>${_esc(label)}</span>
      <span class="param-num-wrap">
        <input type="number" value="${val}" step="${isInt ? '1' : 'any'}" min="0" class="param-input param-num">
        ${_numSpin()}
      </span>
    </div>`;
  }
  if (typeof val === 'string') {
    const opts = PARAM_ENUMS[key];
    if (opts) {
      const options = opts.map(o => `<option value="${_esc(o)}"${o === val ? ' selected' : ''}>${_esc(o)}</option>`).join('');
      return `<div class="param-field" data-key="${_esc(key)}" data-type="string">
        <span class="param-key"${_pdesc(key)}>${_esc(label)}</span>
        <select class="param-input param-select">${options}</select>
      </div>`;
    }
    return `<div class="param-field" data-key="${_esc(key)}" data-type="string">
      <span class="param-key"${_pdesc(key)}>${_esc(label)}</span>
      <input type="text" value="${_esc(val)}" class="param-input param-text">
    </div>`;
  }
  if (Array.isArray(val)) {
    if (val.length === 0 || val.every(v => typeof v === 'number')) {
      return `<div class="param-field" data-key="${_esc(key)}" data-type="list_num">
        <span class="param-key"${_pdesc(key)}>${_esc(label)}</span>
        <input type="text" value="${val.join(', ')}" class="param-input param-text" placeholder="e.g. 50, 200">
      </div>`;
    }
    // Complex array (list of dicts, etc.) → JSON textarea
    return `<div class="param-field param-wide" data-key="${_esc(key)}" data-type="json">
      <span class="param-key"${_pdesc(key)}>${_esc(label)}</span>
      <textarea class="param-input param-json">${_esc(JSON.stringify(val, null, 2))}</textarea>
    </div>`;
  }
  if (typeof val === 'object') {
    const isInline = Object.values(PARAM_CONTROLS).includes(key);
    const body = Object.keys(val).length
      ? _renderParamTree(val)
      : '<span class="param-none">no additional parameters</span>';
    const desc = _paramDescriptions[key];
    const groupTitle = desc
      ? `Click to expand/collapse — ${desc}`
      : 'Click to expand/collapse this parameter group';
    return `<div class="param-group${isInline ? ' param-inline' : ''}" data-key="${_esc(key)}" data-type="object">
      <div class="param-group-head" title="${_esc(groupTitle)}">
        <span class="param-group-arrow">▾</span>${_esc(label)}
      </div>
      <div class="param-group-body">${body}</div>
    </div>`;
  }
  return '';
}

// ── Param tree reader ──────────────────────────────────────────

function _readParamTree(container) {
  const result = {};
  for (const child of container.children) {
    if (child.classList.contains('param-field')) {
      const key  = child.dataset.key;
      const type = child.dataset.type;
      const input = child.querySelector('input, textarea, select');
      if (!input) continue;
      switch (type) {
        case 'bool':      result[key] = input.checked; break;
        case 'int':       result[key] = parseInt(input.value)   || 0; break;
        case 'float':     result[key] = parseFloat(input.value) || 0; break;
        case 'string':    result[key] = input.value; break;
        case 'list_num': {
          const parts = input.value.split(',').map(v => v.trim()).filter(Boolean);
          result[key] = parts.map(v => v.includes('.') ? parseFloat(v) : parseInt(v));
          break;
        }
        case 'nullable_num': {
          const toggle = child.querySelector('.param-nullable-toggle');
          const numEl  = child.querySelector('.param-nullable-value');
          if (toggle?.checked) {
            const n = parseInt(numEl?.value);
            result[key] = isNaN(n) ? null : n;
          } else {
            result[key] = null;
          }
          break;
        }
        case 'nullable_list': {
          const toggle = child.querySelector('.param-nullable-list-toggle');
          if (toggle?.checked) {
            const textEl = child.querySelector('.param-nullable-list-value');
            const parts = (textEl?.value || '').split(',').map(v => v.trim()).filter(Boolean);
            result[key] = parts.map(v => v.includes('.') ? parseFloat(v) : parseInt(v));
          } else {
            result[key] = [];
          }
          break;
        }
        case 'json':
          try { result[key] = JSON.parse(input.value); } catch { result[key] = input.value; }
          break;
      }
    } else if (child.classList.contains('param-group')) {
      const key  = child.dataset.key;
      const body = child.querySelector('.param-group-body');
      if (body) result[key] = _readParamTree(body);
    }
  }
  return result;
}

// ── Event wiring ───────────────────────────────────────────────

function _wireStaticButtons() {
  document.getElementById('btn-new-config').addEventListener('click', _createConfig);
  document.getElementById('config-name').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); _saveConfig(); e.target.blur(); }
  });
  document.getElementById('btn-clear-results').addEventListener('click', _clearResults);
  document.getElementById('btn-db-clear-results').addEventListener('click', _dbClearResults);
  document.getElementById('btn-db-refresh').addEventListener('click', _loadDbSummary);
  document.getElementById('btn-history-refresh').addEventListener('click', _loadHistory);
  document.getElementById('btn-clear-history').addEventListener('click', _clearHistory);
  document.getElementById('btn-delete-config').addEventListener('click', _deleteConfig);
  document.getElementById('btn-save').addEventListener('click', _saveConfig);
  document.getElementById('btn-run-refresh').addEventListener('click', _renderRunConfigs);
  document.getElementById('btn-run-clear-all').addEventListener('click', () => {
    if (!_runCheckedIds.size) return;
    _runCheckedIds.clear();
    _runResults = {};
    _saveRunQueue();
    _renderConfigList();
    _renderRunConfigs();
  });
  document.getElementById('btn-compute').addEventListener('click', _startCompute);
  document.getElementById('btn-compute-cancel').addEventListener('click', () => {
    _runQueue    = [];
    _runQueueIdx = -1;
    _updateQueueStatus();
    api.post('/api/jobs/indicators/cancel');
  });

  for (const tab of document.querySelectorAll('.tf-tab')) {
    tab.addEventListener('click', () => _switchTf(tab.dataset.tf));
  }

  const searchEl = document.getElementById('ind-search');
  searchEl.addEventListener('input', e => {
    _searchQuery   = e.target.value.trim().toLowerCase();
    _focusedIndKey = null;
    _renderIndicatorList();
  });
  searchEl.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      e.preventDefault();
      searchEl.blur();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault(); _moveFocus(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault(); _moveFocus(-1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (_focusedIndKey) _toggleFocusedCard();
      else _selectFirstFilteredIndicator();
    }
  });

}

async function _renderRunConfigs() {
  const el = document.getElementById('run-conf-list');
  if (!el) return;
  const queued = _configList.filter(c => _runCheckedIds.has(c.id));
  if (!queued.length) {
    el.innerHTML = '<div class="run-queue-empty">No configs queued — click a conf to add</div>';
    return;
  }
  // Fetch data for any conf not yet cached
  await Promise.all(
    queued.filter(c => !_confDataCache[c.id])
          .map(c => api.get(`/api/ind-configs/${c.id}`).then(d => { _confDataCache[c.id] = d; }))
  );
  const inRun = _runQueueIdx >= 0;
  el.innerHTML = `<table class="run-queue-table"><tbody>${queued.map((c, i) => {
    const inds = _confDataCache[c.id]?.indicators || {};
    const tfs  = ALL_TIMEFRAMES.filter(tf => inds[tf] && Object.keys(inds[tf]).length);
    const detail = tfs.length
      ? tfs.map(tf => {
          const names = Object.keys(inds[tf]);
          return `<div class="run-summary-row">
            <span class="run-summary-tf">${_esc(tf)}</span>
            <span class="run-summary-inds">${names.map(_esc).join('<span class="run-summary-sep">·</span>')}</span>
          </div>`;
        }).join('')
      : '<span class="run-summary-empty">No indicators configured</span>';
    return `<tr class="run-queue-item">
      <td class="run-queue-td-pos">${i + 1}</td>
      <td class="run-queue-td-name">
        <div class="run-queue-name">${_esc(c.name)}</div>
        <div class="run-queue-detail">${detail}</div>
        <div class="rq-status" data-id="${c.id}"></div>
      </td>
      <td class="run-queue-td-del"><button class="run-queue-remove" data-id="${c.id}"${inRun ? ' disabled' : ''} title="Remove ${_esc(c.name)} from the run queue">×</button></td>
    </tr>`;
  }).join('')}</tbody></table>`;
  for (const btn of el.querySelectorAll('.run-queue-remove')) {
    btn.addEventListener('click', () => {
      const id = +btn.dataset.id;
      _runCheckedIds.delete(id);
      delete _runResults[id];
      _saveRunQueue();
      _renderConfigList();
      _renderRunConfigs();
    });
  }
  _updateRunQueueStatus();  // repopulate any existing results after re-render
}

function _updateQueueStatus() {
  const el = document.getElementById('run-queue-status');
  if (!el) return;
  if (_runQueue.length <= 1 || _runQueueIdx < 0 || _runQueueIdx >= _runQueue.length) {
    el.style.display = 'none';
    return;
  }
  el.style.display = '';
  const conf = _configList.find(c => c.id === _runQueue[_runQueueIdx]);
  el.textContent = `Config ${_runQueueIdx + 1} / ${_runQueue.length}  ·  ${conf?.name ?? `#${_runQueue[_runQueueIdx]}`}`;
}

function _setKeyboardFocus(ind) {
  document.querySelector('#ind-list .ind-card.kb-focused')?.classList.remove('kb-focused');
  _focusedIndKey = ind || null;
  if (!_focusedIndKey) return;
  const card = document.querySelector(`#ind-list .ind-card[data-indicator="${CSS.escape(_focusedIndKey)}"]`);
  if (card) { card.classList.add('kb-focused'); card.scrollIntoView({ block: 'nearest' }); }
}

function _moveFocus(dir) {
  const cards = [...document.querySelectorAll('#ind-list .ind-card')];
  if (!cards.length) return;
  const keys  = cards.map(c => c.dataset.indicator);
  const cur   = _focusedIndKey ? keys.indexOf(_focusedIndKey) : -1;
  const next  = (cur + dir + cards.length) % cards.length;
  _setKeyboardFocus(keys[next]);
}

function _toggleFocusedCard() {
  if (!_focusedIndKey) return;
  const card = document.querySelector(`#ind-list .ind-card[data-indicator="${CSS.escape(_focusedIndKey)}"]`);
  if (!card) return;
  const checkbox = card.querySelector('.ind-toggle');
  if (checkbox) { checkbox.checked = !card.classList.contains('enabled'); _onToggle(checkbox); _dirty = true; }
}

function _wireListEvents() {
  const list = document.getElementById('ind-list');

  list.addEventListener('change', e => {
    if (e.target.classList.contains('ind-toggle')) {
      e.target.closest('.ind-card').classList.toggle('enabled', e.target.checked);
      _updateTabCounts();
      _dirty = true;
      e.target.blur();
      return;
    }

    // Nullable-number toggle: enable/disable the number input
    if (e.target.classList.contains('param-nullable-toggle')) {
      const wrap = e.target.closest('.param-nullable')?.querySelector('.param-num-wrap');
      const numEl = wrap?.querySelector('.param-nullable-value');
      if (numEl) {
        numEl.disabled = !e.target.checked;
        if (e.target.checked && !numEl.value) numEl.value = '5';
      }
      wrap?.querySelectorAll('.param-num-up, .param-num-down')
        .forEach(btn => { btn.disabled = !e.target.checked; });
    }

    // Nullable-list toggle: enable/disable the text input
    if (e.target.classList.contains('param-nullable-list-toggle')) {
      const textEl = e.target.closest('.param-nullable')?.querySelector('.param-nullable-list-value');
      if (textEl) textEl.disabled = !e.target.checked;
    }

    // When a dropdown with param_options changes, swap the dependent sub-param group
    if (e.target.classList.contains('param-select')) {
      const field     = e.target.closest('[data-key]');
      const card      = e.target.closest('.ind-card');
      if (field && card) {
        const ind       = card.dataset.indicator;
        const key       = field.dataset.key;
        const targetKey = PARAM_CONTROLS[key];
        const subOpts   = _paramOptions[ind]?.[key];
        if (targetKey && subOpts) {
          const subParams = { ...(subOpts[e.target.value] ?? {}) };
          const paramTree = card.querySelector('.param-tree');
          const targetEl  = paramTree?.querySelector(`[data-key="${targetKey}"]`);
          if (targetEl) targetEl.outerHTML = _renderParamValue(targetKey, subParams);
        }
      }
    }

    _dirty = true;
  });

  list.addEventListener('input', () => { _dirty = true; });

  list.addEventListener('click', e => {
    const head = e.target.closest('.ind-card-head');
    if (head && !e.target.closest('.ind-toggle-wrap')) {
      const card     = head.closest('.ind-card');
      const checkbox = card.querySelector('.ind-toggle');
      if (checkbox) {
        checkbox.checked = !checkbox.checked;
        _onToggle(checkbox);
        _dirty = true;
      }
    }
    // Toggle nested param group
    const gh = e.target.closest('.param-group-head');
    if (gh) {
      const group = gh.closest('.param-group');
      group.classList.toggle('collapsed');
    }

    // Custom number-input spinner buttons
    const spinBtn = e.target.closest('.param-num-up, .param-num-down');
    if (spinBtn) {
      const input = spinBtn.closest('.param-num-wrap')?.querySelector('input[type="number"]');
      if (input && !input.disabled) {
        const step = parseFloat(input.step) || 1;
        const min  = input.min !== '' ? parseFloat(input.min) : -Infinity;
        const max  = input.max !== '' ? parseFloat(input.max) : Infinity;
        let cur = parseFloat(input.value);
        if (isNaN(cur)) cur = min !== -Infinity ? min : 0;
        const dir  = spinBtn.classList.contains('param-num-up') ? 1 : -1;
        let next = Math.round((cur + dir * step) * 1e6) / 1e6;
        next = Math.max(min, Math.min(max, next));
        input.value = next;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }
  });
}

function _wireTooltip() {
  const tip  = document.getElementById('ind-tooltip');
  const list = document.getElementById('ind-list');
  if (!tip || !list) return;

  list.addEventListener('mouseover', e => {
    const nameEl = e.target.closest('[data-has-tip]');
    if (!nameEl) { tip.style.display = 'none'; return; }
    const desc = _descriptions[nameEl.dataset.ind];
    if (!desc) return;
    tip.textContent = desc;
    tip.style.display = 'block';
  });

  list.addEventListener('mousemove', e => {
    if (tip.style.display === 'none') return;
    const x = e.clientX + 14;
    const y = e.clientY + 14;
    const tw = tip.offsetWidth;
    const th = tip.offsetHeight;
    tip.style.left = (x + tw > window.innerWidth  ? e.clientX - tw - 8 : x) + 'px';
    tip.style.top  = (y + th > window.innerHeight ? e.clientY - th - 8 : y) + 'px';
  });

  list.addEventListener('mouseout', e => {
    if (!e.relatedTarget?.closest?.('[data-has-tip]')) tip.style.display = 'none';
  });
}

function _onToggle(checkbox) {
  const card    = checkbox.closest('.ind-card');
  const ind     = card.dataset.indicator;
  const enabled = checkbox.checked;
  card.classList.toggle('enabled', enabled);

  // Add/remove expand arrow in header
  const head  = card.querySelector('.ind-card-head');
  let arrow   = head.querySelector('.ind-expand-arrow');

  if (enabled) {
    const params = {
      ...(_defaults?.defaults?.[ind] ?? {}),
      ...(_configData?.indicators?.[_activeTf]?.[ind] ?? {}),
      ...(_pending[_activeTf]?.[ind] ?? {}),
    };
    let body = card.querySelector('.ind-card-body');
    if (!body) {
      body = document.createElement('div');
      body.className = 'ind-card-body';
      card.appendChild(body);
    }
    body.innerHTML = `<div class="param-tree">${_renderParamTree(params)}</div>`;
    if (!arrow) {
      arrow = document.createElement('span');
      arrow.className = 'ind-expand-arrow';
      arrow.textContent = '▾';
      head.appendChild(arrow);
    }
  } else {
    card.querySelector('.ind-card-body')?.remove();
    arrow?.remove();
  }
  _updateTabCounts();
}

// ── Tab switching ──────────────────────────────────────────────

function _switchTf(tf) {
  if (tf === _activeTf) return;
  _pending[_activeTf] = _collectCurrentTf();
  _setActiveTab(tf);
  _renderIndicatorList();
}

// ── Collect current form state ─────────────────────────────────

function _collectCurrentTf() {
  const result = {};
  for (const card of document.querySelectorAll('.ind-card')) {
    if (!card.querySelector('.ind-toggle')?.checked) continue;
    const ind  = card.dataset.indicator;
    const tree = card.querySelector('.param-tree');
    result[ind] = tree ? _readParamTree(tree) : {};
  }
  return result;
}

// ── Config CRUD ────────────────────────────────────────────────

async function _createConfig() {
  const created = await api.post('/api/ind-configs', { name: 'New config' });
  _configList.push(created);
  _renderConfigList();
  await _selectConfig(created.id);
}

async function _clearResults() {
  if (!_selectedId) return;
  const name = _configData?.name || 'this config';
  if (!confirm(`Clear all computed results for "${name}"? The config will be kept.`)) return;
  await api.del(`/api/data/indicators/${_selectedId}`);
  _closeDbDetail();
  await _loadDbSummary();
}

async function _dbClearResults() {
  if (!confirm('Clear ALL computed indicator results from the database? Configs will be kept.')) return;
  await api.del('/api/data/indicators');
  _closeDbDetail();
  await _loadDbSummary();
}

async function _deleteConfig() {
  if (!_selectedId) return;
  const name = _configData?.name || 'this config';
  if (!confirm(`Delete "${name}" and all its computed results? This cannot be undone.`)) return;
  await api.del(`/api/data/indicators/${_selectedId}`);
  await api.del(`/api/ind-configs/${_selectedId}`);
  _runCheckedIds.delete(_selectedId);
  delete _runResults[_selectedId];
  _saveRunQueue();
  _configList = _configList.filter(c => c.id !== _selectedId);
  _selectedId = null;
  _configData = null;
  _pending    = {};
  _closeDbDetail();
  _renderConfigList();
  if (_configList.length) {
    await _selectConfig(_configList[0].id);
  } else {
    _showEmpty(true);
    _loadDbSummary();
  }
}

async function _saveConfig() {
  if (!_selectedId) return;
  _pending[_activeTf] = _collectCurrentTf();

  const name = document.getElementById('config-name').value.trim() || 'Unnamed';
  // Merge: DB state for untouched tabs, _pending for visited tabs
  const indicators = { ...(_configData?.indicators || {}), ..._pending };

  const btn = document.getElementById('btn-save');
  btn.disabled = true;
  btn.textContent = 'Saving…';

  btn.disabled = false;

  try {
    const saved = await api.put(`/api/ind-configs/${_selectedId}`, { name, indicators });
    _dirty   = false;
    _pending = {};
    await _loadConfig(_selectedId);
    const item = _configList.find(c => c.id === _selectedId);
    if (item) { item.name = name; item.updated_at = saved.updated_at; }
    _renderConfigList();
    _renderRunConfigs();
    _renderConfDates();
    _updateTabCounts();
    btn.textContent = 'Saved ✓';
    btn.classList.add('ind-btn-save-ok');
    setTimeout(() => { btn.textContent = 'Save'; btn.classList.remove('ind-btn-save-ok'); }, 1800);
  } catch {
    btn.textContent = 'Failed ✗';
    btn.classList.add('ind-btn-save-err');
    setTimeout(() => { btn.textContent = 'Save'; btn.classList.remove('ind-btn-save-err'); }, 2000);
  }
}

// ── Compute ────────────────────────────────────────────────────

function _updateRunQueueStatus() {
  for (const [idStr, result] of Object.entries(_runResults)) {
    const el = document.querySelector(`.rq-status[data-id="${idStr}"]`);
    if (!el) continue;
    const { status, done = 0, total = 0, errors = 0, current = '' } = result;
    if (status === 'pending') {
      el.innerHTML = `<div class="rq-info"><span class="rq-state rq-pending">waiting</span></div>`;
    } else if (status === 'running') {
      const pct = total > 0 ? (done / total * 100) : 0;
      el.innerHTML =
        `<div class="rq-bar-track"><div class="rq-bar-fill rq-running" style="width:${pct}%"></div></div>
         <div class="rq-info">
           <span class="rq-state rq-running">running</span>
           ${current ? `<span class="rq-current">→ ${_esc(current)}</span>` : ''}
           <span class="rq-count">${done} / ${total || '?'}</span>
         </div>`;
    } else if (status === 'done') {
      const hasErr = errors > 0;
      el.innerHTML =
        `<div class="rq-bar-track"><div class="rq-bar-fill ${hasErr ? 'rq-errors' : 'rq-done'}" style="width:100%"></div></div>
         <div class="rq-info">
           <span class="rq-state ${hasErr ? 'rq-errors' : 'rq-done'}">${hasErr ? `✗ ${errors} error${errors !== 1 ? 's' : ''}` : '✓ done'}</span>
           <span class="rq-count">${done} / ${total}</span>
         </div>`;
    } else if (status === 'cancelled') {
      el.innerHTML = `<div class="rq-info"><span class="rq-state rq-cancelled">cancelled</span></div>`;
    }
  }
}

async function _startCompute() {
  const ids = _configList.filter(c => _runCheckedIds.has(c.id)).map(c => c.id);
  if (!ids.length) return;
  _runQueue    = ids;
  _runQueueIdx = 0;
  _runResults  = {};
  await _kickNextQueueItem();
}

async function _kickNextQueueItem() {
  const configId  = _runQueue[_runQueueIdx];
  const btn       = document.getElementById('btn-compute');
  const btnCancel = document.getElementById('btn-compute-cancel');
  _updateQueueStatus();
  // Mark this conf running, remaining confs pending
  _runResults[configId] = { status: 'running', done: 0, total: 0, errors: 0, current: '' };
  for (let i = _runQueueIdx + 1; i < _runQueue.length; i++) {
    if (!_runResults[_runQueue[i]]) _runResults[_runQueue[i]] = { status: 'pending' };
  }
  _updateRunQueueStatus();
  btn.disabled = true;
  btn.textContent = '▶ Starting…';
  btnCancel.style.display = '';

  try {
    await api.post('/api/indicators/batch', { config_id: configId });
  } catch (err) {
    btn.disabled = false;
    btn.textContent = '▶ Run';
    btnCancel.style.display = 'none';
    _runQueue    = [];
    _runQueueIdx = -1;
    _updateQueueStatus();
    alert(err.message || 'Failed to start compute job');
    return;
  }

  _startPolling();
}

// ── Progress polling ───────────────────────────────────────────

function _startPolling() {
  if (_pollTimer) return;
  _pollTimer = setInterval(_poll, 2000);
  _poll();
}

function _stopPolling() {
  clearInterval(_pollTimer);
  _pollTimer = null;
}

async function _poll() {
  const data  = await api.get('/api/jobs/status');
  const state = data.indicators;
  _updateProgress(state);
  if (state.status !== 'running') {
    _stopPolling();
    if (state.status === 'done') {
      _runQueueIdx++;
      if (_runQueueIdx < _runQueue.length) {
        _loadHistory();
        await _kickNextQueueItem();
      } else {
        _runQueue    = [];
        _runQueueIdx = -1;
        _updateQueueStatus();
        _loadDbSummary(); _loadHistory();
      }
    } else if (state.status === 'cancelled' || state.status === 'error') {
      _runQueue    = [];
      _runQueueIdx = -1;
      _updateQueueStatus();
    }
  }
}

function _updateProgress(state) {
  const progress  = document.getElementById('comp-overall');
  const idleEl    = document.getElementById('comp-output-idle');
  const track     = document.getElementById('comp-track');
  const bar       = document.getElementById('comp-bar');
  const meta      = document.getElementById('comp-meta');
  const count     = document.getElementById('comp-count');
  const pctEl     = document.getElementById('comp-pct');
  const currentEl = document.getElementById('comp-current');
  const errorsEl  = document.getElementById('comp-errors');
  const btn       = document.getElementById('btn-compute');
  const btnCancel = document.getElementById('btn-compute-cancel');

  // Queue-level bar elements
  const qSection  = document.getElementById('comp-queue-section');
  const qTrack    = document.getElementById('comp-queue-track');
  const qBar      = document.getElementById('comp-queue-bar');
  const qMeta     = document.getElementById('comp-queue-meta');
  const qCount    = document.getElementById('comp-queue-count');
  const qPct      = document.getElementById('comp-queue-pct');
  const qConf     = document.getElementById('comp-queue-conf');

  const _updateQueueBar = (active) => {
    const qTotal = _runQueue.length;
    if (!qSection || qTotal <= 1) { if (qSection) qSection.style.display = 'none'; return; }
    const qDone  = Math.max(0, _runQueueIdx);
    const qp     = Math.round(qDone / qTotal * 100);
    qSection.style.display = '';
    qBar.style.width  = `${qDone / qTotal * 100}%`;
    qCount.textContent = `${qDone} / ${qTotal}`;
    qPct.textContent   = `${qp}%`;
    qConf.textContent  = `Config ${_runQueueIdx + 1} / ${qTotal}`;
    qTrack.classList.toggle('active', active);
    qBar.classList.toggle('active', active);
    qMeta.classList.toggle('active', active);
  };

  const pct = state.total > 0 ? (state.done / state.total * 100) : 0;
  bar.style.width = `${pct}%`;

  const _setActive = on => {
    track.classList.toggle('active', on);
    bar.classList.toggle('active', on);
    meta.classList.toggle('active', on);
  };

  if (state.status === 'idle') {
    progress.style.display = 'none';
    if (qSection) qSection.style.display = 'none';
    if (idleEl) idleEl.style.display = '';
    _setActive(false);
    count.textContent = pctEl.textContent = currentEl.textContent = errorsEl.textContent = '';
    btn.disabled = false;
    btn.textContent = '▶ Run';
    btnCancel.style.display = 'none';
  } else if (state.status === 'running') {
    if (idleEl) idleEl.style.display = 'none';
    _updateQueueBar(true);
    progress.style.display = '';
    _setActive(true);
    count.textContent    = `${state.done} / ${state.total || '?'}`;
    pctEl.textContent    = state.total ? `${Math.round(pct)}%` : '…';
    currentEl.textContent = state.current ? `→ ${state.current}` : '';
    errorsEl.textContent = state.errors > 0 ? `✗ ${state.errors}` : '';
    btn.disabled = true;
    btn.textContent = '▶ Running…';
    btnCancel.style.display = '';
    _renderFeed(state.log || []);
    if (_dbSectionConfigId) _loadDbPreview();
    const cid = _runQueue[_runQueueIdx];
    if (cid !== undefined) {
      _runResults[cid] = { status: 'running', done: state.done, total: state.total, errors: state.errors, current: state.current };
      _updateRunQueueStatus();
    }
  } else if (state.status === 'done') {
    if (idleEl) idleEl.style.display = 'none';
    _updateQueueBar(false);
    progress.style.display = '';
    _setActive(false);
    count.textContent     = `${state.done} / ${state.total}`;
    pctEl.textContent     = '100%';
    currentEl.textContent = '';
    errorsEl.textContent  = state.errors > 0
      ? `✗ ${state.errors} error${state.errors !== 1 ? 's' : ''}`
      : '✓ complete';
    const isLastInQueue = _runQueueIdx + 1 >= _runQueue.length;
    if (isLastInQueue) {
      btn.disabled = false;
      btn.textContent = '▶ Run';
      btnCancel.style.display = 'none';
    }
    _renderFeed(state.log || []);
    const cidDone = _runQueue[_runQueueIdx];
    if (cidDone !== undefined) {
      _runResults[cidDone] = { status: 'done', done: state.done, total: state.total, errors: state.errors };
      _updateRunQueueStatus();
    }
  } else if (state.status === 'cancelled') {
    if (idleEl) idleEl.style.display = 'none';
    _updateQueueBar(false);
    progress.style.display = '';
    _setActive(false);
    count.textContent     = `${state.done} / ${state.total}`;
    pctEl.textContent     = `${Math.round(pct)}% — cancelled`;
    currentEl.textContent = '';
    errorsEl.textContent  = state.errors > 0 ? `✗ ${state.errors} error${state.errors !== 1 ? 's' : ''}` : '';
    btn.disabled = false;
    btn.textContent = '▶ Run';
    btnCancel.style.display = 'none';
    _renderFeed(state.log || []);
  } else if (state.status === 'error') {
    if (idleEl) idleEl.style.display = 'none';
    _updateQueueBar(false);
    progress.style.display = '';
    _setActive(false);
    count.textContent = 'failed';
    pctEl.textContent = currentEl.textContent = errorsEl.textContent = '';
    btn.disabled = false;
    btn.textContent = '▶ Run';
    btnCancel.style.display = 'none';
  }
}

// DB card state
let _dbSummaryData     = [];
let _dbGroupBy         = 'config';
let _dbGroupSort       = { col: 'key', dir: 'asc' };
let _dbSectionConfigId = null;
let _dbActiveTf        = 'daily';
let _dbPreviewTicker   = null;

const _IND_DIM_COLS = ['config', 'ticker', 'timeframe', 'rows', 'first_date', 'last_date'];

// ── DB card ────────────────────────────────────────────────────

function _wireDbSummary() {
  document.getElementById('btn-db-detail-back').addEventListener('click', _closeDbDetail);
  document.getElementById('db-detail-conf-sel').addEventListener('change', async e => {
    _dbSectionConfigId = parseInt(e.target.value);
    await _refreshDetailTfs();
  });
  document.getElementById('db-detail-tf-sel').addEventListener('change', async e => {
    _dbActiveTf = e.target.value;
    await _refreshDetailTickers();
  });
  document.getElementById('db-detail-ticker-sel').addEventListener('change', e => {
    _dbPreviewTicker = e.target.value;
    _loadDbPreview();
  });
}

async function _loadDbSummary() {
  document.getElementById('ind-db-summary-thead').innerHTML = '';
  document.getElementById('ind-db-summary-body').innerHTML =
    '<tr><td colspan="8" class="stats-empty" style="color:var(--t3)">Loading…</td></tr>';
  let data;
  try { data = await api.get('/api/indicators/summary'); } catch { data = { rows: [] }; }
  _dbSummaryData = data.rows || [];
  _renderDbSummary();
}

function _renderDbSummary() {
  const thead = document.getElementById('ind-db-summary-thead');
  const tbody = document.getElementById('ind-db-summary-body');

  if (!_dbSummaryData.length) {
    thead.innerHTML = '';
    tbody.innerHTML = '<tr><td colspan="8" class="stats-empty">No indicator data yet.</td></tr>';
    return;
  }

  // Group all rows by the active dimension
  const _keyOf = row => {
    switch (_dbGroupBy) {
      case 'config':     return row.config_name;
      case 'ticker':     return row.ticker;
      case 'timeframe':  return row.timeframe;
      case 'rows':       return String(row.rows);
      case 'first_date': return row.first_date || '';
      case 'last_date':  return row.last_date  || '';
    }
  };

  const groups = {};
  for (const row of _dbSummaryData) {
    const key = _keyOf(row);
    if (!groups[key]) {
      groups[key] = { totalRows: 0, configs: new Set(), tickers: new Set(), timeframes: new Set(),
                      firstDate: '', lastDate: '', sampleRow: row };
    }
    const g = groups[key];
    g.totalRows += row.rows;
    g.configs.add(row.config_name);
    g.tickers.add(row.ticker);
    g.timeframes.add(row.timeframe);
    if (!g.firstDate || (row.first_date && row.first_date < g.firstDate)) g.firstDate = row.first_date;
    if (!g.lastDate  || (row.last_date  && row.last_date  > g.lastDate))  g.lastDate  = row.last_date;
  }

  // Sort entries
  let entries = Object.entries(groups);
  const dir = _dbGroupSort.dir === 'asc' ? 1 : -1;
  if (_dbGroupSort.col === 'key') {
    if (_dbGroupBy === 'rows') {
      entries.sort(([a], [b]) => dir * (Number(a) - Number(b)));
    } else {
      entries.sort(([a], [b]) => dir * a.localeCompare(b));
    }
  } else {
    const sortFns = {
      config:     ([, a], [, b]) => a.configs.size    - b.configs.size,
      ticker:     ([, a], [, b]) => a.tickers.size    - b.tickers.size,
      timeframe:  ([, a], [, b]) => a.timeframes.size - b.timeframes.size,
      rows:       ([, a], [, b]) => a.totalRows        - b.totalRows,
      first_date: ([, a], [, b]) => (a.firstDate || '').localeCompare(b.firstDate || ''),
      last_date:  ([, a], [, b]) => (a.lastDate  || '').localeCompare(b.lastDate  || ''),
    };
    const fn = sortFns[_dbGroupSort.col];
    if (fn) entries.sort((a, b) => dir * fn(a, b));
  }

  // Column value for a non-key cell
  const _cellVal = (col, g) => {
    switch (col) {
      case 'config':     return `<span class="ind-db-dim-link">${g.configs.size}</span>`;
      case 'ticker':     return `<span class="ind-db-dim-link">${g.tickers.size}</span>`;
      case 'timeframe':  return `<span class="ind-db-dim-link">${g.timeframes.size}</span>`;
      case 'rows':       return `<span class="ind-db-dim-link">${g.totalRows.toLocaleString()}</span>`;
      case 'first_date': return `<span class="ind-db-dim-link">${g.firstDate || '—'}</span>`;
      case 'last_date':  return `<span class="ind-db-dim-link">${g.lastDate  || '—'}</span>`;
    }
  };

  const mkTh = (label, col) => {
    const isGroup = col === _dbGroupBy;
    const isSort  = _dbGroupSort.col === col || (_dbGroupSort.col === 'key' && isGroup);
    const cls = ['stats-th-sort', (isGroup || isSort) ? 'stats-th-pivot' : ''].filter(Boolean).join(' ');
    const arrow = isSort ? (_dbGroupSort.dir === 'asc' ? ' ↑' : ' ↓') : '';
    return `<th class="${cls}" data-col="${col}">${_esc(label)}${arrow}</th>`;
  };

  thead.innerHTML = `<tr>
    <th class="ind-db-th-idx"></th>
    ${mkTh('Config', 'config')}${mkTh('Ticker', 'ticker')}${mkTh('Timeframe', 'timeframe')}
    ${mkTh('Rows', 'rows')}${mkTh('Start Date', 'first_date')}${mkTh('Last Date', 'last_date')}
    <th></th>
  </tr>`;

  for (const th of thead.querySelectorAll('th[data-col]')) {
    th.addEventListener('click', () => {
      const col = th.dataset.col;
      if (col === _dbGroupBy) {
        _dbGroupSort = { col: 'key', dir: _dbGroupSort.dir === 'asc' ? 'desc' : 'asc' };
      } else {
        _dbGroupBy   = col;
        _dbGroupSort = { col: 'key', dir: 'asc' };
      }
      _renderDbSummary();
    });
  }

  const COLS = ['config', 'ticker', 'timeframe', 'rows', 'first_date', 'last_date'];
  tbody.innerHTML = '';
  entries.forEach(([key, g], rowIdx) => {
    const tr = document.createElement('tr');
    tr.className = 'ind-db-summary-row';
    const keyDisplay = _dbGroupBy === 'rows' ? Number(key).toLocaleString() : _esc(key || '—');
    tr.innerHTML = `<td class="ind-db-td-idx">${rowIdx + 1}</td>` +
      COLS.map(col => `<td>${col === _dbGroupBy ? keyDisplay : _cellVal(col, g)}</td>`).join('') +
      `<td class="ind-db-td-del"><button class="ind-db-del-btn" title="Delete this group">×</button></td>`;

    // Non-key cells: click switches groupBy
    const tds = tr.querySelectorAll('td');
    COLS.forEach((col, idx) => {
      if (col === _dbGroupBy) return;
      tds[idx + 1].addEventListener('click', e => {  // +1 for index col offset
        e.stopPropagation();
        _dbGroupBy   = col;
        _dbGroupSort = { col: 'key', dir: 'asc' };
        _renderDbSummary();
      });
    });

    tr.querySelector('.ind-db-del-btn').addEventListener('click', async e => {
      e.stopPropagation();
      if (!confirm(`Delete indicator data for this group?`)) return;
      try { await _deleteIndicatorGroup(key, g); } finally { await _loadDbSummary(); }
    });

    tr.addEventListener('click', () => _openDbDetail(g.sampleRow.config_id, g.sampleRow.ticker, g.sampleRow.timeframe));
    tbody.appendChild(tr);
  });
}

async function _deleteIndicatorGroup(key, g) {
  const qs = p => Object.entries(p).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  if (_dbGroupBy === 'config') {
    await api.del(`/api/indicators/data?${qs({ ind_conf_id: g.sampleRow.config_id })}`);
  } else if (_dbGroupBy === 'ticker') {
    await api.del(`/api/indicators/data?${qs({ ticker: key })}`);
  } else if (_dbGroupBy === 'timeframe') {
    await api.del(`/api/indicators/data?${qs({ timeframe: key })}`);
  } else {
    // rows/first_date/last_date: delete each specific combo in this group
    const matching = _dbSummaryData.filter(r => {
      if (_dbGroupBy === 'rows')       return String(r.rows)        === key;
      if (_dbGroupBy === 'first_date') return (r.first_date || '') === key;
      if (_dbGroupBy === 'last_date')  return (r.last_date  || '') === key;
    });
    await Promise.all(matching.map(r =>
      api.del(`/api/indicators/data?${qs({ ind_conf_id: r.config_id, ticker: r.ticker, timeframe: r.timeframe })}`)
    ));
  }
}

function _openDbDetail(configId, ticker, timeframe) {
  _dbSectionConfigId = configId;
  _dbActiveTf        = timeframe;
  _dbPreviewTicker   = ticker;
  // Populate config selector with all configs that have data
  const confSel = document.getElementById('db-detail-conf-sel');
  const confIds = new Set(_dbSummaryData.map(r => r.config_id));
  const confsWithData = _configList.filter(c => confIds.has(c.id));
  confSel.innerHTML = '';
  for (const c of confsWithData) {
    const o = document.createElement('option');
    o.value = c.id; o.textContent = c.name; o.selected = c.id === configId;
    confSel.appendChild(o);
  }
  confSel.disabled = confsWithData.length <= 1;

  document.getElementById('ind-db-summary-view').style.display = 'none';
  document.getElementById('ind-db-detail-view').style.display  = 'flex';
  document.getElementById('comp-db-table').innerHTML = '';
  _refreshDetailTfs(timeframe, ticker);
}

function _refreshDetailTfs(preferTf, preferTicker) {
  const tfSel = document.getElementById('db-detail-tf-sel');
  const TF_ORDER = ['daily', 'weekly', '1hour', '4hour', '5min'];
  const available = [...new Set(
    _dbSummaryData.filter(r => r.config_id === _dbSectionConfigId).map(r => r.timeframe)
  )].sort((a, b) => {
    const ai = TF_ORDER.indexOf(a), bi = TF_ORDER.indexOf(b);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });
  tfSel.innerHTML = '';
  for (const tf of available) {
    const o = document.createElement('option'); o.value = tf; o.textContent = tf; tfSel.appendChild(o);
  }
  const target = preferTf && available.includes(preferTf) ? preferTf : available[0] || '';
  tfSel.value = target;
  tfSel.disabled = available.length <= 1;
  _dbActiveTf = target;
  _refreshDetailTickers(preferTicker);
}

async function _refreshDetailTickers(preferTicker) {
  const tickerSel = document.getElementById('db-detail-ticker-sel');
  tickerSel.innerHTML = '<option disabled>Loading…</option>';
  tickerSel.disabled = true;
  let tickers = [];
  try {
    const data = await api.get(
      `/api/indicators/tickers-list?config_id=${_dbSectionConfigId}&timeframe=${_dbActiveTf}`
    );
    tickers = data.tickers || [];
  } catch {}
  tickerSel.innerHTML = '';
  for (const t of tickers) {
    const o = document.createElement('option'); o.value = t; o.textContent = t; tickerSel.appendChild(o);
  }
  const target = preferTicker && tickers.includes(preferTicker) ? preferTicker : tickers[0] || '';
  tickerSel.value = target;
  tickerSel.disabled = tickers.length <= 1;
  _dbPreviewTicker = target;
  _loadDbPreview();
}

function _closeDbDetail() {
  document.getElementById('ind-db-detail-view').style.display  = 'none';
  document.getElementById('ind-db-summary-view').style.display = 'flex';
  _dbSectionConfigId = null;
  _dbPreviewTicker   = null;
}

async function _loadDbPreview() {
  if (!_dbSectionConfigId) return;
  const tableEl = document.getElementById('comp-db-table');
  tableEl.innerHTML = '<tr><td style="color:#333;padding:8px 12px;font-size:11px;">Loading…</td></tr>';

  const tickerParam = _dbPreviewTicker ? `&ticker=${encodeURIComponent(_dbPreviewTicker)}` : '';
  let data;
  try {
    data = await api.get(
      `/api/indicators/preview?config_id=${_dbSectionConfigId}&timeframe=${_dbActiveTf}${tickerParam}`
    );
  } catch {
    tableEl.innerHTML = '<tr><td style="color:#333;padding:8px 12px;font-size:11px;">Failed to load.</td></tr>';
    return;
  }

  if (data.not_found) {
    tableEl.innerHTML = `<tr><td style="color:#555;padding:8px 12px;font-size:11px;">${_esc(_dbPreviewTicker)} not found for this config / timeframe.</td></tr>`;
    return;
  }
  if (!data.columns?.length) {
    tableEl.innerHTML = '<tr><td style="color:#333;padding:8px 12px;font-size:11px;">No data for this timeframe.</td></tr>';
    return;
  }

  const ohlcvCols = new Set(['date','open','high','low','close','volume']);
  const thead = `<thead><tr>${data.columns.map(c =>
    `<th class="${ohlcvCols.has(c) ? 'ind-db-th-ohlcv' : 'ind-db-th-ind'}">${_esc(c)}</th>`
  ).join('')}</tr></thead>`;
  const tbody = `<tbody>${data.rows.map(row =>
    `<tr>${data.columns.map(c => {
      const v = row[c];
      const display = v === null || v === undefined ? '<span class="ind-db-null">—</span>' : _esc(String(v));
      return `<td class="${ohlcvCols.has(c) ? 'ind-db-td-ohlcv' : ''}">${display}</td>`;
    }).join('')}</tr>`
  ).join('')}</tbody>`;
  tableEl.innerHTML = thead + tbody;
}

function _renderFeed(entries) {
  const el = document.getElementById('comp-feed');
  if (!entries.length) { el.style.display = 'none'; return; }
  el.style.display = '';
  const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 4;
  el.innerHTML = entries.map(e =>
    `<div class="ind-feed-row${e.ok ? '' : ' ind-feed-err'}">
      <span class="ind-feed-status">${e.ok ? '✓' : '✗'}</span>
      <span class="ind-feed-sym">${_esc(e.ticker)}</span>
      <span class="ind-feed-tf">${_esc(e.detail)}</span>
    </div>`
  ).join('');
  if (atBottom) el.scrollTop = el.scrollHeight;
}


async function _loadHistory() {
  const tbody = document.getElementById('ind-history-body');
  tbody.innerHTML = '<tr><td colspan="7" class="stats-empty" style="color:var(--t3)">Loading…</td></tr>';
  let data;
  try {
    data = await api.get('/api/indicators/history');
  } catch {
    tbody.innerHTML = '<tr><td colspan="6" class="stats-empty">Failed to load.</td></tr>';
    return;
  }
  const rows = data.history || [];
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="stats-empty">No history yet.</td></tr>';
    return;
  }
  tbody.innerHTML = '';
  for (const [i, r] of rows.entries()) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="ind-db-td-idx">${i + 1}</td>
      <td>${_esc(r.config_name)}</td>
      <td>${r.timeframes.join(', ')}</td>
      <td>${r.tickers}</td>
      <td class="${r.errors > 0 ? 'ind-hist-err' : ''}">${r.errors}</td>
      <td>${_esc(r.ran_at)}</td>
      <td><button class="scan-history-del" title="Delete this run">✕</button></td>
    `;
    tr.querySelector('.scan-history-del').addEventListener('click', async () => {
      try { await api.del(`/api/indicators/history/${r.id}`); } catch {}
      await _loadHistory();
    });
    tbody.appendChild(tr);
  }
}

async function _clearHistory() {
  try { await api.del('/api/indicators/history'); } catch {}
  await _loadHistory();
}


// ── Utilities ──────────────────────────────────────────────────

function _esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function _selectFirstFilteredIndicator() {
  const firstCard = document.querySelector('#ind-list .ind-card');
  if (!firstCard) return;
  const ind = firstCard.dataset.indicator;
  if (!ind) return;
  // Enable it if not already on
  const current = _pending[_activeTf] !== undefined
    ? _pending[_activeTf]
    : { ...(_configData?.indicators?.[_activeTf] ?? {}) };
  if (!(ind in current)) {
    current[ind] = { ...(_defaults?.defaults?.[ind] ?? {}) };
    _pending[_activeTf] = current;
    _dirty = true;
  }
  const searchEl = document.getElementById('ind-search');
  searchEl.value = '';
  _searchQuery = '';
  _renderIndicatorList(); // enabled indicator sorts to top
  searchEl.blur();
}

document.addEventListener('keydown', e => {
  if (e.key === '/') { e.preventDefault(); toggleTheme(); return; }
  if (e.key === '`') { e.preventDefault(); window.location.href = '/scanner'; return; }
  if (e.key === '~') { e.preventDefault(); window.location.href = '/fetch'; return; }

  // Universal Esc reset
  if (e.key === 'Escape') {
    e.preventDefault();
    const search = document.getElementById('ind-search');
    if (_searchQuery) {
      search.value = '';
      _searchQuery = '';
      _renderIndicatorList();
    }
    _setKeyboardFocus(null);
    if (_dbSectionConfigId) {
      _closeDbDetail();
    }
    document.activeElement?.blur();
    return;
  }

  // Any printable char while nothing interactive is focused → route to indicator search
  const tag = document.activeElement?.tagName;
  if (e.key === 'Enter' && e.shiftKey) {
    e.preventDefault();
    const nameEl = document.getElementById('config-name');
    if (nameEl) { nameEl.focus(); nameEl.select(); }
    return;
  }

  if (e.key === 's' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); _saveConfig(); return; }

  if (tag !== 'INPUT' && tag !== 'TEXTAREA' && !e.ctrlKey && !e.metaKey) {
    if (e.key === 'ArrowDown' || e.key === '-') { e.preventDefault(); _moveFocus(1);  return; }
    if (e.key === 'ArrowUp'   || e.key === '=') { e.preventDefault(); _moveFocus(-1); return; }
    if (e.key === 'Enter') { e.preventDefault(); _toggleFocusedCard(); return; }
    if (e.key === ' ' || e.key === '\\') {
      e.preventDefault();
      if (_selectedId) {
        if (_runCheckedIds.has(_selectedId)) { _runCheckedIds.delete(_selectedId); delete _runResults[_selectedId]; }
        else _runCheckedIds.add(_selectedId);
        _saveRunQueue();
        _renderConfigList();
        _renderRunConfigs();
      }
      return;
    }
    if (e.key === '[' || e.key === ']') {
      e.preventDefault();
      const tabs = [...document.querySelectorAll('.tf-tab')];
      const cur  = tabs.findIndex(t => t.dataset.tf === _activeTf);
      const dir  = e.key === ']' ? 1 : -1;
      const next = (cur + dir + tabs.length) % tabs.length;
      if (tabs[next]) _switchTf(tabs[next].dataset.tf);
      return;
    }
    if (e.key === '_' || e.key === '+') {
      e.preventDefault();
      if (!_configList.length) return;
      const cur  = _configList.findIndex(c => c.id === _selectedId);
      const dir  = e.key === '_' ? 1 : -1;
      const next = (cur + dir + _configList.length) % _configList.length;
      _selectConfig(_configList[next].id);
      return;
    }
    if (e.key === 'C') { e.preventDefault(); window.location.href = '/'; return; }
    if (e.key === 'T') { e.preventDefault(); window.location.href = '/fetch'; return; }
    if (e.key === 'I') { e.preventDefault(); window.location.href = '/indicators'; return; }
    if (e.key === 'S') { e.preventDefault(); window.location.href = '/scanner'; return; }
    if (e.key === 'R') { e.preventDefault(); _startCompute(); return; }
    if (e.key === 'D') { e.preventDefault(); _deleteConfig(); return; }
    if (e.key === 'N') {
      e.preventDefault();
      _createConfig().then(() => {
        const nameEl = document.getElementById('config-name');
        if (nameEl) { nameEl.focus(); nameEl.select(); }
      });
      return;
    }
  }
  if (
    e.key.length === 1 &&
    !e.ctrlKey && !e.metaKey && !e.altKey &&
    e.key === e.key.toLowerCase() &&   // ignore uppercase — reserved for shortcuts
    tag !== 'INPUT' && tag !== 'TEXTAREA' &&
    document.getElementById('ind-editor')?.style.display !== 'none'
  ) {
    e.preventDefault();
    const search = document.getElementById('ind-search');
    search.focus();
    search.value += e.key;
    _searchQuery = search.value.trim().toLowerCase();
    _renderIndicatorList();
  }
});

init();
initTheme();
initHelp('indicators');
