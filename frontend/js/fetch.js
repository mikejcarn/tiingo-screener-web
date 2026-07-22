const ALL_TIMEFRAMES = ['daily', 'weekly', '1hour', '4hour', '5min'];

let _tickerLists   = [];
let _pollTimer     = null;

// Single ticker queue state
let _singleQueue   = [];
let _singleResults = {};
let _singleRunning = false;

// Batch list queue state
let _batchQueue     = [];
let _batchResults   = {};
let _batchRunning   = false;
let _batchCancelled = false;

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
    fetch('/api/jobs/status').then(r => r.json()),
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
  try { _singleQueue = JSON.parse(localStorage.getItem('fetch_single_queue') || '[]'); } catch { _singleQueue = []; }
}

function _saveBatchQueue() {
  try { localStorage.setItem('fetch_batch_queue', JSON.stringify(_batchQueue)); } catch {}
}

function _loadBatchQueue() {
  try {
    const saved = JSON.parse(localStorage.getItem('fetch_batch_queue') || '[]');
    const valid = new Set(_tickerLists.map(l => l.name));
    _batchQueue = saved.filter(n => valid.has(n));
  } catch { _batchQueue = []; }
}

// ── Queue rendering ───────────────────────────────────────────

function _renderSingleQueue() {
  const el = document.getElementById('single-queue');
  if (!el) return;
  if (!_singleQueue.length) {
    el.innerHTML = '<div class="run-queue-empty">No tickers queued — type above to add</div>';
    return;
  }
  el.innerHTML = _singleQueue.map((ticker, i) => {
    const r = _singleResults[ticker];
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
    return `<div class="run-queue-item">
      <div class="run-queue-header">
        <span class="run-queue-pos">${i + 1}</span>
        <span class="run-queue-name">${_esc(ticker)}</span>
        <button class="run-queue-remove" data-ticker="${_esc(ticker)}"${_singleRunning ? ' disabled' : ''} title="Remove ${_esc(ticker)} from the queue">×</button>
      </div>
      ${statusHtml ? `<div class="run-queue-detail">${statusHtml}</div>` : ''}
    </div>`;
  }).join('');
  for (const btn of el.querySelectorAll('.run-queue-remove')) {
    btn.addEventListener('click', () => {
      const t = btn.dataset.ticker;
      _singleQueue = _singleQueue.filter(x => x !== t);
      delete _singleResults[t];
      _saveSingleQueue();
      _renderSingleQueue();
    });
  }
}

function _renderBatchQueue() {
  const el = document.getElementById('batch-queue');
  if (!el) return;
  if (!_batchQueue.length) {
    el.innerHTML = '<div class="run-queue-empty">No lists queued — select one above to add</div>';
    return;
  }
  el.innerHTML = _batchQueue.map((listName, i) => {
    const info = _tickerLists.find(l => l.name === listName);
    const countStr = info ? `${info.count.toLocaleString()} tickers` : '';
    return `<div class="run-queue-item">
      <div class="run-queue-header">
        <span class="run-queue-pos">${i + 1}</span>
        <span class="run-queue-name">${_esc(listName)}</span>
        ${countStr ? `<span class="fetch-list-count-tag">${countStr}</span>` : ''}
        <button class="run-queue-remove" data-list="${_esc(listName)}"${_batchRunning ? ' disabled' : ''} title="Remove ${_esc(listName)} from the queue">×</button>
      </div>
      <div class="rq-status" data-list="${_esc(listName)}"></div>
    </div>`;
  }).join('');
  for (const btn of el.querySelectorAll('.run-queue-remove')) {
    btn.addEventListener('click', () => {
      const n = btn.dataset.list;
      _batchQueue = _batchQueue.filter(l => l !== n);
      delete _batchResults[n];
      _saveBatchQueue();
      _renderBatchQueue();
    });
  }
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
  const timeframes = _getChecked('single-tfs');
  if (!timeframes.length) return;

  _singleRunning = true;
  _singleResults = {};
  const btn = document.getElementById('btn-single-fetch');
  btn.disabled = true;
  btn.textContent = 'Fetching…';

  for (const ticker of _singleQueue) _singleResults[ticker] = { status: 'pending' };
  _renderSingleQueue();

  for (const ticker of _singleQueue) {
    _singleResults[ticker] = { status: 'running' };
    _renderSingleQueue();
    try {
      const res = await fetch('/api/fetch/ticker', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker, timeframes }),
      });
      const data = await res.json();
      if (!res.ok) {
        _singleResults[ticker] = { status: 'error', message: data.detail || 'Error' };
      } else {
        const lines = [
          ...(data.results || []).map(r =>
            `<span class="rq-state rq-done fetch-tf-line">✓ ${r.timeframe} — ${r.rows.toLocaleString()} rows</span>`),
          ...(data.errors || []).map(e =>
            `<span class="rq-state rq-errors fetch-tf-line">✗ ${e.timeframe} — ${_esc(e.reason)}</span>`),
        ].join('');
        _singleResults[ticker] = { status: 'done', linesHtml: `<div class="rq-info" style="flex-wrap:wrap;gap:3px 10px;">${lines}</div>` };
      }
    } catch {
      _singleResults[ticker] = { status: 'error', message: 'Network error' };
    }
    _renderSingleQueue();
  }

  _singleRunning = false;
  btn.disabled = false;
  btn.textContent = 'Fetch';
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

  const timeframes = _getChecked('fetch-tfs');
  if (!timeframes.length) {
    alert('Select at least one timeframe.');
    return;
  }

  _batchRunning   = true;
  _batchCancelled = false;
  _batchResults   = {};
  const btn       = document.getElementById('btn-fetch');
  const btnCancel = document.getElementById('btn-fetch-cancel');
  btn.disabled = true;
  btn.textContent = 'Fetching…';
  btnCancel.style.display = '';

  for (const n of _batchQueue) _batchResults[n] = { status: 'pending' };
  _renderBatchQueue();

  for (const listName of _batchQueue) {
    if (_batchCancelled) {
      _batchResults[listName] = { status: 'cancelled' };
      _renderBatchQueueStatus();
      continue;
    }
    _batchResults[listName] = { status: 'running', done: 0, total: 0, errors: 0, current: '' };
    _renderBatchQueueStatus();

    const res = await fetch('/api/fetch/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticker_list: listName, timeframes }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      _batchResults[listName] = { status: 'error', message: err.detail || 'Failed to start' };
      _renderBatchQueueStatus();
      continue;
    }

    await new Promise(resolve => {
      const timer = setInterval(async () => {
        const data  = await fetch('/api/jobs/status').then(r => r.json());
        const state = data.fetch;
        if (state.status === 'running') {
          _batchResults[listName] = { status: 'running', done: state.done, total: state.total, errors: state.errors, current: state.current };
          _renderBatchQueueStatus();
        } else {
          if (state.status === 'done') {
            _batchResults[listName] = { status: 'done', done: state.done, total: state.total, errors: state.errors };
          } else {
            _batchResults[listName] = {
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
  btn.textContent = 'Fetch';
  btnCancel.style.display = 'none';
  _renderBatchQueue();
  _loadStats();
  _loadHistory();
}

// ── Add to queues ─────────────────────────────────────────────

function _addSingleTicker(ticker) {
  ticker = ticker.trim().toUpperCase();
  if (!ticker) return;
  if (!_singleQueue.includes(ticker)) {
    _singleQueue.push(ticker);
    _saveSingleQueue();
    _renderSingleQueue();
  }
  document.getElementById('single-ticker').value = '';
  _ddHide(document.getElementById('single-ticker-dd'));
}

function _addBatchList() {
  const listName = document.getElementById('fetch-list').value;
  if (!listName) return;
  if (!_batchQueue.includes(listName)) {
    _batchQueue.push(listName);
    _saveBatchQueue();
    _renderBatchQueue();
  }
}

// ── Ticker lists ──────────────────────────────────────────────

async function _loadTickerLists() {
  const data = await fetch('/api/ticker-lists').then(r => r.json());
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
      <span class="ticker-list-name">${l.name}</span>
      <span class="ticker-list-count">${l.count.toLocaleString()} tickers</span>
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
  const data = await fetch('/api/settings/api-key').then(r => r.json());
  _hasApiKey = !!data.masked;
  document.getElementById('apikey-masked').textContent = data.masked || '(not set)';
  _setApiKeyEditMode(false);
}

function _setApiKeyEditMode(on) {
  document.getElementById('apikey-masked').style.display     = on ? 'none' : '';
  document.getElementById('apikey-input').style.display      = on ? '' : 'none';
  document.getElementById('btn-apikey-add').style.display    = (!on && !_hasApiKey) ? '' : 'none';
  document.getElementById('btn-apikey-edit').style.display   = (!on && _hasApiKey) ? '' : 'none';
  document.getElementById('btn-apikey-save').style.display   = on ? '' : 'none';
  document.getElementById('btn-apikey-cancel').style.display = on ? '' : 'none';
  document.getElementById('btn-apikey-verify').style.display = (!on && _hasApiKey) ? '' : 'none';
  document.getElementById('btn-apikey-delete').style.display = (!on && _hasApiKey) ? '' : 'none';
  if (on) {
    document.getElementById('apikey-input').value = '';
    document.getElementById('apikey-input').focus();
  }
}

async function _saveApiKey() {
  const key = document.getElementById('apikey-input').value.trim();
  if (!key) return;
  const res = await fetch('/api/settings/api-key', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key }),
  });
  const data = await res.json();
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
  const data = await fetch('/api/settings/api-key/verify', { method: 'POST' }).then(r => r.json());
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
    const data = await fetch('/api/tickers/list-info').then(r => r.json());
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

async function _loadStats() {
  const tbody = document.getElementById('stats-body');
  let data;
  try {
    const res = await fetch('/api/stats');
    if (!res.ok) throw new Error(res.status);
    data = await res.json();
  } catch {
    tbody.innerHTML = '<tr><td colspan="6" class="stats-empty">Failed to load stats.</td></tr>';
    return;
  }

  const summary   = data.summary || [];
  const summaryEl = document.getElementById('stats-summary');
  if (summary.length) {
    summaryEl.innerHTML = summary.map(s => {
      const rows = s.rows >= 1e6
        ? (s.rows / 1e6).toFixed(1) + 'M'
        : s.rows >= 1e3
          ? (s.rows / 1e3).toFixed(0) + 'K'
          : s.rows;
      return `<span class="stats-summary-pill">
        <span class="ss-tf">${s.timeframe}</span>
        <span class="ss-val">${s.tickers} tickers</span>
        <span class="ss-sep">·</span>
        <span class="ss-val">${s.first_date} – ${s.last_date}</span>
        <span class="ss-sep">·</span>
        <span class="ss-val">${rows} rows</span>
      </span>`;
    }).join('');
  } else {
    summaryEl.innerHTML = '';
  }

  const rows = data.stats || [];
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="stats-empty">No data in database yet.</td></tr>';
    return;
  }
  tbody.innerHTML = rows.map(r => `
    <tr>
      <td>${_esc(r.ticker)}</td>
      <td>${_esc(r.timeframe)}</td>
      <td>${_esc(r.ticker_list || '—')}</td>
      <td>${r.last_date || '—'}</td>
      <td>${r.rows.toLocaleString()}</td>
      <td>${r.fetched_at || '—'}</td>
      <td><button class="tbl-del-btn" data-ticker="${_esc(r.ticker)}" title="Delete ${_esc(r.ticker)}">×</button></td>
    </tr>
  `).join('');
  for (const btn of tbody.querySelectorAll('.tbl-del-btn')) {
    btn.addEventListener('click', async () => {
      const ticker = btn.dataset.ticker;
      if (!confirm(`Delete all data for ${ticker}?`)) return;
      await fetch(`/api/data/ohlcv/ticker/${encodeURIComponent(ticker)}`, { method: 'DELETE' });
      _loadStats();
    });
  }
}

// ── History ───────────────────────────────────────────────────

async function _loadHistory() {
  const tbody = document.getElementById('history-body');
  let data;
  try {
    const res = await fetch('/api/fetch-history');
    if (!res.ok) throw new Error(res.status);
    data = await res.json();
  } catch {
    tbody.innerHTML = '<tr><td colspan="5" class="stats-empty">Failed to load history.</td></tr>';
    return;
  }
  const rows = data.history || [];
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="stats-empty">No history yet.</td></tr>';
    return;
  }
  tbody.innerHTML = rows.map(r => `
    <tr>
      <td>${_esc(r.session)}</td>
      <td>${_esc(r.ticker_list)}</td>
      <td>${_esc(r.timeframe)}</td>
      <td>${r.tickers.toLocaleString()}</td>
      <td>${r.last_date}</td>
      <td>${r.ticker_list !== '—'
        ? `<button class="tbl-del-btn" data-list="${_esc(r.ticker_list)}" title="Delete list ${_esc(r.ticker_list)}">×</button>`
        : ''}</td>
    </tr>
  `).join('');
  for (const btn of tbody.querySelectorAll('.tbl-del-btn')) {
    btn.addEventListener('click', async () => {
      const list = btn.dataset.list;
      if (!confirm(`Delete all tickers from list "${list}"?`)) return;
      await fetch(`/api/data/ohlcv/list/${encodeURIComponent(list)}`, { method: 'DELETE' });
      _loadStats();
      _loadHistory();
    });
  }
}

// ── Buttons ───────────────────────────────────────────────────

function _wireButtons() {
  document.getElementById('btn-single-fetch').addEventListener('click', _runSingleQueue);
  document.getElementById('btn-fetch').addEventListener('click', _runBatchQueue);
  document.getElementById('btn-fetch-cancel').addEventListener('click', () => {
    _batchCancelled = true;
    fetch('/api/jobs/fetch/cancel', { method: 'POST' });
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
    const data = await fetch('/api/settings/api-key', { method: 'DELETE' }).then(r => r.json());
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
      const res  = await fetch('/api/tickers/update-list', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        meta.textContent = `✗ ${data.detail || 'Update failed'}`;
        meta.className = 'tiingo-ref-meta upload-err';
      } else {
        meta.textContent = `${data.rows.toLocaleString()} tickers · updated ${data.updated_at}`;
        meta.className = 'tiingo-ref-meta';
      }
    } catch {
      meta.textContent = '✗ Network error';
      meta.className = 'tiingo-ref-meta upload-err';
    }
    btn.disabled = false;
    btn.textContent = 'Update';
  });

  document.getElementById('btn-refresh-stats').addEventListener('click', () => {
    _loadStats();
    _loadHistory();
  });

  document.getElementById('btn-clear-all').addEventListener('click', async () => {
    if (!confirm('Delete ALL ticker data from the database?')) return;
    await fetch('/api/data/ohlcv', { method: 'DELETE' });
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

  input.addEventListener('input', e => {
    e.target.value = e.target.value.toUpperCase();
    clearTimeout(debounce);
    hiIdx = -1;
    const q = e.target.value.trim();
    if (!q) { _ddHide(dd); return; }
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
    const items = [...dd.querySelectorAll('.ticker-dd-item')];
    if (!items.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      hiIdx = Math.min(hiIdx + 1, items.length - 1);
      items.forEach((el, i) => el.classList.toggle('hi', i === hiIdx));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      hiIdx = Math.max(hiIdx - 1, 0);
      items.forEach((el, i) => el.classList.toggle('hi', i === hiIdx));
    }
  });

  document.addEventListener('click', e => {
    if (!document.getElementById('single-ticker-wrap').contains(e.target)) _ddHide(dd);
  });
}

async function _ddFetch(q, dd) {
  const data = await fetch(`/api/tickers/search?q=${encodeURIComponent(q)}`).then(r => r.json());
  const results = data.results || [];
  if (!results.length) { _ddHide(dd); return; }
  dd.innerHTML = results.map(r => `
    <div class="ticker-dd-item" data-ticker="${r.ticker}">
      <span class="ticker-dd-sym">${r.ticker}</span>
      <span class="ticker-dd-exch">${r.exchange}</span>
      <span class="ticker-dd-type">${r.assetType}</span>
    </div>
  `).join('');
  dd.querySelectorAll('.ticker-dd-item').forEach(el => {
    el.addEventListener('mousedown', e => {
      e.preventDefault();
      _addSingleTicker(el.dataset.ticker);
    });
  });
  dd.style.display = 'block';
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
  const status = await fetch('/api/jobs/status').then(r => r.json());
  if (status.fetch.status !== 'running') {
    _stopPolling();
    _batchRunning = false;
    _renderBatchQueue();
    _loadStats();
    _loadHistory();
  }
}

document.addEventListener('keydown', e => {
  if (e.key === '`') { e.preventDefault(); window.location.href = '/indicators'; return; }
  if (e.key === '~') { e.preventDefault(); window.location.href = '/'; return; }
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  if (e.key === 'C' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); window.location.href = '/'; }
  if (e.key === 'T' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); window.location.href = '/fetch'; }
  if (e.key === 'I' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); window.location.href = '/indicators'; }
  if (e.key.length === 1 && /[a-z]/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
    e.preventDefault();
    const input = document.getElementById('single-ticker');
    input.focus();
    input.value = e.key.toUpperCase();
    input.dispatchEvent(new Event('input'));
  }
});

init();
