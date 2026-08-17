import { initHelp } from './help.js';
import { initTheme, toggleTheme } from './theme.js';
import { api } from './api.js';

const ALL_TIMEFRAMES = ['daily', 'weekly', '1hour', '4hour', '5min'];

let _tickerLists   = [];
let _pollTimer     = null;

// Single ticker queue state
let _singleQueue   = [];
let _singleResults = {};
let _singleRunning = false;
let _selectedSingleIdx = null;

// ── Ticker Configs (list + timeframes, reusable — also referenced from Pipeline) ──
let _configs       = [];        // [{id, name, ticker_list, timeframes, updated_at}]
let _activeId      = null;
let _dirty         = false;
let _runCheckedIds = new Set(); // config ids queued via the ▶ button — persisted like the other pages
let _runQueue      = [];        // ordered ids for the run currently in progress
let _runQueueIdx   = -1;        // -1 idle, else index into _runQueue
let _runResults    = {};        // id -> {status:'pending'|'running'|'done'|'error', done, total, errors, error?}
let _tconfTfFocusIdx = -1;      // -1 none, else index into #tconf-tfs's timeframe checkboxes ([/] cycle, Enter toggles)

// ── Bootstrap ─────────────────────────────────────────────────

async function init() {
  await _loadTickerLists();
  _buildTimeframeChecks('single-tfs', ['daily']);
  _buildTconfTfChecks();
  _loadSingleQueue();
  _renderSingleQueue();
  _wireButtons();
  _wireTconfButtons();
  _initDropZone();
  await _loadConfigs();

  const [status] = await Promise.all([
    api.get('/api/jobs/status'),
    _loadApiKey(),
    _loadStats(),
    _loadHistory(),
    _loadTiingoListInfo(),
  ]);
  if (status.fetch.status === 'running') {
    _startPolling();
  }
}

// ── Utilities ─────────────────────────────────────────────────

function _esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Single-ticker queue persistence ────────────────────────────

function _saveSingleQueue() {
  try { localStorage.setItem('fetch_single_queue', JSON.stringify(_singleQueue)); } catch {}
}

function _loadSingleQueue() {
  try {
    const saved = JSON.parse(localStorage.getItem('fetch_single_queue') || '[]');
    _singleQueue = saved.map(item => typeof item === 'string' ? { ticker: item, timeframes: ['daily'] } : item);
  } catch { _singleQueue = []; }
}

// ── Single-ticker queue rendering ──────────────────────────────

function _syncTfChecks(containerId, timeframes) {
  for (const cb of document.querySelectorAll(`#${containerId} input[type="checkbox"]`)) {
    cb.checked = timeframes.includes(cb.value);
  }
}

function _renderSingleQueue() {
  const el = document.getElementById('single-queue');
  if (!el) return;
  if (!_singleQueue.length) {
    el.innerHTML = '<div class="run-queue-empty">No tickers queued — type above to add</div>';
    _selectedSingleIdx = null;
    return;
  }
  const table = document.createElement('table');
  table.className = 'run-queue-table';
  const tbody = document.createElement('tbody');
  _singleQueue.forEach((item, i) => {
    const r = _singleResults[item.ticker];
    let statusHtml = '';
    if (r) {
      if (r.status === 'pending') {
        statusHtml = '<div class="rq-info"><span class="rq-state rq-pending">waiting</span></div>';
      } else if (r.status === 'running') {
        statusHtml = '<div class="rq-info"><span class="rq-state rq-running">fetching</span></div>';
      } else if (r.status === 'done') {
        statusHtml = r.linesHtml || '';
      } else if (r.status === 'error') {
        statusHtml = `<div class="rq-info"><span class="rq-state rq-errors">✗ ${_esc(r.message || 'error')}</span></div>`;
      }
    }
    const tr = document.createElement('tr');
    tr.className = 'run-queue-item' + (i === _selectedSingleIdx ? ' rq-selected' : '');
    tr.innerHTML = `
      <td class="run-queue-td-pos">${i + 1}</td>
      <td class="run-queue-td-name">
        <span class="run-queue-name">${_esc(item.ticker)}</span>
        ${statusHtml ? `<div class="run-queue-detail">${statusHtml}</div>` : ''}
      </td>
      <td class="run-queue-td-tfs">${item.timeframes.join(' · ')}</td>
      <td class="run-queue-td-del"><button class="run-queue-remove" data-ticker="${_esc(item.ticker)}"${_singleRunning ? ' disabled' : ''} title="Remove ${_esc(item.ticker)} from the queue">×</button></td>
    `;
    if (!_singleRunning) {
      tr.addEventListener('click', e => {
        if (e.target.closest('.run-queue-remove')) return;
        if (i === _selectedSingleIdx) {
          _selectedSingleIdx = null;
        } else {
          _selectedSingleIdx = i;
          _syncTfChecks('single-tfs', item.timeframes);
        }
        _renderSingleQueue();
      });
    }
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  el.innerHTML = '';
  el.appendChild(table);
}

// ── Single-ticker run ───────────────────────────────────────────

async function _runSingleQueue() {
  if (!_singleQueue.length || _singleRunning) return;

  _singleRunning = true;
  _singleResults = {};
  const btn = document.getElementById('btn-single-fetch');
  btn.disabled = true;
  btn.textContent = 'Fetching…';

  for (const item of _singleQueue) _singleResults[item.ticker] = { status: 'pending' };
  _renderSingleQueue();

  for (const item of _singleQueue) {
    const timeframes = item.timeframes;
    if (!timeframes.length) {
      _singleResults[item.ticker] = { status: 'error', message: 'No timeframes selected' };
      _renderSingleQueue();
      continue;
    }
    _singleResults[item.ticker] = { status: 'running' };
    _renderSingleQueue();
    try {
      const data = await api.post('/api/fetch/ticker', { ticker: item.ticker, timeframes });
      const lines = [
        ...(data.results || []).map(r =>
          `<span class="rq-state rq-done fetch-tf-line">✓ ${r.timeframe} — ${r.rows.toLocaleString()} rows</span>`),
        ...(data.errors || []).map(e =>
          `<span class="rq-state rq-errors fetch-tf-line">✗ ${e.timeframe} — ${_esc(e.reason)}</span>`),
      ].join('');
      _singleResults[item.ticker] = { status: 'done', linesHtml: `<div class="rq-info" style="flex-wrap:wrap;gap:3px 10px;">${lines}</div>` };
    } catch (err) {
      _singleResults[item.ticker] = { status: 'error', message: err.message || 'Network error' };
    }
    _renderSingleQueue();
  }

  _singleRunning = false;
  btn.disabled = false;
  btn.textContent = '▶ Fetch';
  _renderSingleQueue();
  _loadStats();
  _loadHistory();
}

function _addSingleTicker(ticker) {
  const tickers = ticker.toUpperCase().split(',').map(t => t.trim()).filter(Boolean);
  if (!tickers.length) return;
  const timeframes = _getChecked('single-tfs');
  let changed = false;
  for (const t of tickers) {
    if (!_singleQueue.find(item => item.ticker === t)) {
      _singleQueue.push({ ticker: t, timeframes: timeframes.length ? [...timeframes] : ['daily'] });
      changed = true;
    }
  }
  if (changed) { _saveSingleQueue(); _renderSingleQueue(); }
  document.getElementById('single-ticker').value = '';
  _ddHide(document.getElementById('single-ticker-dd'));
}

// ── Ticker lists (raw CSVs — referenced by ticker configs) ─────

async function _loadTickerLists() {
  const data = await api.get('/api/ticker-lists');
  _tickerLists = data.lists || [];
  _renderTickerListItems();
  _populateTconfTickerListSelect();
  _updateTconfListCount();
}

function _renderTickerListItems() {
  const wrap = document.getElementById('ticker-list-items');
  if (!_tickerLists.length) { wrap.innerHTML = ''; return; }
  wrap.innerHTML = _tickerLists.map(l => `
    <div class="ticker-list-row">
      <span class="ticker-list-name">${_esc(l.name)}</span>
      <span class="ticker-list-count">${l.count.toLocaleString()} tickers</span>
      <button class="ticker-list-del scan-history-del" data-list="${_esc(l.name)}" title="Delete list ${_esc(l.name)}">✕</button>
    </div>
  `).join('');
}

function _buildTimeframeChecks(containerId, defaultChecked) {
  const wrap = document.getElementById(containerId);
  wrap.innerHTML = '';
  for (const tf of ALL_TIMEFRAMES) {
    const lbl = document.createElement('label');
    lbl.innerHTML = `<input type="checkbox" value="${tf}"${defaultChecked.includes(tf) ? ' checked' : ''}> ${tf}`;
    wrap.appendChild(lbl);
  }
}

function _getChecked(containerId) {
  return [...document.querySelectorAll(`#${containerId} input[type="checkbox"]:checked`)]
    .map(el => el.value);
}

// ── Ticker Configs — sidebar list ───────────────────────────────

function _populateTconfTickerListSelect() {
  const sel = document.getElementById('tconf-ticker-list');
  if (!sel) return;
  const prev = sel.value;
  sel.innerHTML = '<option value="">— select —</option>';
  for (const l of _tickerLists) {
    const opt = document.createElement('option');
    opt.value = l.name; opt.textContent = l.name;
    sel.appendChild(opt);
  }
  if (prev) sel.value = prev;
}

function _updateTconfListCount() {
  const sel = document.getElementById('tconf-ticker-list');
  const el  = document.getElementById('tconf-ticker-list-count');
  if (!sel || !el) return;
  const match = _tickerLists.find(l => l.name === sel.value);
  el.textContent = match ? `${match.count.toLocaleString()} tickers` : '';
}

// -/= cycle the Ticker List through a custom overlay rather than the native
// <select> popup: once a real OS select popup is open it captures its own
// keyboard input for navigation, so arbitrary keys like -/= never reach our
// keydown handler — only Up/Down would. This overlay is just a styled list
// (same pattern as the single-ticker search dropdown) so -/= can drive its
// highlighted row directly and the visible "this is a dropdown" cue survives.
function _cycleTconfTickerList(dir) {
  if (!_activeId) return;
  const sel = document.getElementById('tconf-ticker-list');
  const dd  = document.getElementById('tconf-ticker-list-dd');
  if (!sel || !sel.options.length) return;
  sel.focus();
  if (dd.style.display !== 'block') _tconfListDdOpen();
  sel.selectedIndex = (sel.selectedIndex + dir + sel.options.length) % sel.options.length;
  sel.dispatchEvent(new Event('change'));
  _tconfListDdSyncHi();
}

function _tconfListDdOpen() {
  const sel = document.getElementById('tconf-ticker-list');
  const dd  = document.getElementById('tconf-ticker-list-dd');
  dd.innerHTML = '';
  [...sel.options].forEach((opt, i) => {
    const item = document.createElement('div');
    item.className = 'ticker-dd-item' + (i === sel.selectedIndex ? ' hi' : '');
    item.dataset.index = i;
    item.textContent = opt.textContent;
    item.addEventListener('click', () => {
      sel.selectedIndex = i;
      sel.dispatchEvent(new Event('change'));
      _tconfListDdClose();
      sel.focus();
    });
    dd.appendChild(item);
  });
  // Reparented to <body> and fixed-positioned from the select's actual screen
  // rect — the editor card has overflow:hidden, so a dropdown left inside it
  // (position:absolute) gets clipped at the card's edge instead of floating
  // over the rest of the page.
  document.body.appendChild(dd);
  const rect = sel.getBoundingClientRect();
  dd.style.position = 'fixed';
  dd.style.left = `${rect.left}px`;
  dd.style.top = `${rect.bottom + 4}px`;
  dd.style.minWidth = `${rect.width}px`;
  dd.style.display = 'block';
}

function _tconfListDdSyncHi() {
  const sel = document.getElementById('tconf-ticker-list');
  const dd  = document.getElementById('tconf-ticker-list-dd');
  const items = dd.querySelectorAll('.ticker-dd-item');
  items.forEach((el, i) => el.classList.toggle('hi', i === sel.selectedIndex));
  items[sel.selectedIndex]?.scrollIntoView({ block: 'nearest' });
}

function _tconfListDdClose() {
  const dd = document.getElementById('tconf-ticker-list-dd');
  dd.style.display = 'none';
  dd.innerHTML = '';
}

function _buildTconfTfChecks() {
  const wrap = document.getElementById('tconf-tfs');
  wrap.innerHTML = '';
  for (const tf of ALL_TIMEFRAMES) {
    const lbl = document.createElement('label');
    lbl.innerHTML = `<input type="checkbox" value="${tf}"> ${tf}`;
    wrap.appendChild(lbl);
  }
  wrap.addEventListener('change', () => { _dirty = true; });
}

function _syncTconfTfChecks(timeframes) {
  for (const cb of document.querySelectorAll('#tconf-tfs input[type="checkbox"]')) {
    cb.checked = (timeframes || []).includes(cb.value);
  }
}

function _getTconfCheckedTfs() {
  return [...document.querySelectorAll('#tconf-tfs input[type="checkbox"]:checked')].map(el => el.value);
}

// [/] cycle a visual focus marker across the timeframe checkboxes, Enter
// toggles whichever one is focused — mirrors the kb-focused convention used
// for card focus on the Indicators/Scanner/Pipeline pages.
function _setTconfTfFocus(idx) {
  const labels = [...document.querySelectorAll('#tconf-tfs label')];
  labels.forEach(l => l.classList.remove('kb-focused'));
  _tconfTfFocusIdx = idx;
  if (idx >= 0 && labels[idx]) labels[idx].classList.add('kb-focused');
}

function _moveTconfTfFocus(dir) {
  if (!_activeId) return;
  const labels = document.querySelectorAll('#tconf-tfs label');
  if (!labels.length) return;
  const next = (_tconfTfFocusIdx + dir + labels.length) % labels.length;
  _setTconfTfFocus(next);
}

function _toggleTconfTfFocused() {
  const labels = document.querySelectorAll('#tconf-tfs label');
  const lbl = labels[_tconfTfFocusIdx];
  if (!lbl) return;
  const cb = lbl.querySelector('input[type="checkbox"]');
  cb.checked = !cb.checked;
  cb.dispatchEvent(new Event('change', { bubbles: true }));
}

// ── Run queue persistence ────────────────────────────────────

function _saveRunQueue() {
  try { localStorage.setItem('tconf_run_queue', JSON.stringify([..._runCheckedIds])); } catch {}
}
function _loadRunQueue() {
  try {
    const saved = JSON.parse(localStorage.getItem('tconf_run_queue') || '[]');
    const valid = new Set(_configs.map(c => c.id));
    _runCheckedIds = new Set(saved.filter(id => valid.has(id)));
  } catch { _runCheckedIds = new Set(); }
}

async function _loadConfigs() {
  const data = await api.get('/api/ticker-configs');
  _configs = data.configs || [];
  _loadRunQueue();
  _renderList();
  _renderRunConfigs();
  let restoreId = null;
  try { restoreId = parseInt(localStorage.getItem('tconf_selected_config_id')); } catch {}
  const target = (_configs.some(c => c.id === restoreId) ? restoreId : _configs[0]?.id) || null;
  if (target) {
    await _selectConfig(target);
  } else {
    _showTconfEmpty(true);
  }
}

function _renderList() {
  const el = document.getElementById('tconf-list');
  if (!el) return;
  if (!_configs.length) { el.innerHTML = '<div class="ind-loading">No ticker configs yet.</div>'; return; }
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
    qBtn.disabled = _isRunning();
    qBtn.title = _isRunning()
      ? 'Queue is locked while a run is in progress'
      : (queued ? 'Remove from run queue (Space)' : 'Add to run queue (Space)');
    qBtn.textContent = '▶';
    item.append(info, qBtn);
    item.addEventListener('click', e => { if (!e.target.closest('.ind-queue-btn')) _selectConfig(cfg.id); });
    qBtn.addEventListener('click', e => { e.stopPropagation(); _toggleQueued(cfg.id); });
    el.appendChild(item);
  }
}

// Guarded against an active run: the ▶ button already disables itself while
// running (see _renderList), but Space bypasses that DOM state entirely, so
// the check has to live here too — otherwise Space could silently drop the
// in-progress config out of _runCheckedIds, making it vanish from the Run
// Ticker Configs card even though the fetch job itself kept running unaffected.
function _toggleQueued(id) {
  if (_isRunning()) return;
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
  _activeId = id; _dirty = false;
  try { localStorage.setItem('tconf_selected_config_id', id); } catch {}
  _renderList();
  const cfg = await api.get(`/api/ticker-configs/${id}`);
  _showTconfEmpty(false);
  _populateTconfEditorFields(cfg);
  _renderTconfDates(cfg);
}

// Switches the editor to display a queued config without the dirty-confirm
// that _selectConfig does (the queue driver owns that decision).
async function _queueDisplayConfig(id) {
  _activeId = id; _dirty = false;
  try { localStorage.setItem('tconf_selected_config_id', id); } catch {}
  _renderList();
  const cfg = await api.get(`/api/ticker-configs/${id}`);
  _showTconfEmpty(false);
  _populateTconfEditorFields(cfg);
  _renderTconfDates(cfg);
}

function _populateTconfEditorFields(cfg) {
  document.getElementById('tconf-name').value = cfg.name;
  document.getElementById('tconf-ticker-list').value = cfg.ticker_list || '';
  _updateTconfListCount();
  _syncTconfTfChecks(cfg.timeframes);
  _setTconfTfFocus(-1);
}

function _renderTconfDates(cfg) {
  const el = document.getElementById('tconf-dates');
  const parts = [];
  if (cfg.created_at) parts.push(`created ${cfg.created_at.slice(0, 10)}`);
  if (cfg.updated_at) parts.push(`updated ${cfg.updated_at.slice(0, 10)}`);
  el.textContent = parts.join(' · ');
}

function _showTconfEmpty(yes) {
  document.getElementById('tconf-empty').style.display  = yes ? 'flex' : 'none';
  document.getElementById('tconf-editor').style.display = yes ? 'none' : 'flex';
}

async function _createTconf() {
  const created = await api.post('/api/ticker-configs');
  _configs.push(created);
  _renderList();
  await _selectConfig(created.id);
  const nameEl = document.getElementById('tconf-name');
  nameEl.focus(); nameEl.select();
}

async function _deleteTconf() {
  if (!_activeId) return;
  const cfg = _configs.find(c => c.id === _activeId);
  if (!confirm(`Delete "${cfg?.name || 'this ticker config'}"? This cannot be undone.`)) return;
  await api.del(`/api/ticker-configs/${_activeId}`);
  _configs = _configs.filter(c => c.id !== _activeId);
  _runCheckedIds.delete(_activeId);
  delete _runResults[_activeId];
  _saveRunQueue();
  _activeId = null;
  _renderList();
  _renderRunConfigs();
  if (_configs.length) {
    await _selectConfig(_configs[0].id);
  } else {
    _showTconfEmpty(true);
  }
}

async function _saveTconf() {
  if (!_activeId) return;
  const body = {
    name: document.getElementById('tconf-name').value.trim() || 'Unnamed',
    ticker_list: document.getElementById('tconf-ticker-list').value || null,
    timeframes: _getTconfCheckedTfs(),
  };
  const btn = document.getElementById('btn-save-tconf');
  try {
    const saved = await api.put(`/api/ticker-configs/${_activeId}`, body);
    _dirty = false;
    const item = _configs.find(c => c.id === _activeId);
    if (item) Object.assign(item, body, { updated_at: saved.updated_at });
    _renderList();
    btn.textContent = 'Saved ✓';
    btn.classList.add('ind-btn-save-ok');
    setTimeout(() => { btn.textContent = 'Save'; btn.classList.remove('ind-btn-save-ok'); }, 1800);
  } catch {
    btn.textContent = 'Failed ✗';
    btn.classList.add('ind-btn-save-err');
    setTimeout(() => { btn.textContent = 'Save'; btn.classList.remove('ind-btn-save-err'); }, 2000);
  }
}

// ── Run queue — right column ────────────────────────────────────

function _renderRunConfigs() {
  const el = document.getElementById('tconf-run-conf-list');
  if (!el) return;
  const queued = _configs.filter(c => _runCheckedIds.has(c.id));
  const inRun  = _runQueueIdx >= 0;
  if (!queued.length) {
    el.innerHTML = '<div class="run-queue-empty">No ticker configs queued — click ▶ to add</div>';
    return;
  }
  el.innerHTML = queued.map((c, i) => {
    const r = _runResults[c.id];
    let statusHtml = '';
    if (r) {
      if (r.status === 'pending') {
        statusHtml = `<div class="rq-info"><span class="rq-state rq-pending">waiting</span></div>`;
      } else if (r.status === 'running') {
        const pct = r.total > 0 ? (r.done / r.total * 100) : 0;
        statusHtml = `<div class="rq-bar-track"><div class="rq-bar-fill rq-running" style="width:${pct}%"></div></div>
                      <div class="rq-info"><span class="rq-state rq-running">fetching…</span><span class="rq-count">${r.done} / ${r.total || '?'}</span></div>`;
      } else if (r.status === 'done') {
        const hasErr = r.errors > 0;
        statusHtml = `<div class="rq-bar-track"><div class="rq-bar-fill ${hasErr ? 'rq-errors' : 'rq-done'}" style="width:100%"></div></div>
                      <div class="rq-info"><span class="rq-state ${hasErr ? 'rq-errors' : 'rq-done'}">${hasErr ? `✗ ${r.errors} error${r.errors !== 1 ? 's' : ''}` : '✓ done'}</span><span class="rq-count">${r.done} / ${r.total}</span></div>`;
      } else if (r.status === 'error') {
        statusHtml = `<div class="rq-bar-track"><div class="rq-bar-fill rq-errors" style="width:100%"></div></div>
                      <div class="rq-info"><span class="rq-state rq-errors">✗ ${_esc(r.error || 'error')}</span></div>`;
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
}

function _isRunning() {
  return _runQueueIdx >= 0;
}

// The single ▶ Run button always runs whatever's queued (matching Indicators/
// Scanner/Pipeline) — queue at least one ticker config with its ▶ button or Space first.
async function _startRun() {
  if (_isRunning()) return;
  const ids = _configs.filter(c => _runCheckedIds.has(c.id)).map(c => c.id);
  if (!ids.length) return;
  for (const id of ids) {
    const cfg = _configs.find(c => c.id === id);
    if (!cfg.ticker_list || !(cfg.timeframes || []).length) {
      alert(`Ticker config "${cfg.name}" is missing a ticker list or timeframe — fix it before running.`);
      return;
    }
  }
  _runQueue    = ids;
  _runQueueIdx = 0;
  _runResults  = {};
  for (const id of _runQueue) _runResults[id] = { status: 'pending' };
  document.getElementById('btn-run-tconf').disabled = true;
  _renderRunConfigs();
  await _kickQueueItem();
}

async function _kickQueueItem() {
  const id = _runQueue[_runQueueIdx];
  _runResults[id] = { status: 'running', done: 0, total: 0, errors: 0 };
  _renderRunConfigs();
  await _queueDisplayConfig(id);
  _resetProgressUI();
  document.getElementById('tconf-run-total').textContent = `Config ${_runQueueIdx + 1} / ${_runQueue.length}`;
  document.getElementById('btn-run-tconf').disabled = true;
  const cfg = _configs.find(c => c.id === id);
  try {
    await api.post('/api/fetch/batch', { ticker_list: cfg.ticker_list, timeframes: cfg.timeframes });
  } catch (err) {
    _failRun(err.message || 'Failed to start fetch job');
    return;
  }
  _startPolling();
}

// Called after a ticker config's fetch reaches a terminal state (done). Advances
// to the next queued config, or finishes the run if that was the last one.
async function _afterConfigFinished() {
  _runQueueIdx++;
  if (_runQueueIdx < _runQueue.length) {
    await _kickQueueItem();
  } else {
    _finishQueueRun();
  }
}

function _finishQueueRun() {
  _runQueue    = [];
  _runQueueIdx = -1;
  document.getElementById('btn-run-tconf').disabled = false;
  _renderList();       // re-syncs each ▶ button's disabled state now that _isRunning() is false
  _renderRunConfigs();
}

// A fetch failure aborts the rest of the run (matching Indicators/Scanner/
// Pipeline) — remaining queued configs stay queued so the user can retry.
function _abortQueue(id, msg) {
  if (_runResults[id]) _runResults[id] = { status: 'error', error: msg };
  _runQueue    = [];
  _runQueueIdx = -1;
  document.getElementById('btn-run-tconf').disabled = false;
  _renderList();       // re-syncs each ▶ button's disabled state now that _isRunning() is false
  _renderRunConfigs();
}

// Never alert() here — this can be reached from a poll callback, and a
// blocking dialog would freeze the tab. The failure shows inline in the
// ticker config's run-queue row instead; the rest of the run queue is aborted.
function _failRun(msg) {
  _stopPolling();
  _abortQueue(_activeId, msg);
}

function _clearRun() {
  if (_isRunning()) return;
  _runCheckedIds.clear();
  _runResults = {};
  _saveRunQueue();
  _renderList();
  _renderRunConfigs();
}

function _resetProgressUI() {
  document.getElementById('tconf-overall').style.display = 'none';
  document.getElementById('tconf-output-idle').style.display = '';
}

function _updateProgress(state) {
  const idleEl    = document.getElementById('tconf-output-idle');
  const overall   = document.getElementById('tconf-overall');
  const track     = document.getElementById('tconf-track');
  const bar       = document.getElementById('tconf-bar');
  const meta      = document.getElementById('tconf-meta');
  const count     = document.getElementById('tconf-count');
  const pctEl     = document.getElementById('tconf-pct');
  const currentEl = document.getElementById('tconf-current');
  const errorsEl  = document.getElementById('tconf-errors');

  idleEl.style.display  = 'none';
  overall.style.display = '';
  const pct = state.total > 0 ? (state.done / state.total * 100) : 0;
  bar.style.width = `${pct}%`;
  const active = state.status === 'running';
  track.classList.toggle('active', active);
  bar.classList.toggle('active', active);
  meta.classList.toggle('active', active);
  count.textContent    = `${state.done} / ${state.total || '?'}`;
  pctEl.textContent    = state.total ? `${Math.round(pct)}%` : '…';
  currentEl.textContent = state.current ? `→ ${state.current}` : '';
  errorsEl.textContent  = state.errors > 0 ? `✗ ${state.errors}` : '';
}

// ── API key ───────────────────────────────────────────────────

let _hasApiKey = false;

async function _loadApiKey() {
  const data = await api.get('/api/settings/api-key');
  _hasApiKey = !!data.masked;
  document.getElementById('apikey-masked').textContent = data.masked || '(not set)';
  _setApiKeyEditMode(false);
}

function _setApiKeyEditMode(on) {
  document.getElementById('apikey-masked').style.display     = on ? 'none' : '';
  document.getElementById('apikey-input').style.display      = on ? '' : 'none';
  document.getElementById('btn-apikey-save').style.display   = on ? '' : 'none';
  document.getElementById('btn-apikey-cancel').style.display = on ? '' : 'none';
  const addBtn = document.getElementById('btn-apikey-add');
  const isKeySet = !on && _hasApiKey;
  addBtn.disabled = on || _hasApiKey;
  addBtn.textContent = isKeySet ? '+ Add Key ✓' : '+ Add Key';
  addBtn.title = isKeySet ? 'API key is already set — delete it to add a new one' : 'Add your Tiingo API key';
  addBtn.classList.toggle('key-set-check', isKeySet);
  document.getElementById('btn-apikey-edit').disabled   = on || !_hasApiKey;
  document.getElementById('btn-apikey-verify').disabled = on || !_hasApiKey;
  document.getElementById('btn-apikey-delete').disabled = on || !_hasApiKey;
  if (on) {
    document.getElementById('apikey-input').value = '';
    document.getElementById('apikey-input').focus();
  }
}

async function _saveApiKey() {
  const key = document.getElementById('apikey-input').value.trim();
  if (!key) return;
  const data = await api.put('/api/settings/api-key', { key });
  _hasApiKey = !!data.masked;
  document.getElementById('apikey-masked').textContent = data.masked || '(not set)';
  document.getElementById('apikey-status').textContent = '';
  document.getElementById('apikey-status').className = 'apikey-status';
  _setApiKeyEditMode(false);
}

async function _verifyApiKey() {
  const statusEl = document.getElementById('apikey-status');
  statusEl.textContent = '…';
  statusEl.className = 'apikey-status';
  const data = await api.post('/api/settings/api-key/verify');
  if (data.valid) {
    statusEl.textContent = '✓ valid';
    statusEl.className = 'apikey-status apikey-ok';
  } else {
    statusEl.textContent = `✗ ${data.detail || 'invalid'}`;
    statusEl.className = 'apikey-status apikey-err';
  }
}

// ── Tiingo list info ──────────────────────────────────────────

async function _loadTiingoListInfo() {
  const meta = document.getElementById('tiingo-list-meta');
  try {
    const data = await api.get('/api/tickers/list-info');
    if (data.exists) {
      meta.textContent = `${data.rows.toLocaleString()} tickers · updated ${data.updated_at}`;
    } else {
      meta.textContent = 'Not downloaded yet';
    }
  } catch {
    meta.textContent = '';
  }
}

// ── Stats ─────────────────────────────────────────────────────

let _statsData   = null;
let _groupBy     = 'ticker';
let _groupSort   = { col: 'key', dir: 'asc' };

let _statsDetailTf     = 'daily';
let _statsDetailTicker = null;

function _fmtBars(n) {
  return n >= 1e6 ? (n/1e6).toFixed(1)+'M' : n >= 1e3 ? (n/1e3).toFixed(0)+'K' : String(n);
}

async function _loadStats() {
  const tbody = document.getElementById('stats-body');
  tbody.innerHTML = '<tr><td colspan="8" class="stats-empty" style="color:var(--t3)">Loading…</td></tr>';
  try {
    _statsData = await api.get('/api/stats');
  } catch {
    tbody.innerHTML = '<tr><td colspan="8" class="stats-empty">Failed to load stats.</td></tr>';
    return;
  }
  _renderStatsGrouped();
}

function _renderStatsGrouped() {
  const raw = (_statsData && _statsData.stats) || [];
  document.getElementById('stats-summary').innerHTML = '';

  const _keyOf = r => {
    switch (_groupBy) {
      case 'ticker':     return r.ticker;
      case 'timeframe':  return r.timeframe;
      case 'list':       return r.ticker_list || '—';
      case 'bars':       return String(r.rows);
      case 'first_date': return r.first_date || '';
      case 'last_date':  return r.last_date  || '';
      default:           return r.ticker;
    }
  };

  const groups = {};
  for (const r of raw) {
    const key = _keyOf(r);
    if (!groups[key]) groups[key] = {
      bars: 0, tickers: new Set(), timeframes: new Set(), lists: new Set(),
      firstDate: '', lastDate: '', sampleRow: r
    };
    const g = groups[key];
    g.tickers.add(r.ticker);
    g.timeframes.add(r.timeframe);
    g.lists.add(r.ticker_list || '—');
    g.bars += r.rows;
    if (!g.firstDate || (r.first_date && r.first_date < g.firstDate)) g.firstDate = r.first_date;
    if (!g.lastDate  || (r.last_date  && r.last_date  > g.lastDate))  g.lastDate  = r.last_date;
  }

  let entries = Object.entries(groups);
  const dir = _groupSort.dir === 'asc' ? 1 : -1;
  if (_groupSort.col === 'key') {
    if (_groupBy === 'bars') {
      entries.sort(([a], [b]) => dir * (Number(a) - Number(b)));
    } else {
      entries.sort(([a], [b]) => dir * String(a || '').localeCompare(String(b || '')));
    }
  } else {
    const sortFns = {
      ticker:     ([, a], [, b]) => a.tickers.size    - b.tickers.size,
      timeframe:  ([, a], [, b]) => a.timeframes.size - b.timeframes.size,
      list:       ([, a], [, b]) => a.lists.size      - b.lists.size,
      bars:       ([, a], [, b]) => a.bars             - b.bars,
      first_date: ([, a], [, b]) => String(a.firstDate || '').localeCompare(String(b.firstDate || '')),
      last_date:  ([, a], [, b]) => String(a.lastDate  || '').localeCompare(String(b.lastDate  || '')),
    };
    const fn = sortFns[_groupSort.col];
    if (fn) entries.sort((a, b) => dir * fn(a, b));
  }

  const COLS   = ['ticker', 'timeframe', 'list', 'bars', 'first_date', 'last_date'];
  const LABELS = { ticker: 'Ticker', timeframe: 'Timeframe', list: 'List', bars: 'Bars', first_date: 'Start Date', last_date: 'Last Date' };

  const theadRow = document.getElementById('stats-thead-row');
  const mkTh = (label, col) => {
    const isGroup = col === _groupBy;
    const isSort  = _groupSort.col === col || (_groupSort.col === 'key' && isGroup);
    const cls = ['stats-th-sort', (isGroup || isSort) ? 'stats-th-pivot' : ''].filter(Boolean).join(' ');
    const arrow = isSort ? (_groupSort.dir === 'asc' ? ' ↑' : ' ↓') : '';
    return `<th class="${cls}" data-col="${col}">${label}${arrow}</th>`;
  };
  theadRow.innerHTML = [
    '<th class="ind-db-th-idx"></th>',
    ...COLS.map(col => mkTh(LABELS[col], col)),
    '<th></th>',
  ].join('');

  for (const th of theadRow.querySelectorAll('.stats-th-sort')) {
    th.addEventListener('click', () => {
      const col = th.dataset.col;
      if (col === _groupBy) {
        _groupSort = { col: 'key', dir: _groupSort.dir === 'asc' ? 'desc' : 'asc' };
      } else {
        _groupBy   = col;
        _groupSort = { col: 'key', dir: 'asc' };
      }
      _renderStatsGrouped();
    });
  }

  const tbody = document.getElementById('stats-body');
  if (!entries.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="stats-empty">No data in database yet.</td></tr>';
    return;
  }

  const _cellVal = (col, g) => {
    switch (col) {
      case 'ticker':     return `<span class="ind-db-dim-link">${g.tickers.size}</span>`;
      case 'timeframe':  return `<span class="ind-db-dim-link">${[...g.timeframes].sort().join(', ')}</span>`;
      case 'list':       return `<span class="ind-db-dim-link">${g.lists.size === 1 ? _esc([...g.lists][0]) : g.lists.size}</span>`;
      case 'bars':       return `<span class="ind-db-dim-link">${_fmtBars(g.bars)}</span>`;
      case 'first_date': return `<span class="ind-db-dim-link">${g.firstDate || '—'}</span>`;
      case 'last_date':  return `<span class="ind-db-dim-link">${g.lastDate  || '—'}</span>`;
    }
  };

  tbody.innerHTML = '';
  entries.forEach(([key, g], rowIdx) => {
    const tr = document.createElement('tr');
    tr.className = 'ind-db-summary-row';
    const keyDisplay = _groupBy === 'bars' ? _fmtBars(Number(key)) : _esc(key || '—');
    tr.innerHTML = `<td class="ind-db-td-idx">${rowIdx + 1}</td>` +
      COLS.map(col => `<td>${col === _groupBy ? keyDisplay : _cellVal(col, g)}</td>`).join('') +
      `<td class="ind-db-td-del"><button class="tbl-del-btn" title="Delete this group">×</button></td>`;

    const tds = tr.querySelectorAll('td');
    COLS.forEach((col, idx) => {
      if (col === _groupBy) return;
      tds[idx + 1].addEventListener('click', e => {
        e.stopPropagation();
        _groupBy   = col;
        _groupSort = { col: 'key', dir: 'asc' };
        _renderStatsGrouped();
      });
    });

    tr.querySelector('.tbl-del-btn').addEventListener('click', async e => {
      e.stopPropagation();
      if (!confirm('Delete data for this group?')) return;
      await _deleteStatsGroup(key, g);
      _loadStats();
    });

    tr.addEventListener('click', () => _openStatsDetail(g.sampleRow.ticker, g.sampleRow.timeframe));
    tbody.appendChild(tr);
  });
}

async function _deleteStatsGroup(key, g) {
  const qs = p => Object.entries(p).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  if (_groupBy === 'ticker') {
    await api.del(`/api/data/ohlcv/ticker/${encodeURIComponent(key)}`);
  } else if (_groupBy === 'timeframe') {
    await api.del(`/api/data/ohlcv/timeframe/${encodeURIComponent(key)}`);
  } else if (_groupBy === 'list' && key !== '—') {
    await api.del(`/api/data/ohlcv/list/${encodeURIComponent(key)}`);
  } else {
    const raw = (_statsData && _statsData.stats) || [];
    const matching = raw.filter(r => {
      switch (_groupBy) {
        case 'bars':       return String(r.rows)         === key;
        case 'first_date': return (r.first_date || '')   === key;
        case 'last_date':  return (r.last_date  || '')   === key;
        case 'list':       return (r.ticker_list || '—') === key;
        default:           return false;
      }
    });
    await Promise.all(matching.map(r =>
      api.del(`/api/data/ohlcv/ticker-tf?${qs({ ticker: r.ticker, timeframe: r.timeframe })}`)
    ));
  }
}

// ── DB card detail view ───────────────────────────────────────

function _wireStatsDetail() {
  document.getElementById('btn-stats-detail-back').addEventListener('click', _closeStatsDetail);
  document.getElementById('stats-detail-tf-sel').addEventListener('change', async e => {
    _statsDetailTf = e.target.value;
    await _refreshStatsTickers();
  });
  document.getElementById('stats-detail-ticker-sel').addEventListener('change', e => {
    _statsDetailTicker = e.target.value;
    _loadStatsPreview();
  });
}

function _openStatsDetail(ticker, timeframe) {
  _statsDetailTicker = ticker;
  _statsDetailTf     = timeframe;
  document.getElementById('stats-db-summary-view').style.display = 'none';
  document.getElementById('stats-db-detail-view').style.display  = 'flex';
  document.getElementById('stats-db-table').innerHTML = '';
  _refreshDetailSelectors(ticker, timeframe);
}

function _closeStatsDetail() {
  document.getElementById('stats-db-detail-view').style.display  = 'none';
  document.getElementById('stats-db-summary-view').style.display = 'flex';
}

function _refreshDetailSelectors(preferTicker, preferTf) {
  const tfSel = document.getElementById('stats-detail-tf-sel');
  const TF_ORDER = ['daily', 'weekly', '1hour', '4hour', '5min'];
  const available = [...new Set(((_statsData && _statsData.stats) || []).map(r => r.timeframe))]
    .sort((a, b) => {
      const ai = TF_ORDER.indexOf(a), bi = TF_ORDER.indexOf(b);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });
  tfSel.innerHTML = '';
  for (const tf of available) {
    const o = document.createElement('option'); o.value = tf; o.textContent = tf; tfSel.appendChild(o);
  }
  const targetTf = preferTf && available.includes(preferTf) ? preferTf : available[0] || '';
  tfSel.value    = targetTf;
  tfSel.disabled = available.length <= 1;
  _statsDetailTf = targetTf;
  _refreshStatsTickers(preferTicker);
}

async function _refreshStatsTickers(preferTicker) {
  const tickerSel = document.getElementById('stats-detail-ticker-sel');
  tickerSel.innerHTML = '<option disabled>Loading…</option>';
  tickerSel.disabled  = true;
  let tickers = [];
  try {
    const data = await api.get(`/api/data/ohlcv/tickers-list?timeframe=${encodeURIComponent(_statsDetailTf)}`);
    tickers = data.tickers || [];
  } catch {}
  tickerSel.innerHTML = '';
  for (const t of tickers) {
    const o = document.createElement('option'); o.value = t; o.textContent = t; tickerSel.appendChild(o);
  }
  const target = preferTicker && tickers.includes(preferTicker) ? preferTicker : tickers[0] || '';
  tickerSel.value    = target;
  tickerSel.disabled = tickers.length <= 1;
  _statsDetailTicker = target;
  _loadStatsPreview();
}

async function _loadStatsPreview() {
  if (!_statsDetailTicker || !_statsDetailTf) return;
  const tableEl = document.getElementById('stats-db-table');
  tableEl.innerHTML = '<tr><td style="color:var(--t3);padding:8px 12px;font-size:11px;">Loading…</td></tr>';
  let data;
  try {
    data = await api.get(
      `/api/data/ohlcv/preview?ticker=${encodeURIComponent(_statsDetailTicker)}&timeframe=${encodeURIComponent(_statsDetailTf)}`
    );
  } catch {
    tableEl.innerHTML = '<tr><td style="color:var(--t3);padding:8px 12px;font-size:11px;">Failed to load.</td></tr>';
    return;
  }
  const COLS = ['date', 'open', 'high', 'low', 'close', 'volume'];
  const thead = `<thead><tr>${COLS.map(c => `<th class="ind-db-th-ohlcv">${_esc(c)}</th>`).join('')}</tr></thead>`;
  const tbody = `<tbody>${(data.rows || []).map(row =>
    `<tr>${COLS.map(c => {
      const v = row[c];
      const display = v === null || v === undefined ? '<span class="ind-db-null">—</span>' : _esc(String(v));
      return `<td class="ind-db-td-ohlcv">${display}</td>`;
    }).join('')}</tr>`
  ).join('')}</tbody>`;
  tableEl.innerHTML = thead + tbody;
}

// ── History ───────────────────────────────────────────────────

async function _loadHistory() {
  const tbody = document.getElementById('history-body');
  tbody.innerHTML = '<tr><td colspan="8" class="stats-empty" style="color:var(--t3)">Loading…</td></tr>';
  let data;
  try {
    data = await api.get('/api/fetch-history');
  } catch {
    tbody.innerHTML = '<tr><td colspan="8" class="stats-empty">Failed to load history.</td></tr>';
    return;
  }
  const rows = data.history || [];
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="stats-empty">No history yet.</td></tr>';
    return;
  }
  tbody.innerHTML = rows.map((r, i) => `
    <tr data-session="${r.session}" data-timeframe="${r.timeframe}" data-list="${r.ticker_list !== '—' ? r.ticker_list : ''}">
      <td class="ind-db-td-idx">${i + 1}</td>
      <td>${_esc(r.session)}</td>
      <td>${_esc(r.ticker_list)}</td>
      <td>${_esc(r.timeframe)}</td>
      <td>${r.tickers.toLocaleString()}</td>
      <td>${r.first_date}</td>
      <td>${r.last_date}</td>
      <td><button class="scan-history-del" title="Delete this history entry">✕</button></td>
    </tr>
  `).join('');
}

function _wireHistoryTable() {
  document.getElementById('history-body').addEventListener('click', async e => {
    const btn = e.target.closest('.scan-history-del');
    if (!btn) return;
    const tr = btn.closest('tr');
    const session  = tr.dataset.session;
    const timeframe = tr.dataset.timeframe;
    const list     = tr.dataset.list;
    const params   = new URLSearchParams({ session, timeframe });
    if (list) params.set('ticker_list', list);
    await api.del(`/api/fetch-history/entry?${params}`);
    _loadHistory();
  });
}

// ── Buttons ───────────────────────────────────────────────────

function _wireButtons() {
  document.getElementById('btn-single-queue-refresh').addEventListener('click', _renderSingleQueue);
  document.getElementById('btn-single-queue-clear').addEventListener('click', () => {
    if (_singleRunning) return;
    _singleQueue = []; _singleResults = {};
    _saveSingleQueue(); _renderSingleQueue();
  });
  document.getElementById('btn-single-fetch').addEventListener('click', _runSingleQueue);

  document.getElementById('single-queue').addEventListener('click', e => {
    const btn = e.target.closest('.run-queue-remove');
    if (!btn || btn.disabled) return;
    const t = btn.dataset.ticker;
    const removedIdx = _singleQueue.findIndex(item => item.ticker === t);
    _singleQueue = _singleQueue.filter(item => item.ticker !== t);
    if (_selectedSingleIdx !== null) {
      if (_selectedSingleIdx === removedIdx) _selectedSingleIdx = null;
      else if (_selectedSingleIdx > removedIdx) _selectedSingleIdx--;
    }
    delete _singleResults[t];
    _saveSingleQueue();
    _renderSingleQueue();
  });

  // Global timeframe checkboxes update the currently selected queue item
  document.getElementById('single-tfs').addEventListener('change', () => {
    if (_selectedSingleIdx !== null && _selectedSingleIdx < _singleQueue.length) {
      _singleQueue[_selectedSingleIdx].timeframes = _getChecked('single-tfs');
      _saveSingleQueue();
      _renderSingleQueue();
    }
  });

  document.getElementById('btn-single-add').addEventListener('click', () => {
    const dd = document.getElementById('single-ticker-dd');
    const hi = dd.querySelector('.hi');
    _addSingleTicker(hi ? hi.dataset.ticker : document.getElementById('single-ticker').value);
  });

  document.getElementById('btn-apikey-add').addEventListener('click', () => _setApiKeyEditMode(true));
  document.getElementById('btn-apikey-edit').addEventListener('click', () => _setApiKeyEditMode(true));
  document.getElementById('btn-apikey-cancel').addEventListener('click', () => _setApiKeyEditMode(false));
  document.getElementById('btn-apikey-save').addEventListener('click', _saveApiKey);
  document.getElementById('btn-apikey-verify').addEventListener('click', _verifyApiKey);
  document.getElementById('btn-apikey-delete').addEventListener('click', async () => {
    const data = await api.del('/api/settings/api-key');
    _hasApiKey = !!data.masked;
    document.getElementById('apikey-masked').textContent = data.masked || '(not set)';
    document.getElementById('apikey-status').textContent = '';
    document.getElementById('apikey-status').className = 'apikey-status';
    _setApiKeyEditMode(false);
  });
  document.getElementById('apikey-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') _saveApiKey();
    if (e.key === 'Escape') _setApiKeyEditMode(false);
  });

  document.getElementById('btn-update-tickers').addEventListener('click', async () => {
    const btn  = document.getElementById('btn-update-tickers');
    const meta = document.getElementById('tiingo-list-meta');
    btn.disabled = true;
    btn.textContent = 'Downloading…';
    meta.textContent = 'Fetching from Tiingo…';
    meta.className = 'tiingo-ref-meta';
    try {
      const data = await api.post('/api/tickers/update-list');
      meta.textContent = `${data.rows.toLocaleString()} tickers · updated ${data.updated_at}`;
      meta.className = 'tiingo-ref-meta';
    } catch (err) {
      meta.textContent = `✗ ${err.message || 'Update failed'}`;
      meta.className = 'tiingo-ref-meta upload-err';
    }
    btn.disabled = false;
    btn.textContent = 'Update';
  });

  document.getElementById('btn-refresh-stats').addEventListener('click', () => {
    _loadStats();
    _loadHistory();
  });

  document.getElementById('btn-refresh-lists').addEventListener('click', () => _loadTickerLists());
  document.getElementById('ticker-list-items').addEventListener('click', async e => {
    const btn = e.target.closest('.ticker-list-del');
    if (!btn) return;
    const name = btn.dataset.list;
    if (!confirm(`Delete list "${name}"?`)) return;
    await api.del(`/api/ticker-lists/${encodeURIComponent(name)}`);
    _loadTickerLists();
  });
  document.getElementById('btn-history-refresh').addEventListener('click', () => _loadHistory());
  document.getElementById('btn-history-clear').addEventListener('click', async () => {
    if (!confirm('Clear all fetch history?')) return;
    await api.del('/api/fetch-history');
    _loadHistory();
  });
  _wireHistoryTable();
  _wireStatsDetail();

  document.getElementById('btn-clear-all').addEventListener('click', async () => {
    if (!confirm('Delete ALL data from the database? This includes OHLCV, indicators, and fetch history.')) return;
    await api.del('/api/data/all');
    _loadStats();
    _loadHistory();
  });

  _initTickerSearch();
}

function _wireTconfButtons() {
  document.getElementById('btn-new-tconf').addEventListener('click', _createTconf);
  document.getElementById('btn-save-tconf').addEventListener('click', _saveTconf);
  document.getElementById('btn-delete-tconf').addEventListener('click', _deleteTconf);
  document.getElementById('btn-run-tconf').addEventListener('click', _startRun);
  document.getElementById('btn-tconf-run-refresh').addEventListener('click', async () => {
    await _loadTickerLists();
    _renderRunConfigs();
  });
  document.getElementById('btn-tconf-run-clear').addEventListener('click', _clearRun);
  document.getElementById('tconf-run-conf-list').addEventListener('click', e => {
    const btn = e.target.closest('.run-queue-remove');
    if (!btn || btn.disabled) return;
    const id = +btn.dataset.id;
    _runCheckedIds.delete(id);
    delete _runResults[id];
    _saveRunQueue();
    _renderList();
    _renderRunConfigs();
  });
  document.getElementById('tconf-name').addEventListener('input', () => { _dirty = true; });
  document.getElementById('tconf-ticker-list').addEventListener('change', () => { _updateTconfListCount(); _dirty = true; });
  document.addEventListener('click', e => {
    const inWrap = document.getElementById('tconf-ticker-list-wrap').contains(e.target);
    const inDd   = document.getElementById('tconf-ticker-list-dd').contains(e.target);
    if (!inWrap && !inDd) _tconfListDdClose();
  });
}

// ── Single ticker autocomplete ────────────────────────────────

function _initTickerSearch() {
  const input = document.getElementById('single-ticker');
  const dd    = document.getElementById('single-ticker-dd');
  let debounce = null;
  let hiIdx    = -1;

  async function _navigate(dir) {
    const items = [...dd.querySelectorAll('.ticker-dd-item')];
    if (!items.length) return;
    // Going down: load more when within 3 of the bottom
    if (dir > 0 && hiIdx >= items.length - 3 && dd.dataset.hasMore) {
      await _ddFetch(dd.dataset.q || '', dd, parseInt(dd.dataset.offset || '0'), true);
    }
    // Going up past the first item: prepend tickers from earlier in the alphabet
    if (dir < 0 && hiIdx <= 0) {
      const added = await _ddFetchBefore(dd);
      if (added > 0) {
        hiIdx += added; // shift index to stay on same item after prepend
      } else {
        // Already at the very beginning — append the tail so wrap lands at the end
        await _ddFetchTail(dd);
      }
    }
    const allItems = [...dd.querySelectorAll('.ticker-dd-item')];
    hiIdx = (hiIdx + dir + allItems.length) % allItems.length;
    allItems.forEach((el, i) => el.classList.toggle('hi', i === hiIdx));
    allItems[hiIdx]?.scrollIntoView({ block: 'nearest' });
  }

  input.addEventListener('input', e => {
    e.target.value = e.target.value.toUpperCase();
    clearTimeout(debounce);
    hiIdx = -1;
    const q = e.target.value.trim();
    debounce = setTimeout(() => _ddFetch(q, dd), 120);
  });

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const hi = dd.querySelector('.hi');
      _addSingleTicker(hi ? hi.dataset.ticker : input.value);
      return;
    }
    if (e.key === 'Escape') { _ddHide(dd); return; }
    if (e.key === 'ArrowDown' || e.key === '-') { e.preventDefault(); _navigate(1);  return; }
    if (e.key === 'ArrowUp'   || e.key === '=') { e.preventDefault(); _navigate(-1); return; }
  });

  document.addEventListener('click', e => {
    if (!document.getElementById('single-ticker-wrap').contains(e.target)) _ddHide(dd);
  });
}

function _ddMakeItems(results) {
  return results.map(r => `
    <div class="ticker-dd-item" data-ticker="${r.ticker}">
      <span class="ticker-dd-sym">${r.ticker}</span>
      <span class="ticker-dd-exch">${r.exchange}</span>
      <span class="ticker-dd-type">${r.assetType}</span>
    </div>
  `).join('');
}

function _ddWireItems(dd) {
  dd.querySelectorAll('.ticker-dd-item:not([data-wired])').forEach(el => {
    el.dataset.wired = '1';
    el.addEventListener('mousedown', e => { e.preventDefault(); _addSingleTicker(el.dataset.ticker); });
  });
}

async function _ddFetch(q, dd, offset = 0, append = false) {
  const data = await api.get(`/api/tickers/search?q=${encodeURIComponent(q)}&offset=${offset}`);
  const results = data.results || [];
  if (!append && !results.length) { _ddHide(dd); return; }
  if (append) {
    const frag = document.createElement('div');
    frag.innerHTML = _ddMakeItems(results);
    while (frag.firstChild) dd.appendChild(frag.firstChild);
  } else {
    dd.innerHTML = _ddMakeItems(results);
    dd.style.display = 'block';
  }
  dd.dataset.q       = q;
  dd.dataset.offset  = data.offset ?? (offset + results.length);
  dd.dataset.hasMore = data.has_more ? '1' : '';
  _ddWireItems(dd);
}

async function _ddFetchBefore(dd) {
  const firstTicker = dd.querySelector('.ticker-dd-item')?.dataset.ticker;
  if (!firstTicker) return 0;
  const data = await api.get(`/api/tickers/search?before=${encodeURIComponent(firstTicker)}`);
  const results = data.results || [];
  if (!results.length) return 0;
  const frag = document.createElement('div');
  frag.innerHTML = _ddMakeItems(results);
  dd.insertBefore(frag, dd.firstChild);
  _ddWireItems(dd);
  return results.length;
}

async function _ddFetchTail(dd) {
  const data = await api.get('/api/tickers/search?before=~');
  const results = data.results || [];
  if (!results.length) return;
  const frag = document.createElement('div');
  frag.innerHTML = _ddMakeItems(results);
  while (frag.firstChild) dd.appendChild(frag.firstChild);
  _ddWireItems(dd);
}

function _ddHide(dd) {
  dd.style.display = 'none';
  dd.innerHTML = '';
}

// ── Drop zone ─────────────────────────────────────────────────

function _initDropZone() {
  const zone   = document.getElementById('drop-zone');
  const input  = document.getElementById('file-input');
  const browse = document.getElementById('btn-browse');

  browse.addEventListener('click', () => input.click());
  document.getElementById('btn-add-list').addEventListener('click', () => input.click());
  input.addEventListener('change', () => {
    if (input.files[0]) _uploadFile(input.files[0]);
    input.value = '';
  });

  zone.addEventListener('click', e => { if (e.target !== browse) input.click(); });
  zone.addEventListener('dragover',  e => { e.preventDefault(); zone.classList.add('drag-over'); });
  zone.addEventListener('dragleave', e => { if (!zone.contains(e.relatedTarget)) zone.classList.remove('drag-over'); });
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) _uploadFile(file);
  });
}

async function _uploadFile(file) {
  const statusEl = document.getElementById('upload-status');
  if (!file.name.toLowerCase().endsWith('.csv')) {
    statusEl.textContent = '✗ CSV files only';
    statusEl.className = 'upload-status upload-err';
    return;
  }
  statusEl.textContent = `Uploading ${file.name}…`;
  statusEl.className = 'upload-status';
  const form = new FormData();
  form.append('file', file);
  try {
    const res  = await fetch('/api/ticker-lists/upload', { method: 'POST', body: form });
    const data = await res.json();
    if (!res.ok) {
      statusEl.textContent = `✗ ${data.detail || 'Upload failed'}`;
      statusEl.className = 'upload-status upload-err';
    } else {
      statusEl.textContent = `✓ ${data.name} — ${data.count.toLocaleString()} tickers`;
      statusEl.className = 'upload-status upload-ok';
      await _loadTickerLists();
    }
  } catch {
    statusEl.textContent = '✗ Network error';
    statusEl.className = 'upload-status upload-err';
  }
}

// ── Polling — drives the ticker-config run queue, and also reconciles
// a fetch job that was already running server-side when the page loaded ──

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
  const state = data.fetch;
  if (_runQueueIdx >= 0) {
    _updateProgress(state);
    const mapped = state.status === 'running' ? 'running' : state.status === 'done' ? 'done' : 'error';
    _runResults[_activeId] = {
      status: mapped, done: state.done, total: state.total, errors: state.errors,
      error: mapped === 'error' ? state.status : undefined,
    };
    _renderRunConfigs();
  }
  if (state.status !== 'running') {
    _stopPolling();
    if (_runQueueIdx < 0) {
      // Reconciling a job that was already running when the page loaded —
      // no active queue run on this tab, nothing to advance.
      _loadStats();
      _loadHistory();
      return;
    }
    if (state.status === 'done') {
      await _loadStats();
      await _loadHistory();
      await _afterConfigFinished();
    } else {
      _failRun(`fetch job ${state.status}`);
    }
  }
}

// ── Keyboard ──────────────────────────────────────────────────

document.addEventListener('keydown', e => {
  if (e.key === '/') { e.preventDefault(); toggleTheme(); return; }
  if (e.key === '`') { e.preventDefault(); window.location.href = '/indicators'; return; }
  if (e.key === '~') { e.preventDefault(); window.location.href = '/'; return; }
  if (e.key === 's' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); _saveTconf(); return; }
  if (e.key === 'Escape') {
    e.preventDefault();
    _setApiKeyEditMode(false);
    const tickerInput = document.getElementById('single-ticker');
    tickerInput.value = '';
    _ddHide(document.getElementById('single-ticker-dd'));
    _tconfListDdClose();
    _setTconfTfFocus(-1);
    document.activeElement?.blur();
    return;
  }
  // Matches Indicators/Scanner/Pipeline's convention for jumping to the
  // config name field.
  if (e.key === 'Enter' && e.shiftKey) {
    e.preventDefault();
    const nameEl = document.getElementById('tconf-name');
    if (nameEl) { nameEl.focus(); nameEl.select(); }
    return;
  }
  const active = document.activeElement;
  const tag = active?.tagName;
  // The Ticker List select is itself the target of -/= below, so once it has
  // focus (from a previous press) it must stay exempt from the generic guard.
  const isTconfListSelect = active?.id === 'tconf-ticker-list';
  if (isTconfListSelect && e.key === 'Enter') { e.preventDefault(); _tconfListDdClose(); return; }
  if (tag === 'INPUT' || tag === 'TEXTAREA' || (tag === 'SELECT' && !isTconfListSelect)) return;
  if (e.key === '-') { e.preventDefault(); _cycleTconfTickerList(1);  return; }
  if (e.key === '=') { e.preventDefault(); _cycleTconfTickerList(-1); return; }
  // Matches the -/= convention (the "first" key moves forward, the "second"
  // key moves backward — - is down/next, = is up/previous) rather than
  // reading order, so [ moves right/next and ] moves left/previous.
  if (e.key === '[') { e.preventDefault(); _moveTconfTfFocus(1);  return; }
  if (e.key === ']') { e.preventDefault(); _moveTconfTfFocus(-1); return; }
  if (e.key === 'Enter' && _tconfTfFocusIdx >= 0) { e.preventDefault(); _toggleTconfTfFocused(); return; }
  if (e.key === 'C' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); window.location.href = '/'; }
  if (e.key === 'T' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); window.location.href = '/fetch'; }
  if (e.key === 'I' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); window.location.href = '/indicators'; }
  if (e.key === 'S' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); window.location.href = '/scanner'; }
  if (e.key === 'P' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); window.location.href = '/pipeline'; }
  // Ticker config shortcuts — matches Indicators/Scanner/Pipeline conventions.
  if (e.key === 'N' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); _createTconf(); }
  if (e.key === 'D' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); _deleteTconf(); }
  if (e.key === 'R' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); _startRun(); }
  if (e.key === ' ') { e.preventDefault(); if (_activeId) _toggleQueued(_activeId); }
  if (e.key === '_') { e.preventDefault(); _cycleConfig(1); }
  if (e.key === '+') { e.preventDefault(); _cycleConfig(-1); }
  if (e.key === 'F' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); _runSingleQueue(); }
  if (e.key.length === 1 && /[a-z]/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
    e.preventDefault();
    const input = document.getElementById('single-ticker');
    input.focus();
    input.value = e.key.toUpperCase();
    input.dispatchEvent(new Event('input'));
  }
});

init();
initTheme();
initHelp('tickers');
