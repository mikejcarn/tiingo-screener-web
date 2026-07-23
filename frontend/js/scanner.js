import { api }       from './api.js';
import { initHelp }  from './help.js';
import { initTheme } from './theme.js';

// ── State ─────────────────────────────────────────────────────
let _configs    = [];
let _criteria   = [];
let _confs      = [];
let _timeframes = [];
let _activeId   = null;
let _dirty      = false;
let _lastResults = null;
let _activeTf   = '';
// _enabled[tf]  = Set<criteria_name>
// _params[tf][criteria_name] = {key: val}  (persisted even when unchecked)
// _critLogic[criteria_name]  = 'AND' | 'OR'
let _enabled      = {};
let _params       = {};
let _critLogic    = {};
let _compatibility = {};   // { criteria_name: true | false | null }
let _focusedIdx   = -1;

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
  _activeTf   = _timeframes[0] || 'daily';
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

// ── Timeframe tabs ────────────────────────────────────────────
function _buildTfTabs() {
  const container = document.getElementById('scan-tf-tabs');
  container.innerHTML = '';
  for (const tf of _timeframes) {
    const btn = document.createElement('button');
    btn.className   = 'tf-tab' + (tf === _activeTf ? ' active' : '');
    btn.dataset.tf  = tf;
    btn.textContent = tf;
    btn.addEventListener('click', () => _setActiveTf(tf));
    container.appendChild(btn);
  }
  const hint = document.createElement('span');
  hint.className   = 'scan-tf-hint';
  hint.textContent = 'tabs reflect fetched timeframes';
  hint.title       = 'Fetch additional timeframes on the Tickers page to add more tabs here.';
  container.appendChild(hint);
}

function _setActiveTf(tf) {
  _activeTf = tf;
  document.querySelectorAll('#scan-tf-tabs .tf-tab').forEach(b =>
    b.classList.toggle('active', b.dataset.tf === tf)
  );
  document.querySelectorAll('.scan-crit-card').forEach(card => card._update?.(tf));
  const indConfId = parseInt(document.getElementById('scan-ind-conf')?.value) || 0;
  _checkCompat(indConfId, tf);
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
    name.className = 'ind-config-name'; name.textContent = cfg.name;
    const sub = document.createElement('div');
    sub.className = 'ind-config-date'; sub.textContent = cfg.updated_at ? cfg.updated_at.slice(0, 10) : '';
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
  document.getElementById('scan-ind-conf').value = cfg.ind_conf_id || '';
  const created = (cfg.created_at || '').slice(0, 10);
  const updated = (cfg.updated_at || '').slice(0, 10);
  const datesEl = document.getElementById('scan-conf-dates');
  if (updated && updated !== created) {
    datesEl.textContent = `created ${created} · updated ${updated}`;
  } else if (created) {
    datesEl.textContent = `created ${created}`;
  } else {
    datesEl.textContent = '';
  }
  _loadFromConfig(cfg.criteria || []);
  _clearResults();
  const indConfId = parseInt(document.getElementById('scan-ind-conf').value) || 0;
  _checkCompat(indConfId, _activeTf);
}

function _showEmpty(yes) {
  document.getElementById('scan-empty').style.display  = yes ? 'flex' : 'none';
  document.getElementById('scan-editor').style.display = yes ? 'none' : 'flex';
}

// ── Load criteria state from config ──────────────────────────
function _loadFromConfig(entries) {
  _enabled   = {};
  _params    = {};
  _critLogic = {};
  for (const e of entries) {
    const { criteria_name, timeframe: tf, params, logic } = e;
    if (!_enabled[tf]) _enabled[tf] = new Set();
    _enabled[tf].add(criteria_name);
    if (!_params[tf])  _params[tf]  = {};
    _params[tf][criteria_name] = { ...(params || {}) };
    _critLogic[criteria_name]  = logic || 'AND';
  }
  _buildTfTabs();
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
  _updateCompatBadges();
  _syncFocus();
}

function _updateCompatBadges() {
  document.querySelectorAll('.scan-crit-card').forEach(card => {
    const badge = card.querySelector('.scan-compat-badge');
    if (!badge) return;
    const ok = _compatibility[card.dataset.name];
    badge.textContent   = ok === true ? '✓' : '';
    badge.title         = ok === true ? 'Indicator data available' : ok === false ? 'Indicator data missing' : '';
    badge.dataset.state = ok === true ? 'ok' : ok === false ? 'miss' : '';
  });
}

async function _checkCompat(indConfId, tf) {
  if (!indConfId || !tf) { _compatibility = {}; _updateCompatBadges(); return; }
  try {
    const data = await api.get(`/api/criteria/check/${indConfId}?timeframe=${tf}`);
    _compatibility = data.compatibility || {};
  } catch {
    _compatibility = {};
  }
  _updateCompatBadges();
}

function _buildCard(crit, idx) {
  const card = document.createElement('div');
  card.className = 'ind-card scan-crit-card';
  card.dataset.idx  = idx;
  card.dataset.name = crit.name;

  // ── Head ──────────────────────────────────────────────────
  const head = document.createElement('div');
  head.className = 'ind-card-head';

  const cbxWrap = document.createElement('div');
  cbxWrap.className = 'ind-toggle-wrap';
  const cbx = document.createElement('input');
  cbx.type = 'checkbox'; cbx.className = 'param-checkbox';
  cbxWrap.appendChild(cbx);

  const nameWrap = document.createElement('div');
  nameWrap.className = 'scan-name-wrap';

  const nameSpan = document.createElement('span');
  nameSpan.className = 'ind-name';
  nameSpan.textContent = crit.display_name || crit.name;

  const compatBadge = document.createElement('span');
  compatBadge.className = 'scan-compat-badge';

  nameWrap.append(nameSpan, compatBadge);

  const countBadge = document.createElement('span');
  countBadge.className = 'scan-count-badge';

  const logicToggle = document.createElement('button');
  logicToggle.className = 'scan-logic-toggle';
  const _updateToggle = () => {
    const l = _critLogic[crit.name] || 'AND';
    logicToggle.textContent = l;
    logicToggle.classList.toggle('or', l === 'OR');
  };
  _updateToggle();
  logicToggle.addEventListener('click', e => {
    e.stopPropagation();
    _critLogic[crit.name] = (_critLogic[crit.name] || 'AND') === 'AND' ? 'OR' : 'AND';
    _updateToggle();
    _markDirty();
  });

  const arrow = document.createElement('span');
  arrow.className = 'ind-expand-arrow'; arrow.textContent = '▸';

  head.append(cbxWrap, logicToggle, nameWrap, countBadge, arrow);
  card.appendChild(head);

  // ── Body ──────────────────────────────────────────────────
  const body = document.createElement('div');
  body.className = 'ind-card-body collapsed';
  card.appendChild(body);

  // ── Helpers ────────────────────────────────────────────────
  function _getParams(tf) {
    if (!_params[tf])              _params[tf]              = {};
    if (!_params[tf][crit.name])   _params[tf][crit.name]   = {};
    return _params[tf][crit.name];
  }

  function _isEnabled(tf) {
    return !!(_enabled[tf]?.has(crit.name));
  }

  function _tfCount() {
    return Object.values(_enabled).filter(s => s.has(crit.name)).length;
  }

  function _refreshHead(tf) {
    const en = _isEnabled(tf);
    cbx.checked = en;
    card.classList.toggle('enabled', en);
    const n = _tfCount();
    countBadge.textContent = n > 1 ? `×${n}` : '';
  }

  function _refreshBody(tf) {
    body.innerHTML = '';
    _renderParamFields(crit.param_schema, _getParams(tf), body);
  }

  // ── card._update — called on tab switch ───────────────────
  card._update = (tf) => {
    _refreshHead(tf);
    _refreshBody(tf);
  };

  // Initial render for _activeTf
  _refreshHead(_activeTf);
  _refreshBody(_activeTf);

  // ── Checkbox ──────────────────────────────────────────────
  cbx.addEventListener('change', () => {
    const tf = _activeTf;
    if (cbx.checked) {
      if (!_enabled[tf]) _enabled[tf] = new Set();
      _enabled[tf].add(crit.name);
      card.classList.add('enabled');
    } else {
      _enabled[tf]?.delete(crit.name);
      card.classList.remove('enabled');
    }
    const n = _tfCount();
    countBadge.textContent = n > 1 ? `×${n}` : '';
    _markDirty();
  });

  // ── Head click: expand/collapse ───────────────────────────
  head.addEventListener('click', e => {
    if (cbxWrap.contains(e.target)) return;
    _setCritFocus(idx);
    body.classList.toggle('collapsed');
    arrow.textContent = body.classList.contains('collapsed') ? '▸' : '▾';
  });

  // ── Collect for save ──────────────────────────────────────
  card._collect = () => {
    const logic = _critLogic[crit.name] || 'AND';
    const results = [];
    for (const [tf, names] of Object.entries(_enabled)) {
      if (names.has(crit.name)) {
        results.push({
          criteria_name: crit.name,
          timeframe:     tf,
          logic,
          params:        { ...(_params[tf]?.[crit.name] || {}) },
        });
      }
    }
    return results;
  };

  return card;
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
      inp.type = 'checkbox'; inp.className = 'param-checkbox';
      inp.checked = val === true || val === 'true';
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
  const btn = document.getElementById('btn-save-scan');
  const body = {
    name:        document.getElementById('scan-name').value.trim() || 'Unnamed',
    logic:       'AND',
    ind_conf_id: parseInt(document.getElementById('scan-ind-conf').value) || null,
    criteria:    _collectAllEntries(),
  };
  try {
    const saved = await api.put(`/api/scan-configs/${_activeId}`, body);
    _dirty = false;
    const listData = await api.get('/api/scan-configs');
    _configs = listData.configs || [];
    _renderList();
    const datesEl = document.getElementById('scan-conf-dates');
    const today = (saved.updated_at || '').slice(0, 10);
    if (today) datesEl.textContent = datesEl.textContent.replace(/· updated \S+$/, '').trimEnd() + ` · updated ${today}`;
    btn.textContent = 'Saved ✓';
    btn.classList.add('ind-btn-save-ok');
    setTimeout(() => { btn.textContent = 'Save'; btn.classList.remove('ind-btn-save-ok'); }, 1800);
  } catch (err) {
    btn.textContent = 'Error';
    btn.classList.add('ind-btn-save-err');
    setTimeout(() => { btn.textContent = 'Save'; btn.classList.remove('ind-btn-save-err'); }, 2000);
  }
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
  document.getElementById('scan-results-label').textContent   = '';
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
    empty.textContent   = 'No tickers matched.';
    empty.style.display = 'flex';
    wrap.style.display  = 'none';
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

// ── History ───────────────────────────────────────────────────
async function _loadHistory() {
  const data  = await api.get('/api/scan/history');
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
  document.getElementById('scan-ind-conf').addEventListener('change', e => {
    _markDirty();
    const id = parseInt(e.target.value) || 0;
    _checkCompat(id, _activeTf);
  });

  document.addEventListener('keydown', e => {
    const tag     = document.activeElement?.tagName;
    const ctrl    = e.ctrlKey || e.metaKey;
    const inInput = tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA';

    if (e.key === '`') { e.preventDefault(); window.location.href = '/fetch'; return; }
    if (e.key === '~') { e.preventDefault(); window.location.href = '/indicators'; return; }

    if (inInput) return;

    if (e.key === 'N' && !ctrl) { e.preventDefault(); document.getElementById('btn-new-scan').click(); }
    if (e.key === 's' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); _saveScan(); }
    if (e.key === 'D' && !ctrl) { e.preventDefault(); document.getElementById('btn-delete-scan').click(); }
    if (e.key === 'R' && !ctrl) { e.preventDefault(); _runScan(); }
    if (e.key === 'T' && !ctrl) { e.preventDefault(); window.location.href = '/fetch'; }
    if (e.key === 'I' && !ctrl) { e.preventDefault(); window.location.href = '/indicators'; }
    if (e.key === 'C' && !ctrl) { e.preventDefault(); window.location.href = '/'; }
    if (e.key === 'S' && !ctrl) { e.preventDefault(); window.location.href = '/scanner'; }

    if (e.key === '=') {
      const i = _configs.findIndex(c => c.id === _activeId);
      if (i > 0) _selectConfig(_configs[i - 1].id);
    }
    if (e.key === '-') {
      const i = _configs.findIndex(c => c.id === _activeId);
      if (i >= 0 && i < _configs.length - 1) _selectConfig(_configs[i + 1].id);
    }

    // [ / ] cycle timeframe tabs
    if (e.key === '[') {
      const i = _timeframes.indexOf(_activeTf);
      if (i > 0) _setActiveTf(_timeframes[i - 1]);
    }
    if (e.key === ']') {
      const i = _timeframes.indexOf(_activeTf);
      if (i < _timeframes.length - 1) _setActiveTf(_timeframes[i + 1]);
    }

    if (e.key === 'ArrowUp')   { e.preventDefault(); _moveCritFocus(-1); }
    if (e.key === 'ArrowDown') { e.preventDefault(); _moveCritFocus(1); }
    if (e.key === 'Enter')     { e.preventDefault(); _toggleFocusedCard(); }
    if (e.key === ' ')         { e.preventDefault(); _toggleFocusedCheck(); }
  });
}
