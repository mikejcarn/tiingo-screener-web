// Shared keyboard-shortcuts help overlay — used by all three pages.
// Call initHelp('chart' | 'tickers' | 'indicators') once per page.

const _PAGES = [
  {
    id: 'tickers',
    label: 'tickers',
    html: `<table class="help-table"><tbody>
      <tr class="help-section"><td colspan="2">Ticker Search</td></tr>
      <tr><td>Type any letter</td><td>Search tickers in the Single Ticker box</td></tr>
      <tr><td><kbd>↑</kbd> <kbd>↓</kbd></td><td>Navigate suggestions</td></tr>
      <tr><td><kbd>=</kbd> / <kbd>-</kbd></td><td>Previous / next suggestion (same as ↑ / ↓)</td></tr>
      <tr><td><kbd>Enter</kbd></td><td>Add selected ticker to queue</td></tr>
      <tr><td><kbd>Escape</kbd></td><td>Clear search box / close dropdown / cancel API key edit</td></tr>

      <tr class="help-section"><td colspan="2">Ticker Lists</td></tr>
      <tr><td><kbd>[</kbd> / <kbd>]</kbd></td><td>Previous / next list in Batch Fetch select</td></tr>

      <tr class="help-section"><td colspan="2">Page Navigation</td></tr>
      <tr><td><kbd>\`</kbd> / <kbd>~</kbd></td><td>Cycle pages: chart → tickers → indicators</td></tr>
      <tr><td><kbd>C</kbd> / <kbd>T</kbd> / <kbd>I</kbd></td><td>Go to chart / tickers / indicators page</td></tr>

      <tr class="help-section"><td colspan="2">This Panel</td></tr>
      <tr><td><kbd>?</kbd></td><td>Toggle help</td></tr>
      <tr><td><kbd>=</kbd> / <kbd>-</kbd> &nbsp;or&nbsp; <kbd>←</kbd> / <kbd>→</kbd></td><td>Cycle between page shortcut views</td></tr>
      <tr><td><kbd>Escape</kbd></td><td>Close panel</td></tr>
    </tbody></table>`,
  },
  {
    id: 'indicators',
    label: 'indicators',
    html: `<table class="help-table"><tbody>
      <tr class="help-section"><td colspan="2">Config List</td></tr>
      <tr><td><kbd>↑</kbd> <kbd>↓</kbd></td><td>Navigate configs</td></tr>
      <tr><td><kbd>=</kbd> / <kbd>-</kbd></td><td>Previous / next config (same as ↑ / ↓)</td></tr>
      <tr><td><kbd>_</kbd> / <kbd>+</kbd></td><td>Previous / next config</td></tr>

      <tr class="help-section"><td colspan="2">Config Actions</td></tr>
      <tr><td><kbd>N</kbd></td><td>New config</td></tr>
      <tr><td><kbd>S</kbd></td><td>Save config</td></tr>
      <tr><td><kbd>D</kbd></td><td>Delete config</td></tr>
      <tr><td><kbd>R</kbd></td><td>Run selected configs</td></tr>
      <tr><td><kbd>Shift+Enter</kbd></td><td>Focus config name input</td></tr>

      <tr class="help-section"><td colspan="2">Timeframes</td></tr>
      <tr><td><kbd>[</kbd> / <kbd>]</kbd></td><td>Previous / next timeframe tab</td></tr>

      <tr class="help-section"><td colspan="2">Indicator Cards</td></tr>
      <tr><td><kbd>↑</kbd> <kbd>↓</kbd></td><td>Navigate indicator cards</td></tr>
      <tr><td><kbd>Enter</kbd></td><td>Toggle focused indicator (select / deselect)</td></tr>
      <tr><td><kbd>Space</kbd> / <kbd>\\</kbd></td><td>Toggle focused indicator in / out of run queue</td></tr>

      <tr class="help-section"><td colspan="2">Page Navigation</td></tr>
      <tr><td><kbd>\`</kbd> / <kbd>~</kbd></td><td>Cycle pages: chart → tickers → indicators</td></tr>
      <tr><td><kbd>C</kbd> / <kbd>T</kbd> / <kbd>I</kbd></td><td>Go to chart / tickers / indicators page</td></tr>

      <tr class="help-section"><td colspan="2">This Panel</td></tr>
      <tr><td><kbd>?</kbd></td><td>Toggle help</td></tr>
      <tr><td><kbd>=</kbd> / <kbd>-</kbd> &nbsp;or&nbsp; <kbd>←</kbd> / <kbd>→</kbd></td><td>Cycle between page shortcut views</td></tr>
      <tr><td><kbd>Escape</kbd></td><td>Close panel</td></tr>
    </tbody></table>`,
  },
  {
    id: 'chart',
    label: 'chart',
    html: `<table class="help-table"><tbody>
      <tr class="help-section"><td colspan="2">Playback</td></tr>
      <tr><td><kbd>Space</kbd></td><td>Play / pause (rewinds to start if at last bar)</td></tr>
      <tr><td><kbd>←</kbd> <kbd>→</kbd></td><td>Step one bar backward / forward</td></tr>
      <tr><td><kbd>Shift+←</kbd> <kbd>Shift+→</kbd></td><td>Jump 20 bars</td></tr>
      <tr><td><kbd>Home</kbd> <kbd>End</kbd></td><td>First bar / last bar</td></tr>
      <tr><td><kbd>↑</kbd> <kbd>↓</kbd></td><td>Increase / decrease FPS</td></tr>
      <tr><td><kbd>Backspace</kbd></td><td>Toggle auto-fit (fits all candles during playback)</td></tr>
      <tr><td>Double-click chart</td><td>Jump to that bar</td></tr>

      <tr class="help-section"><td colspan="2">Ticker Navigation</td></tr>
      <tr><td><kbd>=</kbd></td><td>Previous ticker</td></tr>
      <tr><td><kbd>-</kbd></td><td>Next ticker</td></tr>
      <tr><td><kbd>_</kbd> / <kbd>+</kbd></td><td>Previous / next ticker list</td></tr>
      <tr><td><kbd>[</kbd> / <kbd>]</kbd></td><td>Previous / next timeframe</td></tr>
      <tr><td><kbd>{</kbd> / <kbd>}</kbd></td><td>Previous / next indicator conf</td></tr>
      <tr><td>Any lowercase letter</td><td>Focus ticker search</td></tr>

      <tr class="help-section"><td colspan="2">Jump Inputs (press Enter)</td></tr>
      <tr><td>Any digit key</td><td>Focus the bar # input and start typing</td></tr>
      <tr><td>Bar # input</td><td>Jump to bar number</td></tr>
      <tr><td>Date input</td><td>Jump to date (YYYY-MM-DD)</td></tr>
      <tr><td>FPS input</td><td>Set playback speed (1–60)</td></tr>

      <tr class="help-section"><td colspan="2">Load Position (nav bar dropdown)</td></tr>
      <tr><td><kbd>\\</kbd></td><td>Cycle load mode: start → end → bar → date</td></tr>
      <tr><td><kbd>Enter</kbd></td><td>Enter the value field (when bar or date mode active)</td></tr>
      <tr><td>start</td><td>Each ticker loads at bar 0, ready for playback</td></tr>
      <tr><td>end</td><td>Each ticker loads at the last bar (full chart)</td></tr>
      <tr><td>bar</td><td>Each ticker loads at the given bar index</td></tr>
      <tr><td>date</td><td>Each ticker loads at the bar closest to the given date</td></tr>

      <tr class="help-section"><td colspan="2">View</td></tr>
      <tr><td><kbd>F</kbd></td><td>Toggle fullscreen (hides nav &amp; controls bars)</td></tr>
      <tr><td><kbd>\`</kbd> / <kbd>~</kbd></td><td>Cycle pages: chart → tickers → indicators</td></tr>
      <tr><td><kbd>C</kbd> / <kbd>T</kbd> / <kbd>I</kbd></td><td>Go to chart / tickers / indicators page</td></tr>

      <tr class="help-section"><td colspan="2">This Panel</td></tr>
      <tr><td><kbd>?</kbd></td><td>Toggle help</td></tr>
      <tr><td><kbd>=</kbd> / <kbd>-</kbd> &nbsp;or&nbsp; <kbd>←</kbd> / <kbd>→</kbd></td><td>Cycle between page shortcut views</td></tr>
      <tr><td><kbd>Escape</kbd></td><td>Close panel / blur any focused input</td></tr>
    </tbody></table>`,
  },
];

let _overlay = null;
let _body    = null;
let _activeIdx = 0;
let _btnHelp   = null;

function _createOverlay() {
  if (_overlay) return;

  const tabsHtml = _PAGES.map(p =>
    `<button class="help-tab" data-page="${p.id}">${p.label}</button>`
  ).join('');

  const el = document.createElement('div');
  el.id = 'help-overlay';
  el.innerHTML = `
    <div id="help-panel">
      <div id="help-header">
        <div id="help-tabs">${tabsHtml}</div>
        <span id="help-nav-hint"><kbd>=</kbd> / <kbd>-</kbd></span>
        <button id="help-close" title="Close (Escape)">&#x2715;</button>
      </div>
      <div id="help-body"></div>
    </div>`;
  document.body.appendChild(el);

  _overlay = el;
  _body    = el.querySelector('#help-body');

  el.addEventListener('click', (e) => { if (e.target === el) _hide(); });
  el.querySelector('#help-close').addEventListener('click', _hide);
  el.querySelectorAll('.help-tab').forEach((tab, i) => {
    tab.addEventListener('click', () => _switchTab(i));
  });
}

function _switchTab(idx) {
  _activeIdx = (idx + _PAGES.length) % _PAGES.length;
  _body.innerHTML = _PAGES[_activeIdx].html;
  _overlay.querySelectorAll('.help-tab').forEach((t, i) => {
    t.classList.toggle('active', i === _activeIdx);
  });
}

function _show(startIdx) {
  _overlay.classList.add('visible');
  _btnHelp?.classList.add('active');
  _switchTab(startIdx ?? _activeIdx);
}

function _hide() {
  _overlay.classList.remove('visible');
  _btnHelp?.classList.remove('active');
}

function _toggle(startIdx) {
  if (_overlay.classList.contains('visible')) _hide();
  else _show(startIdx);
}

export function initHelp(currentPage) {
  _createOverlay();

  const pageIdx = _PAGES.findIndex(p => p.id === currentPage);
  if (pageIdx >= 0) _activeIdx = pageIdx;

  _btnHelp = document.querySelector('.btn-help-nav');
  _btnHelp?.addEventListener('click', () => _toggle());

  document.addEventListener('keydown', (e) => {
    if (_overlay.classList.contains('visible')) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); _hide(); return; }
      if (e.key === 'ArrowLeft'  || e.key === '[' || e.key === '=') { e.preventDefault(); e.stopPropagation(); _switchTab(_activeIdx - 1); return; }
      if (e.key === 'ArrowRight' || e.key === ']' || e.key === '-') { e.preventDefault(); e.stopPropagation(); _switchTab(_activeIdx + 1); return; }
      e.stopPropagation(); // swallow all other keys while panel is open
      return;
    }
    if (e.key === '?') { e.preventDefault(); e.stopPropagation(); _toggle(); return; }
  }, true); // capture phase — runs before page-specific bubble handlers
}

// Allow external callers (browse.js) to toggle programmatically
export function toggleHelp(force) {
  if (!_overlay) return;
  if (force === false) _hide();
  else if (force === true) _show();
  else _toggle();
}
export function isHelpVisible() {
  return _overlay?.classList.contains('visible') ?? false;
}
