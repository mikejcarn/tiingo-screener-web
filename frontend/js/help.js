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
  <tr><td><kbd>Escape</kbd></td><td>Close panel / blur any focused input</td></tr>
  <tr><td>Shift+<kbd>X</kbd> &nbsp;or&nbsp; <kbd>Ctrl+Z</kbd></td><td>Cancel — the same as Escape (close panel, leave the ticker box or any focused input, clear a search), but never leaves fullscreen. In a text box Shift+<kbd>X</kbd> still types an X, except in the ticker boxes; on the chart, with nothing to cancel, they undo instead</td></tr>`;

// TradingView attribution for the chart library (Lightweight Charts™,
// Apache 2.0, which asks for a link to tradingview.com on pages using it).
// Shown here instead of the library's on-chart logo (attributionLogo: false
// in chart.js) — same SVG mark the library itself draws.
const _ATTRIBUTION = `
  <a id="help-attribution" href="https://www.tradingview.com/" target="_blank" rel="noopener noreferrer"
     title="Charts by TradingView Lightweight Charts™">
    <svg xmlns="http://www.w3.org/2000/svg" width="35" height="19" fill="none" aria-hidden="true"><g fill-rule="evenodd" clip-rule="evenodd"><path fill="var(--tv-stroke)" d="M2 0H0v10h6v9h21.4l.5-1.3 6-15 1-2.7H23.7l-.5 1.3-.2.6a5 5 0 0 0-7-.9V0H2Zm20 17h4l5.2-13 .8-2h-7l-1 2.5-.2.5-1.5 3.8-.3.7V17Zm-.8-10a3 3 0 0 0 .7-2.7A3 3 0 1 0 16.8 7h4.4ZM14 7V2H2v6h6v9h4V7h2Z"/><path fill="var(--tv-fill)" d="M14 2H2v6h6v9h6V2Zm12 15h-7l6-15h7l-6 15Zm-7-9a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"/></g></svg>
    <span>Charts by TradingView Lightweight Charts™</span>
  </a>`;

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
      <tr><td colspan="2" style="color:var(--t3);font-size:11px;">A ticker config pairs a ticker list with timeframes to fetch — save it once, reuse it here or from the Pipeline page. It is also a <b>dataset</b>: its Window (full history / last N bars / date range) and Warm-up decide which bars indicator runs and scans on it use (pick it beside ▶ Run on the Indicators / Scanner pages, or in the chart's list select). Fetching always downloads full history into the shared database; a ticker belongs to every list whose CSV names it. Windowed results are stored apart from full-history ones, so a test run never overwrites them, and the warm-up bars (computed before the window so lookbacks are formed) show on the chart too.</td></tr>

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
      <tr><td><kbd>R</kbd></td><td>Run queued configs — on the dataset chosen beside ▶ Run (a ticker config's list, timeframes and bar window), or all downloaded data, full history</td></tr>
      <tr><td><kbd>Shift+Enter</kbd></td><td>Focus config name input</td></tr>

      <tr class="help-section"><td colspan="2">Timeframes</td></tr>
      <tr><td><kbd>[</kbd> / <kbd>]</kbd></td><td>Next / previous timeframe tab (wraps around)</td></tr>

      <tr class="help-section"><td colspan="2">Indicator Cards</td></tr>
      <tr><td><kbd>-</kbd> / <kbd>=</kbd></td><td>Navigate indicator cards (always — even while a card is open)</td></tr>
      <tr><td><kbd>↑</kbd> <kbd>↓</kbd></td><td>Cycle the open card's parameters, once it's open</td></tr>
      <tr><td><kbd>Enter</kbd></td><td>Toggle focused indicator on / off — or, if a parameter is focused, activate it (toggle checkbox, cycle dropdown, focus text field, expand/collapse a group)</td></tr>
      <tr><td><kbd>←</kbd> <kbd>→</kbd></td><td>Step the focused numeric parameter by its increment</td></tr>
      <tr><td><kbd>Space</kbd> / <kbd>\\</kbd></td><td>Add / remove open config from the run queue</td></tr>
      <tr><td>Any lowercase letter</td><td>Focus the indicator search box and start typing (uppercase is reserved for the N/D/R/... shortcuts above)</td></tr>
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
      <tr><td><kbd>R</kbd></td><td>Run queued scan configs — on the dataset chosen beside ▶ Run (its list's tickers, and its window's indicator results), or everything</td></tr>

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
      <tr><td>Any lowercase letter</td><td>Focus the criteria search box and start typing (uppercase is reserved for the N/D/R/... shortcuts above)</td></tr>
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
      <tr><td>Shift+<kbd>V</kbd></td><td>Show / hide the volume pane below the price chart (same as the Volume row in the show/hide indicators panel, or the pane's own &#x2715;)</td></tr>
      <tr><td>Shift+<kbd>K</kbd></td><td>Cycle live candle coloring: standard → σ distance of each close from an aVWAP anchored at the candle under the mouse when you press it (shown as a dotted volume-orange aVWAP in both anchored modes; mouse off the chart → latest stdev-band/manual anchor; pressing it over a different candle re-anchors there and restarts at σ): teal above / red below (bullish / bearish): the fill goes from empty at the aVWAP to solid at 1σ, then shades from teal / red to neon green / magenta at 2σ, solid neon / magenta beyond; borders and wicks grey within 1σ, teal / red at 1–2σ, neon green / magenta past 2σ (sliced: each price filled — and its wick colored — by its own distance, the body outlined in the close's border color) → relative volume within a range: from the candle under the mouse (as for σ) to the current bar, each bar's volume vs that range's average as the candle body — quiet bars fade toward grey and transparency, warming to opaque medium orange at the range average, solid volume orange at 2.5× (black only at zero volume); wicks keep teal/red for up/down ( the candle colors indicator's RelVolume covers the full chart) → HVN / LVN split: the profile's "Both" split from the Volume Profile of that range — orange where the close's level is above half the POC's volume, indigo below, stronger the further from that midpoint, yellow for closes at the POC level; borders and wicks in the same color at one steady opacity → rejection vs acceptance: the <kbd>&lt;</kbd> profile's rejection vs acceptance mode for that range — only rejection is highlighted, as in the profile's bars: where the close's level takes a bigger share of the range's wick volume than of its total volume (price pushed away from there more than usual) the candle shades from grey to bright, solid white the stronger that is (full white for the strongest tenth of those levels); everywhere else it's a dim neutral grey; borders and wicks in the same color → rejection vs acceptance on teal / red: the profile's rejection bars (wicks with the bodies subtracted out) on up / down candles — very dark grey wherever the close's level has no bar, shading to bright teal / red the stronger its bar → QQEMOD: the candle_colors indicator's QQEMOD coloring from the candle under the mouse to the current bar, like the others (or the <kbd>,</kbd> range; the indicator itself is still computed over the full history): solid teal when QQE1 is above its upper band and QQE2 above the threshold and its trend line, lighter teal when QQE2 is below its trend line, faint teal for QQE2 above the threshold alone; the same in red for the bearish side; hollow when there's no signal → standard</td></tr>
      <tr><td>Shift+<kbd>J</kbd></td><td>The same candle colorings as Shift+<kbd>K</kbd> (same cycle, anchoring, <kbd>,</kbd> ranges and undo), drawn sliced: each candle drawn as a normal body box and wicks, filled price by price — σ by each price's distance from that bar's aVWAP, the HVN/LVN split and rejection vs acceptance by each price level of a finer Volume Profile — so the levels show inside the candle. QQEMOD has one value per bar, so sliced it shows a what-if: each price inside the candle in the QQEMOD state the bar would have had if it had closed there (faint grey for no signal), the body outlined in the actual close's state — the color edges inside a candle are the prices where QQEMOD would have flipped. Relative volume has no per-price values, so here it becomes the plain Volume Profile of that range inside the candles: each price in volume orange, faint at untraded levels and solid at the POC — next to the orange / indigo HVN / LVN split of the same profile. Shift+<kbd>K</kbd> / Shift+<kbd>J</kbd> on the same coloring switches between whole and sliced. Clearest zoomed in</td></tr>
      <tr><td>Double-click chart</td><td>Jump to that bar</td></tr>

      <tr class="help-section"><td colspan="2">Annotations — growing-to-"now"</td></tr>
      <tr><td><kbd>.</kbd></td><td>Place a manually-anchored VWAP at the hovered candle (amber line, grows to "now", ephemeral). Press <kbd>.</kbd> again over its anchor to cycle: aVWAP → aVWAP + ±1 / ±2 stdev bands (dashed, tightest band most visible; the σ candle coloring's preferred reference) → fan shape by stdev zone (the bands and the aVWAP line give way to a cloud filling the space between the lowest and highest of the aVWAPs anchored at every candle from it up to each bar — the outline of the Alt+<kbd>.</kbd> fan without drawing its lines — colored by the σ zone it falls in around the line: above it teal within 1σ, aqua at 1–2σ, neon green beyond 2σ; below it red, crimson, magenta) → off (removed)</td></tr>
      <tr><td>Shift+<kbd>.</kbd></td><td>Average aVWAP from the hovered candle, on its own (solid orange, grows to "now"): at each bar, the mean of the aVWAPs anchored at every candle from the hovered one up to that bar — the same line as the <kbd>&lt;</kbd> / Shift+<kbd>M</kbd> dotted average and the Alt+<kbd>.</kbd> fan's average mode. Press Shift+<kbd>.</kbd> again over its anchor to cycle: average aVWAP → plus dashed orange ±1 / ±2 stdev bands → fan shape by stdev zone (the bands and the line give way to a cloud filling the space between the lowest and highest of the average aVWAPs anchored at every candle from it up to each bar — the outline of the Alt+<kbd>.</kbd> fan's average mode; this average is one of its lines, so it's always inside — colored by the σ zone it falls in around the average: above it teal within 1σ, aqua at 1–2σ, neon green beyond 2σ; below it red, crimson, magenta) → off (removed). The bands are the σ of the prices the average is the mean of (every anchor's volume-weighted prices mixed equally): each aVWAP's own spread plus how far the aVWAPs fan out around their average — wide in trends, where old and new aVWAPs drift apart, tight in ranges</td></tr>
      <tr><td>Alt+<kbd>.</kbd></td><td>aVWAP fan — an aVWAP at every candle from the hovered one to the current bar, all growing to "now". Each line is weighted by its swing's significance (the largest swing window its candle is a peak/valley at): major peaks/valleys strong (top ones 2px), minor swings and in-between candles faint. Press Alt+<kbd>.</kbd> again over its first candle to cycle: amber → peaks red / valleys teal / in-between grey (min/max aVWAPs — highest peak, lowest valley — bright red / aqua) → every line grey at one flat opacity, only the min/max aVWAPs in color, plus the fan's average aVWAP (mean of all its lines at each bar) in solid amber → every line colored by its own slope point by point (faint grey where it's flat, shading to teal as it rises and red as it falls, stronger the steeper) → average aVWAPs: every candle draws its own average aVWAP instead (from that candle on, at each bar the mean of the aVWAPs anchored at every candle from it up to that bar — what a <kbd>&lt;</kbd> profile's dotted line is), colored by slope the same way, with the first candle's own average aVWAP drawn on top — neon green where price closed above it, magenta where below → off (removed; the next press starts over). Very long spans thin in-between candles first (peaks/valleys kept) to keep drawing fast. One Shift+<kbd>X</kbd> removes the whole fan</td></tr>
      <tr><td>Ctrl+<kbd>.</kbd></td><td>Volume-Profile aVWAP fan — the same full aVWAP set, all in volume orange, each line shaded point by point by the span's Volume Profile at that price: bright through heavily traded levels, faint through thin ones (the profile covers the span up to the current bar). Press Ctrl+<kbd>.</kbd> again over its first candle to cycle the same modes as a <kbd>&lt;</kbd> Volume Profile: orange (bright at high-volume levels) → each whole line one color from its anchor candle's close, as the HVN/LVN split candle coloring reads it (orange if that close's level is above half the POC's volume, indigo below, brighter the further from the midpoint, yellow at the POC) → orange above / indigo below half the POC's volume → lines shaded by each bar's own volume (vertical brightness bands — when the volume came in) → off (removed; the next press starts over). One Shift+<kbd>X</kbd> removes it</td></tr>
      <tr><td><kbd>&lt;</kbd></td><td>Volume Profile anchored at the hovered candle, growing to the current bar — the one-key form of <kbd>,</kbd> <kbd>,</kbd>. The profile only; Shift+<kbd>M</kbd> draws its aVWAPs. Press <kbd>&lt;</kbd> again over its anchor candle to cycle the mode (Shift+<kbd>X</kbd> removes it): normal (orange, POC line) → LVN (bars widest at the thinnest price levels, POC on the deepest LVN, indigo) → both POCs with a combined histogram (orange where a level's volume is above half the POC's, indigo where it's below — longer = further from that midpoint) → wick map: where price was rejected rather than where it traded. Each candle's upper wick (high down to its body) and lower wick (low up to its body) count its volume × that wick's share of its range, spread over the wick; bodies count nothing. One translucent off-white bar per level, its length all the wick weight there, plus its own POC — an off-white line at its heaviest level → rejection vs acceptance: the wick map's shape against the volume profile's — each level's share of all wick weight minus its share of all volume, which works out to the level's share of volume × how much its wick share is above or below the profile's average. Off-white bars mark levels where price is pushed away more than usual (relative rejection), longer = stronger, thinly traded levels staying short; levels where price holds more than usual get no bar; an off-white POC line marks its strongest rejection level → liquidity: volume per unit of price movement at each level — sky-blue bars, longest where a lot of volume traded on narrow bars (absorption: big effort, little result), short where price moved through easily on little volume (a thin book). Each bar's volume is divided by its range in ATR(14), and a level takes the average of the bars that traded through it (weighted by how much of each bar's range covers it, levels touched only by a stray wick or two pulled toward the overall average); bars measured from the profile's 10th-percentile level, since liquidity varies much less between levels than volume does; a sky-blue POC line marks the most liquid level → off (removed; the next press starts over)</td></tr>
      <tr><td>Ctrl+<kbd>,</kbd></td><td>The <kbd>&lt;</kbd> Volume Profile as a heatmap: each price level a band across the whole span (anchor → current bar), its value shown as opacity instead of bar length, faint enough for candles to read through. Same modes, cycled the same way — Ctrl+<kbd>,</kbd> again over its anchor candle: normal (orange, stronger at busier levels) → LVN (indigo, stronger at thinner levels) → both (orange above half the POC's volume, indigo below, stronger the further from that midpoint) → wick map (off-white, stronger where more wick weight) → rejection vs acceptance (off-white, stronger the more rejection-heavy) → liquidity (sky blue, stronger the more volume per unit of movement) → off; each with its POC line. After <kbd>,</kbd>, across the marked range. Independent of <kbd>&lt;</kbd> and Shift+<kbd>M</kbd>, so they can be layered. Shift+<kbd>X</kbd> removes it</td></tr>
      <tr><td>Shift+<kbd>M</kbd></td><td>The <kbd>&lt;</kbd> profile's aVWAPs without the profile: the hovered candle's aVWAP and its other-side aVWAP (anchored at the range's opposite extreme), growing to the current bar, coded by that range's Volume Profile — plus the span's average aVWAP as a dotted orange line (at each bar, the mean of the aVWAPs anchored at every candle from the anchor up to that bar — the Alt+<kbd>.</kbd> fan's average). After <kbd>,</kbd>, across the marked range (lines stop at its end). Shift+<kbd>M</kbd> and <kbd>&lt;</kbd> on the same candle give both together. The mode's peak levels are highlighted on the lines (a line takes the color wherever it crosses that level): the POC yellow, HVN peaks bright orange, LVN troughs electric violet. Press Shift+<kbd>M</kbd> again over its anchor candle to cycle the coding (Shift+<kbd>X</kbd> removes it): normal (orange; thicker and more opaque where more volume traded; every local volume peak highlighted) → LVN (indigo; thicker through thin levels; every trough highlighted) → both (orange above half the POC's volume, indigo below, thicker the stronger the node) → connected: the aVWAP and its other-side aVWAP each start at their anchor candle's wick tip (low for a valley, high for a peak) instead of mid-candle, and are joined at the end bar by a connector coded the same way → wick map (off-white, thicker through levels with more wick weight, pure white through its peaks) → rejection vs acceptance (off-white through levels where price is pushed away more than usual, orange where it holds; thicker the stronger; the strongest pure white / bright orange) → off (removed; the next press starts over)</td></tr>
      <tr><td>Shift+<kbd>X</kbd> &nbsp;or&nbsp; <kbd>Ctrl+Z</kbd></td><td>Undo the most recent in-chart addition — manual aVWAP anchor (bands/profile included), fan, or Shift+<kbd>K</kbd> candle coloring/re-anchor (restores the coloring before it) — repeat to keep undoing, in order. While a panel, the help, a focused box, a <kbd>,</kbd> range mark, a measurement or a maximized pane is open they cancel that instead, like Escape</td></tr>

      <tr class="help-section"><td colspan="2">Annotations — fixed range (two candles)</td></tr>
      <tr><td><kbd>,</kbd></td><td>Mark the hovered candle as a range start (cursor turns into a crosshair); hover the far end, then use one of the rows below to finish it — Escape cancels instead</td></tr>
      <tr><td><kbd>,</kbd> then <kbd>.</kbd></td><td>Fixed-range aVWAP between the two marked candles; <kbd>.</kbd> again over its start or end steps it through the stdev bands, the fan by stdev zone, then removes it</td></tr>
      <tr><td><kbd>,</kbd> then Shift+<kbd>.</kbd></td><td>Average aVWAP across the marked range (aVWAPs from every candle from its start), stopping at its end; Shift+<kbd>.</kbd> again over its start or end steps it through its stdev bands, the fan by stdev zone, then removes it</td></tr>
      <tr><td><kbd>,</kbd> then Alt+<kbd>.</kbd></td><td>aVWAP fan across the marked range, each line stopping at the range's end</td></tr>
      <tr><td><kbd>,</kbd> then Ctrl+<kbd>.</kbd></td><td>Volume-Profile aVWAP fan across the marked range (profile of the range), each line stopping at its end</td></tr>
      <tr><td><kbd>,</kbd> then Shift+<kbd>K</kbd></td><td>Candle coloring over the marked range only: each mode is computed from that range alone (σ from an aVWAP anchored at its start and ending at its end, relative volume vs the range's average, the HVN / LVN split from the range's own Volume Profile); candles outside it stay standard. Starts at σ; Shift+<kbd>K</kbd> with the mouse inside the range (or off the chart) keeps cycling it, over a candle outside it re-anchors there without a range</td></tr>
      <tr><td><kbd>,</kbd> then <kbd>,</kbd>, same candle</td><td>Volume Profile at that candle, growing to "now" — the same as <kbd>&lt;</kbd>; over an existing one it cycles its mode</td></tr>
      <tr><td><kbd>,</kbd> then <kbd>,</kbd> (or <kbd>&lt;</kbd>), different candle</td><td>Fixed-range Volume Profile between the two candles; <kbd>&lt;</kbd> again over either end cycles its mode</td></tr>
      <tr><td><kbd>,</kbd> then Shift+<kbd>M</kbd></td><td>The profile-coded aVWAPs across the marked range, stopping at its end; Shift+<kbd>M</kbd> again over either end cycles the coding. The other-side aVWAP starts from the range's opposite extreme: its lowest low when the anchor is a peak, its highest high when it's a valley — judged by the bars after the anchor, so a gap-up candle that price then holds above counts as a valley</td></tr>

      <tr class="help-section"><td colspan="2">Measurement</td></tr>
      <tr><td>Alt+Click &nbsp;or&nbsp; Alt+Space</td><td>Lock a measurement start point (Alt+Space uses the last mouse position over the chart); move the cursor to explore $ / % change live; repeat either, or press Escape, to dismiss</td></tr>
      <tr><td><kbd>Escape</kbd></td><td>Cancel a pending <kbd>,</kbd> range-start mark, or dismiss an active measurement</td></tr>

      <tr class="help-section"><td colspan="2">Oscillator Panes</td></tr>
      <tr><td>&#x2922; next to a pane's name</td><td>Maximize that pane to the whole chart area; click it again (&#x2921;) to restore</td></tr>
      <tr><td>&#x2715; at a pane's top right</td><td>Close that pane — bring it back by re-ticking it in the show/hide indicators panel (&#9776;)</td></tr>
      <tr><td><kbd>Escape</kbd></td><td>Restore a maximized pane. In fullscreen mode (<kbd>F</kbd>) the first press only restores the pane — press again (or hold) to leave fullscreen</td></tr>

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
      <tr><td><kbd>\\</kbd></td><td>Cycle the rule for where a ticker opens when loaded: start (first bar) → end (last bar) → bar (a specific bar #) → date (a specific date) → range (a start through an end bar/date) → recent (a number of bars back from the end)</td></tr>
      <tr><td><kbd>Enter</kbd></td><td>Focus the value field (bar / date / range / recent modes)</td></tr>

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
  // Attribution sits at the end of the scrolling content, under the page's
  // own text — not a fixed footer that stays visible while scrolling.
  _body.innerHTML = _PAGES[_activeIdx].html + `<div id="help-footer">${_ATTRIBUTION}</div>`;
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

// Alternate cancel keys: Ctrl+Z and Shift+X act as Escape on every page —
// Escape itself also leaves fullscreen and is grabbed by the browser in
// other ways, these never are. The press is swallowed and a synthetic
// Escape keydown is sent to the focused element instead, so every page's
// own Escape handling runs unchanged. In a text box Shift+X keeps typing an
// X unless the box is marked data-x-cancels (the ticker boxes — tickers
// are uppercased anyway). A page that binds the keys itself (the chart's
// undo) calls claimCancelKeys(check): they then cancel only when something
// is open or focused, or check() says something is pending, and otherwise
// pass through to the page.
const _cancelChecks = [];
let _cancelKeysClaimed = false;
export function claimCancelKeys(check) { _cancelKeysClaimed = true; if (check) _cancelChecks.push(check); }

function _isCancelKey(e) {
  if (e.altKey) return false;
  if (e.key === 'X' && !e.ctrlKey && !e.metaKey) return true;
  return (e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z';
}

function _wireCancelKeys() {
  window.addEventListener('keydown', (e) => {
    if (!_isCancelKey(e)) return;
    const el = document.activeElement;
    const field = el && el !== document.body && el.matches('input, select, textarea, [contenteditable]');
    const text = field && (el.matches('textarea, [contenteditable]')
      || (el.tagName === 'INPUT' && !['checkbox', 'radio', 'button', 'submit', 'range', 'color', 'file'].includes(el.type)));
    if (text && e.key === 'X' && !el.hasAttribute('data-x-cancels')) return;   // typing an X
    const pending = field || isHelpVisible() || !!document.querySelector('[id$="-panel"].open')
      || _cancelChecks.some(f => f());
    if (_cancelKeysClaimed && !pending) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    (el || document.body).dispatchEvent(new KeyboardEvent('keydown',
      { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }));
  }, true);
}

export function initHelp(currentPage) {
  _createOverlay();
  _wireCancelKeys();

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
