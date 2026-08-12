import { api }       from './api.js';
import { initHelp }  from './help.js';
import { initTheme, toggleTheme } from './theme.js';

// ── State ─────────────────────────────────────────────────────
const _FIXED_TFS = ['daily', 'weekly', '1hour', '4hour', '5min'];
let _configs      = [];
let _criteria     = [];
let _confs        = [];           // all ind_configs [{id, name}]
let _confsWithData = new Set();   // ind_conf ids that have computed data
let _tickerLists  = [];           // available ticker list names
let _hasSingles   = false;        // any tickers fetched without a list
let _timeframes   = [];
let _indConfTfs   = new Set();   // timeframes with indicator data for selected ind_conf
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
let _criteriaDescriptions     = {};  // { name: description }
let _criteriaParamDescriptions = {}; // { param_key: description }
let _focusedIdx   = -1;

// ── Run queue ─────────────────────────────────────────────────
let _runCheckedIds = new Set();
let _runQueue      = [];
let _runQueueIdx   = -1;
let _runResults    = {};
let _scanDone      = false;

const _esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

function _saveRunQueue() {
  try { localStorage.setItem('scan_run_queue', JSON.stringify([..._runCheckedIds])); } catch {}
}
function _loadRunQueue() {
  try {
    const saved = JSON.parse(localStorage.getItem('scan_run_queue') || '[]');
    const valid = new Set(_configs.map(c => c.id));
    _runCheckedIds = new Set(saved.filter(id => valid.has(id)));
  } catch { _runCheckedIds = new Set(); }
}

// ── Init ──────────────────────────────────────────────────────
(async function init() {
  initTheme();
  initHelp('scanner');
  const [tickerData, criteriaData, indConfsData] = await Promise.all([
    api.get('/api/tickers'),
    api.get('/api/criteria'),
    api.get('/api/ind-configs'),
  ]);
  _confs         = indConfsData.configs  || [];
  _confsWithData = new Set((tickerData.ind_confs || []).map(c => c.id));
  _tickerLists   = tickerData.lists      || [];
  _hasSingles    = !!tickerData.has_singles;
  _timeframes    = tickerData.timeframes || [];
  _criteria   = criteriaData.criteria || [];
  _criteriaParamDescriptions = criteriaData.param_descriptions || {};
  for (const c of _criteria) _criteriaDescriptions[c.name] = c.description || '';
  _activeTf   = 'daily';
  _populateIndConfs();
  _wireScanTooltip();
  _wireGlobal();
  await Promise.all([_loadConfigs(), _loadHistory()]);
})();

function _populateIndConfs() {
  const sel = document.getElementById('scan-ind-conf');
  sel.innerHTML = '';
  const placeholder = document.createElement('option');
  placeholder.value = ''; placeholder.textContent = '— select —';
  placeholder.disabled = true;
  sel.appendChild(placeholder);

  if (_confs.length) {
    const grp = document.createElement('optgroup');
    grp.label = '— Indicator Configs —';
    for (const c of _confs) {
      const o = document.createElement('option');
      o.value = `conf:${c.id}`;
      o.textContent = c.name;
      if (!_confsWithData.has(c.id)) o.disabled = true;
      grp.appendChild(o);
    }
    sel.appendChild(grp);
  }

  if (_hasSingles || _tickerLists.length) {
    const grp = document.createElement('optgroup');
    grp.label = '— Tickers Only —';
    const tickerOpts = [];
    if (_hasSingles) tickerOpts.push({ value: 'list:__single__', text: 'SINGLE' });
    for (const list of _tickerLists) tickerOpts.push({ value: `list:${list}`, text: list });
    if (tickerOpts.length >= 2) {
      const o = document.createElement('option');
      o.value = 'list:__all__'; o.textContent = 'ALL';
      grp.appendChild(o);
    }
    for (const opt of tickerOpts) {
      const o = document.createElement('option');
      o.value = opt.value; o.textContent = opt.text;
      grp.appendChild(o);
    }
    sel.appendChild(grp);
  }
}

// ── Dropdown value helpers ────────────────────────────────────
// Encode: ind_conf → "conf:ID", ticker list → "list:NAME", none → ""
function _encodeSource(indConfId, tickerList) {
  if (indConfId) return `conf:${indConfId}`;
  if (tickerList) return `list:${tickerList}`;
  return '';
}
function _decodeSource(val) {
  if (!val) return { indConfId: null, tickerList: null };
  if (val.startsWith('conf:')) return { indConfId: parseInt(val.slice(5)) || null, tickerList: null };
  if (val.startsWith('list:')) return { indConfId: null, tickerList: val.slice(5) };
  return { indConfId: null, tickerList: null };
}
function _updateNoDataWarning() {
  const warn = document.getElementById('scan-no-data-warn');
  if (!warn) return;
  const val = document.getElementById('scan-ind-conf')?.value || '';
  const { indConfId } = _decodeSource(val);
  const show = indConfId && !_confsWithData.has(indConfId);
  warn.style.display = show ? '' : 'none';
}

// ── Criteria tooltip ──────────────────────────────────────────
function _wireScanTooltip() {
  const tip  = document.getElementById('scan-tooltip');
  const list = document.getElementById('scan-criteria-list');
  if (!tip || !list) return;

  list.addEventListener('mouseover', e => {
    const el = e.target.closest('[data-has-tip]');
    if (!el) { tip.style.display = 'none'; return; }
    const desc = _criteriaDescriptions[el.dataset.critName];
    if (!desc) return;
    tip.textContent = desc;
    tip.style.display = 'block';
  });

  list.addEventListener('mousemove', e => {
    if (tip.style.display === 'none') return;
    const x = e.clientX + 14, y = e.clientY + 14;
    tip.style.left = (x + tip.offsetWidth  > window.innerWidth  ? e.clientX - tip.offsetWidth  - 8 : x) + 'px';
    tip.style.top  = (y + tip.offsetHeight > window.innerHeight ? e.clientY - tip.offsetHeight - 8 : y) + 'px';
  });

  list.addEventListener('mouseout', e => {
    if (!e.relatedTarget?.closest?.('[data-has-tip]')) tip.style.display = 'none';
  });
}

// ── Timeframe tabs ────────────────────────────────────────────
function _buildTfTabs() {
  const container = document.getElementById('scan-tf-tabs');
  if (!container) return;
  container.innerHTML = '';
  for (const tf of _FIXED_TFS) {
    const btn = document.createElement('button');
    btn.className  = 'tf-tab';
    btn.dataset.tf = tf;
    btn.textContent = tf;
    btn.addEventListener('click', () => _setActiveTf(tf));
    container.appendChild(btn);
  }
  _updateTfTabStates();
}

function _updateTfTabStates() {
  const { indConfId } = _decodeSource(document.getElementById('scan-ind-conf')?.value || '');
  const hasIndConf = !!indConfId;
  for (const btn of document.querySelectorAll('#scan-tf-tabs .tf-tab')) {
    const tf = btn.dataset.tf;
    btn.classList.toggle('active',    tf === _activeTf);
    btn.classList.toggle('has-data',  !hasIndConf || _indConfTfs.has(tf));
  }
  _updateTfCounts();
}

async function _fetchIndConfTfs(indConfId) {
  if (!indConfId) { _indConfTfs = new Set(); _updateTfTabStates(); return; }
  try {
    const data = await api.get(`/api/criteria/ind_conf_timeframes/${indConfId}`);
    _indConfTfs = new Set(data.timeframes || []);
  } catch { _indConfTfs = new Set(); }
  _updateTfTabStates();
}

function _updateTfCounts() {
  for (const btn of document.querySelectorAll('#scan-tf-tabs .tf-tab')) {
    const tf    = btn.dataset.tf;
    const count = _enabled[tf]?.size || 0;
    let badge   = btn.querySelector('.tf-count');
    if (count > 0) {
      if (!badge) { badge = document.createElement('span'); badge.className = 'tf-count'; btn.appendChild(badge); }
      badge.textContent = count;
    } else {
      badge?.remove();
    }
  }
}

function _setActiveTf(tf) {
  _activeTf = tf;
  _updateTfTabStates();
  document.querySelectorAll('.scan-crit-card').forEach(card => card._update?.(tf));
  const { indConfId } = _decodeSource(document.getElementById('scan-ind-conf')?.value || '');
  _checkCompat(indConfId, tf);
}

// ── Config list ───────────────────────────────────────────────
async function _loadConfigs() {
  const data = await api.get('/api/scan-configs');
  _configs = data.configs || [];
  _loadRunQueue();
  _renderList();
  if (!_activeId) {
    try {
      const stored = parseInt(localStorage.getItem('scan_active_id')) || 0;
      if (stored && _configs.find(c => c.id === stored)) _activeId = stored;
    } catch {}
  }
  const target = (_activeId && _configs.find(c => c.id === _activeId))
    ? _activeId
    : _configs.length ? _configs[0].id : null;
  if (target) {
    try { await _selectConfig(target); } catch { _showEmpty(true); }
  } else {
    _showEmpty(true);
  }
  _renderRunConfigs();
}

function _renderList() {
  const el = document.getElementById('scan-list');
  if (!_configs.length) { el.innerHTML = '<div class="ind-loading">No scans yet.</div>'; return; }
  el.innerHTML = '';
  for (const cfg of _configs) {
    const queued = _runCheckedIds.has(cfg.id);
    const item = document.createElement('div');
    item.className = 'ind-config-item' + (cfg.id === _activeId ? ' active' : '') + (queued ? ' queued' : '');
    item.dataset.id = cfg.id;
    item.title = 'Open config — _ next · + prev (wraps around)';
    const info = document.createElement('div');
    info.className = 'ind-config-info';
    const name = document.createElement('div');
    name.className = 'ind-config-name'; name.textContent = cfg.name;
    const sub = document.createElement('div');
    sub.className = 'ind-config-date'; sub.textContent = cfg.updated_at ? cfg.updated_at.slice(0, 10) : '';
    info.append(name, sub);
    const qBtn = document.createElement('button');
    qBtn.className = 'ind-queue-btn' + (queued ? ' queued' : '');
    qBtn.dataset.id = cfg.id;
    qBtn.title = queued ? 'Remove from run queue (Space)' : 'Add to run queue (Space)';
    qBtn.textContent = '▶';
    item.append(info, qBtn);
    item.addEventListener('click', e => { if (!e.target.closest('.ind-queue-btn')) _selectConfig(cfg.id); });
    qBtn.addEventListener('click', e => { e.stopPropagation(); _toggleQueued(+qBtn.dataset.id); });
    el.appendChild(item);
  }
}

function _toggleQueued(id) {
  if (_runCheckedIds.has(id)) { _runCheckedIds.delete(id); delete _runResults[id]; }
  else _runCheckedIds.add(id);
  _saveRunQueue();
  _renderList();
  _renderRunConfigs();
}

function _cycleConfig(dir) {
  if (!_configs.length) return;
  const cur  = _configs.findIndex(c => c.id === _activeId);
  const next = (cur + dir + _configs.length) % _configs.length;
  _selectConfig(_configs[next].id);
}

async function _selectConfig(id) {
  if (_dirty && _activeId && !confirm('Discard unsaved changes?')) return;
  _activeId = id; _dirty = false; _focusedIdx = -1;
  try { localStorage.setItem('scan_active_id', String(id)); } catch {}
  _renderList();
  const cfg = await api.get(`/api/scan-configs/${id}`);
  _showEmpty(false);
  document.getElementById('scan-name').value     = cfg.name;
  document.getElementById('scan-ind-conf').value = _encodeSource(cfg.ind_conf_id, cfg.ticker_list);
  _updateNoDataWarning();
  _renderScanDates(cfg);
  _loadFromConfig(cfg.criteria || []);
  _clearResults();
  const { indConfId } = _decodeSource(document.getElementById('scan-ind-conf').value);
  _fetchIndConfTfs(indConfId);
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

// ── Date helpers ─────────────────────────────────────────────
function _fmtDate(str) {
  if (!str) return '';
  const d = new Date(str);
  return isNaN(d) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function _renderScanDates(cfg) {
  const el = document.getElementById('scan-conf-dates');
  if (!el) return;
  const created = _fmtDate(cfg.created_at);
  const updated = _fmtDate(cfg.updated_at);
  if (updated && updated !== created) {
    el.textContent = `created ${created} · updated ${updated}`;
  } else if (created) {
    el.textContent = `created ${created}`;
  } else {
    el.textContent = '';
  }
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
  if (_criteriaDescriptions[crit.name]) {
    nameSpan.dataset.hasTip  = '';
    nameSpan.dataset.critName = crit.name;
  }

  const compatBadge = document.createElement('span');
  compatBadge.className = 'scan-compat-badge';

  nameWrap.append(nameSpan, compatBadge);

  const countBadge = document.createElement('span');
  countBadge.className = 'scan-count-badge';

  const logicSwitch = document.createElement('div');
  logicSwitch.className = 'scan-logic-switch';
  const btnAnd = document.createElement('button'); btnAnd.textContent = 'AND';
  const btnOr  = document.createElement('button'); btnOr.textContent  = 'OR';
  logicSwitch.append(btnAnd, btnOr);

  const _updateToggle = () => {
    const l = _critLogic[crit.name] || 'AND';
    btnAnd.className = l === 'AND' ? 'active-and' : '';
    btnOr.className  = l === 'OR'  ? 'active-or'  : '';
  };
  _updateToggle();

  const _setLogic = (val, e) => {
    e.stopPropagation();
    _critLogic[crit.name] = val;
    _updateToggle();
    _markDirty();
  };
  btnAnd.addEventListener('click', e => _setLogic('AND', e));
  btnOr.addEventListener('click',  e => _setLogic('OR',  e));

  head.append(cbxWrap, logicSwitch, nameWrap, countBadge);
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
    let arrow = head.querySelector('.ind-expand-arrow');
    if (n > 0) {
      if (!arrow) {
        arrow = document.createElement('span');
        arrow.className = 'ind-expand-arrow';
        arrow.textContent = '▾';
        head.appendChild(arrow);
      }
    } else {
      arrow?.remove();
      body.classList.add('collapsed');
    }
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
      body.classList.remove('collapsed');
    } else {
      _enabled[tf]?.delete(crit.name);
    }
    _refreshHead(tf);
    _updateTfCounts();
    _markDirty();
  });

  // ── Head click: toggle enabled state for current tf ───────
  head.addEventListener('click', e => {
    if (cbxWrap.contains(e.target)) return;
    if (logicSwitch.contains(e.target)) return;
    _setCritFocus(idx);
    cbx.checked = !_isEnabled(_activeTf);
    cbx.dispatchEvent(new Event('change'));
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
    const pdesc = s.description || _criteriaParamDescriptions[key];
    if (pdesc) lbl.title = pdesc;
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

// Enter selects/deselects the focused card AND opens/closes it in one action —
// mirrors clicking the card head (outside the checkbox/logic-switch): toggling
// the checkbox already drives collapse/expand + the arrow via its 'change' handler.
function _toggleFocusedCard() {
  _toggleFocusedCheck();
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
  const { indConfId, tickerList } = _decodeSource(document.getElementById('scan-ind-conf').value);
  const body = {
    name:        document.getElementById('scan-name').value.trim() || 'Unnamed',
    logic:       'AND',
    ind_conf_id: indConfId,
    ticker_list: tickerList,
    criteria:    _collectAllEntries(),
  };
  try {
    const saved = await api.put(`/api/scan-configs/${_activeId}`, body);
    _dirty = false;
    const listData = await api.get('/api/scan-configs');
    _configs = listData.configs || [];
    _renderList();
    const el = document.getElementById('scan-conf-dates');
    if (el && saved.updated_at) {
      const updated = _fmtDate(saved.updated_at);
      el.textContent = el.textContent.replace(/· updated .+$/, '').trimEnd() + ` · updated ${updated}`;
    }
    btn.textContent = 'Saved ✓';
    btn.classList.add('ind-btn-save-ok');
    setTimeout(() => { btn.textContent = 'Save'; btn.classList.remove('ind-btn-save-ok'); }, 1800);
  } catch (err) {
    btn.textContent = 'Error';
    btn.classList.add('ind-btn-save-err');
    setTimeout(() => { btn.textContent = 'Save'; btn.classList.remove('ind-btn-save-err'); }, 2000);
  }
}

// ── Run queue ─────────────────────────────────────────────────
function _renderRunConfigs() {
  const el = document.getElementById('scan-run-conf-list');
  if (!el) return;
  const queued = _configs.filter(c => _runCheckedIds.has(c.id));
  const inRun  = _runQueueIdx >= 0;
  if (!queued.length) {
    el.innerHTML = '<div class="run-queue-empty">No scans queued — click ▶ to add</div>';
    return;
  }
  el.innerHTML = queued.map((c, i) => {
    const result = _runResults[c.id];
    let statusHtml = '';
    if (result) {
      if (result.status === 'pending') {
        statusHtml = `<div class="rq-info"><span class="rq-state rq-pending">waiting</span></div>`;
      } else if (result.status === 'running') {
        statusHtml = `<div class="rq-bar-track"><div class="rq-bar-fill rq-running" style="width:100%"></div></div>
                      <div class="rq-info"><span class="rq-state rq-running">running…</span></div>`;
      } else if (result.status === 'done') {
        statusHtml = `<div class="rq-bar-track"><div class="rq-bar-fill ${result.error ? 'rq-errors' : 'rq-done'}" style="width:100%"></div></div>
                      <div class="rq-info">
                        <span class="rq-state ${result.error ? 'rq-errors' : 'rq-done'}">${result.error ? '✗ error' : '✓ done'}</span>
                        ${!result.error ? `<span class="rq-count">${result.matched} / ${result.total} matched</span>` : ''}
                      </div>`;
      }
    }
    return `<div class="run-queue-item">
      <div class="run-queue-header">
        <span class="run-queue-pos">${i + 1}</span>
        <span class="run-queue-name">${_esc(c.name)}</span>
        <button class="run-queue-remove" data-id="${c.id}"${inRun ? ' disabled' : ''} title="Remove from queue">×</button>
      </div>
      <div class="rq-status">${statusHtml}</div>
    </div>`;
  }).join('');

  _updateScanOverall();
}

function _updateScanOverall() {
  const overall  = document.getElementById('scan-overall');
  const idleEl   = document.getElementById('scan-output-idle');
  const totalEl  = document.getElementById('scan-run-total');
  const track    = document.getElementById('scan-track');
  const bar      = document.getElementById('scan-bar');
  const meta     = document.getElementById('scan-meta');
  const countEl  = document.getElementById('scan-count');
  const pctEl    = document.getElementById('scan-pct');
  const currentEl= document.getElementById('scan-current');
  const errorsEl = document.getElementById('scan-errors');

  const inRun = _runQueueIdx >= 0 && _runQueueIdx < _runQueue.length;

  if (!inRun && !_scanDone) {
    overall.style.display = 'none';
    if (idleEl) idleEl.style.display = '';
    return;
  }

  if (idleEl) idleEl.style.display = 'none';
  overall.style.display = '';

  if (inRun) {
    const total = _runQueue.length;
    const done  = _runQueueIdx;
    const pct   = total > 0 ? (done / total * 100) : 0;
    const conf  = _configs.find(c => c.id === _runQueue[_runQueueIdx]);
    bar.style.width = `${pct}%`;
    track.classList.add('active');
    bar.classList.add('active');
    meta.classList.add('active');
    totalEl.textContent  = `Config ${_runQueueIdx + 1} / ${total}`;
    countEl.textContent  = `${done} / ${total}`;
    pctEl.textContent    = `${Math.round(pct)}%`;
    currentEl.textContent= conf?.name ? `→ ${conf.name}` : '';
    errorsEl.textContent = '';
  } else {
    const ids   = Object.keys(_runResults);
    const total = ids.length;
    const errs  = ids.filter(id => _runResults[+id]?.error).length;
    bar.style.width = '100%';
    track.classList.remove('active');
    bar.classList.remove('active');
    meta.classList.remove('active');
    totalEl.textContent  = `${total} config${total !== 1 ? 's' : ''}`;
    countEl.textContent  = `${total} / ${total}`;
    pctEl.textContent    = '100%';
    currentEl.textContent= '';
    errorsEl.textContent = errs > 0 ? `✗ ${errs} error${errs !== 1 ? 's' : ''}` : '✓ complete';
  }
}

async function _startScan() {
  const ids = _configs.filter(c => _runCheckedIds.has(c.id)).map(c => c.id);
  if (!ids.length) return;
  _scanDone    = false;
  _runQueue    = ids;
  _runQueueIdx = 0;
  _runResults  = {};
  for (const id of _runQueue) _runResults[id] = { status: 'pending' };
  const btn = document.getElementById('btn-run-scan');
  btn.disabled = true; btn.textContent = '▶ Running…';
  _renderRunConfigs();
  await _kickNextQueueItem();
}

async function _kickNextQueueItem() {
  if (_runQueueIdx >= _runQueue.length) {
    _scanDone = true;
    _runQueue = []; _runQueueIdx = -1;
    const btn = document.getElementById('btn-run-scan');
    btn.disabled = false; btn.textContent = '▶ Run';
    _renderRunConfigs();
    return;
  }
  const configId = _runQueue[_runQueueIdx];
  _runResults[configId] = { status: 'running' };
  _renderRunConfigs();
  try {
    if (_dirty && _activeId === configId) await _saveScan();
    const data = await api.post('/api/scan/run', { config_id: configId });
    _lastResults = data.results || [];
    _runResults[configId] = { status: 'done', matched: data.count, total: data.total ?? 0 };
    _renderResults(data);
    _loadHistory();
  } catch (e) {
    _runResults[configId] = { status: 'done', error: true };
  }
  _renderRunConfigs();
  _runQueueIdx++;
  await _kickNextQueueItem();
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
    tbody.innerHTML = '<tr><td colspan="5" class="stats-empty">No history yet.</td></tr>';
    return;
  }
  tbody.innerHTML = '';
  for (const r of rows) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${r.config_name}</td>
      <td>${r.matched}</td>
      <td>${r.total}</td>
      <td>${r.ran_at}</td>
      <td></td>`;
    const delBtn = document.createElement('button');
    delBtn.className = 'scan-history-del';
    delBtn.textContent = '✕';
    delBtn.title = 'Delete this run and its results';
    delBtn.addEventListener('click', async () => {
      if (!confirm(`Delete run "${r.config_name} · ${r.ran_at}"?`)) return;
      await api.del(`/api/scan/runs/${r.id}`);
      _loadHistory();
    });
    tr.querySelector('td:last-child').appendChild(delBtn);
    tbody.appendChild(tr);
  }
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

  document.getElementById('btn-run-refresh').addEventListener('click', _renderRunConfigs);
  document.getElementById('btn-run-clear').addEventListener('click', () => {
    if (_runQueueIdx >= 0) return;
    _runCheckedIds.clear();
    _runResults = {};
    _scanDone   = false;
    _saveRunQueue();
    _renderList();
    _renderRunConfigs();
  });
  document.getElementById('scan-run-conf-list').addEventListener('click', e => {
    const btn = e.target.closest('.run-queue-remove');
    if (!btn || btn.disabled) return;
    const id = +btn.dataset.id;
    _runCheckedIds.delete(id);
    delete _runResults[id];
    _saveRunQueue();
    _renderList();
    _renderRunConfigs();
  });
  document.getElementById('btn-results-refresh').addEventListener('click', () => {
    if (_lastResults) _renderResults({ results: _lastResults, count: _lastResults.length });
  });
  document.getElementById('btn-results-clear').addEventListener('click', _clearResults);
  document.getElementById('btn-history-refresh').addEventListener('click', _loadHistory);
  document.getElementById('btn-history-clear').addEventListener('click', async () => {
    if (!confirm('Clear all scan history?')) return;
    await api.del('/api/scan/history');
    _loadHistory();
  });
  document.getElementById('btn-run-scan').addEventListener('click', _startScan);
  document.getElementById('btn-open-chart').addEventListener('click', () => {
    if (_lastResults?.length) _openTicker(_lastResults[0].ticker);
  });

  document.getElementById('scan-name').addEventListener('input', _markDirty);
  document.getElementById('scan-ind-conf').addEventListener('change', e => {
    _markDirty();
    const { indConfId } = _decodeSource(e.target.value);
    _updateNoDataWarning();
    _fetchIndConfTfs(indConfId);
    _checkCompat(indConfId, _activeTf);
  });

  document.addEventListener('keydown', e => {
    const tag     = document.activeElement?.tagName;
    const ctrl    = e.ctrlKey || e.metaKey;
    const inInput = tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA';

    if (e.key === '/') { e.preventDefault(); toggleTheme(); return; }
    if (e.key === '`') { e.preventDefault(); window.location.href = '/pipeline'; return; }
    if (e.key === '~') { e.preventDefault(); window.location.href = '/indicators'; return; }

    if (e.key === 's' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); _saveScan(); return; }

    // Universal Esc reset — leave whatever input/select is focused so page-level
    // shortcuts (nav, N/D/R, etc.) work again without needing a stray click first.
    if (e.key === 'Escape') {
      e.preventDefault();
      _setCritFocus(-1);
      document.activeElement?.blur();
      return;
    }

    if (inInput) return;

    if (e.key === 'N' && !ctrl) { e.preventDefault(); document.getElementById('btn-new-scan').click(); }
    if (e.key === 'D' && !ctrl) { e.preventDefault(); document.getElementById('btn-delete-scan').click(); }
    if (e.key === 'R' && !ctrl) { e.preventDefault(); _runScan(); }
    if (e.key === 'T' && !ctrl) { e.preventDefault(); window.location.href = '/fetch'; }
    if (e.key === 'I' && !ctrl) { e.preventDefault(); window.location.href = '/indicators'; }
    if (e.key === 'C' && !ctrl) { e.preventDefault(); window.location.href = '/'; }
    if (e.key === 'S' && !ctrl) { e.preventDefault(); window.location.href = '/scanner'; }
    if (e.key === 'P' && !ctrl) { e.preventDefault(); window.location.href = '/pipeline'; }

    // _/+ cycle saved scan configs (matches Indicators/Pipeline, wraps around).
    if (e.key === '_') { e.preventDefault(); _cycleConfig(1); }
    if (e.key === '+') { e.preventDefault(); _cycleConfig(-1); }

    // [ / ] cycle timeframe tabs
    if (e.key === '[') {
      const i = _FIXED_TFS.indexOf(_activeTf);
      if (i > 0) _setActiveTf(_FIXED_TFS[i - 1]);
    }
    if (e.key === ']') {
      const i = _FIXED_TFS.indexOf(_activeTf);
      if (i < _FIXED_TFS.length - 1) _setActiveTf(_FIXED_TFS[i + 1]);
    }

    // -/= (redundant with ArrowUp/ArrowDown) cycle keyboard focus between the
    // criteria cards of the open config — matches Pipeline's stage-card keys.
    if (e.key === 'ArrowUp'   || e.key === '=') { e.preventDefault(); _moveCritFocus(-1); }
    if (e.key === 'ArrowDown' || e.key === '-') { e.preventDefault(); _moveCritFocus(1); }
    if (e.key === 'Enter')     { e.preventDefault(); _toggleFocusedCard(); }
    // Space toggles the focused criteria card's checkbox when one is kb-focused
    // (-/=/arrows); otherwise it queues/dequeues the open scan config for a run
    // (matches Indicators/Pipeline's Space-to-queue convention).
    if (e.key === ' ') {
      e.preventDefault();
      if (_focusedIdx >= 0) _toggleFocusedCheck();
      else if (_activeId) _toggleQueued(_activeId);
    }
  });
}
