const ALL_TIMEFRAMES = ['daily', 'weekly', '1hour', '4hour', '5min'];

let _tickerLists = [];
let _pollTimer   = null;

async function init() {
  await _loadTickerLists();
  _buildTimeframeChecks('fetch-tfs', ['daily']);
  _wireButtons();

  const status = await fetch('/api/jobs/status').then(r => r.json());
  _updatePanel(status.fetch);
  if (status.fetch.status === 'running') _startPolling();
}

async function _loadTickerLists() {
  const data = await fetch('/api/ticker-lists').then(r => r.json());
  _tickerLists = data.lists || [];
  const sel = document.getElementById('fetch-list');
  sel.innerHTML = '';
  for (const l of _tickerLists) {
    const opt = document.createElement('option');
    opt.value = l.name;
    opt.textContent = l.name;
    sel.appendChild(opt);
  }
  const saved = localStorage.getItem('defaultTickerList');
  if (saved && _tickerLists.find(l => l.name === saved)) sel.value = saved;
  _updateListCount();
  sel.addEventListener('change', () => {
    localStorage.setItem('defaultTickerList', sel.value);
    _updateListCount();
  });
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

function _wireButtons() {
  document.getElementById('btn-fetch').addEventListener('click', async () => {
    const list      = document.getElementById('fetch-list').value;
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
  if (status.fetch.status !== 'running') _stopPolling();
}

function _updatePanel(state) {
  const track    = document.getElementById('fetch-track');
  const bar      = document.getElementById('fetch-bar');
  const meta     = document.getElementById('fetch-meta');
  const count    = document.getElementById('fetch-count');
  const pctEl    = document.getElementById('fetch-pct');
  const current  = document.getElementById('fetch-current');
  const errorsEl = document.getElementById('fetch-errors');
  const report   = document.getElementById('fetch-report');
  const btn      = document.getElementById('btn-fetch');
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
    count.textContent   = `${state.done} / ${state.total}`;
    pctEl.textContent   = `${Math.round(pct)}%`;
    current.textContent = state.current ? `→ ${state.current}` : '';
    errorsEl.textContent = state.errors > 0 ? `✗ ${state.errors}` : '';
    btn.disabled = true;
    btnCancel.style.display = '';
  } else if (state.status === 'done') {
    _setActive(false);
    const ok = state.done - state.errors;
    count.textContent   = `${state.done} / ${state.total}`;
    pctEl.textContent   = '100%';
    current.textContent = '';
    errorsEl.textContent = state.errors > 0
      ? `✗ ${state.errors} error${state.errors !== 1 ? 's' : ''}`
      : '✓ complete';
    report.innerHTML = _buildReport(ok, state.failed || []);
    btn.disabled = false;
    btnCancel.style.display = 'none';
  } else if (state.status === 'cancelled') {
    _setActive(false);
    count.textContent   = `${state.done} / ${state.total}`;
    pctEl.textContent   = `${Math.round(pct)}% — cancelled`;
    current.textContent = '';
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

init();
