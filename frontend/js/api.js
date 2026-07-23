// Thin fetch wrapper — JSON headers, automatic error throwing, response parsing.

async function _req(url, opts = {}) {
  const res = await fetch(url, opts);
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json()).detail || ''; } catch {}
    throw Object.assign(new Error(detail || res.statusText), { status: res.status });
  }
  const ct = res.headers.get('content-type') || '';
  return ct.includes('application/json') ? res.json() : res.text();
}

export const api = {
  get:  (url)       => _req(url),
  post: (url, body) => _req(url, body !== undefined
    ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
    : { method: 'POST' }),
  put:  (url, body) => _req(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  del:  (url)       => _req(url, { method: 'DELETE' }),
};
