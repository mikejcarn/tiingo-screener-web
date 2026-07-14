const ALL_TIMEFRAMES = ['daily', 'weekly', '1hour', '4hour', '5min'];

let _tickerLists = [];
let _pollTimer   = null;

async function init() {
  await _loadTickerLists();
  _buildTimeframeChecks('fetch-tfs',   ['daily']);
  _buildTimeframeChecks('single-tfs',  ['daily']);
  _wireButtons();
  _initDropZone();

  const [status] = await Promise.all([
    fetch('/api/jobs/status').then(r => r.json()),
    _loadApiKey(),
    _loadStats(),
    _loadHistory(),
    _loadTiingoListInfo(),
  ]);
  _updatePanel(status.fetch);
  if (status.fetch.status === 'running') _startPolling();
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

async function _loadApiKey() {
  const data = await fetch('/api/settings/api-key').then(r => r.json());
  document.getElementById('apikey-masked').textContent = data.masked || '(not set)';
}

function _setApiKeyEditMode(on) {
  document.getElementById('apikey-masked').style.display    = on ? 'none' : '';
  document.getElementById('apikey-input').style.display     = on ? '' : 'none';
  document.getElementById('btn-apikey-edit').style.display  = on ? 'none' : '';
  document.getElementById('btn-apikey-save').style.display  = on ? '' : 'none';
  document.getElementById('btn-apikey-cancel').style.display = on ? '' : 'none';
  document.getElementById('btn-apikey-verify').style.display = on ? 'none' : '';
  document.getElementById('btn-apikey-delete').style.display = on ? 'none' : '';
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
  document.getElementById('apikey-masked').textContent = data.masked || '';
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
      <td>${r.ticker}</td>
      <td>${r.timeframe}</td>
      <td>${r.ticker_list || '—'}</td>
      <td>${r.last_date || '—'}</td>
      <td>${r.rows.toLocaleString()}</td>
      <td>${r.fetched_at || '—'}</td>
    </tr>
  `).join('');
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
      <td>${r.session}</td>
      <td>${r.ticker_list}</td>
      <td>${r.timeframe}</td>
      <td>${r.tickers.toLocaleString()}</td>
      <td>${r.last_date}</td>
    </tr>
  `).join('');
}

// ── Buttons ───────────────────────────────────────────────────

function _wireButtons() {
  document.getElementById('btn-fetch').addEventListener('click', async () => {
    const list       = document.getElementById('fetch-list').value;
    const timeframes = _getChecked('fetch-tfs');
    if (!list || !timeframes.length) return;
    const res = await fetch('/api/fetch/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticker_list: list, timeframes }),
    });
    if (!res.ok) {
      const err = await res.json();
      alert(err.detail || 'Failed to start fetch job');
      return;
    }
    _startPolling();
  });

  document.getElementById('btn-fetch-cancel').addEventListener('click', () => {
    fetch('/api/jobs/fetch/cancel', { method: 'POST' });
  });

  document.getElementById('btn-apikey-edit').addEventListener('click', () => _setApiKeyEditMode(true));
  document.getElementById('btn-apikey-cancel').addEventListener('click', () => _setApiKeyEditMode(false));
  document.getElementById('btn-apikey-save').addEventListener('click', _saveApiKey);
  document.getElementById('btn-apikey-verify').addEventListener('click', _verifyApiKey);
  document.getElementById('btn-apikey-delete').addEventListener('click', async () => {
    const data = await fetch('/api/settings/api-key', { method: 'DELETE' }).then(r => r.json());
    document.getElementById('apikey-masked').textContent = data.masked || '(not set)';
    document.getElementById('apikey-status').textContent = '';
    document.getElementById('apikey-status').className = 'apikey-status';
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

  // Single ticker
  document.getElementById('btn-single-fetch').addEventListener('click', _fetchSingleTicker);
  _initTickerSearch();
}

// ── Single ticker fetch ───────────────────────────────────────

async function _fetchSingleTicker() {
  const ticker = document.getElementById('single-ticker').value.trim().toUpperCase();
  if (!ticker) return;
  const timeframes = _getChecked('single-tfs');
  if (!timeframes.length) return;

  const btn      = document.getElementById('btn-single-fetch');
  const resultEl = document.getElementById('single-result');
  btn.disabled = true;
  btn.textContent = 'Fetching…';
  resultEl.innerHTML = '';

  try {
    const res = await fetch('/api/fetch/ticker', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticker, timeframes }),
    });
    const data = await res.json();
    if (res.status === 429) {
      resultEl.innerHTML = `<div class="dash-report-inner"><span class="report-err">✗ ${data.detail}</span></div>`;
    } else if (!res.ok) {
      resultEl.innerHTML = `<div class="dash-report-inner"><span class="report-err">✗ ${data.detail || 'Error'}</span></div>`;
    } else {
      resultEl.innerHTML = _buildSingleResult(data);
      _loadStats();
      _loadHistory();
    }
  } catch {
    resultEl.innerHTML = `<div class="dash-report-inner"><span class="report-err">✗ Network error</span></div>`;
  }

  btn.disabled = false;
  btn.textContent = 'Fetch';
}

function _buildSingleResult({ ticker, results, errors }) {
  const lines = [
    ...results.map(r => `<span class="report-ok">✓ ${r.timeframe} — ${r.rows.toLocaleString()} rows</span>`),
    ...errors.map(e => `<span class="report-err">✗ ${e.timeframe} — ${e.reason}</span>`),
  ];
  return `<div class="dash-report-inner">
    <span class="single-result-ticker">${ticker}</span>
    <div class="single-result-lines">${lines.join('')}</div>
  </div>`;
}

// ── Ticker search autocomplete ────────────────────────────────

function _initTickerSearch() {
  const input = document.getElementById('single-ticker');
  const dd    = document.getElementById('single-ticker-dd');
  let debounce = null;
  let hiIdx    = -1;

  input.addEventListener('input', e => {
    e.target.value = e.target.value.toUpperCase();
    clearTimeout(debounce);
    const q = e.target.value.trim();
    if (!q) { _ddHide(dd); return; }
    debounce = setTimeout(() => _ddFetch(q, input, dd), 120);
  });

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      const hi = dd.querySelector('.hi');
      if (hi) { input.value = hi.dataset.ticker; _ddHide(dd); }
      else _fetchSingleTicker();
      e.preventDefault();
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

async function _ddFetch(q, input, dd) {
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
      input.value = el.dataset.ticker;
      _ddHide(dd);
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
  const zone    = document.getElementById('drop-zone');
  const input   = document.getElementById('file-input');
  const browse  = document.getElementById('btn-browse');

  browse.addEventListener('click', () => input.click());
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

// ── Polling ───────────────────────────────────────────────────

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
  _updatePanel(status.fetch);
  if (status.fetch.status !== 'running') {
    _stopPolling();
    _loadStats();
    _loadHistory();
  }
}

// ── Progress panel ────────────────────────────────────────────

function _updatePanel(state) {
  const track     = document.getElementById('fetch-track');
  const bar       = document.getElementById('fetch-bar');
  const meta      = document.getElementById('fetch-meta');
  const count     = document.getElementById('fetch-count');
  const pctEl     = document.getElementById('fetch-pct');
  const current   = document.getElementById('fetch-current');
  const errorsEl  = document.getElementById('fetch-errors');
  const report    = document.getElementById('fetch-report');
  const btn       = document.getElementById('btn-fetch');
  const btnCancel = document.getElementById('btn-fetch-cancel');

  const pct = state.total > 0 ? (state.done / state.total * 100) : 0;
  bar.style.width = `${pct}%`;

  const _setActive = on => {
    track.classList.toggle('active', on);
    bar.classList.toggle('active', on);
    meta.classList.toggle('active', on);
  };

  if (state.status === 'idle') {
    _setActive(false);
    count.textContent = pctEl.textContent = current.textContent = errorsEl.textContent = '';
    report.innerHTML = '';
    btn.disabled = false;
    btnCancel.style.display = 'none';
  } else if (state.status === 'running') {
    _setActive(true);
    count.textContent    = `${state.done} / ${state.total}`;
    pctEl.textContent    = `${Math.round(pct)}%`;
    current.textContent  = state.current ? `→ ${state.current}` : '';
    errorsEl.textContent = state.errors > 0 ? `✗ ${state.errors}` : '';
    btn.disabled = true;
    btnCancel.style.display = '';
  } else if (state.status === 'done') {
    _setActive(false);
    const ok = state.done - state.errors;
    count.textContent    = `${state.done} / ${state.total}`;
    pctEl.textContent    = '100%';
    current.textContent  = '';
    errorsEl.textContent = state.errors > 0
      ? `✗ ${state.errors} error${state.errors !== 1 ? 's' : ''}`
      : '✓ complete';
    report.innerHTML = _buildReport(ok, state.failed || []);
    btn.disabled = false;
    btnCancel.style.display = 'none';
  } else if (state.status === 'cancelled') {
    _setActive(false);
    count.textContent    = `${state.done} / ${state.total}`;
    pctEl.textContent    = `${Math.round(pct)}% — cancelled`;
    current.textContent  = '';
    errorsEl.textContent = state.errors > 0 ? `✗ ${state.errors} error${state.errors !== 1 ? 's' : ''}` : '';
    report.innerHTML = state.failed?.length ? _buildReport(state.done - state.errors, state.failed) : '';
    btn.disabled = false;
    btnCancel.style.display = 'none';
  } else if (state.status === 'error') {
    _setActive(false);
    count.textContent = 'failed';
    pctEl.textContent = current.textContent = errorsEl.textContent = '';
    report.innerHTML = '';
    btn.disabled = false;
    btnCancel.style.display = 'none';
  }
}

function _buildReport(ok, failed) {
  if (!ok && !failed.length) return '';
  const okLine   = `<span class="report-ok">✓ ${ok} fetched</span>`;
  if (!failed.length) return `<div class="dash-report-inner">${okLine}</div>`;
  const failLine = `<span class="report-err">✗ ${failed.length} failed</span>`;
  const tickers  = failed.map(f =>
    `<span class="report-ticker" title="${f.reason}">${f.ticker}</span>`
  ).join('');
  return `<div class="dash-report-inner">${okLine} ${failLine}<div class="report-tickers">${tickers}</div></div>`;
}

document.addEventListener('keydown', e => {
  if (e.key === '`') { e.preventDefault(); window.location.href = '/indicators'; }
});

init();
