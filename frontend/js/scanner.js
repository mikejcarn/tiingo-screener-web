import { api }       from './api.js';
import { initHelp }  from './help.js';
import { initTheme } from './theme.js';

// ── State ─────────────────────────────────────────────────────
let _configs     = [];
let _criteria    = [];
let _confs       = [];
let _timeframes  = [];
let _activeId    = null;
let _dirty       = false;
let _lastResults = null;
// { criteria_name: [{timeframe, params}, ...] }
let _instances   = {};
let _focusedIdx  = -1;

// ── Init ──────────────────────────────────────────────────────
(async function init() {
  initTheme();
  initHelp('scanner');
  const [tickerData, criteriaData] = await Promise.all([
    api.get('/api/tickers'),
    api.get('/api/criteria'),
  ]);
  _confs      = tickerData.ind_confs  || [];
  _timeframes = tickerData.timeframes || [];
  _criteria   = criteriaData.criteria || [];
  _populateIndConfs();
  _wireGlobal();
  await Promise.all([_loadConfigs(), _loadHistory()]);
})();

function _populateIndConfs() {
  const sel = document.getElementById('scan-ind-conf');
  sel.innerHTML = '<option value="">— select —</option>';
  for (const c of _confs) {
    const o = document.createElement('option');
    o.value = c.id; o.textContent = c.name;
    sel.appendChild(o);
  }
}

// ── Config list ───────────────────────────────────────────────
async function _loadConfigs() {
  const data = await api.get('/api/scan-configs');
  _configs = data.configs || [];
  _renderList();
  if (_activeId && _configs.find(c => c.id === _activeId)) {
    await _selectConfig(_activeId);
  } else if (_configs.length) {
    await _selectConfig(_configs[0].id);
  } else {
    _showEmpty(true);
  }
}

function _renderList() {
  const el = document.getElementById('scan-list');
  if (!_configs.length) { el.innerHTML = '<div class="ind-loading">No scans yet.</div>'; return; }
  el.innerHTML = '';
  for (const cfg of _configs) {
    const item = document.createElement('div');
    item.className = 'ind-config-item' + (cfg.id === _activeId ? ' active' : '');
    item.dataset.id = cfg.id;

    const info = document.createElement('div');
    info.className = 'ind-config-info';

    const name = document.createElement('div');
    name.className = 'ind-config-name';
    name.textContent = cfg.name;

    const sub = document.createElement('div');
    sub.className = 'ind-config-date';
    sub.textContent = (cfg.logic || 'AND').toLowerCase();

    info.append(name, sub);
    item.appendChild(info);
    item.addEventListener('click', () => _selectConfig(cfg.id));
    el.appendChild(item);
  }
}

async function _selectConfig(id) {
  if (_dirty && _activeId && !confirm('Discard unsaved changes?')) return;
  _activeId = id; _dirty = false; _focusedIdx = -1;
  _renderList();
  const cfg = await api.get(`/api/scan-configs/${id}`);
  _showEmpty(false);
  document.getElementById('scan-name').value     = cfg.name;
  document.getElementById('scan-logic').value    = cfg.logic || 'AND';
  document.getElementById('scan-ind-conf').value = cfg.ind_conf_id || '';
  _loadInstances(cfg.criteria || []);
  _clearResults();
}

function _showEmpty(yes) {
  document.getElementById('scan-empty').style.display  = yes ? 'flex' : 'none';
  document.getElementById('scan-editor').style.display = yes ? 'none' : 'flex';
}

// ── Instances state ───────────────────────────────────────────
function _loadInstances(entries) {
  _instances = {};
  for (const e of entries) {
    if (!_instances[e.criteria_name]) _instances[e.criteria_name] = [];
    _instances[e.criteria_name].push({
      timeframe: e.timeframe,
      params:    { ...(e.params || {}) },
    });
  }
  _rebuildCards();
}

// ── Cards ─────────────────────────────────────────────────────
function _rebuildCards() {
  const list  = document.getElementById('scan-criteria-list');
  const noMsg = document.getElementById('scan-no-crit');
  list.innerHTML = '';
  if (!_criteria.length) { noMsg.style.display = 'block'; return; }
  noMsg.style.display = 'none';
  _criteria.forEach((crit, idx) => list.appendChild(_buildCard(crit, idx)));
  _syncFocus();
}

function _buildCard(crit, idx) {
  const isEnabled = !!(_instances[crit.name]?.length);

  const card = document.createElement('div');
  card.className = 'ind-card scan-crit-card' + (isEnabled ? ' enabled' : '');
  card.dataset.idx = idx;

  // ── Head ──────────────────────────────────────────────────
  const head = document.createElement('div');
  head.className = 'ind-card-head';

  const cbxWrap = document.createElement('div');
  cbxWrap.className = 'ind-toggle-wrap';
  const cbx = document.createElement('input');
  cbx.type = 'checkbox'; cbx.className = 'param-checkbox'; cbx.checked = isEnabled;
  cbxWrap.appendChild(cbx);

  const nameSpan = document.createElement('span');
  nameSpan.className = 'ind-name';
  nameSpan.textContent = crit.display_name || crit.name;

  const countBadge = document.createElement('span');
  countBadge.className = 'scan-count-badge';
  const n0 = _instances[crit.name]?.length || 0;
  countBadge.textContent = n0 > 1 ? `×${n0}` : '';

  const arrow = document.createElement('span');
  arrow.className = 'ind-expand-arrow';
  arrow.textContent = '▸';

  head.append(cbxWrap, nameSpan, countBadge, arrow);
  card.appendChild(head);

  // ── Body ──────────────────────────────────────────────────
  const body = document.createElement('div');
  body.className = 'ind-card-body collapsed';
  card.appendChild(body);

  _renderBody(crit, body, cbx, countBadge, arrow, card);

  // Checkbox: enable/disable
  cbx.addEventListener('change', () => {
    if (cbx.checked) {
      if (!_instances[crit.name]?.length) {
        _instances[crit.name] = [{ timeframe: _timeframes[0] || 'daily', params: {} }];
      }
      card.classList.add('enabled');
      body.classList.remove('collapsed');
      arrow.textContent = '▾';
    } else {
      delete _instances[crit.name];
      card.classList.remove('enabled');
      body.classList.add('collapsed');
      arrow.textContent = '▸';
    }
    _renderBody(crit, body, cbx, countBadge, arrow, card);
    _markDirty();
  });

  // Head click: expand/collapse
  head.addEventListener('click', e => {
    if (cbxWrap.contains(e.target)) return;
    _setCritFocus(idx);
    body.classList.toggle('collapsed');
    arrow.textContent = body.classList.contains('collapsed') ? '▸' : '▾';
  });

  card._collect = () =>
    (_instances[crit.name] || []).map(inst => ({
      criteria_name: crit.name,
      timeframe:     inst.timeframe,
      params:        { ...inst.params },
    }));

  return card;
}

// Re-renders only the body content; keeps head intact
function _renderBody(crit, body, cbx, countBadge, arrow, card) {
  body.innerHTML = '';
  const instances = _instances[crit.name] || [];
  const multi = instances.length > 1;

  countBadge.textContent = multi ? `×${instances.length}` : '';

  instances.forEach((inst, iIdx) => {
    const block = document.createElement('div');
    block.className = 'scan-instance' + (multi ? ' scan-instance-multi' : '');

    // Timeframe row + ✕ remove
    const tfRow = document.createElement('div');
    tfRow.className = 'scan-instance-head';

    const tfLabel = document.createElement('span');
    tfLabel.className = 'param-key'; tfLabel.textContent = 'Timeframe';

    const tfSel = document.createElement('select');
    tfSel.className = 'param-input scan-crit-tf';
    for (const tf of _timeframes) {
      const o = document.createElement('option');
      o.value = tf; o.textContent = tf;
      o.selected = tf === inst.timeframe;
      tfSel.appendChild(o);
    }
    tfSel.addEventListener('change', () => { inst.timeframe = tfSel.value; _markDirty(); });

    const removeBtn = document.createElement('button');
    removeBtn.className = 'scan-instance-remove btn-destructive';
    removeBtn.title = 'Remove this instance';
    removeBtn.textContent = '✕';
    removeBtn.addEventListener('click', () => {
      _instances[crit.name].splice(iIdx, 1);
      if (!_instances[crit.name].length) {
        delete _instances[crit.name];
        cbx.checked = false;
        card.classList.remove('enabled');
        body.classList.add('collapsed');
        arrow.textContent = '▸';
      }
      _markDirty();
      _renderBody(crit, body, cbx, countBadge, arrow, card);
    });

    tfRow.append(tfLabel, tfSel, removeBtn);
    block.appendChild(tfRow);

    // Param fields — live-update inst.params
    _renderParamFields(crit.param_schema, inst.params, block);

    body.appendChild(block);
  });

  // + Add instance button
  if (instances.length > 0) {
    const addBtn = document.createElement('button');
    addBtn.className = 'scan-add-instance';
    addBtn.textContent = '+ Add instance';
    addBtn.addEventListener('click', () => {
      _instances[crit.name].push({ timeframe: _timeframes[0] || 'daily', params: {} });
      _markDirty();
      _renderBody(crit, body, cbx, countBadge, arrow, card);
    });
    body.appendChild(addBtn);
  }
}

function _renderParamFields(schema, params, container) {
  if (!schema || !Object.keys(schema).length) return;
  for (const [key, s] of Object.entries(schema)) {
    const wrap = document.createElement('div');
    wrap.className = 'param-field';
    const lbl = document.createElement('span');
    lbl.className = 'param-key'; lbl.textContent = s.label || key;
    wrap.appendChild(lbl);

    const val = params?.[key] ?? s.default;
    let inp;

    if (s.type === 'select') {
      inp = document.createElement('select');
      inp.className = 'param-input';
      for (const opt of (s.options || [])) {
        const o = document.createElement('option');
        o.value = opt; o.textContent = opt;
        o.selected = String(opt) === String(val);
        inp.appendChild(o);
      }
    } else if (s.type === 'bool') {
      inp = document.createElement('input');
      inp.type = 'checkbox'; inp.className = 'param-checkbox'; inp.checked = val === true || val === 'true';
    } else if (s.type === 'list_int' || s.type === 'list_str') {
      inp = document.createElement('input');
      inp.type = 'text'; inp.className = 'param-input';
      inp.value = Array.isArray(val) ? val.join(', ') : String(val ?? '');
      inp.placeholder = s.type === 'list_int' ? 'e.g. 50, 20, 10' : 'e.g. OBV, VI';
    } else {
      inp = document.createElement('input');
      inp.type = 'number'; inp.className = 'param-input param-num';
      inp.value = val ?? '';
      if (s.min !== undefined) inp.min = s.min;
      if (s.max !== undefined) inp.max = s.max;
      if (s.type === 'int') inp.step = '1';
    }

    // Live-write back to the params object so _collect() never needs to read DOM
    inp.addEventListener('change', () => {
      const t = s.type;
      if (t === 'bool')          params[key] = inp.checked;
      else if (t === 'list_int') params[key] = inp.value.split(',').map(v => parseInt(v.trim())).filter(n => !isNaN(n));
      else if (t === 'list_str') params[key] = inp.value.split(',').map(v => v.trim()).filter(Boolean);
      else if (t === 'int')      { const v = parseInt(inp.value);   params[key] = isNaN(v) ? null : v; }
      else if (t === 'number')   { const v = parseFloat(inp.value); params[key] = isNaN(v) ? null : v; }
      else                       params[key] = inp.value;
      _markDirty();
    });

    wrap.appendChild(inp);
    container.appendChild(wrap);
  }
}

// ── Keyboard focus ────────────────────────────────────────────
function _setCritFocus(idx) { _focusedIdx = idx; _syncFocus(); }

function _syncFocus() {
  document.querySelectorAll('.scan-crit-card').forEach((card, i) => {
    card.classList.toggle('kb-focused', i === _focusedIdx);
    if (i === _focusedIdx) card.scrollIntoView({ block: 'nearest' });
  });
}

function _moveCritFocus(dir) {
  const cards = document.querySelectorAll('.scan-crit-card');
  if (!cards.length) return;
  _focusedIdx = (_focusedIdx + dir + cards.length) % cards.length;
  _syncFocus();
}

function _toggleFocusedCard() {
  const card = document.querySelector('.scan-crit-card.kb-focused');
  if (!card) return;
  const body  = card.querySelector('.ind-card-body');
  const arrow = card.querySelector('.ind-expand-arrow');
  body.classList.toggle('collapsed');
  arrow.textContent = body.classList.contains('collapsed') ? '▸' : '▾';
}

function _toggleFocusedCheck() {
  const card = document.querySelector('.scan-crit-card.kb-focused');
  if (!card) return;
  const cbx = card.querySelector('.param-checkbox');
  if (cbx) { cbx.checked = !cbx.checked; cbx.dispatchEvent(new Event('change')); }
}

// ── Collect ───────────────────────────────────────────────────
function _collectAllEntries() {
  return Array.from(document.querySelectorAll('.scan-crit-card'))
    .flatMap(card => card._collect?.() || []);
}

// ── Save ──────────────────────────────────────────────────────
async function _saveScan() {
  if (!_activeId) return;
  const body = {
    name:        document.getElementById('scan-name').value.trim() || 'Unnamed',
    logic:       document.getElementById('scan-logic').value,
    ind_conf_id: parseInt(document.getElementById('scan-ind-conf').value) || null,
    criteria:    _collectAllEntries(),
  };
  await api.put(`/api/scan-configs/${_activeId}`, body);
  _dirty = false;
  const listData = await api.get('/api/scan-configs');
  _configs = listData.configs || [];
  _renderList();
}

// ── Run ───────────────────────────────────────────────────────
async function _runScan() {
  if (!_activeId) return;
  if (_dirty) await _saveScan();
  const statusEl  = document.getElementById('scan-run-status');
  const summaryEl = document.getElementById('scan-run-summary');
  statusEl.textContent  = 'Running…';
  summaryEl.textContent = '';
  _clearResults();
  try {
    const data = await api.post('/api/scan/run', { config_id: _activeId });
    _lastResults = data.results || [];
    statusEl.textContent  = '';
    summaryEl.textContent = `${data.count} of ${data.total ?? '?'} matched`;
    _renderResults(data);
    _loadHistory();
  } catch (e) {
    statusEl.textContent  = e.message || 'Error running scan';
    summaryEl.textContent = '';
  }
}

function _clearResults() {
  document.getElementById('scan-results-label').textContent  = '';
  document.getElementById('scan-results-empty').style.display = 'flex';
  document.getElementById('scan-table-wrap').style.display    = 'none';
  document.getElementById('btn-open-chart').style.display     = 'none';
  document.getElementById('scan-table').innerHTML             = '';
}

function _renderResults(data) {
  const results = data.results || [];
  const label   = document.getElementById('scan-results-label');
  const table   = document.getElementById('scan-table');
  const wrap    = document.getElementById('scan-table-wrap');
  const empty   = document.getElementById('scan-results-empty');

  label.textContent = `— ${data.count} ticker${data.count === 1 ? '' : 's'}`;
  document.getElementById('btn-open-chart').style.display = results.length ? '' : 'none';

  if (!results.length) {
    empty.textContent    = 'No tickers matched.';
    empty.style.display  = 'flex';
    wrap.style.display   = 'none';
    return;
  }

  empty.style.display = 'none';
  wrap.style.display  = 'block';

  const sigKeys = [...new Set(results.flatMap(r => Object.keys(r.signals || {})))];
  let sortCol = 'ticker', sortAsc = true;

  const thead = document.createElement('thead');
  thead.innerHTML = '<tr>' +
    ['ticker', 'date'].map(c => `<th class="scan-th scan-th-sort" data-col="${c}">${c}</th>`).join('') +
    sigKeys.map(k => `<th class="scan-th">${k.replace(/_/g, ' ')}</th>`).join('') + '</tr>';

  const tbody = document.createElement('tbody');
  function _rebuild() {
    const sorted = [...results].sort((a, b) => {
      const av = sortCol === 'date' ? a.date : a.ticker;
      const bv = sortCol === 'date' ? b.date : b.ticker;
      return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
    });
    tbody.innerHTML = '';
    for (const r of sorted) {
      const tr = document.createElement('tr');
      tr.className = 'scan-result-row';
      tr.innerHTML =
        `<td class="scan-ticker">${r.ticker}</td><td>${r.date || ''}</td>` +
        sigKeys.map(k => {
          const sig = r.signals?.[k];
          return `<td class="scan-signal-cell">${sig?.Signal ?? (sig ? '✓' : '—')}</td>`;
        }).join('');
      tr.addEventListener('click', () => _openTicker(r.ticker));
      tbody.appendChild(tr);
    }
  }

  table.innerHTML = '';
  table.append(thead, tbody);
  thead.querySelectorAll('.scan-th-sort').forEach(th => {
    th.style.cursor = 'pointer';
    th.addEventListener('click', () => {
      if (sortCol === th.dataset.col) sortAsc = !sortAsc;
      else { sortCol = th.dataset.col; sortAsc = true; }
      _rebuild();
    });
  });
  _rebuild();
}

async function _loadHistory() {
  const data = await api.get('/api/scan/history');
  const tbody = document.getElementById('scan-history-body');
  const rows  = data.history || [];
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="stats-empty">No history yet.</td></tr>';
    return;
  }
  tbody.innerHTML = rows.map(r =>
    `<tr>
      <td>${r.config_name}</td>
      <td>${r.matched}</td>
      <td>${r.total}</td>
      <td>${r.ran_at}</td>
    </tr>`
  ).join('');
}

function _openTicker(ticker) {
  if (!_lastResults) return;
  try {
    localStorage.setItem('scan_tickers', JSON.stringify(_lastResults.map(r => r.ticker)));
    localStorage.setItem('scan_label', document.getElementById('scan-name').value.trim() || 'Scan Results');
  } catch {}
  window.location.href = `/?ticker=${encodeURIComponent(ticker)}&from_scan=1`;
}

function _markDirty() { _dirty = true; }

// ── Wiring ────────────────────────────────────────────────────
function _wireGlobal() {
  document.getElementById('btn-new-scan').addEventListener('click', async () => {
    const cfg = await api.post('/api/scan-configs');
    _activeId = cfg.id; _dirty = false;
    await _loadConfigs();
  });

  document.getElementById('btn-save-scan').addEventListener('click', _saveScan);

  document.getElementById('btn-delete-scan').addEventListener('click', async () => {
    if (!_activeId || !confirm('Delete this scan?')) return;
    await api.del(`/api/scan-configs/${_activeId}`);
    _activeId = null; _dirty = false;
    await _loadConfigs();
  });

  document.getElementById('btn-run-scan').addEventListener('click', _runScan);
  document.getElementById('btn-open-chart').addEventListener('click', () => {
    if (_lastResults?.length) _openTicker(_lastResults[0].ticker);
  });

  document.getElementById('scan-name').addEventListener('input', _markDirty);
  document.getElementById('scan-logic').addEventListener('change', _markDirty);
  document.getElementById('scan-ind-conf').addEventListener('change', _markDirty);

  document.addEventListener('keydown', e => {
    const tag     = document.activeElement?.tagName;
    const ctrl    = e.ctrlKey || e.metaKey;
    const inInput = tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA';

    if (e.key === '`') { e.preventDefault(); window.location.href = '/fetch'; return; }
    if (e.key === '~') { e.preventDefault(); window.location.href = '/indicators'; return; }

    if (inInput) return;

    if (e.key === 'N' && !ctrl) { e.preventDefault(); document.getElementById('btn-new-scan').click(); }
    if (e.key === 'S' && !ctrl) { e.preventDefault(); _saveScan(); }
    if (e.key === 'D' && !ctrl) { e.preventDefault(); document.getElementById('btn-delete-scan').click(); }
    if (e.key === 'R' && !ctrl) { e.preventDefault(); _runScan(); }
    if (e.key === 'T' && !ctrl) { e.preventDefault(); window.location.href = '/fetch'; }
    if (e.key === 'I' && !ctrl) { e.preventDefault(); window.location.href = '/indicators'; }
    if (e.key === 'C' && !ctrl) { e.preventDefault(); window.location.href = '/'; }
    if (e.key === 'A' && !ctrl) { e.preventDefault(); window.location.href = '/scanner'; }

    if (e.key === '=') {
      const i = _configs.findIndex(c => c.id === _activeId);
      if (i > 0) _selectConfig(_configs[i - 1].id);
    }
    if (e.key === '-') {
      const i = _configs.findIndex(c => c.id === _activeId);
      if (i >= 0 && i < _configs.length - 1) _selectConfig(_configs[i + 1].id);
    }

    if (e.key === 'ArrowUp')   { e.preventDefault(); _moveCritFocus(-1); }
    if (e.key === 'ArrowDown') { e.preventDefault(); _moveCritFocus(1); }
    if (e.key === 'Enter')     { e.preventDefault(); _toggleFocusedCard(); }
    if (e.key === ' ')         { e.preventDefault(); _toggleFocusedCheck(); }
  });
}
