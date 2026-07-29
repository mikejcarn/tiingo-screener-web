import { initHelp } from './help.js';
import { initTheme, toggleTheme } from './theme.js';
import { api } from './api.js';

const ALL_TIMEFRAMES = ['daily', 'weekly', '1hour', '4hour', '5min'];

let _tickerLists   = [];
let _pollTimer     = null;
let _moveTickerSuggestion = null; // set by _initTickerSearch

// Single ticker queue state
let _singleQueue   = [];
let _singleResults = {};
let _singleRunning = false;

// Batch list queue state
let _batchQueue     = [];
let _batchResults   = {};
let _batchRunning   = false;
let _batchCancelled = false;

// Queue selection state (which item's timeframes the global checkboxes control)
let _selectedSingleIdx = null;
let _selectedBatchIdx  = null;

// ── Bootstrap ─────────────────────────────────────────────────

async function init() {
  await _loadTickerLists();
  _buildTimeframeChecks('fetch-tfs',  ['daily']);
  _buildTimeframeChecks('single-tfs', ['daily']);
  _loadSingleQueue();
  _loadBatchQueue();
  _renderSingleQueue();
  _renderBatchQueue();
  _wireButtons();
  _initDropZone();

  const [status] = await Promise.all([
    api.get('/api/jobs/status'),
    _loadApiKey(),
    _loadStats(),
    _loadHistory(),
    _loadTiingoListInfo(),
  ]);
  if (status.fetch.status === 'running') {
    _batchRunning = true;
    _renderBatchQueue();
    _startPolling();
  }
}

// ── Utilities ─────────────────────────────────────────────────

function _esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Queue persistence ─────────────────────────────────────────

function _saveSingleQueue() {
  try { localStorage.setItem('fetch_single_queue', JSON.stringify(_singleQueue)); } catch {}
}

function _loadSingleQueue() {
  try {
    const saved = JSON.parse(localStorage.getItem('fetch_single_queue') || '[]');
    _singleQueue = saved.map(item => typeof item === 'string' ? { ticker: item, timeframes: ['daily'] } : item);
  } catch { _singleQueue = []; }
}

function _saveBatchQueue() {
  try { localStorage.setItem('fetch_batch_queue', JSON.stringify(_batchQueue)); } catch {}
}

function _loadBatchQueue() {
  try {
    const saved = JSON.parse(localStorage.getItem('fetch_batch_queue') || '[]');
    const valid = new Set(_tickerLists.map(l => l.name));
    _batchQueue = saved
      .map(item => typeof item === 'string' ? { name: item, timeframes: ['daily'] } : item)
      .filter(item => valid.has(item.name));
  } catch { _batchQueue = []; }
}

// ── Queue rendering ───────────────────────────────────────────

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

function _renderBatchQueue() {
  const el = document.getElementById('batch-queue');
  if (!el) return;
  if (!_batchQueue.length) {
    el.innerHTML = '<div class="run-queue-empty">No lists queued — select one above to add</div>';
    _selectedBatchIdx = null;
    return;
  }
  const table = document.createElement('table');
  table.className = 'run-queue-table';
  const tbody = document.createElement('tbody');
  _batchQueue.forEach((item, i) => {
    const info = _tickerLists.find(l => l.name === item.name);
    const countStr = info ? `${info.count.toLocaleString()} tickers` : '';
    const tr = document.createElement('tr');
    tr.className = 'run-queue-item' + (i === _selectedBatchIdx ? ' rq-selected' : '');
    tr.innerHTML = `
      <td class="run-queue-td-pos">${i + 1}</td>
      <td class="run-queue-td-name">
        <div class="run-queue-name-row">
          <span class="run-queue-name">${_esc(item.name)}</span>
          ${countStr ? `<span class="fetch-list-count-tag">${countStr}</span>` : ''}
        </div>
        <div class="rq-status" data-list="${_esc(item.name)}"></div>
      </td>
      <td class="run-queue-td-tfs">${item.timeframes.join(' · ')}</td>
      <td class="run-queue-td-del"><button class="run-queue-remove" data-list="${_esc(item.name)}"${_batchRunning ? ' disabled' : ''} title="Remove ${_esc(item.name)} from the queue">×</button></td>
    `;
    if (!_batchRunning) {
      tr.addEventListener('click', e => {
        if (e.target.closest('.run-queue-remove')) return;
        if (i === _selectedBatchIdx) {
          _selectedBatchIdx = null;
        } else {
          _selectedBatchIdx = i;
          _syncTfChecks('fetch-tfs', item.timeframes);
        }
        _renderBatchQueue();
      });
    }
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  el.innerHTML = '';
  el.appendChild(table);
  _renderBatchQueueStatus();
}

function _renderBatchQueueStatus() {
  for (const [listName, result] of Object.entries(_batchResults)) {
    const el = document.querySelector(`.rq-status[data-list="${listName}"]`);
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
    } else if (status === 'error') {
      el.innerHTML = `<div class="rq-info"><span class="rq-state rq-errors">✗ ${_esc(result.message || 'failed to start')}</span></div>`;
    }
  }
}

// ── Run sequences ─────────────────────────────────────────────

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

async function _runBatchQueue() {
  if (_batchRunning) return;

  // Auto-add selected list if queue is empty
  if (!_batchQueue.length) {
    const listName = document.getElementById('fetch-list').value;
    if (!listName) {
      alert('Select a ticker list first.');
      return;
    }
    _addBatchList();
  }

  _batchRunning   = true;
  _batchCancelled = false;
  _batchResults   = {};
  const btn       = document.getElementById('btn-fetch');
  const btnCancel = document.getElementById('btn-fetch-cancel');
  btn.disabled = true;
  btn.textContent = 'Fetching…';
  btnCancel.style.display = '';

  for (const item of _batchQueue) _batchResults[item.name] = { status: 'pending' };
  _renderBatchQueue();

  for (const item of _batchQueue) {
    if (_batchCancelled) {
      _batchResults[item.name] = { status: 'cancelled' };
      _renderBatchQueueStatus();
      continue;
    }
    const timeframes = item.timeframes;
    if (!timeframes.length) {
      _batchResults[item.name] = { status: 'error', message: 'No timeframes selected' };
      _renderBatchQueueStatus();
      continue;
    }
    _batchResults[item.name] = { status: 'running', done: 0, total: 0, errors: 0, current: '' };
    _renderBatchQueueStatus();

    try {
      await api.post('/api/fetch/batch', { ticker_list: item.name, timeframes });
    } catch (err) {
      _batchResults[item.name] = { status: 'error', message: err.message || 'Failed to start' };
      _renderBatchQueueStatus();
      continue;
    }

    await new Promise(resolve => {
      const timer = setInterval(async () => {
        const data  = await api.get('/api/jobs/status');
        const state = data.fetch;
        if (state.status === 'running') {
          _batchResults[item.name] = { status: 'running', done: state.done, total: state.total, errors: state.errors, current: state.current };
          _renderBatchQueueStatus();
        } else {
          if (state.status === 'done') {
            _batchResults[item.name] = { status: 'done', done: state.done, total: state.total, errors: state.errors };
          } else {
            _batchResults[item.name] = {
              status: state.status === 'cancelled' ? 'cancelled' : 'error',
              done: state.done, total: state.total,
            };
            if (state.status === 'cancelled') _batchCancelled = true;
          }
          _renderBatchQueueStatus();
          clearInterval(timer);
          resolve();
        }
      }, 2000);
    });

    _loadStats();
    _loadHistory();
  }

  _batchRunning = false;
  btn.disabled = false;
  btn.textContent = '▶ Fetch';
  btnCancel.style.display = 'none';
  _renderBatchQueue();
  _loadStats();
  _loadHistory();
}

// ── Add to queues ─────────────────────────────────────────────

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

function _addBatchList() {
  const listName = document.getElementById('fetch-list').value;
  if (!listName) return;
  if (!_batchQueue.find(item => item.name === listName)) {
    const timeframes = _getChecked('fetch-tfs');
    _batchQueue.push({ name: listName, timeframes: timeframes.length ? [...timeframes] : ['daily'] });
    _saveBatchQueue();
    _renderBatchQueue();
  }
}

// ── Ticker lists ──────────────────────────────────────────────

async function _loadTickerLists() {
  const data = await api.get('/api/ticker-lists');
  _tickerLists = data.lists || [];
  const sel = document.getElementById('fetch-list');
  const prev = sel.value;
  sel.innerHTML = '';
  for (const l of _tickerLists) {
    const opt = document.createElement('option');
    opt.value = l.name;
    opt.textContent = l.name;
    sel.appendChild(opt);
  }
  const saved = localStorage.getItem('defaultTickerList');
  const target = prev || saved;
  if (target && _tickerLists.find(l => l.name === target)) sel.value = target;
  _updateListCount();
  sel.addEventListener('change', () => {
    localStorage.setItem('defaultTickerList', sel.value);
    _updateListCount();
  });
  _renderTickerListItems();
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

function _updateListCount() {
  const sel   = document.getElementById('fetch-list');
  const el    = document.getElementById('fetch-list-count');
  const match = _tickerLists.find(l => l.name === sel.value);
  el.textContent = match ? `${match.count} tickers` : '';
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
let _statsDetailOffset = 0;
let _statsDetailTotal  = 0;
const _STATS_DB_LIMIT  = 8;

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
  document.getElementById('stats-rows-older').addEventListener('click', () => {
    _statsDetailOffset = Math.min(_statsDetailOffset + _STATS_DB_LIMIT, Math.max(0, _statsDetailTotal - _STATS_DB_LIMIT));
    _loadStatsPreview();
  });
  document.getElementById('stats-rows-newer').addEventListener('click', () => {
    _statsDetailOffset = Math.max(0, _statsDetailOffset - _STATS_DB_LIMIT);
    _loadStatsPreview();
  });
  document.getElementById('stats-detail-tf-sel').addEventListener('change', async e => {
    _statsDetailTf = e.target.value;
    _statsDetailOffset = 0;
    await _refreshStatsTickers();
  });
  document.getElementById('stats-detail-ticker-sel').addEventListener('change', e => {
    _statsDetailTicker = e.target.value;
    _statsDetailOffset = 0;
    _loadStatsPreview();
  });
}

function _openStatsDetail(ticker, timeframe) {
  _statsDetailTicker = ticker;
  _statsDetailTf     = timeframe;
  _statsDetailOffset = 0;
  _statsDetailTotal  = 0;
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
  _statsDetailOffset = 0;
  _loadStatsPreview();
}

async function _loadStatsPreview() {
  if (!_statsDetailTicker || !_statsDetailTf) return;
  const tableEl = document.getElementById('stats-db-table');
  tableEl.innerHTML = '<tr><td style="color:var(--t3);padding:8px 12px;font-size:11px;">Loading…</td></tr>';
  let data;
  try {
    data = await api.get(
      `/api/data/ohlcv/preview?ticker=${encodeURIComponent(_statsDetailTicker)}&timeframe=${encodeURIComponent(_statsDetailTf)}&offset=${_statsDetailOffset}&limit=${_STATS_DB_LIMIT}`
    );
  } catch {
    tableEl.innerHTML = '<tr><td style="color:var(--t3);padding:8px 12px;font-size:11px;">Failed to load.</td></tr>';
    return;
  }
  _statsDetailTotal = data.total_rows || 0;
  _updateStatsRowNav(data.rows || []);
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

function _updateStatsRowNav(rows) {
  const older = document.getElementById('stats-rows-older');
  const newer = document.getElementById('stats-rows-newer');
  const label = document.getElementById('stats-rows-label');
  older.disabled = _statsDetailOffset + _STATS_DB_LIMIT >= _statsDetailTotal;
  newer.disabled = _statsDetailOffset <= 0;
  if (rows.length > 0) {
    const d0   = String(rows[0].date || '').slice(0, 10);
    const d1   = String(rows[rows.length - 1].date || '').slice(0, 10);
    const pos  = _statsDetailTotal - _statsDetailOffset;
    const from = Math.max(1, pos - rows.length + 1);
    label.textContent = `rows ${from}–${pos} of ${_statsDetailTotal.toLocaleString()}  ·  ${d0} → ${d1}`;
  } else {
    label.textContent = '';
  }
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
  document.getElementById('btn-batch-queue-refresh').addEventListener('click', _renderBatchQueue);
  document.getElementById('btn-batch-queue-clear').addEventListener('click', () => {
    if (_batchRunning) return;
    _batchQueue = []; _batchResults = {};
    _saveBatchQueue(); _renderBatchQueue();
  });
  document.getElementById('btn-single-fetch').addEventListener('click', _runSingleQueue);
  document.getElementById('btn-fetch').addEventListener('click', _runBatchQueue);

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

  document.getElementById('batch-queue').addEventListener('click', e => {
    const btn = e.target.closest('.run-queue-remove');
    if (!btn || btn.disabled) return;
    const n = btn.dataset.list;
    const removedIdx = _batchQueue.findIndex(item => item.name === n);
    _batchQueue = _batchQueue.filter(item => item.name !== n);
    if (_selectedBatchIdx !== null) {
      if (_selectedBatchIdx === removedIdx) _selectedBatchIdx = null;
      else if (_selectedBatchIdx > removedIdx) _selectedBatchIdx--;
    }
    delete _batchResults[n];
    _saveBatchQueue();
    _renderBatchQueue();
  });
  // Global timeframe checkboxes update the currently selected queue item
  document.getElementById('single-tfs').addEventListener('change', () => {
    if (_selectedSingleIdx !== null && _selectedSingleIdx < _singleQueue.length) {
      _singleQueue[_selectedSingleIdx].timeframes = _getChecked('single-tfs');
      _saveSingleQueue();
      _renderSingleQueue();
    }
  });
  document.getElementById('fetch-tfs').addEventListener('change', () => {
    if (_selectedBatchIdx !== null && _selectedBatchIdx < _batchQueue.length) {
      _batchQueue[_selectedBatchIdx].timeframes = _getChecked('fetch-tfs');
      _saveBatchQueue();
      _renderBatchQueue();
    }
  });

  document.getElementById('btn-fetch-cancel').addEventListener('click', () => {
    _batchCancelled = true;
    api.post('/api/jobs/fetch/cancel');
  });
  document.getElementById('btn-batch-add').addEventListener('click', _addBatchList);
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

  _moveTickerSuggestion = async (dir) => {
    input.focus();
    if (!dd.querySelector('.ticker-dd-item')) {
      hiIdx = -1;
      await _ddFetch(input.value.trim(), dd);
    }
    _navigate(dir);
  };

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
    if (e.key === '[' || e.key === ']') { e.preventDefault(); _moveList(e.key === ']' ? 1 : -1); return; }
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

// ── Polling (page-load sync only) ─────────────────────────────

function _startPolling() {
  if (_pollTimer) return;
  _pollTimer = setInterval(_poll, 2000);
}

function _stopPolling() {
  clearInterval(_pollTimer);
  _pollTimer = null;
}

async function _poll() {
  const status = await api.get('/api/jobs/status');
  if (status.fetch.status !== 'running') {
    _stopPolling();
    _batchRunning = false;
    _renderBatchQueue();
    _loadStats();
    _loadHistory();
  }
}

function _moveList(dir) {
  const sel = document.getElementById('fetch-list');
  if (!sel || sel.options.length < 2) return;
  sel.selectedIndex = (sel.selectedIndex + dir + sel.options.length) % sel.options.length;
  sel.dispatchEvent(new Event('change'));
}

document.addEventListener('keydown', e => {
  if (e.key === '/') { e.preventDefault(); toggleTheme(); return; }
  if (e.key === '`') { e.preventDefault(); window.location.href = '/indicators'; return; }
  if (e.key === '~') { e.preventDefault(); window.location.href = '/'; return; }
  if (e.key === 'Escape') {
    e.preventDefault();
    _setApiKeyEditMode(false);
    const tickerInput = document.getElementById('single-ticker');
    tickerInput.value = '';
    _ddHide(document.getElementById('single-ticker-dd'));
    document.activeElement?.blur();
    return;
  }
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  if (e.key === '-') { e.preventDefault(); _moveTickerSuggestion?.(1);  return; }
  if (e.key === '=') { e.preventDefault(); _moveTickerSuggestion?.(-1); return; }
  if (e.key === '[') { e.preventDefault(); _moveList(-1);   return; }
  if (e.key === ']') { e.preventDefault(); _moveList(1);    return; }
  if (e.key === 'C' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); window.location.href = '/'; }
  if (e.key === 'T' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); window.location.href = '/fetch'; }
  if (e.key === 'I' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); window.location.href = '/indicators'; }
  if (e.key === 'S' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); window.location.href = '/scanner'; }
  if (e.key === 'F' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); document.getElementById('btn-fetch').click(); }
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
