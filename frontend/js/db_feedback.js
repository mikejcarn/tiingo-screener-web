/**
 * db_feedback.js — visible feedback for deletes on the database / history
 * cards (tickers, indicators, scanner, pipeline pages).
 *
 * runDelete() wraps one delete: the button reads "Clearing…" and is disabled,
 * the affected rows dim with a strikethrough while the request runs, then fade
 * and collapse out; the card's header shows "✓ …" for a few seconds — or an
 * orange message that stays (click to dismiss) if it failed or did nothing.
 */

/** The header bar (.ind-run-head / .dash-section-head) of the card containing el. */
export function cardHeadOf(el) {
  for (let n = el; n; n = n.parentElement) {
    const head = [...n.children].find(c => c.matches?.('.ind-run-head, .dash-section-head'));
    if (head) return head;
  }
  return null;
}

const _timers = new WeakMap();

/** Show a message in a card header. kind 'ok' fades after a few seconds; 'warn' stays until clicked. */
export function cardNotice(head, text, kind = 'ok') {
  if (!head) return;
  let el = head.querySelector(':scope > .card-notice');
  if (!el) {
    el = document.createElement('span');
    el.className = 'card-notice';
    el.addEventListener('click', () => el.classList.remove('on'));
    // Just before the header's buttons (the title may be a bare text node).
    const actions = head.querySelector(':scope > .ind-db-head-actions, :scope > .dash-section-actions');
    head.insertBefore(el, actions || null);
  }
  clearTimeout(_timers.get(el));
  el.textContent = text;
  el.title = kind === 'warn' ? `${text} (click to dismiss)` : text;
  el.dataset.kind = kind;
  el.classList.add('on');
  if (kind === 'ok') _timers.set(el, setTimeout(() => el.classList.remove('on'), 4500));
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * Run a delete with feedback.
 *   btn      the button pressed (busy state; also locates the card header)
 *   rows     the table rows being deleted (dimmed, then faded out)
 *   action   async () => the delete; may return false, or a message string, to mean "nothing deleted"
 *   okText   header message on success
 *   noneText header message (warn) when action returns false
 *   busyText button label while running (default "Clearing…"; row × buttons keep their glyph)
 *   emptyText if given and there are no rows, show it (warn) and skip the delete — a Clear All on an empty card
 * Returns true if the delete went through.
 */
export async function runDelete({ btn, rows = [], action, okText, noneText = 'Nothing deleted', busyText, emptyText }) {
  const head = cardHeadOf(btn || rows[0]);
  if (emptyText && !rows.length) { cardNotice(head, emptyText, 'warn'); return false; }
  const label = btn?.textContent;
  if (btn) {
    btn.disabled = true;
    if (busyText !== null && btn.textContent.trim().length > 2) btn.textContent = busyText || 'Clearing…';
  }
  rows.forEach(r => r.classList.add('row-deleting'));
  try {
    const result = await action();
    if (result === false || typeof result === 'string') {
      rows.forEach(r => r.classList.remove('row-deleting'));
      cardNotice(head, typeof result === 'string' ? result : noneText, 'warn');
      return false;
    }
    rows.forEach(r => r.classList.add('row-gone'));
    if (rows.length) await sleep(280);
    cardNotice(head, okText, 'ok');
    return true;
  } catch (err) {
    rows.forEach(r => r.classList.remove('row-deleting', 'row-gone'));
    cardNotice(head, `✗ Delete failed — ${err?.message || 'error'}`, 'warn');
    return false;
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = label; }
  }
}

/** After a Clear All + reload: replace the empty table's placeholder with what happened. */
export function noteEmpty(tbody, text) {
  const cell = tbody?.querySelector('.stats-empty');
  if (cell) cell.textContent = text;
}

export const fmtCount = (n, noun) => `${Number(n).toLocaleString()} ${noun}${n === 1 ? '' : 's'}`;
