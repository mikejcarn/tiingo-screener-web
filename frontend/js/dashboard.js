/**
 * dashboard.js — batch management dashboard
 *
 * Drives: ticker list selector, timeframe checkboxes, Fetch + Compute
 * buttons, live progress bars (polling /api/jobs/status), and the
 * Database Overview stats table.
 */

const ALL_TIMEFRAMES = ['daily', 'weekly', '1hour', '4hour', '5min'];
const JOB_PREFIX     = { fetch: 'fetch', indicators: 'ind' };

let _tickerLists  = [];   // [{name, count}]
let _pollTimer    = null;

// ── Bootstrap ─────────────────────────────────────────────────

async function init() {
  await Promise.all([_loadTickerLists(), _loadIndConfs(), _loadStats()]);
  _buildTimeframeChecks('fetch-tfs', ['daily']);
  _buildTimeframeChecks('ind-tfs',   ['daily']);
  _wireButtons();

  // Resume polling if a job was already running before page load
  const status = await fetch('/api/jobs/status').then(r => r.json());
  _applyStatus(status);
  if (status.fetch.status === 'running' || status.indicators.status === 'running') {
    _startPolling();
  }
}

// ── Data loaders ──────────────────────────────────────────────

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
  // Restore saved default
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

async function _loadIndConfs() {
  const data = await fetch('/api/ind-configs').then(r => r.json());
  const sel  = document.getElementById('ind-conf');
  sel.innerHTML = '';
  for (const c of (data.ind_confs || [])) {
    const opt = document.createElement('option');
    opt.value = c;
    opt.textContent = `conf ${c}`;
    sel.appendChild(opt);
  }
}

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
  // Summary strip
  const summary = data.summary || [];
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
    tbody.innerHTML = '<tr><td colspan="6" class="stats-empty">No data in database yet — run a batch fetch to populate.</td></tr>';
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

// ── Timeframe checkboxes ──────────────────────────────────────

function _buildTimeframeChecks(containerId, defaultChecked) {
  const wrap = document.getElementById(containerId);
  wrap.innerHTML = '';
  for (const tf of ALL_TIMEFRAMES) {
    const id  = `${containerId}-${tf}`;
    const lbl = document.createElement('label');
    lbl.innerHTML = `<input type="checkbox" id="${id}" value="${tf}"${defaultChecked.includes(tf) ? ' checked' : ''}> ${tf}`;
    wrap.appendChild(lbl);
  }
}

function _getChecked(containerId) {
  return [...document.querySelectorAll(`#${containerId} input[type="checkbox"]:checked`)]
    .map(el => el.value);
}

// ── Button wiring ─────────────────────────────────────────────

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

  document.getElementById('btn-indicators').addEventListener('click', async () => {
    const conf       = parseInt(document.getElementById('ind-conf').value);
    const timeframes = _getChecked('ind-tfs');
    if (isNaN(conf) || !timeframes.length) return;

    const res = await fetch('/api/indicators/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ind_conf: conf, timeframes }),
    });
    if (!res.ok) {
      const err = await res.json();
      alert(err.detail || 'Failed to start indicators job');
      return;
    }
    _startPolling();
  });

  document.getElementById('btn-refresh-stats').addEventListener('click', _loadStats);

  const _clearBtn = (id, url, msg) => {
    document.getElementById(id).addEventListener('click', async () => {
      if (!confirm(msg)) return;
      await fetch(url, { method: 'DELETE' });
      _loadStats();
    });
  };
  _clearBtn('btn-clear-ohlcv',      '/api/data/ohlcv',      'Delete all price data? This cannot be undone.');
  _clearBtn('btn-clear-indicators', '/api/data/indicators', 'Delete all indicator data? This cannot be undone.');
  _clearBtn('btn-clear-all',        '/api/data/all',        'Delete ALL data (prices + indicators)? This cannot be undone.');

  document.getElementById('btn-fetch-cancel').addEventListener('click', () => {
    fetch('/api/jobs/fetch/cancel', { method: 'POST' });
  });
  document.getElementById('btn-ind-cancel').addEventListener('click', () => {
    fetch('/api/jobs/indicators/cancel', { method: 'POST' });
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
  _applyStatus(status);
  const anyRunning = status.fetch.status === 'running' || status.indicators.status === 'running';
  if (!anyRunning) {
    _stopPolling();
    _loadStats();
  }
}

function _applyStatus(status) {
  _updatePanel('fetch',      status.fetch);
  _updatePanel('indicators', status.indicators);
}

function _updatePanel(job, state) {
  const p         = JOB_PREFIX[job];
  const track     = document.getElementById(`${p}-track`);
  const bar       = document.getElementById(`${p}-bar`);
  const meta      = document.getElementById(`${p}-meta`);
  const count     = document.getElementById(`${p}-count`);
  const pctEl     = document.getElementById(`${p}-pct`);
  const current   = document.getElementById(`${p}-current`);
  const errorsEl  = document.getElementById(`${p}-errors`);
  const report    = document.getElementById(`${p}-report`);
  const btn       = document.getElementById(job === 'fetch' ? 'btn-fetch' : 'btn-indicators');
  const btnCancel = document.getElementById(job === 'fetch' ? 'btn-fetch-cancel' : 'btn-ind-cancel');

  const pct = state.total > 0 ? (state.done / state.total * 100) : 0;
  bar.style.width = `${pct}%`;

  const _setActive = (on) => {
    track.classList.toggle('active', on);
    bar.classList.toggle('active', on);
    meta.classList.toggle('active', on);
  };

  if (state.status === 'idle') {
    _setActive(false);
    count.textContent   = '';
    pctEl.textContent   = '';
    current.textContent = '';
    errorsEl.textContent = '';
    report.innerHTML    = '';
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
    count.textContent   = 'failed';
    pctEl.textContent   = '';
    current.textContent = '';
    errorsEl.textContent = '';
    report.innerHTML    = '';
    btn.disabled = false;
    btnCancel.style.display = 'none';
  }
}

function _buildReport(ok, failed) {
  if (!ok && !failed.length) return '';
  const okLine = `<span class="report-ok">✓ ${ok} fetched</span>`;
  if (!failed.length) return `<div class="dash-report-inner">${okLine}</div>`;
  const failLine = `<span class="report-err">✗ ${failed.length} failed</span>`;
  const tickers  = failed.map(f => `<span class="report-ticker" title="${f.reason}">${f.ticker}</span>`).join('');
  return `<div class="dash-report-inner">${okLine} ${failLine}<div class="report-tickers">${tickers}</div></div>`;
}

init();
