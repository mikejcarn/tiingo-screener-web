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
 * Multiple pipelines can be checked in the sidebar and run as a queue
 * (_startQueueRun/_runQueueItem/_afterPipelineFinished): they run one at a
 * time in the same tab session. Queued pipelines that share an identical
 * (ticker_list, timeframes) fetch signature only fetch once — later ones
 * reuse the first fetch's result (_queueFetchSummaries) instead of re-hitting
 * the Tiingo API for tickers a prior pipeline in the same run already pulled.
 */
import { api }       from './api.js';
import { initHelp }  from './help.js';
import { initTheme, toggleTheme } from './theme.js';

const ALL_TIMEFRAMES = ['daily', 'weekly', '1hour', '4hour', '5min'];

const _esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

// ── State ─────────────────────────────────────────────────────
let _configs      = [];   // [{id, name, ticker_list, timeframes, ind_conf_id, scan_config_id, updated_at}]
let _activeId     = null;
let _dirty        = false;
let _tickerLists  = [];   // [{name, count}]
let _scanConfigs  = [];   // [{id, name, logic, ind_conf_id, updated_at}]
let _indConfigs   = [];   // [{id, name, ...}]

let _stageIdx     = -1;   // -1 idle, 0 fetch, 1 indicators, 2 scan
let _pollTimer    = null;
let _lastResults  = null; // last scan results array, for "open in chart"
let _fetchSummary = { tickers: 0, errors: 0 };
let _indSummary   = { tickers: 0, errors: 0 };

// ── Queue (run several pipeline configs in a row) ───────────────
let _queueSelected = new Set();   // config ids checked in the sidebar
let _queueIds      = [];          // ordered ids for the run currently in progress (or last run)
let _queuePos       = -1;         // -1 idle, else index into _queueIds
let _queueStatus    = new Map();  // id -> 'pending' | 'running' | 'done' | 'error'
let _queueFetchSummaries = new Map(); // fetch signature -> {tickers, errors}, so a shared fetch is only run once
let _running = false; // true from the moment any run/queue kicks off until it fully finishes — covers the
                       // synchronous scan/run await too, where _pollTimer is briefly null but a run is still live

// ── Init ──────────────────────────────────────────────────────
(async function init() {
  initTheme();
  initHelp('pipeline');
  _buildTimeframeChecks();
  const [tickerData, scanData, indData] = await Promise.all([
    api.get('/api/ticker-lists'),
    api.get('/api/scan-configs'),
    api.get('/api/ind-configs'),
  ]);
  _tickerLists = tickerData.lists || [];
  _scanConfigs = scanData.configs || [];
  _indConfigs  = indData.configs  || [];
  _populateTickerListSelect();
  _populateIndConfigSelect();
  _refreshScanConfigOptions();
  _wireStatic();
  await _loadConfigs();
  await _loadHistory();
})();

// ── Timeframe checkboxes ─────────────────────────────────────
function _buildTimeframeChecks() {
  const wrap = document.getElementById('pipeline-tfs');
  wrap.innerHTML = '';
  for (const tf of ALL_TIMEFRAMES) {
    const lbl = document.createElement('label');
    lbl.innerHTML = `<input type="checkbox" value="${tf}"> ${tf}`;
    wrap.appendChild(lbl);
  }
  wrap.addEventListener('change', () => { _dirty = true; });
}
function _syncTfChecks(timeframes) {
  for (const cb of document.querySelectorAll('#pipeline-tfs input[type="checkbox"]')) {
    cb.checked = (timeframes || []).includes(cb.value);
  }
}
function _getCheckedTfs() {
  return [...document.querySelectorAll('#pipeline-tfs input[type="checkbox"]:checked')].map(el => el.value);
}

// ── Selects ───────────────────────────────────────────────────
function _populateTickerListSelect() {
  const sel = document.getElementById('pipeline-ticker-list');
  const prev = sel.value;
  sel.innerHTML = '<option value="">— select —</option>';
  for (const l of _tickerLists) {
    const opt = document.createElement('option');
    opt.value = l.name; opt.textContent = l.name;
    sel.appendChild(opt);
  }
  if (prev) sel.value = prev;
  sel.addEventListener('change', () => { _updateTickerListCount(); _dirty = true; });
  _updateTickerListCount();
}
function _updateTickerListCount() {
  const sel = document.getElementById('pipeline-ticker-list');
  const el  = document.getElementById('pipeline-ticker-list-count');
  const match = _tickerLists.find(l => l.name === sel.value);
  el.textContent = match ? `${match.count.toLocaleString()} tickers` : '';
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

// ── Pipeline config list ─────────────────────────────────────
async function _loadConfigs() {
  const data = await api.get('/api/pipeline-configs');
  _configs = data.configs || [];
  for (const id of [..._queueSelected]) {
    if (!_configs.some(c => c.id === id)) _queueSelected.delete(id);
  }
  _renderList();
  _updateQueueBar();
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
    const item = document.createElement('div');
    item.className = 'ind-config-item' + (cfg.id === _activeId ? ' active' : '');
    item.dataset.id = cfg.id;
    const check = document.createElement('input');
    check.type = 'checkbox';
    check.className = 'pipeline-item-check';
    check.title = 'Queue this pipeline for a batch run';
    check.checked = _queueSelected.has(cfg.id);
    check.addEventListener('click', e => e.stopPropagation());
    check.addEventListener('change', () => {
      if (check.checked) _queueSelected.add(cfg.id); else _queueSelected.delete(cfg.id);
      _syncSelectAllCheck();
      _updateQueueBar();
    });
    item.appendChild(check);
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
  _syncSelectAllCheck();
}

function _syncSelectAllCheck() {
  const allCb = document.getElementById('pipeline-select-all');
  if (!allCb) return;
  allCb.checked = _configs.length > 0 && _configs.every(c => _queueSelected.has(c.id));
}

async function _selectConfig(id) {
  if (_dirty && _activeId && !confirm('Discard unsaved changes?')) return;
  _activeId = id; _dirty = false;
  try { localStorage.setItem('pipeline_selected_config_id', id); } catch {}
  _renderList();
  const cfg = await api.get(`/api/pipeline-configs/${id}`);
  _showEmpty(false);
  _populateEditorFields(cfg);
  _renderConfDates(cfg);
  _clearResults();
  _resetRun();
}

function _populateEditorFields(cfg) {
  document.getElementById('pipeline-name').value = cfg.name;
  document.getElementById('pipeline-ticker-list').value = cfg.ticker_list || '';
  _updateTickerListCount();
  _syncTfChecks(cfg.timeframes);
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
  _queueSelected.delete(_activeId);
  _activeId = null;
  _renderList();
  _updateQueueBar();
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
    ticker_list: document.getElementById('pipeline-ticker-list').value || null,
    timeframes: _getCheckedTfs(),
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
  const btn = document.getElementById('btn-run-pipeline');
  btn.disabled = false; btn.textContent = '▶ Run';
}

function _isRunning() {
  return _running;
}

async function _startRun() {
  if (!_activeId) return;
  if (_isRunning()) { alert('A run is already in progress.'); return; }
  const cfg = _configs.find(c => c.id === _activeId);
  if (!cfg?.ticker_list) { alert('Select a ticker list before running.'); return; }
  if (!_getCheckedTfs().length) { alert('Select at least one timeframe before running.'); return; }
  if (!cfg?.ind_conf_id) { alert('Select an indicator config before running.'); return; }

  _running = true;
  _resetRun();
  _clearResults();
  document.getElementById('btn-run-pipeline').disabled = true;
  document.getElementById('btn-run-queue').disabled = true;
  await _kickFetchStage();
}

// A fetch signature identifies "what fetch/batch would do" for a pipeline —
// pipelines that share one only need that fetch run once per queue run.
function _fetchSignature(cfg) {
  return `${cfg.ticker_list}|${[...(cfg.timeframes || [])].sort().join(',')}`;
}

function _updateQueueBar() {
  const bar   = document.getElementById('pipeline-queue-bar');
  const label = document.getElementById('pipeline-queue-label');
  const btn   = document.getElementById('btn-run-queue');
  const n = _queueSelected.size;
  bar.style.display = n > 0 ? '' : 'none';
  if (_queuePos < 0) {
    label.textContent = `${n} pipeline${n === 1 ? '' : 's'} selected`;
    btn.disabled = n === 0 || _isRunning();
  }
}

function _renderQueueList() {
  const el = document.getElementById('pipeline-queue-list');
  el.innerHTML = _queueIds.map(id => {
    const cfg = _configs.find(c => c.id === id);
    const status = _queueStatus.get(id) || 'pending';
    return `<div class="pipeline-queue-row ${status}"><span class="pipeline-queue-dot"></span>${_esc(cfg?.name || `#${id}`)}</div>`;
  }).join('');
}

function _markQueueItem(status) {
  if (_queuePos < 0) return;
  _queueStatus.set(_queueIds[_queuePos], status);
  _renderQueueList();
}

async function _startQueueRun() {
  if (_queueSelected.size === 0) return;
  if (_isRunning()) { alert('A run is already in progress.'); return; }
  const ids = _configs.filter(c => _queueSelected.has(c.id)).map(c => c.id);
  for (const id of ids) {
    const cfg = _configs.find(c => c.id === id);
    if (!cfg.ticker_list || !(cfg.timeframes || []).length || !cfg.ind_conf_id) {
      alert(`Pipeline "${cfg.name}" is missing a ticker list, timeframe, or indicator config — fix it before running the queue.`);
      return;
    }
  }
  _queueIds = ids;
  _queueStatus = new Map(ids.map(id => [id, 'pending']));
  _queueFetchSummaries = new Map();
  _queuePos = 0;
  _running = true;
  document.getElementById('btn-run-pipeline').disabled = true;
  document.getElementById('btn-run-queue').disabled = true;
  _renderQueueList();
  await _runQueueItem();
}

async function _runQueueItem() {
  const id = _queueIds[_queuePos];
  _markQueueItem('running');
  document.getElementById('pipeline-queue-label').textContent = `Running ${_queuePos + 1} / ${_queueIds.length}`;
  await _queueDisplayConfig(id);
  _clearResults();
  _resetRun();
  document.getElementById('btn-run-pipeline').disabled = true;
  document.getElementById('btn-run-queue').disabled = true;
  await _kickFetchStage();
}

// Called after a pipeline's run reaches a terminal state (done or errored).
// Advances the queue if one is active, otherwise just re-enables the controls.
async function _afterPipelineFinished() {
  if (_queuePos < 0) {
    _running = false;
    document.getElementById('btn-run-pipeline').disabled = false;
    document.getElementById('btn-run-queue').disabled = _queueSelected.size === 0;
    return;
  }
  _queuePos++;
  if (_queuePos < _queueIds.length) {
    await _runQueueItem();
  } else {
    _finishQueue();
  }
}

function _finishQueue() {
  const n = _queueIds.length;
  _queuePos = -1;
  _running = false;
  document.getElementById('btn-run-pipeline').disabled = false;
  document.getElementById('btn-run-queue').disabled = _queueSelected.size === 0;
  document.getElementById('pipeline-queue-label').textContent = `Queue finished — ${n} pipeline${n === 1 ? '' : 's'} run`;
  _loadHistory();
}

function _clearRun() {
  _queuePos = -1;
  _running = false;
  _queueStatus = new Map(_queueIds.map(id => [id, 'pending']));
  _resetRun();
  _updateQueueBar();
  _renderQueueList();
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

async function _kickFetchStage() {
  const cfg = _configs.find(c => c.id === _activeId);
  const sig = _fetchSignature(cfg);

  // In a queue run, skip re-fetching a ticker_list/timeframes combo another
  // queued pipeline already fetched this run — go straight to Indicators.
  if (_queuePos >= 0 && _queueFetchSummaries.has(sig)) {
    _setStage(0, 'done');
    _fetchSummary = _queueFetchSummaries.get(sig);
    document.getElementById('pipeline-stage-label').textContent = 'fetch skipped — shared with an earlier pipeline this run';
    await _kickIndStage(cfg.ind_conf_id);
    return;
  }

  _setStage(0);
  try {
    await api.post('/api/fetch/batch', { ticker_list: cfg.ticker_list, timeframes: _getCheckedTfs() });
  } catch (err) {
    _failRun(err.message || 'Failed to start fetch job');
    return;
  }
  _startPolling('fetch');
}

async function _kickIndStage(indConfId) {
  _setStage(1);
  const cfg = _configs.find(c => c.id === _activeId);
  try {
    await api.post('/api/indicators/batch', { config_id: indConfId, ticker_list: cfg.ticker_list });
  } catch (err) {
    _failRun(err.message || 'Failed to start indicators job');
    return;
  }
  _startPolling('indicators');
}

async function _kickScanStage() {
  _setStage(2);
  const cfg = _configs.find(c => c.id === _activeId);
  document.getElementById('pipeline-overall').style.display = 'none';
  document.getElementById('pipeline-output-idle').style.display = '';
  document.getElementById('pipeline-output-idle').textContent = 'Running scan…';
  try {
    const data = await api.post('/api/scan/run', { config_id: cfg.scan_config_id, scope_ticker_list: cfg.ticker_list });
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
    await _loadHistory();
    _markQueueItem('done');
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
  await _loadHistory();
  _markQueueItem('done');
  await _afterPipelineFinished();
}

async function _failRun(msg) {
  _stopPolling();
  const chip = document.querySelectorAll('.pipeline-stage-chip')[Math.max(_stageIdx, 0)];
  chip?.classList.remove('active'); chip?.classList.add('errored');

  if (_queuePos >= 0) {
    // Never alert() mid-queue — a blocking dialog would freeze the tab and
    // stall the whole batch. Log the failure and move on to the next pipeline.
    _markQueueItem('error');
    try {
      await api.post('/api/pipeline/log', {
        config_id: _activeId, status: 'error',
        fetch_tickers: _fetchSummary.tickers, fetch_errors: _fetchSummary.errors,
        ind_tickers: _indSummary.tickers, ind_errors: _indSummary.errors,
        scan_run_id: null,
      });
      await _loadHistory();
    } catch {}
    await _afterPipelineFinished();
    return;
  }

  document.getElementById('btn-run-pipeline').disabled = false;
  alert(msg);
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
        if (_queuePos >= 0) _queueFetchSummaries.set(_fetchSignature(cfg), _fetchSummary);
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
    const [scanData, indData] = await Promise.all([api.get('/api/scan-configs'), api.get('/api/ind-configs')]);
    _scanConfigs = scanData.configs || [];
    _indConfigs  = indData.configs  || [];
    _populateIndConfigSelect();
    _refreshScanConfigOptions();
  });
  document.getElementById('btn-run-clear').addEventListener('click', _clearRun);
  document.getElementById('btn-run-queue').addEventListener('click', _startQueueRun);
  document.getElementById('pipeline-select-all').addEventListener('change', e => {
    if (e.target.checked) _configs.forEach(c => _queueSelected.add(c.id));
    else _queueSelected.clear();
    _renderList();
    _updateQueueBar();
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
  document.getElementById('pipeline-ind-config').addEventListener('change', () => { _refreshScanConfigOptions(); _dirty = true; });
  document.getElementById('pipeline-scan-config').addEventListener('change', () => { _dirty = true; });

  document.addEventListener('keydown', e => {
    const tag = document.activeElement?.tagName;
    const inInput = tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA';
    const ctrl = e.ctrlKey || e.metaKey;

    if (e.key === '/') { e.preventDefault(); toggleTheme(); return; }
    if (e.key === '`') { e.preventDefault(); window.location.href = '/'; return; }
    if (e.key === '~') { e.preventDefault(); window.location.href = '/scanner'; return; }

    if (e.key === 's' && ctrl) { e.preventDefault(); _saveConfig(); return; }

    if (inInput) return;

    if (e.key === 'N' && !ctrl) { e.preventDefault(); _createConfig(); }
    if (e.key === 'D' && !ctrl) { e.preventDefault(); _deleteConfig(); }
    if (e.key === 'R' && !ctrl) { e.preventDefault(); _startRun(); }
    if (e.key === 'T' && !ctrl) { e.preventDefault(); window.location.href = '/fetch'; }
    if (e.key === 'I' && !ctrl) { e.preventDefault(); window.location.href = '/indicators'; }
    if (e.key === 'S' && !ctrl) { e.preventDefault(); window.location.href = '/scanner'; }
    if (e.key === 'C' && !ctrl) { e.preventDefault(); window.location.href = '/'; }
    if (e.key === 'P' && !ctrl) { e.preventDefault(); window.location.href = '/pipeline'; }

    if (e.key === '=') {
      const i = _configs.findIndex(c => c.id === _activeId);
      if (i > 0) _selectConfig(_configs[i - 1].id);
    }
    if (e.key === '-') {
      const i = _configs.findIndex(c => c.id === _activeId);
      if (i >= 0 && i < _configs.length - 1) _selectConfig(_configs[i + 1].id);
    }
  });
}
