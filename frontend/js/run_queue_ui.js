/**
 * run_queue_ui.js — shared rendering for the run cards' queue rows and their
 * end-of-run summary line (tickers / indicators / scanner / pipeline pages).
 *
 * Each row carries a data-state (pending | running | done | errors |
 * cancelled) that the CSS turns into a colored left edge, so a queue reads at
 * a glance; the status line under the name has a badge, a 3px progress line
 * and, once finished, the time it finished — so results left over from an
 * earlier run are recognizable as such.
 *
 * A result is the page's per-config run record:
 *   { status: 'pending' }
 *   { status: 'running', done?, total?, current?, label? }   no total → indeterminate line
 *   { status: 'done', done?, total?, errors?, countText?, at? }
 *   { status: 'error', error? }
 *   { status: 'cancelled' }
 */

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const clockTime = t => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

/** The row state for a result (undefined result → no state). */
export function rqState(r) {
  if (!r) return '';
  if (r.status === 'done') return r.errors > 0 || r.error ? 'errors' : 'done';
  if (r.status === 'error') return 'errors';
  return r.status;
}

/** Status-line HTML for a result ('' when there's none). */
export function rqStatusHtml(r) {
  if (!r) return '';
  const bar = (cls, pct) => `<div class="rq-bar-track"><div class="rq-bar-fill ${cls}" style="width:${pct}%"></div></div>`;
  const badge = (cls, text) => `<span class="rq-state ${cls}">${text}</span>`;
  switch (r.status) {
    case 'pending':
      return `<div class="rq-info">${badge('rq-pending', 'waiting')}</div>`;
    case 'running': {
      const known = r.total > 0;
      return (known ? bar('rq-running', (r.done || 0) / r.total * 100) : bar('rq-running rq-indeterminate', 100)) +
        `<div class="rq-info">${badge('rq-running', esc(r.label || 'running'))}` +
        (r.current ? `<span class="rq-current">→ ${esc(r.current)}</span>` : '<span class="rq-current"></span>') +
        (known ? `<span class="rq-count">${r.done || 0} / ${r.total}</span>` : '') + `</div>`;
    }
    case 'done': {
      const errs = r.errors || 0, failed = errs > 0 || r.error;
      const count = r.countText ?? (r.total != null ? `${r.done ?? r.total} / ${r.total}` : '');
      return bar(failed ? 'rq-errors' : 'rq-done', 100) +
        `<div class="rq-info">${badge(failed ? 'rq-errors' : 'rq-done',
          failed ? (errs ? `✗ ${errs} error${errs !== 1 ? 's' : ''}` : '✗ error') : '✓ done')}` +
        `<span class="rq-current">${esc(count)}</span>` +
        (r.at ? `<span class="rq-count" title="Finished at">${clockTime(r.at)}</span>` : '') + `</div>`;
    }
    case 'error':
      return bar('rq-errors', 100) + `<div class="rq-info">${badge('rq-errors', `✗ ${esc(r.error || 'error')}`)}</div>`;
    case 'cancelled':
      return `<div class="rq-info">${badge('rq-cancelled', 'cancelled')}</div>`;
  }
  return '';
}

/** Apply a result to a rendered row: its data-state, and its status line. */
export function rqApply(rowEl, statusEl, r) {
  if (rowEl) rowEl.dataset.state = rqState(r);
  if (statusEl) statusEl.innerHTML = rqStatusHtml(r);
}

/**
 * The end-of-run line: "✓ Run complete · 3 configs · 30 tickers · 4:12 PM",
 * or a warning when anything errored / the run was cancelled.
 * results: the page's per-config records for this run, in queue order;
 * opts: { noun: 'config', cancelled?: bool, extra?: string }.
 */
export function showRunSummary(el, results, opts = {}) {
  if (!el) return;
  const list = results.filter(Boolean);
  const noun = opts.noun || 'config';
  const finished = list.filter(r => r.status === 'done').length;
  const failed = list.filter(r => rqState(r) === 'errors').length;
  const errors = list.reduce((n, r) => n + (r.errors || 0), 0);
  const tickers = list.reduce((n, r) => n + (r.status === 'done' && r.total ? r.total : 0), 0);
  const cancelled = !!opts.cancelled;
  const ok = !cancelled && !failed && finished === list.length;
  const parts = [
    cancelled ? '◼ Run cancelled' : ok ? '✓ Run complete' : '✗ Run finished with problems',
    `${finished} / ${list.length} ${noun}${list.length !== 1 ? 's' : ''}`,
  ];
  if (tickers && !opts.noTickers) parts.push(`${tickers} ticker${tickers !== 1 ? 's' : ''}`);
  if (errors) parts.push(`${errors} error${errors !== 1 ? 's' : ''}`);
  else if (failed) parts.push(`${failed} failed`);
  if (opts.extra) parts.push(opts.extra);
  parts.push(clockTime(Date.now()));
  el.className = `run-summary-line ${cancelled ? 'cancelled' : ok ? 'ok' : 'warn'}`;
  el.textContent = parts.join('  ·  ');
  el.style.display = '';
}

export function hideRunSummary(el) {
  if (el) el.style.display = 'none';
}
