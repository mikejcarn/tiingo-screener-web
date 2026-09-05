// Shared keyboard-shortcuts help overlay — used by all pages.
// Call initHelp('chart' | 'tickers' | 'indicators' | 'scanner' | 'pipeline') once per page.

const _GLOBAL_ROWS = `
  <tr class="help-section help-section-global"><td colspan="2">Global — all pages</td></tr>
  <tr><td><kbd>/</kbd></td><td>Toggle light / dark theme</td></tr>
  <tr><td><kbd>\`</kbd> / <kbd>~</kbd></td><td>Cycle pages forward / backward (tickers → indicators → scanner → pipeline → chart)</td></tr>
  <tr><td>Ctrl+<kbd>\`</kbd></td><td>Jump straight back to tickers (the starting point), from any page</td></tr>
  <tr><td><kbd>T</kbd> / <kbd>I</kbd> / <kbd>S</kbd> / <kbd>P</kbd> / <kbd>C</kbd></td><td>Jump to tickers / indicators / scanner / pipeline / chart</td></tr>
  <tr><td><kbd>?</kbd></td><td>Toggle this help panel</td></tr>
  <tr><td><kbd>-</kbd> / <kbd>=</kbd> &nbsp;or&nbsp; <kbd>←</kbd> / <kbd>→</kbd> &nbsp;or&nbsp; <kbd>]</kbd> / <kbd>[</kbd></td><td>Cycle help tabs (in this panel)</td></tr>
  <tr><td><kbd>Escape</kbd></td><td>Close panel / blur any focused input</td></tr>`;

const _PAGES = [
  {
    id: 'tickers',
    label: 'tickers',
    html: `<table class="help-table"><tbody>
      <tr class="help-section"><td colspan="2">Ticker Configs</td></tr>
      <tr><td><kbd>_</kbd> / <kbd>+</kbd></td><td>Next / previous ticker config (wraps around)</td></tr>
      <tr><td><kbd>-</kbd> / <kbd>=</kbd></td><td>Open / cycle the open config's Ticker List dropdown</td></tr>
      <tr><td><kbd>[</kbd> / <kbd>]</kbd></td><td>Focus next / previous Timeframe checkbox (wraps around)</td></tr>
      <tr><td><kbd>Enter</kbd></td><td>Toggle the focused Timeframe checkbox on/off</td></tr>
      <tr><td><kbd>N</kbd></td><td>New ticker config</td></tr>
      <tr><td><kbd>Shift+Enter</kbd></td><td>Focus config name input</td></tr>
      <tr><td><kbd>Ctrl+S</kbd></td><td>Save ticker config</td></tr>
      <tr><td><kbd>D</kbd></td><td>Delete ticker config</td></tr>
      <tr><td>▶ button &nbsp;or&nbsp; <kbd>Space</kbd></td><td>Add / remove open config from the run queue</td></tr>
      <tr><td><kbd>R</kbd></td><td>Run queued ticker configs</td></tr>
      <tr><td colspan="2" style="color:var(--t3);font-size:11px;">A ticker config pairs a ticker list with timeframes to fetch — save it once, reuse it here or from the Pipeline page.</td></tr>

      <tr class="help-section"><td colspan="2">Single Ticker Search</td></tr>
      <tr><td>Type any letter</td><td>Search tickers in the Single Ticker box</td></tr>
      <tr><td><kbd>↑</kbd> <kbd>↓</kbd></td><td>Navigate suggestions (while search box is focused)</td></tr>
      <tr><td><kbd>Enter</kbd></td><td>Add selected ticker to queue</td></tr>
      <tr><td><kbd>F</kbd></td><td>Fetch the queued single ticker(s)</td></tr>
      <tr><td><kbd>Escape</kbd></td><td>Clear search / close dropdown / cancel API key edit</td></tr>
      ${_GLOBAL_ROWS}
    </tbody></table>
    <div class="help-summary">The tickers page manages your local price database. Ticker configs (list + timeframes) are saved and reusable — queue several and run them in sequence, or reference one directly from the Pipeline page's Fetch stage. Individual tickers can still be added ad hoc via search. OHLCV data is stored per timeframe and feeds everything else — the chart and indicator pages both draw from here.</div>`,
  },
  {
    id: 'indicators',
    label: 'indicators',
    html: `<table class="help-table"><tbody>
      <tr class="help-section"><td colspan="2">Config List</td></tr>
      <tr><td><kbd>_</kbd> / <kbd>+</kbd></td><td>Next / previous config (wraps around)</td></tr>

      <tr class="help-section"><td colspan="2">Config Actions</td></tr>
      <tr><td><kbd>N</kbd></td><td>New config</td></tr>
      <tr><td><kbd>Ctrl+S</kbd></td><td>Save config</td></tr>
      <tr><td><kbd>D</kbd></td><td>Delete config</td></tr>
      <tr><td><kbd>R</kbd></td><td>Run queued configs</td></tr>
      <tr><td><kbd>Shift+Enter</kbd></td><td>Focus config name input</td></tr>

      <tr class="help-section"><td colspan="2">Timeframes</td></tr>
      <tr><td><kbd>[</kbd> / <kbd>]</kbd></td><td>Next / previous timeframe tab (wraps around)</td></tr>

      <tr class="help-section"><td colspan="2">Indicator Cards</td></tr>
      <tr><td><kbd>-</kbd> / <kbd>=</kbd></td><td>Navigate indicator cards (always — even while a card is open)</td></tr>
      <tr><td><kbd>↑</kbd> <kbd>↓</kbd></td><td>Cycle the open card's parameters, once it's open</td></tr>
      <tr><td><kbd>Enter</kbd></td><td>Toggle focused indicator on / off — or, if a parameter is focused, activate it (toggle checkbox, cycle dropdown, focus text field, expand/collapse a group)</td></tr>
      <tr><td><kbd>←</kbd> <kbd>→</kbd></td><td>Step the focused numeric parameter by its increment</td></tr>
      <tr><td><kbd>Space</kbd> / <kbd>\\</kbd></td><td>Add / remove open config from the run queue</td></tr>
      ${_GLOBAL_ROWS}
    </tbody></table>
    <div class="help-summary">The indicators page configures and computes technical overlays. Each config pairs a set of indicators with one or more timeframes. Computed results are stored alongside OHLCV data and can be overlaid on the chart page.</div>`,
  },
  {
    id: 'scanner',
    label: 'scanner',
    html: `<table class="help-table"><tbody>
      <tr class="help-section"><td colspan="2">Scan Config List</td></tr>
      <tr><td><kbd>_</kbd> / <kbd>+</kbd></td><td>Next / previous scan config (wraps around)</td></tr>
      <tr><td><kbd>N</kbd></td><td>New scan config</td></tr>
      <tr><td><kbd>Shift+Enter</kbd></td><td>Focus config name input</td></tr>
      <tr><td><kbd>Ctrl+S</kbd></td><td>Save scan config</td></tr>
      <tr><td><kbd>D</kbd></td><td>Delete scan config</td></tr>
      <tr><td>▶ button &nbsp;or&nbsp; <kbd>Space</kbd> (no card focused)</td><td>Add / remove open config from the run queue</td></tr>
      <tr><td><kbd>R</kbd></td><td>Run queued scan configs</td></tr>

      <tr class="help-section"><td colspan="2">Timeframes</td></tr>
      <tr><td><kbd>[</kbd> / <kbd>]</kbd></td><td>Next / previous timeframe tab (wraps around)</td></tr>
      <tr><td><kbd>;</kbd> / <kbd>'</kbd></td><td>Previous / next Indicator Configuration (skips configs with no computed data; shows which group — Indicator Configs vs Tickers Only — next to the dropdown)</td></tr>

      <tr class="help-section"><td colspan="2">Criteria Cards</td></tr>
      <tr><td><kbd>-</kbd> / <kbd>=</kbd></td><td>Focus next / previous criteria card (always — even while one is open)</td></tr>
      <tr><td><kbd>↑</kbd> <kbd>↓</kbd></td><td>Cycle the focused card's parameters, once it's open</td></tr>
      <tr><td><kbd>Enter</kbd> (no param focused)</td><td>Select / deselect the focused criteria card (also opens / closes it)</td></tr>
      <tr><td><kbd>Enter</kbd> (param focused)</td><td>Activate the focused parameter (toggle checkbox, cycle dropdown, focus text/number field)</td></tr>
      <tr><td><kbd>Space</kbd> (card focused)</td><td>Select / deselect the focused criteria card — works whether or not a param is also focused</td></tr>
      <tr><td><kbd>←</kbd> <kbd>→</kbd></td><td>Step the focused numeric parameter by its increment</td></tr>
      ${_GLOBAL_ROWS}
    </tbody></table>
    <div class="help-summary">The scanner page tests your ticker database against configurable criteria. Each scan config is linked to an indicator config, so criteria can reference both OHLCV data and computed indicators. Results can be opened directly in the chart page for bar-by-bar review.</div>`,
  },
  {
    id: 'pipeline',
    label: 'pipeline',
    html: `<table class="help-table"><tbody>
      <tr class="help-section"><td colspan="2">Pipeline List</td></tr>
      <tr><td><kbd>_</kbd> / <kbd>+</kbd></td><td>Next / previous pipeline (wraps around)</td></tr>
      <tr><td><kbd>N</kbd></td><td>New pipeline</td></tr>
      <tr><td><kbd>Shift+Enter</kbd></td><td>Focus config name input</td></tr>
      <tr><td><kbd>Ctrl+S</kbd></td><td>Save pipeline</td></tr>
      <tr><td><kbd>D</kbd></td><td>Delete pipeline</td></tr>
      <tr><td><kbd>Space</kbd></td><td>Add / remove open pipeline from the run queue</td></tr>
      <tr><td><kbd>R</kbd></td><td>Run queued pipelines</td></tr>

      <tr class="help-section"><td colspan="2">Stage Cards (Fetch / Indicators / Scan)</td></tr>
      <tr><td><kbd>-</kbd> / <kbd>=</kbd></td><td>Focus next / previous stage card (wraps around)</td></tr>
      <tr><td><kbd>Enter</kbd></td><td>Open the focused stage's config selector — arrow keys / typing change it directly</td></tr>

      <tr class="help-section"><td colspan="2">Schedule Card</td></tr>
      <tr><td><kbd>↑</kbd> <kbd>↓</kbd></td><td>Cycle Enabled → Time → Mon...Sun → Set (wraps around)</td></tr>
      <tr><td><kbd>Enter</kbd></td><td>Activate the focused field — toggle Enabled/a day, open the Time picker, or click Set</td></tr>
      ${_GLOBAL_ROWS}
    </tbody></table>
    <div class="help-summary">The pipeline page chains Fetch, Indicators, and Scan into one run: fetch a ticker config (list + timeframes, from the Tickers page), compute an indicator config, then optionally run a scan filtered to that indicator config — reusing each stage's config from the other pages rather than redefining it. Several pipelines can be queued (▶ button or Space) and run in order; queued pipelines that reference the same ticker config only fetch once. The Schedule card below Pipeline Configuration is a single global timer, not per-pipeline — enable it, pick days and a time (server-local), hit Set, and it runs whatever's currently queued, in the same order the ▶ Run button would. Useful once the app is deployed and running continuously; it has no effect while the server isn't running.</div>`,
  },
  {
    id: 'chart',
    label: 'chart',
    html: `<table class="help-table"><tbody>
      <tr class="help-section"><td colspan="2">Playback</td></tr>
      <tr><td><kbd>Space</kbd></td><td>Play / pause (rewinds to start if at last bar)</td></tr>
      <tr><td><kbd>←</kbd> <kbd>→</kbd></td><td>Step one bar backward / forward</td></tr>
      <tr><td><kbd>Shift+←</kbd> <kbd>Shift+→</kbd></td><td>Jump 20 bars</td></tr>
      <tr><td><kbd>Home</kbd> <kbd>End</kbd> &nbsp;or&nbsp; <kbd>Ctrl+←</kbd> <kbd>Ctrl+→</kbd></td><td>First bar / last bar</td></tr>
      <tr><td><kbd>↑</kbd> <kbd>↓</kbd></td><td>Increase / decrease playback FPS</td></tr>
      <tr><td><kbd>Backspace</kbd></td><td>Toggle auto-fit (fits all candles in view)</td></tr>
      <tr><td>Double-click chart</td><td>Jump to that bar</td></tr>

      <tr class="help-section"><td colspan="2">Annotations</td></tr>
      <tr><td><kbd>.</kbd></td><td>Place / remove a manually-anchored VWAP at the hovered candle (amber line, ephemeral)</td></tr>
      <tr><td>Shift+<kbd>.</kbd></td><td>Same, but also draws +/-1 and +/-2 stdev bands around that anchor (dashed, tightest band most visible)</td></tr>
      <tr><td>Alt+<kbd>.</kbd> &nbsp;or&nbsp; <kbd>Ctrl+Z</kbd></td><td>Undo the most recently placed manual aVWAP anchor, bands included (repeat to keep undoing, in order)</td></tr>
      <tr><td>Alt+Click &nbsp;or&nbsp; Alt+Space</td><td>Lock a measurement start point (Alt+Space uses the last mouse position over the chart); move the cursor to explore $ / % change live; repeat either, or press Escape, to dismiss</td></tr>

      <tr class="help-section"><td colspan="2">Ticker Navigation</td></tr>
      <tr><td>Shift+<kbd>L</kbd> &nbsp;or&nbsp; &#9734; button</td><td>Flag / unflag the current ticker; &#9873; button opens the flagged-ticker panel (click a row to jump, &#10005; to unflag)</td></tr>
      <tr><td>Alt+<kbd>L</kbd></td><td>Toggle ticker cycling (<kbd>=</kbd> / <kbd>-</kbd>, prev/next buttons) to the flagged tickers only; toggle again to return to the previous list</td></tr>
      <tr><td><kbd>=</kbd> / <kbd>-</kbd></td><td>Previous / next ticker</td></tr>
      <tr><td><kbd>_</kbd> / <kbd>+</kbd></td><td>Previous / next ticker list</td></tr>
      <tr><td><kbd>[</kbd> / <kbd>]</kbd></td><td>Previous / next timeframe</td></tr>
      <tr><td><kbd>;</kbd> / <kbd>'</kbd></td><td>Previous / next indicator config (also clears the selected scan result, since it may no longer apply)</td></tr>
      <tr><td><kbd>{</kbd> / <kbd>}</kbd></td><td>Previous / next scan result</td></tr>
      <tr><td><kbd>Shift+↑</kbd> / <kbd>Shift+↓</kbd></td><td>Increase / decrease min bars filter by 100</td></tr>
      <tr><td>Any lowercase letter</td><td>Focus ticker search input</td></tr>

      <tr class="help-section"><td colspan="2">Jump Inputs</td></tr>
      <tr><td>Any digit key</td><td>Focus bar # input</td></tr>
      <tr><td>Bar # / Date input</td><td>Type value then Enter to jump</td></tr>

      <tr class="help-section"><td colspan="2">Load Position</td></tr>
      <tr><td><kbd>\\</kbd></td><td>Cycle mode: start → end → bar → date</td></tr>
      <tr><td><kbd>Enter</kbd></td><td>Focus value field (bar / date mode)</td></tr>

      <tr class="help-section"><td colspan="2">View</td></tr>
      <tr><td><kbd>F</kbd></td><td>Toggle fullscreen</td></tr>
      ${_GLOBAL_ROWS}
    </tbody></table>
    <div class="help-summary">The chart page displays price action with indicator overlays in a bar-by-bar replay format. Navigate your ticker list, switch timeframes and indicator configs, and step through history manually or at a set playback speed. Scanner results can be loaded to review matched tickers in sequence.</div>`,
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
        <span id="help-nav-hint"><kbd>-</kbd> / <kbd>=</kbd></span>
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
      if (e.key === 'Escape' || e.key === '?') { e.preventDefault(); e.stopPropagation(); _hide(); return; }
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
