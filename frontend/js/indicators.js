const ALL_TIMEFRAMES = ['daily', 'weekly', '1hour', '4hour', '5min'];

// ── State ──────────────────────────────────────────────────────
let _configList  = [];   // [{id, name, created_at}]
let _selectedId  = null;
let _configData  = null; // {id, name, indicators: {tf: {ind: params}}}
let _defaults    = null; // {available: [...], defaults: {tf: {ind: params}}}
let _activeTf    = 'daily';
let _pending     = {};   // {tf: {ind: params}} unsaved per-tab state
let _dirty       = false;
let _pollTimer   = null;
let _searchQuery = '';

// ── Bootstrap ──────────────────────────────────────────────────

async function init() {
  _buildTimeframeChecks();
  await Promise.all([_loadConfigList(), _loadDefaults()]);
  _wireStaticButtons();
  if (_configList.length) {
    await _selectConfig(_configList[0].id);
  } else {
    _showEmpty(true);
  }
  const status = await fetch('/api/jobs/status').then(r => r.json());
  _updateProgress(status.indicators);
  if (status.indicators.status === 'running') _startPolling();
}

// ── Data loaders ───────────────────────────────────────────────

async function _loadConfigList() {
  const data = await fetch('/api/ind-configs').then(r => r.json());
  _configList = data.configs || [];
  _renderConfigList();
}

async function _loadDefaults() {
  _defaults = await fetch('/api/indicator-defaults').then(r => r.json());
}

async function _selectConfig(id) {
  _selectedId  = id;
  _pending     = {};
  _dirty       = false;
  _activeTf    = 'daily';
  _searchQuery = '';
  const searchEl = document.getElementById('ind-search');
  if (searchEl) searchEl.value = '';
  await _loadConfig(id);
  _renderConfigList();  // update active highlight
  _showEmpty(false);
  _renderEditor();
  _updateRunConfigLabel();
}

async function _loadConfig(id) {
  _configData = await fetch(`/api/ind-configs/${id}`).then(r => r.json());
}

// ── Rendering ──────────────────────────────────────────────────

function _showEmpty(on) {
  document.getElementById('ind-empty').style.display  = on  ? '' : 'none';
  document.getElementById('ind-editor').style.display = on  ? 'none' : 'flex';
}

function _renderConfigList() {
  const el = document.getElementById('config-list');
  if (!_configList.length) {
    el.innerHTML = '<div class="ind-loading" style="color:#333">No configs</div>';
    return;
  }
  el.innerHTML = _configList.map(c => `
    <div class="ind-config-item${c.id === _selectedId ? ' active' : ''}" data-id="${c.id}">
      <span class="ind-config-name">${_esc(c.name)}</span>
    </div>
  `).join('');
  for (const item of el.querySelectorAll('.ind-config-item')) {
    item.addEventListener('click', () => _selectConfig(+item.dataset.id));
  }
}

function _renderEditor() {
  document.getElementById('config-name').value = _configData?.name || '';
  _setActiveTab(_activeTf);
  _renderIndicatorList();
}

function _setActiveTab(tf) {
  _activeTf = tf;
  for (const tab of document.querySelectorAll('.tf-tab')) {
    tab.classList.toggle('active', tab.dataset.tf === tf);
  }
}

function _renderIndicatorList() {
  const list = document.getElementById('ind-list');
  if (!_defaults?.available?.length) {
    list.innerHTML = '<div class="ind-list-empty">Loading indicators…</div>';
    return;
  }

  const savedForTf    = _pending[_activeTf] ?? _configData?.indicators?.[_activeTf] ?? {};
  const defaultsForTf = _defaults.defaults?.[_activeTf] ?? {};

  const visible = _defaults.available
    .filter(ind => !_searchQuery || ind.toLowerCase().includes(_searchQuery))
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
    const params  = savedForTf[ind] ?? defaultsForTf[ind] ?? {};
    return _renderIndicatorCard(ind, enabled, params);
  }).join('');

  _wireListEvents();
}

function _renderIndicatorCard(ind, enabled, params) {
  const bodyHtml = enabled
    ? `<div class="ind-card-body">
         <div class="param-tree">${_renderParamTree(params)}</div>
       </div>`
    : '';
  const arrow = enabled ? '<span class="ind-expand-arrow">▾</span>' : '';
  return `<div class="ind-card${enabled ? ' enabled' : ''}" data-indicator="${_esc(ind)}">
    <div class="ind-card-head">
      <label class="ind-toggle-wrap">
        <input type="checkbox" class="ind-toggle"${enabled ? ' checked' : ''}>
      </label>
      <span class="ind-name">${_esc(ind)}</span>
      ${arrow}
    </div>
    ${bodyHtml}
  </div>`;
}

// ── Param form renderer ────────────────────────────────────────

function _renderParamTree(params) {
  if (!params || typeof params !== 'object' || Array.isArray(params)) return '';
  return Object.entries(params).map(([k, v]) => _renderParamValue(k, v)).join('');
}

function _renderParamValue(key, val) {
  if (val === null || val === undefined) {
    return `<div class="param-field" data-key="${_esc(key)}" data-type="null">
      <span class="param-key">${_esc(key)}</span>
      <input type="text" value="null" class="param-input param-text">
    </div>`;
  }
  if (typeof val === 'boolean') {
    return `<label class="param-field param-bool" data-key="${_esc(key)}" data-type="bool">
      <input type="checkbox"${val ? ' checked' : ''} class="param-checkbox">
      <span class="param-key">${_esc(key)}</span>
    </label>`;
  }
  if (typeof val === 'number') {
    const isInt = Number.isInteger(val);
    return `<div class="param-field" data-key="${_esc(key)}" data-type="${isInt ? 'int' : 'float'}">
      <span class="param-key">${_esc(key)}</span>
      <input type="number" value="${val}" step="${isInt ? '1' : 'any'}" class="param-input param-num">
    </div>`;
  }
  if (typeof val === 'string') {
    return `<div class="param-field" data-key="${_esc(key)}" data-type="string">
      <span class="param-key">${_esc(key)}</span>
      <input type="text" value="${_esc(val)}" class="param-input param-text">
    </div>`;
  }
  if (Array.isArray(val)) {
    if (val.length === 0 || val.every(v => typeof v === 'number')) {
      return `<div class="param-field" data-key="${_esc(key)}" data-type="list_num">
        <span class="param-key">${_esc(key)}</span>
        <input type="text" value="${val.join(', ')}" class="param-input param-text" placeholder="e.g. 50, 200">
      </div>`;
    }
    // Complex array (list of dicts, etc.) → JSON textarea
    return `<div class="param-field param-wide" data-key="${_esc(key)}" data-type="json">
      <span class="param-key">${_esc(key)}</span>
      <textarea class="param-input param-json">${_esc(JSON.stringify(val, null, 2))}</textarea>
    </div>`;
  }
  if (typeof val === 'object') {
    return `<div class="param-group" data-key="${_esc(key)}" data-type="object">
      <div class="param-group-head">
        <span class="param-group-arrow">▾</span>${_esc(key)}
      </div>
      <div class="param-group-body">${_renderParamTree(val)}</div>
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
      const input = child.querySelector('input, textarea');
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
        case 'json':
        case 'null':
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
  document.getElementById('btn-delete-config').addEventListener('click', _deleteConfig);
  document.getElementById('btn-save').addEventListener('click', _saveConfig);
  document.getElementById('btn-compute').addEventListener('click', _startCompute);
  document.getElementById('btn-compute-cancel').addEventListener('click', () => {
    fetch('/api/jobs/indicators/cancel', { method: 'POST' });
  });

  for (const tab of document.querySelectorAll('.tf-tab')) {
    tab.addEventListener('click', () => _switchTf(tab.dataset.tf));
  }

  const searchEl = document.getElementById('ind-search');
  searchEl.addEventListener('input', e => {
    _searchQuery = e.target.value.trim().toLowerCase();
    _renderIndicatorList();
  });
  searchEl.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      e.preventDefault();
      searchEl.value = '';
      _searchQuery = '';
      _renderIndicatorList();
      searchEl.blur();
    }
  });
}

function _updateRunConfigLabel() {
  const el = document.getElementById('run-config-name');
  if (!el) return;
  el.textContent = _configData?.name || 'No config selected';
}

function _wireListEvents() {
  const list = document.getElementById('ind-list');

  list.addEventListener('change', e => {
    if (e.target.classList.contains('ind-toggle')) _onToggle(e.target);
    _dirty = true;
  });

  list.addEventListener('input', () => { _dirty = true; });

  list.addEventListener('click', e => {
    // Toggle card body open/close via header click (but not on the checkbox)
    const head = e.target.closest('.ind-card-head');
    if (head && !e.target.closest('.ind-toggle-wrap')) {
      const card = head.closest('.ind-card');
      const body = card.querySelector('.ind-card-body');
      if (body) {
        body.classList.toggle('collapsed');
        const arrow = card.querySelector('.ind-expand-arrow');
        if (arrow) arrow.textContent = body.classList.contains('collapsed') ? '▸' : '▾';
      }
    }
    // Toggle nested param group
    const gh = e.target.closest('.param-group-head');
    if (gh) {
      const group = gh.closest('.param-group');
      group.classList.toggle('collapsed');
    }
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
    const params = _pending[_activeTf]?.[ind]
      ?? _configData?.indicators?.[_activeTf]?.[ind]
      ?? _defaults?.defaults?.[_activeTf]?.[ind]
      ?? {};
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
  const res = await fetch('/api/ind-configs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'New config' }),
  });
  const created = await res.json();
  _configList.push(created);
  _renderConfigList();
  await _selectConfig(created.id);
}

async function _deleteConfig() {
  if (!_selectedId) return;
  const name = _configData?.name || 'this config';
  if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;
  await fetch(`/api/ind-configs/${_selectedId}`, { method: 'DELETE' });
  _configList = _configList.filter(c => c.id !== _selectedId);
  _selectedId = null;
  _configData = null;
  _pending    = {};
  _renderConfigList();
  if (_configList.length) {
    await _selectConfig(_configList[0].id);
  } else {
    _showEmpty(true);
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

  const res = await fetch(`/api/ind-configs/${_selectedId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, indicators }),
  });

  btn.disabled = false;

  if (res.ok) {
    _dirty   = false;
    _pending = {};
    await _loadConfig(_selectedId);
    const item = _configList.find(c => c.id === _selectedId);
    if (item) item.name = name;
    _renderConfigList();
    btn.textContent = 'Saved ✓';
    btn.classList.add('ind-btn-save-ok');
    setTimeout(() => { btn.textContent = 'Save'; btn.classList.remove('ind-btn-save-ok'); }, 1800);
  } else {
    btn.textContent = 'Failed ✗';
    btn.classList.add('ind-btn-save-err');
    setTimeout(() => { btn.textContent = 'Save'; btn.classList.remove('ind-btn-save-err'); }, 2000);
  }
}

// ── Compute ────────────────────────────────────────────────────

function _buildTimeframeChecks() {
  const wrap = document.getElementById('compute-tfs');
  wrap.innerHTML = '';
  for (const tf of ALL_TIMEFRAMES) {
    const lbl = document.createElement('label');
    lbl.innerHTML = `<input type="checkbox" value="${tf}"${tf === 'daily' ? ' checked' : ''}> ${tf}`;
    wrap.appendChild(lbl);
  }
}

function _getCheckedTfs() {
  return [...document.querySelectorAll('#compute-tfs input:checked')].map(el => el.value);
}

async function _startCompute() {
  if (!_selectedId) return;
  const timeframes = _getCheckedTfs();
  if (!timeframes.length) { alert('Select at least one timeframe.'); return; }

  const res = await fetch('/api/indicators/batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ config_id: _selectedId, timeframes }),
  });
  if (!res.ok) {
    const err = await res.json();
    alert(err.detail || 'Failed to start compute job');
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
  const status = await fetch('/api/jobs/status').then(r => r.json());
  _updateProgress(status.indicators);
  if (status.indicators.status !== 'running') _stopPolling();
}

function _updateProgress(state) {
  const track     = document.getElementById('comp-track');
  const bar       = document.getElementById('comp-bar');
  const meta      = document.getElementById('comp-meta');
  const count     = document.getElementById('comp-count');
  const pctEl     = document.getElementById('comp-pct');
  const errorsEl  = document.getElementById('comp-errors');
  const btn       = document.getElementById('btn-compute');
  const btnCancel = document.getElementById('btn-compute-cancel');

  const pct = state.total > 0 ? (state.done / state.total * 100) : 0;
  bar.style.width = `${pct}%`;

  const _setActive = on => {
    track.classList.toggle('active', on);
    bar.classList.toggle('active', on);
    meta.classList.toggle('active', on);
  };

  if (state.status === 'idle') {
    _setActive(false);
    count.textContent = pctEl.textContent = errorsEl.textContent = '';
    btn.disabled = false;
    btnCancel.style.display = 'none';
  } else if (state.status === 'running') {
    _setActive(true);
    count.textContent    = `${state.done} / ${state.total}`;
    pctEl.textContent    = `${Math.round(pct)}%`;
    errorsEl.textContent = state.errors > 0 ? `✗ ${state.errors}` : '';
    btn.disabled = true;
    btnCancel.style.display = '';
  } else if (state.status === 'done') {
    _setActive(false);
    count.textContent    = `${state.done} / ${state.total}`;
    pctEl.textContent    = '100%';
    errorsEl.textContent = state.errors > 0
      ? `✗ ${state.errors} error${state.errors !== 1 ? 's' : ''}`
      : '✓ complete';
    btn.disabled = false;
    btnCancel.style.display = 'none';
  } else if (state.status === 'cancelled') {
    _setActive(false);
    count.textContent    = `${state.done} / ${state.total}`;
    pctEl.textContent    = `${Math.round(pct)}% — cancelled`;
    errorsEl.textContent = state.errors > 0 ? `✗ ${state.errors} error${state.errors !== 1 ? 's' : ''}` : '';
    btn.disabled = false;
    btnCancel.style.display = 'none';
  } else if (state.status === 'error') {
    _setActive(false);
    count.textContent = 'failed';
    pctEl.textContent = errorsEl.textContent = '';
    btn.disabled = false;
    btnCancel.style.display = 'none';
  }

  _renderLog(state.log || []);
}

function _renderLog(entries) {
  const el = document.getElementById('comp-log');
  if (!entries.length) { el.innerHTML = ''; return; }
  el.innerHTML = [...entries].reverse().map(e =>
    `<div class="ind-log-row${e.ok ? '' : ' ind-log-err'}">
      <span class="ind-log-sym">${_esc(e.ticker)}</span>
      <span class="ind-log-tf">${_esc(e.detail)}</span>
      <span class="ind-log-status">${e.ok ? '✓' : '✗'}</span>
    </div>`
  ).join('');
}

// ── Utilities ──────────────────────────────────────────────────

function _esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

document.addEventListener('keydown', e => {
  if (e.key === '`') { e.preventDefault(); window.location.href = '/'; }
});

init();
