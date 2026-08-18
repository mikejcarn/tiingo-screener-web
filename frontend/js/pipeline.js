/**
 * pipeline.js — chains Fetch → Indicators → Scan for a saved pipeline config.
 *
 * Orchestration runs client-side: it calls the same three endpoints the
 * Tickers/Indicators/Scanner pages already use (POST /api/fetch/batch,
 * POST /api/indicators/batch, POST /api/scan/run), polling GET /api/jobs/status
 * between the first two (both are background jobs) and awaiting the third
 * (which is synchronous). Fetch and Indicators always run; Scan is optional —
 * a pipeline can stop after Indicators (e.g. for chart visualization/testing)
 * if no scan config is selected. The Scan dropdown is filtered to configs
 * compatible with the chosen indicator config (linked to it, or ticker-only).
 *
 * The sidebar/run-queue UI follows the Indicators and Scanner pages'
 * convention: each config row has a ▶ button (Space to toggle) that adds it
 * to a run queue shown in the Run card; the single ▶ Run button always runs
 * whatever's queued (_startRun/_kickQueueItem/_afterPipelineFinished), one
 * pipeline at a time. Queued pipelines that reference the same ticker config
 * only fetch once per run — later ones reuse the first fetch's result
 * (_fetchSigCache) instead of re-hitting
 * the Tiingo API for tickers a prior pipeline in the same run already pulled.
 * A stage failure aborts the rest of the queue (matching indicators.js/
 * scanner.js) but never alert()s — a blocking dialog would freeze the tab
 * mid-poll — the failure just shows inline in that pipeline's queue row.
 *
 * Stage 1 (Fetch) references a saved Ticker Config (list + timeframes,
 * managed on the Tickers page) by id, the same way Stage 2/3 reference an
 * Indicator/Scan config — the pipeline itself no longer stores a raw ticker
 * list + timeframe set directly.
 *
 * The run queue (queued_for_run) is persisted server-side, not just in
 * localStorage — a single global Schedule (backend/core/scheduler.py) can
 * run whatever's queued on a clock even with no browser open, so the ▶
 * toggle writes through to the server on every change.
 */
import { api }       from './api.js';
import { initHelp }  from './help.js';
import { initTheme, toggleTheme } from './theme.js';

const _esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

// 0=Monday .. 6=Sunday — matches Python's datetime.weekday(), which the
// backend scheduler compares against.
const ALL_WEEKDAYS = [
  { v: 0, label: 'Mon' }, { v: 1, label: 'Tue' }, { v: 2, label: 'Wed' },
  { v: 3, label: 'Thu' }, { v: 4, label: 'Fri' }, { v: 5, label: 'Sat' }, { v: 6, label: 'Sun' },
];

// ── State ─────────────────────────────────────────────────────
let _configs       = [];   // [{id, name, ticker_conf_id, ind_conf_id, scan_config_id, queued_for_run, updated_at}]
let _activeId      = null;
let _dirty         = false;
let _tickerConfigs = [];   // [{id, name, ticker_list, timeframes, updated_at}]
let _scanConfigs   = [];   // [{id, name, logic, ind_conf_id, updated_at}]
let _indConfigs    = [];   // [{id, name, ...}]

let _stageIdx     = -1;   // -1 idle, 0 fetch, 1 indicators, 2 scan
let _pollTimer    = null;
let _lastResults  = null; // last scan results array, for "open in chart"
let _fetchSummary = { tickers: 0, errors: 0 };
let _indSummary   = { tickers: 0, errors: 0 };

// ── Run queue (queue several pipeline configs, run them one after another) ──
let _runCheckedIds = new Set();   // config ids queued via the ▶ button — persisted like the other pages
let _runQueue       = [];         // ordered ids for the run currently in progress
let _runQueueIdx    = -1;         // -1 idle, else index into _runQueue
let _runResults     = {};         // id -> {status:'pending'|'running'|'done'|'error', stage?, error?, scanMatched?, scanTotal?}
let _fetchSigCache  = new Map();  // fetch signature -> {tickers, errors}, shared within one run

// ── Init ──────────────────────────────────────────────────────
(async function init() {
  initTheme();
  initHelp('pipeline');
  const [tickerConfData, scanData, indData] = await Promise.all([
    api.get('/api/ticker-configs'),
    api.get('/api/scan-configs'),
    api.get('/api/ind-configs'),
  ]);
  _tickerConfigs = tickerConfData.configs || [];
  _scanConfigs   = scanData.configs || [];
  _indConfigs    = indData.configs  || [];
  _populateTickerConfigSelect();
  _populateIndConfigSelect();
  _refreshScanConfigOptions();
  _buildScheduleDayChecks();
  _wireStatic();
  await _loadConfigs();
  await _loadHistory();
  await _loadSchedule();
})();

// ── Selects ───────────────────────────────────────────────────
function _populateTickerConfigSelect() {
  const sel = document.getElementById('pipeline-ticker-conf');
  const prev = sel.value;
  sel.innerHTML = '<option value="">— select —</option>';
  for (const c of _tickerConfigs) {
    const opt = document.createElement('option');
    opt.value = c.id; opt.textContent = c.name;
    sel.appendChild(opt);
  }
  if (prev) sel.value = prev;
}

function _populateIndConfigSelect() {
  const sel = document.getElementById('pipeline-ind-config');
  const prev = sel.value;
  sel.innerHTML = '<option value="">— select —</option>';
  for (const c of _indConfigs) {
    const opt = document.createElement('option');
    opt.value = c.id; opt.textContent = c.name;
    sel.appendChild(opt);
  }
  if (prev) sel.value = prev;
}

// Scan is optional and filtered to configs compatible with the chosen
// indicator config: ones linked to it, or ticker-only configs (no ind link).
function _refreshScanConfigOptions() {
  const indSel = document.getElementById('pipeline-ind-config');
  const sel     = document.getElementById('pipeline-scan-config');
  const indConfId = parseInt(indSel.value) || null;
  const prev = sel.value;

  const compatible = _scanConfigs.filter(c => !c.ind_conf_id || c.ind_conf_id === indConfId);
  sel.innerHTML = '<option value="">— none (stop after Indicators) —</option>';
  for (const c of compatible) {
    const opt = document.createElement('option');
    opt.value = c.id; opt.textContent = c.name;
    sel.appendChild(opt);
  }
  if (prev && compatible.some(c => String(c.id) === prev)) sel.value = prev;
  _updateScanHint(compatible.length);
}

function _updateScanHint(compatibleCount) {
  const el = document.getElementById('pipeline-scan-hint');
  const indSel = document.getElementById('pipeline-ind-config');
  if (!indSel.value) {
    el.textContent = 'Select an indicator config above to see compatible scan configs.';
  } else if (!compatibleCount) {
    el.textContent = 'No scan configs are linked to this indicator config yet — that\'s fine, leave unset to just fetch + compute.';
  } else {
    el.textContent = '';
  }
}

// ── Schedule ──────────────────────────────────────────────────
// One global schedule — when it fires, it runs whatever pipelines are
// currently queued (queued_for_run, the same set the ▶ Run button runs),
// in the same order. Not tied to any single pipeline config.
function _buildScheduleDayChecks() {
  const wrap = document.getElementById('pipeline-schedule-days');
  wrap.innerHTML = '';
  for (const d of ALL_WEEKDAYS) {
    const lbl = document.createElement('label');
    lbl.innerHTML = `<input type="checkbox" value="${d.v}"> ${d.label}`;
    wrap.appendChild(lbl);
  }
}

function _syncScheduleDayChecks(days) {
  const set = new Set(days || []);
  document.querySelectorAll('#pipeline-schedule-days input[type="checkbox"]')
    .forEach(cb => { cb.checked = set.has(parseInt(cb.value)); });
}

function _getScheduleCheckedDays() {
  return [...document.querySelectorAll('#pipeline-schedule-days input[type="checkbox"]:checked')]
    .map(cb => parseInt(cb.value));
}

function _updateScheduleHint() {
  const el      = document.getElementById('pipeline-schedule-hint');
  const enabled = document.getElementById('pipeline-schedule-enabled').checked;
  const time    = document.getElementById('pipeline-schedule-time').value;
  const days    = _getScheduleCheckedDays();
  if (!enabled) { el.textContent = ''; return; }
  if (!time || !days.length) {
    el.textContent = 'Pick a time and at least one day to activate the schedule.';
    return;
  }
  const dayLabel = days.length === 7 ? 'every day'
    : `every ${days.map(v => ALL_WEEKDAYS[v].label).join(', ')}`;
  el.textContent = `Runs the queued pipelines ${dayLabel} at ${time} (server-local time).`;
}

async function _loadSchedule() {
  const sched = await api.get('/api/pipeline-schedule');
  document.getElementById('pipeline-schedule-enabled').checked = !!sched.enabled;
  document.getElementById('pipeline-schedule-time').value = sched.time || '';
  _syncScheduleDayChecks(sched.days);
  _updateScheduleHint();
}

async function _saveSchedule() {
  const body = {
    enabled: document.getElementById('pipeline-schedule-enabled').checked,
    days: _getScheduleCheckedDays(),
    time: document.getElementById('pipeline-schedule-time').value || null,
  };
  const btn = document.getElementById('btn-save-schedule');
  try {
    await api.put('/api/pipeline-schedule', body);
    btn.textContent = 'Set ✓';
    btn.classList.add('ind-btn-save-ok');
    setTimeout(() => { btn.textContent = 'Set'; btn.classList.remove('ind-btn-save-ok'); }, 1800);
  } catch {
    btn.textContent = 'Failed ✗';
    btn.classList.add('ind-btn-save-err');
    setTimeout(() => { btn.textContent = 'Set'; btn.classList.remove('ind-btn-save-err'); }, 2000);
  }
}

// ── Run queue persistence ────────────────────────────────────
// Server-persisted (queued_for_run column), not just localStorage — the
// backend Schedule runs whatever's queued even with no browser open, so it
// needs to see the same queue state the UI shows.
function _setQueuedOnServer(id, queued) {
  api.put(`/api/pipeline-configs/${id}/queue`, { queued }).catch(() => {});
}

// ── Pipeline config list ─────────────────────────────────────
async function _loadConfigs() {
  const data = await api.get('/api/pipeline-configs');
  _configs = data.configs || [];
  _runCheckedIds = new Set(_configs.filter(c => c.queued_for_run).map(c => c.id));
  _renderList();
  _renderRunConfigs();
  let restoreId = null;
  try { restoreId = parseInt(localStorage.getItem('pipeline_selected_config_id')); } catch {}
  const target = (_configs.some(c => c.id === restoreId) ? restoreId : _configs[0]?.id) || null;
  if (target) {
    await _selectConfig(target);
  } else {
    _showEmpty(true);
  }
}

function _renderList() {
  const el = document.getElementById('pipeline-list');
  if (!_configs.length) { el.innerHTML = '<div class="ind-loading">No pipelines yet.</div>'; return; }
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
    qBtn.addEventListener('click', e => { e.stopPropagation(); _toggleQueued(cfg.id); });
    el.appendChild(item);
  }
}

function _toggleQueued(id) {
  let queued;
  if (_runCheckedIds.has(id)) { _runCheckedIds.delete(id); delete _runResults[id]; queued = false; }
  else { _runCheckedIds.add(id); queued = true; }
  _setQueuedOnServer(id, queued);
  _renderList();
  _renderRunConfigs();
}

function _renderRunConfigs() {
  const el = document.getElementById('pipeline-run-conf-list');
  if (!el) return;
  const queued = _configs.filter(c => _runCheckedIds.has(c.id));
  const inRun  = _runQueueIdx >= 0;
  if (!queued.length) {
    el.innerHTML = '<div class="run-queue-empty">No pipelines queued — click ▶ to add</div>';
    return;
  }
  el.innerHTML = queued.map((c, i) => {
    const result = _runResults[c.id];
    let statusHtml = '';
    if (result) {
      if (result.status === 'pending') {
        statusHtml = `<div class="rq-info"><span class="rq-state rq-pending">waiting</span></div>`;
      } else if (result.status === 'running') {
        const label = { fetch: 'fetching…', indicators: 'computing…', scan: 'scanning…' }[result.stage] || 'running…';
        statusHtml = `<div class="rq-bar-track"><div class="rq-bar-fill rq-running" style="width:100%"></div></div>
                      <div class="rq-info"><span class="rq-state rq-running">${label}</span></div>`;
      } else if (result.status === 'done') {
        const countText = result.scanTotal != null ? `${result.scanMatched} / ${result.scanTotal} matched` : 'indicators computed';
        statusHtml = `<div class="rq-bar-track"><div class="rq-bar-fill rq-done" style="width:100%"></div></div>
                      <div class="rq-info"><span class="rq-state rq-done">✓ done</span><span class="rq-count">${_esc(countText)}</span></div>`;
      } else if (result.status === 'error') {
        statusHtml = `<div class="rq-bar-track"><div class="rq-bar-fill rq-errors" style="width:100%"></div></div>
                      <div class="rq-info"><span class="rq-state rq-errors">✗ ${_esc(result.error || 'error')}</span></div>`;
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

function _cycleConfig(dir) {
  if (!_configs.length) return;
  const cur  = _configs.findIndex(c => c.id === _activeId);
  const next = (cur + dir + _configs.length) % _configs.length;
  _selectConfig(_configs[next].id);
}

// ── Stage-card keyboard focus (-/= cycle Fetch/Indicators/Scan, Enter opens) ──
const _STAGE_ORDER = ['fetch', 'indicators', 'scan'];
const _STAGE_FIELD  = { fetch: 'pipeline-ticker-conf', indicators: 'pipeline-ind-config', scan: 'pipeline-scan-config' };
let _focusedStage = null; // 'fetch' | 'indicators' | 'scan' | null

function _setStageFocus(stage) {
  document.querySelector('.pipeline-stage-card.kb-focused')?.classList.remove('kb-focused');
  _focusedStage = stage || null;
  if (!_focusedStage) return;
  const card = document.querySelector(`.pipeline-stage-card[data-stage="${_focusedStage}"]`);
  if (card) { card.classList.add('kb-focused'); card.scrollIntoView({ block: 'nearest' }); }
}

function _moveStageFocus(dir) {
  const cur  = _focusedStage ? _STAGE_ORDER.indexOf(_focusedStage) : -1;
  const next = (cur + dir + _STAGE_ORDER.length) % _STAGE_ORDER.length;
  _setStageFocus(_STAGE_ORDER[next]);
}

// Focuses the kb-focused stage's primary control and opens it — plain .focus()
// moves keyboard focus but doesn't visually pop a <select>'s option list open,
// so it looks like nothing happened; showPicker() actually opens it.
function _activateFocusedStage() {
  if (!_focusedStage) return;
  const el = document.getElementById(_STAGE_FIELD[_focusedStage]);
  if (!el) return;
  el.focus();
  try { el.showPicker?.(); } catch {}
}

// ── Schedule card keyboard focus (↑/↓ cycle its fields, Enter activates) ──
// The Schedule card is a single standalone section, not one of several
// competing cards like the stage cards above — so there's no -/= "outer"
// layer to protect here, ArrowUp/ArrowDown drive it directly. The Set
// button is included as the last stop so saving fits the same type-aware
// Enter convention instead of needing a key of its own.
function _scheduleNavItems() {
  return [
    document.getElementById('pipeline-schedule-enabled')?.closest('label'),
    document.getElementById('pipeline-schedule-time'),
    ...document.querySelectorAll('#pipeline-schedule-days label'),
    document.getElementById('btn-save-schedule'),
  ].filter(Boolean);
}

function _setScheduleFocus(el) {
  document.querySelector('.pipeline-schedule-card .kb-focused')?.classList.remove('kb-focused');
  if (!el) return;
  el.classList.add('kb-focused');
  el.scrollIntoView({ block: 'nearest' });
}

function _moveScheduleFocus(dir) {
  const items = _scheduleNavItems();
  if (!items.length) return;
  const cur  = items.findIndex(el => el.classList.contains('kb-focused'));
  const next = (cur + dir + items.length) % items.length;
  _setScheduleFocus(items[next]);
}

function _activateScheduleFocused() {
  const el = document.querySelector('.pipeline-schedule-card .kb-focused');
  if (!el) return false;
  if (el.id === 'btn-save-schedule') { el.click(); return true; }
  if (el.tagName === 'INPUT' && el.type === 'time') {
    el.focus();
    try { el.showPicker?.(); } catch {}
    return true;
  }
  const cb = el.querySelector('input[type="checkbox"]');
  if (cb) { cb.checked = !cb.checked; cb.dispatchEvent(new Event('change', { bubbles: true })); return true; }
  return false;
}

async function _selectConfig(id) {
  if (_dirty && _activeId && !confirm('Discard unsaved changes?')) return;
  _activeId = id; _dirty = false;
  try { localStorage.setItem('pipeline_selected_config_id', id); } catch {}
  _renderList();
  _setStageFocus(null);
  const cfg = await api.get(`/api/pipeline-configs/${id}`);
  _showEmpty(false);
  _populateEditorFields(cfg);
  _renderConfDates(cfg);
  _clearResults();
  _resetRun();
}

function _populateEditorFields(cfg) {
  document.getElementById('pipeline-name').value = cfg.name;
  document.getElementById('pipeline-ticker-conf').value = cfg.ticker_conf_id || '';
  document.getElementById('pipeline-ind-config').value = cfg.ind_conf_id || '';
  _refreshScanConfigOptions();
  document.getElementById('pipeline-scan-config').value = cfg.scan_config_id || '';
}

// Switches the editor to display a queued pipeline without the dirty-confirm
// or run-state reset that _selectConfig does (the queue driver owns those).
async function _queueDisplayConfig(id) {
  _activeId = id; _dirty = false;
  try { localStorage.setItem('pipeline_selected_config_id', id); } catch {}
  _renderList();
  _setStageFocus(null);
  const cfg = await api.get(`/api/pipeline-configs/${id}`);
  _showEmpty(false);
  _populateEditorFields(cfg);
  _renderConfDates(cfg);
  return cfg;
}

function _renderConfDates(cfg) {
  const el = document.getElementById('pipeline-conf-dates');
  const parts = [];
  if (cfg.created_at) parts.push(`created ${cfg.created_at.slice(0, 10)}`);
  if (cfg.updated_at) parts.push(`updated ${cfg.updated_at.slice(0, 10)}`);
  el.textContent = parts.join(' · ');
}

function _showEmpty(yes) {
  document.getElementById('pipeline-empty').style.display  = yes ? 'flex' : 'none';
  document.getElementById('pipeline-editor').style.display = yes ? 'none' : 'flex';
}

async function _createConfig() {
  const created = await api.post('/api/pipeline-configs');
  _configs.push(created);
  _renderList();
  await _selectConfig(created.id);
  const nameEl = document.getElementById('pipeline-name');
  nameEl.focus(); nameEl.select();
}

async function _deleteConfig() {
  if (!_activeId) return;
  const cfg = _configs.find(c => c.id === _activeId);
  if (!confirm(`Delete "${cfg?.name || 'this pipeline'}"? This cannot be undone.`)) return;
  await api.del(`/api/pipeline-configs/${_activeId}`);
  _configs = _configs.filter(c => c.id !== _activeId);
  _runCheckedIds.delete(_activeId);
  delete _runResults[_activeId];
  _activeId = null;
  _renderList();
  _renderRunConfigs();
  if (_configs.length) {
    await _selectConfig(_configs[0].id);
  } else {
    _showEmpty(true);
  }
}

async function _saveConfig() {
  if (!_activeId) return;
  const body = {
    name: document.getElementById('pipeline-name').value.trim() || 'Unnamed',
    ticker_conf_id: parseInt(document.getElementById('pipeline-ticker-conf').value) || null,
    ind_conf_id: parseInt(document.getElementById('pipeline-ind-config').value) || null,
    scan_config_id: parseInt(document.getElementById('pipeline-scan-config').value) || null,
  };
  const btn = document.getElementById('btn-save-pipeline');
  try {
    const saved = await api.put(`/api/pipeline-configs/${_activeId}`, body);
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

// ── Run orchestration ─────────────────────────────────────────

function _resetRun() {
  _stopPolling();
  _stageIdx = -1;
  _fetchSummary = { tickers: 0, errors: 0 };
  _indSummary   = { tickers: 0, errors: 0 };
  document.querySelectorAll('.pipeline-stage-chip').forEach(c => c.classList.remove('active', 'done', 'errored', 'skipped'));
  document.getElementById('pipeline-overall').style.display = 'none';
  document.getElementById('pipeline-output-idle').style.display = '';
}

function _isRunning() {
  return _runQueueIdx >= 0;
}

// The single ▶ Run button always runs whatever's queued (matching Indicators/
// Scanner) — queue at least one pipeline with its ▶ button or Space first.
async function _startRun() {
  if (_isRunning()) return;
  const ids = _configs.filter(c => _runCheckedIds.has(c.id)).map(c => c.id);
  if (!ids.length) return;
  for (const id of ids) {
    const cfg = _configs.find(c => c.id === id);
    if (!cfg.ticker_conf_id || !cfg.ind_conf_id) {
      alert(`Pipeline "${cfg.name}" is missing a ticker config or indicator config — fix it before running.`);
      return;
    }
  }
  _runQueue    = ids;
  _runQueueIdx = 0;
  _runResults  = {};
  for (const id of _runQueue) _runResults[id] = { status: 'pending' };
  _fetchSigCache = new Map();
  document.getElementById('btn-run-pipeline').disabled = true;
  _renderRunConfigs();
  await _kickQueueItem();
}

// A fetch signature identifies "what fetch/batch would do" for a pipeline —
// pipelines that share one only need that fetch run once per run. Since it's
// now a saved ticker config, the id alone is definitionally the same fetch work.
function _fetchSignature(cfg) {
  return String(cfg.ticker_conf_id);
}

async function _kickQueueItem() {
  const id = _runQueue[_runQueueIdx];
  _runResults[id] = { status: 'running', stage: 'fetch' };
  _renderRunConfigs();
  await _queueDisplayConfig(id);
  _clearResults();
  _resetRun();
  document.getElementById('btn-run-pipeline').disabled = true;
  await _kickFetchStage();
}

// Called after a pipeline's run reaches a terminal state (done). Advances to
// the next queued pipeline, or finishes the run if that was the last one.
async function _afterPipelineFinished() {
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
  document.getElementById('btn-run-pipeline').disabled = false;
  _renderRunConfigs();
  _loadHistory();
}

// A stage failure aborts the rest of the run (matching Indicators/Scanner) —
// remaining queued pipelines stay queued (_runCheckedIds is untouched) so the
// user can inspect the error and hit Run again once it's fixed.
function _abortQueue(id, msg) {
  if (_runResults[id]) _runResults[id] = { status: 'error', error: msg };
  _runQueue    = [];
  _runQueueIdx = -1;
  document.getElementById('btn-run-pipeline').disabled = false;
  _renderRunConfigs();
}

function _clearRun() {
  if (_isRunning()) return;
  _runCheckedIds.clear();
  _runResults = {};
  api.post('/api/pipeline-configs/clear-queue').catch(() => {});
  _renderList();
  _renderRunConfigs();
}

function _setStage(idx, extraClass) {
  _stageIdx = idx;
  const stages = ['fetch', 'indicators', 'scan'];
  document.querySelectorAll('.pipeline-stage-chip').forEach((chip, i) => {
    chip.classList.remove('active', 'done', 'errored');
    if (i < idx) chip.classList.add('done');
    else if (i === idx) chip.classList.add(extraClass || 'active');
  });
  document.getElementById('pipeline-stage-label').textContent = `${stages[idx] || ''} progress`;
}

// Pipeline configs only store a ticker_conf_id now — resolve the actual
// ticker_list/timeframes from the cached ticker configs list.
function _resolveTickerConfig(cfg) {
  return _tickerConfigs.find(tc => tc.id === cfg.ticker_conf_id) || null;
}

async function _kickFetchStage() {
  const cfg = _configs.find(c => c.id === _activeId);
  const sig = _fetchSignature(cfg);

  // Skip re-fetching a ticker config another queued pipeline already fetched
  // this run — go straight to Indicators.
  if (_fetchSigCache.has(sig)) {
    _setStage(0, 'done');
    _fetchSummary = _fetchSigCache.get(sig);
    document.getElementById('pipeline-stage-label').textContent = 'fetch skipped — shared with an earlier pipeline this run';
    await _kickIndStage(cfg.ind_conf_id);
    return;
  }

  _setStage(0);
  const tickerConf = _resolveTickerConfig(cfg);
  if (!tickerConf) {
    _failRun('Linked ticker config no longer exists');
    return;
  }
  try {
    await api.post('/api/fetch/batch', { ticker_list: tickerConf.ticker_list, timeframes: tickerConf.timeframes });
  } catch (err) {
    _failRun(err.message || 'Failed to start fetch job');
    return;
  }
  _startPolling('fetch');
}

async function _kickIndStage(indConfId) {
  _setStage(1);
  _runResults[_activeId] = { ..._runResults[_activeId], status: 'running', stage: 'indicators' };
  _renderRunConfigs();
  const cfg = _configs.find(c => c.id === _activeId);
  const tickerConf = _resolveTickerConfig(cfg);
  try {
    await api.post('/api/indicators/batch', { config_id: indConfId, ticker_list: tickerConf?.ticker_list });
  } catch (err) {
    _failRun(err.message || 'Failed to start indicators job');
    return;
  }
  _startPolling('indicators');
}

async function _kickScanStage() {
  _setStage(2);
  _runResults[_activeId] = { ..._runResults[_activeId], status: 'running', stage: 'scan' };
  _renderRunConfigs();
  const cfg = _configs.find(c => c.id === _activeId);
  const tickerConf = _resolveTickerConfig(cfg);
  document.getElementById('pipeline-overall').style.display = 'none';
  document.getElementById('pipeline-output-idle').style.display = '';
  document.getElementById('pipeline-output-idle').textContent = 'Running scan…';
  try {
    const data = await api.post('/api/scan/run', { config_id: cfg.scan_config_id, scope_ticker_list: tickerConf?.ticker_list });
    _lastResults = data.results || [];
    _renderResults(data);
    document.querySelectorAll('.pipeline-stage-chip').forEach(c => { c.classList.remove('active', 'errored'); c.classList.add('done'); });
    document.getElementById('pipeline-output-idle').textContent = 'Done.';
    await api.post('/api/pipeline/log', {
      config_id: _activeId, status: 'done',
      fetch_tickers: _fetchSummary.tickers, fetch_errors: _fetchSummary.errors,
      ind_tickers: _indSummary.tickers, ind_errors: _indSummary.errors,
      scan_run_id: data.run_id,
    });
    _runResults[_activeId] = { status: 'done', scanMatched: data.count, scanTotal: data.total };
    _renderRunConfigs();
    await _loadHistory();
    await _afterPipelineFinished();
  } catch (err) {
    _failRun(err.message || 'Scan failed');
  }
}

async function _finishWithoutScan() {
  const chips = document.querySelectorAll('.pipeline-stage-chip');
  chips.forEach(c => c.classList.remove('active', 'errored'));
  chips[0]?.classList.add('done');
  chips[1]?.classList.add('done');
  chips[2]?.classList.add('skipped');
  document.getElementById('pipeline-overall').style.display = 'none';
  document.getElementById('pipeline-output-idle').style.display = '';
  document.getElementById('pipeline-output-idle').textContent = 'Done — no scan configured, stopped after Indicators.';
  _clearResults();
  document.getElementById('pipeline-results-empty').textContent = 'No scan configured for this pipeline — indicators were computed for viewing/testing.';
  await api.post('/api/pipeline/log', {
    config_id: _activeId, status: 'done',
    fetch_tickers: _fetchSummary.tickers, fetch_errors: _fetchSummary.errors,
    ind_tickers: _indSummary.tickers, ind_errors: _indSummary.errors,
    scan_run_id: null,
  });
  _runResults[_activeId] = { status: 'done', scanMatched: null, scanTotal: null };
  _renderRunConfigs();
  await _loadHistory();
  await _afterPipelineFinished();
}

// Never alert() here — this can be reached from a poll callback, and a
// blocking dialog would freeze the tab. The failure shows inline in the
// pipeline's run-queue row instead; the rest of the run queue is aborted.
async function _failRun(msg) {
  _stopPolling();
  const chip = document.querySelectorAll('.pipeline-stage-chip')[Math.max(_stageIdx, 0)];
  chip?.classList.remove('active'); chip?.classList.add('errored');

  const id = _activeId;
  try {
    await api.post('/api/pipeline/log', {
      config_id: id, status: 'error',
      fetch_tickers: _fetchSummary.tickers, fetch_errors: _fetchSummary.errors,
      ind_tickers: _indSummary.tickers, ind_errors: _indSummary.errors,
      scan_run_id: null,
    });
  } catch {}
  _abortQueue(id, msg);
  await _loadHistory();
}

function _startPolling(job) {
  if (_pollTimer) return;
  _pollTimer = setInterval(() => _poll(job), 2000);
  _poll(job);
}
function _stopPolling() {
  clearInterval(_pollTimer);
  _pollTimer = null;
}

async function _poll(job) {
  const data  = await api.get('/api/jobs/status');
  const state = data[job];
  _updateProgress(state);
  if (state.status !== 'running') {
    _stopPolling();
    if (state.status === 'done') {
      if (job === 'fetch') {
        _fetchSummary = { tickers: state.done, errors: state.errors };
        const cfg = _configs.find(c => c.id === _activeId);
        _fetchSigCache.set(_fetchSignature(cfg), _fetchSummary);
        await _kickIndStage(cfg.ind_conf_id);
      } else if (job === 'indicators') {
        _indSummary = { tickers: state.done, errors: state.errors };
        const cfg = _configs.find(c => c.id === _activeId);
        if (cfg.scan_config_id) {
          await _kickScanStage();
        } else {
          await _finishWithoutScan();
        }
      }
    } else {
      _failRun(`${job} job ${state.status}`);
    }
  }
}

function _updateProgress(state) {
  const idleEl    = document.getElementById('pipeline-output-idle');
  const overall   = document.getElementById('pipeline-overall');
  const track     = document.getElementById('pipeline-track');
  const bar       = document.getElementById('pipeline-bar');
  const meta      = document.getElementById('pipeline-meta');
  const count     = document.getElementById('pipeline-count');
  const pctEl     = document.getElementById('pipeline-pct');
  const currentEl = document.getElementById('pipeline-current');
  const errorsEl  = document.getElementById('pipeline-errors');

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

// ── Results ───────────────────────────────────────────────────

function _clearResults() {
  document.getElementById('pipeline-results-label').textContent = '';
  document.getElementById('pipeline-results-empty').style.display = 'flex';
  document.getElementById('pipeline-results-empty').textContent = 'Run the pipeline to see results.';
  document.getElementById('pipeline-table-wrap').style.display = 'none';
  document.getElementById('btn-open-chart').style.display = 'none';
  document.getElementById('pipeline-table').innerHTML = '';
  _lastResults = null;
}

function _renderResults(data) {
  const results = data.results || [];
  const label = document.getElementById('pipeline-results-label');
  const table = document.getElementById('pipeline-table');
  const wrap  = document.getElementById('pipeline-table-wrap');
  const empty = document.getElementById('pipeline-results-empty');

  label.textContent = `— ${data.count} ticker${data.count === 1 ? '' : 's'}`;
  document.getElementById('btn-open-chart').style.display = results.length ? '' : 'none';

  if (!results.length) {
    empty.textContent = 'No tickers matched.';
    empty.style.display = 'flex';
    wrap.style.display = 'none';
    return;
  }
  empty.style.display = 'none';
  wrap.style.display = 'block';

  const sigKeys = [...new Set(results.flatMap(r => Object.keys(r.signals || {})))];
  table.innerHTML =
    '<thead><tr>' +
    ['ticker', 'date'].map(c => `<th class="scan-th">${c}</th>`).join('') +
    sigKeys.map(k => `<th class="scan-th">${_esc(k.replace(/_/g, ' '))}</th>`).join('') +
    '</tr></thead><tbody>' +
    results.map(r => {
      const cells = sigKeys.map(k => {
        const sig = r.signals?.[k];
        return `<td class="scan-signal-cell">${sig?.Signal ?? (sig ? '✓' : '—')}</td>`;
      }).join('');
      return `<tr class="scan-result-row" data-ticker="${_esc(r.ticker)}"><td class="scan-ticker">${_esc(r.ticker)}</td><td class="scan-date">${_esc(r.date || '')}</td>${cells}</tr>`;
    }).join('') +
    '</tbody>';

  table.querySelectorAll('.scan-result-row').forEach(row => {
    row.addEventListener('click', () => _openTicker(row.dataset.ticker));
  });
}

function _openTicker(ticker) {
  if (!_lastResults) return;
  try {
    localStorage.setItem('scan_tickers', JSON.stringify(_lastResults.map(r => r.ticker)));
    localStorage.setItem('scan_label', document.getElementById('pipeline-name').value.trim() || 'Pipeline Results');
  } catch {}
  window.location.href = `/?ticker=${encodeURIComponent(ticker)}&from_scan=1`;
}

// ── History ───────────────────────────────────────────────────

async function _loadHistory() {
  const data = await api.get('/api/pipeline/history');
  _renderHistory(data.history || []);
}

function _renderHistory(rows) {
  const body = document.getElementById('pipeline-history-body');
  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="6" class="stats-empty">No history yet.</td></tr>';
    return;
  }
  body.innerHTML = rows.map(r => `
    <tr>
      <td>${_esc(r.config_name)}</td>
      <td>${r.fetch_tickers}${r.fetch_errors ? ` <span style="color:var(--red-rgb)">(${r.fetch_errors} err)</span>` : ''}</td>
      <td>${r.ind_tickers}${r.ind_errors ? ` (${r.ind_errors} err)` : ''}</td>
      <td>${r.scan_matched ?? '—'}${r.scan_total ? ` / ${r.scan_total}` : ''}</td>
      <td>${_esc(r.ran_at)}</td>
      <td><button class="scan-history-del" data-id="${r.id}" title="Delete this run">✕</button></td>
    </tr>
  `).join('');
  body.querySelectorAll('.scan-history-del').forEach(btn => {
    btn.addEventListener('click', async () => {
      await api.del(`/api/pipeline/history/${btn.dataset.id}`);
      _loadHistory();
    });
  });
}

// ── Static wiring ─────────────────────────────────────────────

function _wireStatic() {
  document.getElementById('btn-new-pipeline').addEventListener('click', _createConfig);
  document.getElementById('btn-save-pipeline').addEventListener('click', _saveConfig);
  document.getElementById('btn-delete-pipeline').addEventListener('click', _deleteConfig);
  document.getElementById('btn-run-pipeline').addEventListener('click', _startRun);
  document.getElementById('btn-run-refresh').addEventListener('click', async () => {
    const [tickerConfData, scanData, indData] = await Promise.all([
      api.get('/api/ticker-configs'), api.get('/api/scan-configs'), api.get('/api/ind-configs'),
    ]);
    _tickerConfigs = tickerConfData.configs || [];
    _scanConfigs   = scanData.configs || [];
    _indConfigs    = indData.configs  || [];
    _populateTickerConfigSelect();
    _populateIndConfigSelect();
    _refreshScanConfigOptions();
    _renderRunConfigs();
  });
  document.getElementById('btn-run-clear').addEventListener('click', _clearRun);
  document.getElementById('pipeline-run-conf-list').addEventListener('click', e => {
    const btn = e.target.closest('.run-queue-remove');
    if (!btn || btn.disabled) return;
    const id = +btn.dataset.id;
    _runCheckedIds.delete(id);
    delete _runResults[id];
    _setQueuedOnServer(id, false);
    _renderList();
    _renderRunConfigs();
  });
  document.getElementById('btn-open-chart').addEventListener('click', () => {
    if (_lastResults?.length) _openTicker(_lastResults[0].ticker);
  });
  document.getElementById('btn-history-refresh').addEventListener('click', _loadHistory);
  document.getElementById('btn-history-clear').addEventListener('click', async () => {
    if (!confirm('Clear all pipeline history?')) return;
    await api.del('/api/pipeline/history');
    _loadHistory();
  });
  document.getElementById('pipeline-name').addEventListener('input', () => { _dirty = true; });
  // Blur after picking a value — a stage select opened via Enter/showPicker()
  // (see _activateFocusedStage) otherwise keeps real keyboard focus after the
  // native popup closes, silently blocking every other shortcut (N, D, R, ...)
  // until Escape or a stray click.
  document.getElementById('pipeline-ticker-conf').addEventListener('change', e => { _dirty = true; e.target.blur(); });
  document.getElementById('pipeline-ind-config').addEventListener('change', e => { _refreshScanConfigOptions(); _dirty = true; e.target.blur(); });
  document.getElementById('pipeline-scan-config').addEventListener('change', e => { _dirty = true; e.target.blur(); });
  document.getElementById('btn-save-schedule').addEventListener('click', _saveSchedule);
  document.getElementById('pipeline-schedule-enabled').addEventListener('change', _updateScheduleHint);
  // Blur after picking a time — _activateScheduleFocused() focuses + opens this
  // field for typing, and without releasing it afterward it keeps real
  // keyboard focus indefinitely, silently blocking every other shortcut.
  document.getElementById('pipeline-schedule-time').addEventListener('change', e => { _updateScheduleHint(); e.target.blur(); });
  document.getElementById('pipeline-schedule-days').addEventListener('change', _updateScheduleHint);

  document.addEventListener('keydown', e => {
    const tag = document.activeElement?.tagName;
    const inInput = tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA';
    const ctrl = e.ctrlKey || e.metaKey;

    if (e.key === '/') { e.preventDefault(); toggleTheme(); return; }
    if (e.key === '`' && ctrl) { e.preventDefault(); window.location.href = '/fetch'; return; }
    if (e.key === '`') { e.preventDefault(); window.location.href = '/'; return; }
    if (e.key === '~') { e.preventDefault(); window.location.href = '/scanner'; return; }

    if (e.key === 's' && ctrl) { e.preventDefault(); _saveConfig(); return; }

    // Universal Esc reset — leave whatever input/select is focused so page-level
    // shortcuts (nav, N/D/R, etc.) work again without needing a stray click first.
    if (e.key === 'Escape') {
      e.preventDefault();
      _setStageFocus(null);
      _setScheduleFocus(null);
      document.activeElement?.blur();
      return;
    }

    // Matches Indicators/Tickers/Scanner's convention for jumping to the
    // config name field.
    if (e.key === 'Enter' && e.shiftKey) {
      e.preventDefault();
      const nameEl = document.getElementById('pipeline-name');
      if (nameEl) { nameEl.focus(); nameEl.select(); }
      return;
    }

    if (inInput) return;

    if (e.key === 'N' && !ctrl) { e.preventDefault(); _createConfig(); }
    if (e.key === 'D' && !ctrl) { e.preventDefault(); _deleteConfig(); }
    if (e.key === 'R' && !ctrl) { e.preventDefault(); _startRun(); }
    if (e.key === ' ') { e.preventDefault(); if (_activeId) _toggleQueued(_activeId); }
    if (e.key === 'T' && !ctrl) { e.preventDefault(); window.location.href = '/fetch'; }
    if (e.key === 'I' && !ctrl) { e.preventDefault(); window.location.href = '/indicators'; }
    if (e.key === 'S' && !ctrl) { e.preventDefault(); window.location.href = '/scanner'; }
    if (e.key === 'C' && !ctrl) { e.preventDefault(); window.location.href = '/'; }
    if (e.key === 'P' && !ctrl) { e.preventDefault(); window.location.href = '/pipeline'; }

    // _/+ cycle saved pipeline configs (matches Indicators' keys for that, wraps around).
    if (e.key === '_') { e.preventDefault(); _cycleConfig(1); }
    if (e.key === '+') { e.preventDefault(); _cycleConfig(-1); }

    // -/= cycle keyboard focus between the Fetch/Indicators/Scan sub-cards of the
    // open config (matches Indicators' -/= card-focus keys); Enter opens the
    // focused card's primary control so its value can be changed from the keyboard.
    if (e.key === '-') { e.preventDefault(); _moveStageFocus(1); }
    if (e.key === '=') { e.preventDefault(); _moveStageFocus(-1); }
    // ArrowUp/ArrowDown cycle the Schedule card's own fields — it's a single
    // standalone section, not one of several cards, so it doesn't need the
    // -/= "outer" layer the stage cards use.
    if (e.key === 'ArrowDown') { e.preventDefault(); _moveScheduleFocus(1); }
    if (e.key === 'ArrowUp')   { e.preventDefault(); _moveScheduleFocus(-1); }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (!_activateScheduleFocused()) _activateFocusedStage();
    }
  });
}
