async function init() {
  try { await _loadStats(); } catch { /* non-fatal */ }
  _wireButtons();
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

function _wireButtons() {
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
}

init();
