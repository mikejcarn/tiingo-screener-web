/**
 * dataset_select.js — the "run on" dataset select beside the Run buttons
 * (indicators and scanner pages).
 *
 * A dataset is a ticker config (fetch page): a ticker list, timeframes and a
 * bar window. The empty choice runs on every downloaded ticker, full history —
 * the behavior from before datasets existed. The choice is remembered per page.
 */

import { api } from './api.js';

/** Fill `el` with the datasets and restore the page's last choice (storageKey). */
export async function initDatasetSelect(el, storageKey) {
  if (!el) return;
  let configs = [];
  try { configs = (await api.get('/api/ticker-configs')).configs || []; } catch {}
  el.innerHTML = '';
  const all = document.createElement('option');
  all.value = ''; all.textContent = 'All data · full history';
  el.appendChild(all);
  // Only datasets whose list has been downloaded (the fetch page lists them all).
  for (const c of configs.filter(c => c.downloaded)) {
    const opt = document.createElement('option');
    opt.value = String(c.id);
    opt.textContent = `${c.name} · ${c.ticker_list || 'all tickers'} · ${c.window_label}`;
    el.appendChild(opt);
  }
  let saved = '';
  try { saved = localStorage.getItem(storageKey) || ''; } catch {}
  el.value = [...el.options].some(o => o.value === saved) ? saved : '';
  el.addEventListener('change', () => {
    el.blur();
    try { localStorage.setItem(storageKey, el.value); } catch {}
  });
}

/** The selected dataset id, or null for all data / full history. */
export function selectedDatasetId(el) {
  const v = parseInt(el?.value, 10);
  return Number.isFinite(v) ? v : null;
}
