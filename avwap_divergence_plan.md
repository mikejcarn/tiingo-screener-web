# Multi-Anchor aVWAP Flow Divergence Scan — Complete Logic Specification

This document is meant to be handed to an implementation agent (e.g. Claude
Code) working inside an existing Python stock-screener project. It contains
every concept, formula, and definition needed to build the indicators and
scan criteria described — nothing outside this document should need to be
inferred. It does not prescribe file layout, class structure, or repo
organization — fit the logic below into whatever conventions the existing
screener project already uses (e.g. its existing criteria-file pattern).

---

## Design intent — read this before implementing anything

This section exists because formulas alone don't convey *why* certain
choices were made, and an implementing agent that understands the intent
will handle ambiguous cases better than one following formulas mechanically.

**The problem this whole system is trying to solve**: classical technical
divergence (RSI or OBV vs. price) compares indicator peaks in raw
chronological time, with no reference to *where in an auction* a pivot
occurs. A pivot near a meaningful volume-weighted equilibrium means
something different than the same pivot far from one. Anchoring a VWAP to a
meaningful event (a swing high/low, a gap) gives a concrete reference for
"equilibrium," so every subsequent question becomes: is this pivot
strengthening or weakening *relative to this specific anchor's value*, not
just relative to the last pivot in time. This is a direct, numeric
implementation of two Wyckoff principles: the Law of Effort vs. Result (does
volume effort produce proportional price result — this is what AFD and the
Arc Pullback family measure) and the Law of Cause and Effect (does the size
and cleanliness of a base predict the size of what follows — this is what
Arc Quality and the basing requirement in Swing-High Reclaim measure).

**Why everything is derived only from price and volume, with no RSI/OBV/MFI**:
not because those indicators are wrong, but because importing them means
importing their assumptions (RSI's smoothing window, OBV's close-vs-prior-
close convention) alongside data that's already scoped to a *different*
reference frame than the anchor. ASV's signing rule (close vs. this
anchor's own aVWAP, not vs. the prior close) was chosen specifically so
every measurement in this system references the *same* equilibrium concept
throughout — fewer imported assumptions, and every number in the system is
answerable to "relative to what?" with the same answer: this anchor's own
aVWAP.

**Why AFD is continuous rather than triggered by discrete touch events**:
an earlier version of this design scored "absorption" only at the moment
price touched an anchor's band. That version required tracking touch
windows, deciding a band width, and comparing this touch to a prior touch —
real complexity, and it reintroduced something close to classical
pivot-to-pivot divergence (just re-scoped to an anchor) rather than
avoiding it. Making AFD a continuous trailing-slope comparison, valid at
every bar for every anchor, removed that machinery and answers a cleaner
question: is recent flow agreeing with recent price, right now, without
waiting for or defining a discrete event.

**Why Arc Quality and Founding Flow Persistence are undecayed/whole-life
while AFD is a decaying trailing window**: these answer genuinely different
questions, not the same question at different settings. AFD asks "what's
happening lately." Arc Quality and Founding Flow Persistence ask "does the
anchor's original character still hold up." A large founding volume burst
being hard to overturn mathematically is a *feature* here, not a bug — it
means Founding Flow Persistence flipping sign is a rare, high-conviction
event specifically because it's hard to trigger. Don't decay these to make
them behave more like AFD; that would destroy the distinction they exist to
capture.

**Why independence exists at all**: without it, a scanner that spawns
several anchors from the same recent price move (a swing low, a nearby gap,
a ribbon anchor all formed within a few bars of each other) will report
high "confluence" that is really one observation counted three times. This
is the single most important safeguard against the system fooling itself,
and it should never be treated as optional or as a nice-to-have refinement
— a confluence ratio computed without an independence check is not
measuring what this system claims to measure.

**Why the three named patterns (§6) are separate detectors, not one
parameterized function**: Arc Pullback's two presets (Spring, Bear-Trap
Liftoff) genuinely are the same mechanism at different scale — depth and
duration are the only real differences, so they share one detector.
Swing-High Reclaim requires a categorical condition (a flattening base)
that Arc Pullback never needs — that's a different *kind* of requirement,
not a bigger threshold, which is why it's a separate detector. Continuation
Pullback requires the *opposite* AFD behavior from Arc Pullback (AFD should
stay stable in the trend direction, not flip) — conflating these would
produce a detector that can't correctly describe either case.

**The overall epistemic status of this system, worth internalizing**:
every score here (relevancy, Arc Quality, Founding Flow Persistence,
independence, the pattern detectors) is a well-motivated hypothesis about
where useful signal might live, consistent with real, long-established
market-behavior principles (Wyckoff, Shannon's aVWAP framework). None of it
has been validated against real forward returns yet. Implement it
faithfully and make it easy to inspect and later test — don't quietly
"improve" a formula to make output look more sensible on a few charts,
since that's exactly the kind of undocumented tuning that would make later
backtesting results meaningless.

---

## 0. Glossary — quick reference

- **Anchor**: a specific past bar chosen as the starting point of a
  volume-weighted "auction." Everything below is computed relative to one or
  more anchors, tracked independently and simultaneously per symbol.
- **aVWAP**: anchored VWAP. Cumulative (typical price x volume) / cumulative
  volume, starting from an anchor's bar and running forward.
- **ASV (Anchored Signed Volume)**: a running tally, reset at the anchor,
  of volume signed by whether each bar's close is above or below that
  anchor's own aVWAP at that bar.
- **AFD (Anchor Flow Divergence)**: a continuous, per-anchor, per-bar
  comparison of price's trailing trend vs. ASV's trailing trend. The core
  measurement of the whole system.
- **Arc Quality**: a whole-life (not trailing) score of how clean and
  efficient the price path has been since the anchor formed.
- **Founding Flow Persistence**: a whole-life (not trailing) score of
  whether the anchor's original founding volume burst still dominates the
  undecayed, full-lifetime ASV total.
- **Relevancy**: a composite score of whether an anchor is still meaningful
  right now (proximity, liveness, structural strength, respect history).
- **Independence**: a pairwise score between two anchors measuring whether
  they represent genuinely separate observations (different formation time
  and/or type) rather than the same recent move counted twice.
- **Confluence**: agreement among multiple independent, relevant anchors
  that AFD points the same direction at the same price zone.
- **Ribbon anchor**: an anchor spawned unconditionally at a fixed lookback
  distance (e.g. 10, 50, 100, 200 bars back), used alongside structural
  anchors to give a multi-resolution view.
- **Arc Pullback**: the generalized breach-reject-reclaim setup family,
  parameterized by depth and duration. *Spring* (shallow, fast) and
  *Bear-Trap Liftoff* (deeper, slower) are named presets on this same
  continuum, not separate detectors.
- **Swing-High Reclaim**: a deep decline from a swing-high anchor, a
  flattening base, then a reclaim with no time limit. Structurally distinct
  from Arc Pullback because of the required basing period.
- **Continuation Pullback**: a shallow, brief touch of an already-respected,
  trending anchor that resolves quickly back in the prevailing direction.
  The highest-frequency, lowest-magnitude setup in this system.

---

## Core idea

For a given symbol, identify price zones where multiple **independently
anchored VWAPs** currently show their own volume-flow trajectory diverging
from price's trajectory in the same (bullish or bearish) direction — a
continuous, always-on measure computed per anchor, not tied to any single
touch event or pair of pullbacks. When several genuinely separate anchors
(different formation events, different time horizons) currently agree, and
their aVWAPs are also converging on the same price, treat that zone as a
higher-confidence support/resistance candidate than any single anchor's
history could suggest alone.

Everything below is computed from price and volume only — no RSI, OBV, or
MFI as external indicators, and no comparison across discrete successive
pullbacks. The core measure, AFD, is continuous, per-anchor, available at
every bar, built from a single accumulator that resets at the anchor.

---

## 0a. Per-anchor state — the complete field list

Every anchor, once spawned, carries the following state, updated
incrementally each bar. This is the full set of fields the rest of this
document computes — nothing below should require inventing new state that
isn't listed here.

**Identity (set once, at formation, never changed):**
- `id`, `symbol`, `type` (`swing_high`, `swing_low`, `gap`, `session_open`,
  `htf_swing`, `ribbon`), `formation_timestamp`, `formation_bar_index`,
  `formation_price`
- `anchor_effort`: volume (or signed-volume magnitude) present on the bar(s)
  that formed the anchor, captured once, immutable. Used by Founding Flow
  Persistence and by Arc Pullback's untested-anchor compensation check.

**Running accumulators (updated every bar since formation):**
- `cum_pv`, `cum_v`: cumulative price*volume and volume → define the aVWAP.
- `cum_p2v`: cumulative price^2 * volume → defines the volume-weighted
  variance and stdev bands.
- `cum_asv`: cumulative signed volume, undecayed, since the anchor (see
  section 1) → feeds Founding Flow Persistence (section 3b).
- A short rolling history (e.g. last 200 bars, or full history if cheap
  enough) of: price, ASV level, ATR, aVWAP value, and touch outcomes — needed
  to compute trailing slopes, self-relative z-scores, and respect history.

**Derived, recomputed each bar or on relevant events:**
- `avwap`: `cum_pv / cum_v`.
- `stdev_band(k)`: `avwap ± k * sqrt(cum_p2v/cum_v - avwap^2)` for
  configurable `k` (e.g. 1, 2, 3).
- `relevancy`: composite + its four named components (section 2).
- `afd`: current value (section 3).
- `arc_quality`: composite + its two named components (section 3a).
- `founding_flow_persistence`: current value (section 3b).
- `status`: `active` / `decaying` / `retired` (governed by relevancy).

**Lifecycle rules:**
- Anchors are never deleted, only status-transitioned. A `retired` anchor
  can return to `active` ("resurrection") if its relevancy rises back above
  threshold — e.g. price revisits its zone with fresh volume.
- Cap the number of tracked anchors per symbol (e.g. 20) to bound compute.
  If the cap is hit, evict the lowest-relevancy `retired` anchors first.

---

## 1. Anchors — detection and the core accumulators

An **anchor** is a specific bar in the past, chosen because it marks a
plausible restart of the auction. For each symbol, maintain a small set of
live anchors, sourced from two kinds of events:

- **Structural anchors** — fire when a real event happens:
  - Swing high/low: a local price extreme over an N-bar window (e.g. N=10)
    where volume on the swing bar is at least `k * trailing_avg_volume`
    (default `k = 1.5`, tunable).
  - Gap: `|open - prior_close| > k * ATR` (default `k = 0.5`, tunable).
  - Session open (daily/weekly), if the data timeframe supports it.
  - Higher-timeframe swing high/low: same swing-detection logic run on
    resampled higher-timeframe data, projected back onto the base timeframe.
- **Ribbon anchors** — fire unconditionally at fixed lookback distances from
  the current bar, e.g. `ribbon_intervals = [10, 50, 100, 200]` (bars back,
  configurable list). Each ribbon anchor's anchor point is fixed once chosen
  at spawn time — it does not slide forward each bar like a moving-average
  window; if it did, it would stop being an aVWAP entirely.

For each anchor, maintain from its anchor bar forward:

- **aVWAP**: `avwap_t = cum_pv_t / cum_v_t`, where
  `cum_pv_t = cum_pv_{t-1} + typical_price_t * volume_t` and
  `cum_v_t = cum_v_{t-1} + volume_t`, both reset to 0 at the anchor bar.
  `typical_price_t = (high_t + low_t + close_t) / 3`.
- **ASV (Anchored Signed Volume)**: a single running total, reset to 0 at
  the anchor bar:
  ```
  if close_t > avwap_t:
      cum_asv_t = cum_asv_{t-1} + volume_t
  else:
      cum_asv_t = cum_asv_{t-1} - volume_t
  ```
  This is a deliberate departure from standard On-Balance Volume, which
  signs each bar by comparing its close to the *prior bar's close* — a
  purely local, tick-to-tick rule with no reference to value. Signing
  against the anchor's own aVWAP instead asks whether this volume traded at
  a premium or discount to this specific auction's equilibrium. This keeps
  ASV fully self-referential — no external indicator or convention is
  imported, only the aVWAP the anchor already computes.
- **Volume-weighted variance / stdev bands**: `cum_p2v_t = cum_p2v_{t-1} +
  typical_price_t^2 * volume_t`, reset to 0 at the anchor bar.
  `variance_t = cum_p2v_t / cum_v_t - avwap_t^2`. Bands:
  `avwap_t ± k * sqrt(variance_t)` for `k in {1, 2, 3}`. These bands define
  what counts as "near equilibrium" for touch/breach detection throughout
  this document.

Anchors are never deleted once created, only aged out of consideration (see
section 2). Cap the number of anchors tracked per symbol to keep the scan
cheap — evict the least relevant retired anchors first if a cap is hit.

---

## 2. Relevancy — which anchors are still worth checking

Score each live anchor's current relevancy from four components, kept
separate rather than collapsed into one number. Suggested concrete formulas
below — treat all constants as tunable, not fixed.

- **Proximity**: `proximity = exp(-|distance_atr| / half_life)`, where
  `distance_atr = |current_price - avwap| / ATR` and `half_life` is a
  tunable constant (e.g. 3 ATR). Closer to the anchor → closer to 1.
- **Liveness**: `liveness = volume_last_N_bars / cum_v`, where `N` is a
  tunable window (e.g. 50 bars). An anchor whose volume is mostly ancient
  scores low even if price is nearby.
- **Structural strength**: `structural = min(1, |current_slope| /
  max(|slope_history|))`, where slope is the local rate of change of
  `avwap` and `slope_history` is that same anchor's own trailing
  distribution of slope values (self-relative). A flattening slope means
  this auction has effectively stopped evolving — lower structural score.
- **Respect**: `respect = sum(w_i * reacted_i) / sum(w_i)` across this
  anchor's past touch events (see touch detection below), where
  `reacted_i` is 1 if price reversed within a short window after that
  touch and 0 if it sliced through, and `w_i = exp(-age_i / decay)` weights
  recent touches more than old ones (decay tunable, e.g. 30 bars).
- **Touch detection**: a "touch" is any bar where price enters the
  `stdev_band(1)` (or a configurable band width) around the anchor's
  avwap. Log each touch's timestamp, approach direction, and outcome
  (reacted / sliced through, evaluated N bars later).

**Composite**: `relevancy = w1*proximity + w2*liveness + w3*structural +
w4*respect`, weights summing to 1. Expose named weight presets (e.g.
`"macro"`, `"swing"`, `"intraday"`) rather than one fixed formula, since
different use cases should reasonably weight these components differently.

Anchors below a relevancy floor (tunable, e.g. 0.15) are **excluded**
entirely from the rest of the scan — not down-weighted, simply excluded.
This floor also governs the `active → decaying → retired` lifecycle
transitions from section 0a.

---

## 3. Anchor Flow Divergence (AFD) — the core measurement

AFD is evaluated fresh at every bar, for every live anchor, using only price
and ASV — both continuously available once an anchor exists. This replaces
any notion of scoring individual touches or comparing successive pullbacks.

- **Trailing price slope**: linear regression slope (or simple endpoint
  delta) of price over a rolling window `W` (tunable, e.g. 10-20 bars),
  normalized by ATR: `price_slope = slope(price, W) / ATR`.
- **Trailing ASV slope**: same construction over ASV, over the same window
  `W`: `asv_slope = slope(ASV, W)`.
- **Self-relative z-scoring**: both slopes are z-scored against that same
  anchor's own trailing distribution of slope values (e.g. over the last
  100-200 bars of that anchor's life) — never compared across anchors or
  symbols directly.
- **AFD**: `AFD = z(asv_slope) - z(price_slope)`.
  - Large positive AFD: volume flow strengthening relative to what price is
    currently doing (e.g. price flat/falling while ASV still rising) —
    bullish; buying pressure is real and building even though price hasn't
    caught up.
  - Large negative AFD: the mirror case — distribution outpacing price,
    bearish.
  - Near zero: price and volume flow agree; no divergence worth flagging.

Use a *trailing* window deliberately, not the full lifetime cumulative value
of ASV — a raw, undecayed cumulative total gets dragged by old volume from
near the anchor's birth and becomes less sensitive to recent behavior the
longer the anchor lives (the same staleness problem relevancy exists to
prevent). AFD is a continuous, single-point-in-time comparison of two
trends, not a comparison between this pullback and a prior pullback — there
is no discrete "touch" event required to trigger it, which is what makes
the confluence check in section 5 simple to run at any moment, for any
price.

---

## 3a. Arc Quality — the character of the whole move since the anchor

A separate, whole-life measurement from AFD, computed from the anchor's
birth to now (updated as it lives on) rather than on a trailing window.
Asks whether the price path since the anchor formed has been clean and
efficient, or choppy and directionless. Anchors born from a tight, efficient
arc are more trustworthy inputs to the confluence scan than anchors born
from a messy one, even if both currently clear relevancy and independence.

- **Path efficiency**: `efficiency = |price_now - price_anchor| /
  sum(|price_i - price_{i-1}|)` for all bars `i` since the anchor. This is
  the same construction as Kaufman's Efficiency Ratio, applied here across
  the anchor's full life rather than a fixed lookback window. Near 1 means
  almost purely directional movement; near 0 means heavy backtracking for
  little net progress.
- **Volatility compression**: `compression = max(0, 1 - (ATR_recent_avg /
  ATR_early_avg))`, where `ATR_early_avg` is the average ATR over roughly
  the first third of the anchor's life and `ATR_recent_avg` is the average
  ATR over roughly the most recent third. Positive means the move has
  tightened as it matured; zero or negative (clip to 0) means it hasn't.
- **Arc Quality score**: `arc_quality = (efficiency + compression) / 2`
  (equal-weighted by default; expose as tunable weights, not fixed).

Use Arc Quality as a filter on anchor eligibility, the same way relevancy
and independence are used: anchors below an Arc Quality floor (tunable) can
be excluded from the confluence scan entirely, or down-weighted. Keep Arc
Quality as its own visible field per anchor, not folded into relevancy or
independence — a stale-but-clean anchor and a fresh-but-choppy anchor are
different problems and should be distinguishable in the output.

---

## 3b. Founding Flow Persistence — the volume-side counterpart to Arc Quality

Where Arc Quality asks whether the anchor's whole-life *price* path has been
clean, Founding Flow Persistence asks the same question about *volume*: does
the anchor's original founding burst (`anchor_effort`, section 0a) still
dominate the undecayed, full-lifetime `cum_asv`, or has sustained opposing
flow since eroded it?

- **Persistence score**: `persistence = sign(anchor_effort) * cum_asv_now /
  |anchor_effort|`. Values near or above the original sign and magnitude
  indicate the founding character still dominates. Values near zero
  indicate the founding character has been substantially eroded. A sign
  flip (persistence crosses from positive to negative or vice versa) is a
  rare, higher-conviction event — it means sustained opposing flow has
  finally outweighed a large original vote, which is mathematically hard to
  achieve and therefore meaningful when it happens.
- **Erosion tracking**: optionally track `persistence` as a time series to
  detect an anchor's founding character *approaching* a flip before it
  actually crosses zero — an early-warning signal distinct from the flip
  itself.

This is deliberately undecayed, unlike AFD — it answers "does the auction's
founding thesis still hold," a different, whole-life question from AFD's
"what's happening recently." Keep both as separate fields per anchor; don't
merge them, and don't compute AFD from the undecayed total or Founding Flow
Persistence from a trailing window — each needs its own accumulator
treatment for the reason it exists.

**The resulting three-way structure**: Arc Quality (whole-life price
character) and Founding Flow Persistence (whole-life volume character) both
describe the anchor's entire history and change slowly. AFD (section 3)
describes only the trailing window and changes constantly. All three are
kept as separate fields because they answer different questions.

---

## 4. Independence — don't let near-duplicate anchors fake a consensus

Before combining multiple anchors' AFD readings into a confluence claim,
check that anchors agreeing with each other are genuinely independent
observations, not the same recent move counted twice.

- **Time component**: `time_component = min(1, |t_i - t_j| /
  lookback_horizon)`, where `t_i, t_j` are the two anchors' formation
  timestamps (in bars) and `lookback_horizon` is a tunable constant tied to
  the scan's use case (e.g. 60 bars for a swing-trading horizon). Anchors
  formed close together in time score low here.
- **Type component**: `type_component = 1.0` if the two anchors are
  different formation types (e.g. one swing_high, one gap), `0.4` (tunable)
  if the same type — same-type anchors formed independently still carry
  some genuine independence, but less than a structurally different event.
- **Independence score**: `independence(i, j) = time_component *
  type_component`.

Anchors below an independence floor (tunable, e.g. 0.3) relative to each
other should have their agreement excluded from the confluence count
entirely — not down-weighted quietly. Keep independence as its own visible
pairwise field, not folded into relevancy, Arc Quality, or the confluence
ratio, so it's always possible to see *why* a confluence claim is or isn't
trustworthy.

---

## 5. Confluence scan — where multiple anchors and divergences meet

At the current price, for a given symbol:

1. Collect every anchor (structural + ribbon) whose relevancy clears the
   floor from section 2, whose Arc Quality clears the floor from section
   3a, and whose aVWAP currently sits within a tight band of current price
   (in ATRs, tunable) — this identifies a **confluence zone**: current
   price resting near several anchors' equilibrium at once, each reached by
   a sufficiently clean move.
2. For anchors in that zone, pull each one's current AFD reading (always
   available, per section 3 — no event needs to have just occurred).
3. Apply the independence check from section 4 pairwise across the
   agreeing anchors. Discount or exclude agreement between anchors that
   aren't sufficiently independent.
4. Compute a confluence ratio: `confirmed_independent_anchors /
   eligible_anchors`, where an anchor "confirms" if its AFD is above a
   minimum magnitude in the same direction as the majority. Report this as
   a ratio with the supporting anchor list attached (which anchors
   confirmed, which were excluded and why — low relevancy vs. low Arc
   Quality vs. low independence should be distinguishable reasons in the
   output), not a single opaque score.

**Ribbon-specific checks** (only when ribbon anchors are part of the zone):

- **Alignment**: an ordered comparison of price vs. each ribbon anchor's
  current aVWAP, from shortest to longest lookback interval, reported
  explicitly (e.g. `"price > 10 > 50 > 100 > 200"`) so partial alignment is
  visible, not collapsed to a boolean.
- **Spacing**: normalized (ATR-divided) distance between adjacent ribbon
  anchors, tracked as a time series to detect compression (anchors bunching
  — often precedes a bigger move) vs. fanning (anchors spreading — trend
  already extended), read as a trend rather than a single snapshot.

---

## 6. Named setup patterns

Three distinct setup families, in decreasing order of typical magnitude and
increasing order of typical frequency. All three consume the fields defined
above (relevancy, Arc Quality, Founding Flow Persistence, AFD, independence)
as confirmation layers on top of their own price/volume-shape detection.

### 6a. Arc Pullback into a Significant Anchor

A clean, controlled decline (the approach arc) landing on a relevant,
respected anchor, followed by a breach, rejection, and reclaim. One
generalized detector, parameterized by depth and duration — *Spring* and
*Bear-Trap Liftoff* are documentation presets on the same axis, not
separate code paths.

**Gate 1 — approach quality**: score the decline leg into the anchor using
the Arc Quality mechanics from section 3a (path efficiency + volatility
compression), applied specifically to the approach leg rather than the
anchor's whole life. A choppy, panicked drop that happens to land near a
level is a weaker candidate than a controlled one, even at identical depth.

**Gate 2 — anchor significance**: the anchor being tested must clear the
relevancy floor (section 2), ideally with real respect history. If the
anchor has never been tested before (no respect history), require
compensating strength elsewhere (deeper rejection quality, a larger volume
spike) since the setup can't lean on an established watching audience.

**Breach mechanics** (apply at whatever depth/duration the instance falls
at — no separate code path per preset):
- **Displacement**: how far below `stdev_band(2)` (tunable band) price
  travels, normalized in ATR.
- **Duration**: bars from first breach to deepest point.
- **Depth cap**: displacement beyond a tunable multiple of the anchor's own
  stdev band (e.g. 4x) excludes the instance from this family entirely —
  flag as a possible genuine breakdown instead, regardless of duration.
- **Rejection tell**: `(close - low) / (high - low)` on the breach bar(s)
  close to 1, or a close back toward/above the anchor within a few bars.
- **Volume signature**: elevated volume on the breach vs. the anchor's
  recent average (e.g. ≥1.5-2x) — a single sharp burst is a stronger tell
  at short durations; sustained elevated volume across the decline is the
  natural signature at longer durations (this distinction is part of what
  separates the fast preset from the slow one, not a different detector).
- **AFD confirmation on reclaim**: AFD turning positive (or negative, for
  the bearish mirror) at the reclaim attempt, not just price crossing the
  line on its own.
- **Directional asymmetry as a secondary, logged (not gating) field**: a
  slower/deeper instance that reclaims should generally show a *larger*
  AFD swing at the reclaim than a fast/shallow instance — more time for
  real opposing positioning to build before the reclaim unwinds it. Log
  this per instance; treat as an empirical question to validate later, not
  a hard filter yet.

**Presets** (documentation only):
- *Spring*: shallow depth (≲1.5-2x ATR beyond the band), fast duration
  (breach-to-deepest within 1-3 bars, reclaim within ~5-8 bars).
- *Bear-Trap Liftoff*: deeper (multiple ATR beyond the band, short of the
  depth cap), slower duration (multi-week decline), reclaim window scaled
  proportionally rather than fixed.

No basing/flattening requirement in either preset — that's what
distinguishes this whole family from Swing-High Reclaim.

### 6b. Swing-High Reclaim

A deep, sustained decline from a swing-high anchor, a basing period, and an
eventual reclaim with no fixed time limit. Modeled on Wyckoff's Sign of
Strength / Stage 1-to-2 transition. Structurally distinct from Arc Pullback
by the basing requirement — a categorical condition, not a further point on
the depth/duration axis.

- Anchor type: a swing-high anchor specifically (not a range or ribbon
  anchor).
- **Decline depth threshold**: price reaches meaningfully below the
  anchor's aVWAP at its deepest point (e.g. >20% displacement, tunable) —
  filters out ordinary pullbacks, keeps only genuine breakdowns.
- **Basing requirement**: after the decline, the anchor's aVWAP slope must
  flatten toward zero relative to its own decline-phase slope, sustained
  for a minimum duration (tunable, e.g. 15+ bars) — this is Arc Quality's
  compression component, applied specifically to the post-decline stretch.
  This hard condition is what Arc Pullback never requires.
- **Reclaim trigger**: first close back above the anchor's aVWAP after
  being below it, any time after the basing condition is met — no speed
  requirement.
- **AFD confirmation**: AFD trending up into and through the reclaim, not
  just price crossing the line on its own.

### 6c. Continuation Pullback

A shallow, brief touch of an already-respected, actively trending anchor
that resolves quickly back in the prevailing direction. The
highest-frequency, lowest-magnitude member of this family — a mid-trend
event, not a reversal event.

- Anchor must already show strong, established relevancy — specifically
  high `respect` (multiple prior touches that reacted, not sliced through)
  and a `structural` component indicating the anchor's aVWAP is still
  actively trending (not flattened).
- **Shallow depth requirement**: unlike Arc Pullback, price should stay
  *within* `stdev_band(1)` (tunable, deliberately much shallower than Arc
  Pullback's breach) — this is a touch, not a breach. Price should not
  travel meaningfully beyond the anchor's own equilibrium band.
- **Brevity**: contact with the band lasts only a handful of bars (tunable,
  e.g. ≤5) before price resumes moving in the prevailing direction.
- **AFD stability check, not a flip**: unlike Arc Pullback (which needs AFD
  to *turn* positive at a reclaim), Continuation Pullback should show AFD
  *remaining* in the trend's established direction throughout the touch,
  without dipping to the opposite sign — evidence the pullback never
  represented a genuine change in underlying flow.
- **Trend-direction check**: the resumption move should continue in the
  same direction as the long-run Arc Quality-scored move that defined the
  anchor in the first place (section 3a) — this pattern only fires with
  the trend, never against it.

This pattern is expected to fire far more often than Arc Pullback or
Swing-High Reclaim, since it requires no real breakdown, only a routine
test of an already-strong anchor. Treat its higher frequency as expected,
not as a sign of over-fitting the detection logic.

---

### Reporting stage, not just completion

All three patterns should report which stage they're currently in (e.g.
"breach detected, awaiting reclaim within window," "basing, slope not yet
flattened," "touching, awaiting resumption") rather than only firing a
binary flag at the final trigger — a scanner benefits from seeing
candidates forming, not just completed setups. If an Arc Pullback breach
fails to reclaim within its window and later develops a flattening base
instead, re-evaluate it under Swing-High Reclaim rather than discarding it.

---

## 7. What the scan flags

A candidate setup for a given symbol at the current bar should report, at
minimum:

- The price zone and its direction (bullish or bearish flow divergence).
- If matching a named pattern (Arc Pullback — noting preset region, e.g.
  Spring-like or Bear-Trap-like; Swing-High Reclaim; or Continuation
  Pullback), which one and what stage it's currently in.
- The confluence ratio (confirmed / eligible anchors) and the full list of
  contributing anchors with their type, formation time, relevancy, Arc
  Quality, Founding Flow Persistence, and current AFD value.
- The independence-adjusted status of that confluence — explicitly flagged
  if the agreeing anchors aren't well-separated, so a strong-looking ratio
  built from near-duplicate anchors isn't treated the same as one built
  from genuinely separate auctions.
- Ribbon alignment and spacing state, if ribbon anchors are part of the
  picture at that zone.
- A plain-language reason string (e.g. "3 of 4 eligible anchors show
  positive AFD, independence confirmed, ribbon aligned bullish and still
  compressed") or why a nearby zone was considered but not flagged.

Rank flagged setups across the scanned universe by confluence ratio first,
then by the aggregate relevancy of the contributing anchors.

---

## Parameter reference (defaults — all tunable, none settled)

| Parameter | Default | Used in |
|---|---|---|
| Swing-detection window | 10 bars | Anchor detection (§1) |
| Swing volume multiplier | 1.5x trailing avg | Anchor detection (§1) |
| Gap threshold | 0.5x ATR | Anchor detection (§1) |
| Ribbon intervals | [10, 50, 100, 200] bars | Anchor detection (§1) |
| Stdev band multiples | k = 1, 2, 3 | §1, throughout |
| Proximity half-life | 3 ATR | Relevancy (§2) |
| Liveness window | 50 bars | Relevancy (§2) |
| Respect touch-decay | 30 bars | Relevancy (§2) |
| Relevancy floor | 0.15 | §2, gates elsewhere |
| AFD trailing window (W) | 10-20 bars | AFD (§3) |
| AFD z-score history window | 100-200 bars | AFD (§3) |
| Arc Quality floor | tunable, no default yet | §3a, gates elsewhere |
| Independence time horizon | 60 bars (swing use case) | Independence (§4) |
| Independence type factor (same type) | 0.4 | Independence (§4) |
| Independence floor | 0.3 | Independence (§4) |
| Confluence zone width | tunable, in ATR | Confluence (§5) |
| Arc Pullback depth cap | 4x stdev band | Arc Pullback (§6a) |
| Spring preset depth | ≲1.5-2x ATR | Arc Pullback (§6a) |
| Spring preset duration | 1-3 bars to low, ≤5-8 bars to reclaim | §6a |
| Swing-High Reclaim depth threshold | >20% | §6b |
| Swing-High Reclaim basing duration | 15+ bars | §6b |
| Continuation Pullback band | stdev_band(1) | §6c |
| Continuation Pullback max duration | ≤5 bars | §6c |

---

## Explicit non-goals for this scan logic

- No forward-return validation or backtesting is part of this logic — it
  identifies candidate zones based on the mechanism described above and
  makes no claim about historical hit rate or expectancy. Treat every
  flagged setup as a candidate for further judgment, not a proven signal.
- No RSI, OBV, or MFI as external indicators anywhere in this logic. ASV
  signs volume by each bar's relation to its own anchor's aVWAP, not by
  comparison to the prior close — it is not even a same-logic analog of
  OBV, it's a distinct, self-referential rule built only from the aVWAP the
  anchor already computes.
- No discrete touch-event detection and no comparison across separate,
  discrete pullbacks for AFD specifically — AFD is deliberately continuous
  and self-contained at every bar. (Touch detection *is* used elsewhere —
  for relevancy's respect component and for Continuation Pullback — but
  never as the trigger for AFD itself.)
- Don't compute AFD from full-lifetime cumulative ASV — always use a
  trailing window, or the measure quietly degrades into the same staleness
  problem relevancy scoring exists to prevent. This restriction applies to
  AFD specifically; Founding Flow Persistence (§3b) intentionally uses the
  undecayed full-lifetime total, since it answers a different question.
  Don't conflate the two or let one substitute for the other.
- Don't treat any value in the Parameter Reference table as fixed or
  settled — they are starting points for tuning, not validated constants.
- Arc Quality and Founding Flow Persistence are hypotheses about which
  anchors are more trustworthy, not validated filters — usable for scanning
  and candidate generation, not proof that tighter-arc or
  stronger-persistence anchors actually resolve more reliably until tested
  against real outcomes.
- Arc Pullback, Swing-High Reclaim, and Continuation Pullback (§6) are
  three separate detectors on purpose — the basing requirement (§6b) and
  the shallow/brief/no-reversal requirement (§6c) are categorical
  differences from Arc Pullback, not threshold differences. Within Arc
  Pullback itself, Spring and Bear-Trap Liftoff are documentation presets
  on one shared depth/duration parameter space, not separate code paths —
  don't re-split them into distinct detectors either.

---

## Worked examples — use these as test vectors

Small, hand-computable examples for the core formulas. Implementations
should reproduce these numbers exactly (within floating-point tolerance)
before being trusted on real data.

**ASV signing** (§1): five bars, anchor at bar 0.
```
bar:        0     1     2     3     4
close:      100   104   101   108   112
volume:     500   400   300   600   450
```
aVWAP after each bar (cumulative typical-price*volume / cumulative volume —
for this simplified example assume typical_price = close): after bar 0,
avwap = 100. Bar 1: cum_pv = 100*500 + 104*400 = 91,600; cum_v = 900;
avwap = 101.78. Since close(104) > avwap(101.78) at bar 1, that bar's
volume (400) adds to ASV. Continue this bar-by-bar; the point of this
example is the *mechanism* — each bar's sign is determined by that bar's
own close vs. the aVWAP *as of that bar*, not vs. the prior close and not
vs. a fixed anchor price.

**Efficiency ratio** (§3a): the path `100 → 104 → 101 → 108 → 105 → 112`
has per-step absolute moves `4, 3, 7, 3, 7`, summing to a path length of
24. Net displacement is `|112 - 100| = 12`. Efficiency ratio = `12 / 24 =
0.50`. A path that went `100 → 112` in one step would score `1.0`; a path
that oscillated back to 100 before ending at 112 with lots of backtracking
would score well below 0.50.

**AFD sign, conceptually**: if price's trailing slope is flat-to-negative
(z-score near 0 or negative) while ASV's trailing slope is clearly positive
(z-score well above 0), `AFD = z(asv_slope) - z(price_slope)` will be a
large positive number — this is the "quiet accumulation" case (see the
quadrant description below). Implementers should verify their sign
convention produces positive AFD for this bullish-divergence case, not the
reverse.

**Price-position x ASV-sign quadrant** (a useful sanity check for AFD and
relevancy interacting correctly, not a separate scored quantity to
implement): a 2x2 read of price vs. this anchor's aVWAP, crossed with ASV's
recent sign —
- Price above aVWAP + ASV rising → confirmed strength.
- Price above aVWAP + ASV falling → fragile rally (price up, flow says
  selling — a warning case).
- Price below aVWAP + ASV rising → quiet accumulation (price down, flow
  says buying).
- Price below aVWAP + ASV falling → confirmed weakness.
Use this to sanity-check that AFD's sign and magnitude behave sensibly in
each of the four cases when testing against synthetic data.

**Independence, worked**: two anchors, a swing low formed 4 bars ago and a
gap formed 55 bars ago, with `lookback_horizon = 60`. `time_component =
min(1, |55-4|/60) = min(1, 0.85) = 0.85`. Different types →
`type_component = 1.0`. `independence = 0.85 * 1.0 = 0.85` — high, these
count as independent. Contrast: two swing lows formed 3 bars apart with the
same horizon: `time_component = min(1, 3/60) = 0.05`, same type →
`type_component = 0.4`. `independence = 0.05 * 0.4 = 0.02` — should be
excluded from confluence entirely at any reasonable independence floor.

**Founding Flow Persistence, worked**: an anchor's founding bar had
`anchor_effort = +10,000` (net buying on formation). Over the following 300
bars, `cum_asv` drifts down by roughly 20 per bar from opposing flow, net
`-6,000`. Current `cum_asv = 10,000 - 6,000 = 4,000`.
`persistence = sign(10,000) * 4,000 / |10,000| = 0.4` — still positive,
still "founding character intact," but eroding. If a trailing-window
measure (like AFD) were computed over just the most recent 20 bars of that
same drift, it would read negative — this is the expected and correct
divergence between the two measures, not a bug to reconcile.

---

## Common pitfalls — mistakes made and corrected during design, don't repeat them

Each of these was an actual wrong turn taken while developing this system.
Listed so the same mistakes aren't quietly re-introduced during
implementation, where they might look like reasonable simplifications.

- **Signing ASV like standard OBV (close vs. prior close)**: this was the
  first version of ASV. It's simpler to implement but imports an external
  convention with no reference to this anchor's value, defeating the point
  of anchoring in the first place. Always sign against this anchor's own
  `avwap`, per §1 — not the prior bar's close.
- **Treating ribbon anchors as a rolling/moving-average window**: a ribbon
  anchor's anchor point must be chosen once, at spawn time, and stay fixed.
  If the anchor point slides forward each bar, it stops being an aVWAP and
  silently becomes a disguised moving average — a different, much simpler
  calculation that loses the volume-weighted-since-a-fixed-point meaning
  the whole system depends on.
- **Making AFD event-triggered (only computed at a touch)**: an earlier
  design computed absorption only when price touched an anchor's band. This
  added real complexity (band width, touch-window bookkeeping) and
  reintroduced a pivot-to-pivot comparison. AFD must be continuous — valid
  at every bar, for every anchor — per §3.
- **Computing AFD from full-lifetime cumulative ASV instead of a trailing
  window**: this makes AFD increasingly insensitive to recent behavior as
  an anchor ages, the same staleness problem relevancy exists to solve. Use
  a trailing window for AFD specifically; save the undecayed total for
  Founding Flow Persistence (§3b), which needs it for a different reason.
- **Merging Swing-High Reclaim into the Arc Pullback continuum**: it's
  tempting since both are breach-reject-reclaim shapes, but Swing-High
  Reclaim's basing requirement is a categorical gate (must flatten before
  reclaim is valid), not a depth/duration setting. Collapsing them into one
  parameterized function would either force spurious basing checks onto
  fast Springs or drop the basing requirement Swing-High Reclaim depends
  on.
- **Skipping or softening the independence check "for simplicity"**:
  without it, a scanner that spawns a swing-low anchor, a nearby gap
  anchor, and a ribbon anchor all within the same few bars will report
  strong confluence that is actually one observation triple-counted. This
  check is load-bearing, not optional polish — see Design Intent above.
- **Treating Continuation Pullback like a smaller Arc Pullback**: Arc
  Pullback wants AFD to *flip* at the reclaim (evidence something changed).
  Continuation Pullback wants AFD to *stay* in the trend direction
  throughout (evidence nothing changed). These are opposite confirmation
  conditions — implementing Continuation Pullback as "Arc Pullback with
  smaller depth thresholds" will silently invert its confirmation logic.
- **Averaging or overwriting Arc Quality/Founding Flow Persistence with
  AFD**: all three are meant to coexist as separate fields per anchor (see
  §3b's "three-way structure" note). An anchor with high whole-life Arc
  Quality but currently negative AFD is a meaningful, reportable state
  (e.g. a clean uptrend currently seeing a flow warning) — collapsing these
  into one number destroys exactly the information the system exists to
  surface.
