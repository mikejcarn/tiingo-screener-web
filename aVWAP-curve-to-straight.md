# Curve-to-Straight — a standalone aVWAP shape indicator

**Standalone.** Depends only on file 1 (anchors, aVWAP, ATR) — nothing else
in this spec set. Can be built and tested entirely on its own, independent
of AFD, relevancy, or any other file.

## Design intent

Visual observation: an anchor born at a swing extreme often shows a sharp
initial curve in its aVWAP line, which then straightens out over time. The
hypothesis: the more the line has flattened *relative to how sharply it
originally curved*, the closer it is to being penetrated — and this holds
symmetrically for anchors born at highs (curving down then flattening,
eventually broken upward) and anchors born at lows (curving up then
flattening, eventually broken downward).

This maps onto two different Wyckoff ideas, not one:
- The **size of the initial curve** relates to the Law of Cause and
  Effect — a bigger initial move suggests more "cause" built up, and
  potentially a bigger eventual "effect" once released.
- The **degree of flattening** relates to timing — how close the anchor
  is, right now, to being ready for that release.

Keep these as two separate measurements. A strong curve that's still sharp
(not flattened) and a weak curve that's already flat are different
situations, not points on the same scale — collapsing them into one number
too early loses that distinction.

**Important caution, verify before trusting this indicator**: an aVWAP's
slope mechanically decays toward zero as an anchor ages, simply because
accumulated volume (`cum_v`) grows over time — the same size price move
produces a smaller slope change late in an anchor's life than early on,
regardless of whether anything meaningful is happening. This is why the
formulas below always compare an anchor's *current* slope against *that
same anchor's own peak slope* — a self-relative baseline — rather than
against a fixed threshold. Without this, the indicator would flag every
sufficiently old anchor as "ready," since flattening is partly guaranteed
by aging alone.

## Core formulas

**Normalized slope** (every bar, per anchor):
```
raw_slope_t = slope(avwap, window)      # regression or endpoint delta over `window` bars, default window=5
norm_slope_t = raw_slope_t / ATR_t
```
Use a short smoothing window (default 5 bars, tunable) rather than a
single-bar delta — a 1-bar difference is too noisy for this indicator to
behave sensibly.

**Curve strength** (running peak since anchor formation):
```
curve_strength = max(|norm_slope_t|) for all t since anchor birth
```
Because anchors form at swing extremes by definition, the sharp move
naturally happens early in the anchor's life. This running max typically
locks in during that initial move and then stays fixed as the line
flattens — no separate "early window" detection logic is needed.

**Straightening score** (how far current slope has decayed from that peak):
```
straightening_score = 1 - (|norm_slope_now| / curve_strength)
```
`0` = current slope is still as sharp as the peak ever was. `1` = fully
flat relative to this anchor's own history. Guard against division by zero
for brand-new anchors where `curve_strength` hasn't been established yet
(e.g. require a minimum number of bars, default 5, before this is valid).

**Sustain / duration check** (avoid single-bar noise):
```
bars_sustained = count of consecutive recent bars where
                  straightening_score >= sustain_threshold   # default 0.85
duration_factor = min(1, bars_sustained / target_duration)   # default target_duration=15
```

**Consistency score** (how clean was the decay from peak to now, not just
its endpoints):

`curve_strength` and `straightening_score` only ever look at two points —
the sharpest moment the slope ever reached, and the current slope. Nothing
in those two formulas evaluates what happened *between* those points. Two
anchors can have an identical peak and an identical current value while one
decayed almost in a straight line and the other zigzagged wildly the whole
way there — the formulas above can't tell them apart, but the jagged one is
a meaningfully weaker candidate. This reuses the same efficiency-ratio
logic as Arc Quality (file 4), applied to the slope series itself rather
than to price — a curvature-of-the-curvature measurement:
```
consistency_score = |slope_at_peak - slope_now| / sum(|slope_t - slope_{t-1}|)
                     for all t from the peak bar to now
```
Near 1 = the slope decayed almost monotonically from its peak to now — a
genuinely round, clean curve. Well below 1 = the slope bounced around
repeatedly on its way to flat — jagged, less trustworthy even with the
same start and end values.

## Composite quality score

Four sub-scores feed the composite, each normalized to [0, 1]:

```
curve_strength_norm = min(1, curve_strength / curve_strength_cap)  # default cap=3.0, tunable
straightening_score                                                 # already [0,1]
duration_factor                                                     # already [0,1]
consistency_score                                                   # already [0,1]

composite_quality = (curve_strength_norm * straightening_score * duration_factor * consistency_score) ** (1/4)
```

**Why a geometric mean, not an average**: a plain average lets one strong
component compensate for another weak one — a huge curve with almost no
flattening could still average out to a mid-range score, which is
misleading, since it isn't actually a ready candidate. Same logic applies
to consistency: a strong peak and a currently-flat reading could mask a
jagged, erratic path in between if averaged, but the geometric mean
punishes that low component just as hard as any other. The requirement is
a real curve, real flattening, real persistence, *and* a clean path
between them — not a good score on just one or two axes.

**`curve_strength_cap` default of 3.0 is a rough starting point, not a
calibrated value** — it should be tuned against real data, or replaced with
a cross-sectional approach: instead of a fixed cap, rank each candidate's
`curve_strength` as a percentile against all other currently-eligible
anchors in the same scan pass. The cross-sectional version self-calibrates
across instruments and time periods; the fixed-cap version is simpler to
compute per-anchor in isolation. Start with the fixed cap, move to
cross-sectional ranking once there's enough real scan output to calibrate
against.

## Worked example

Anchor with `curve_strength = 2.4` (ATR-normalized peak slope), current
`norm_slope = 0.15`, `bars_sustained = 12` at the default 0.85 threshold,
`target_duration = 15`, `curve_strength_cap = 3.0`, and a smooth,
near-monotonic decay from peak to now (`consistency_score = 0.90`).

```
straightening_score = 1 - (0.15 / 2.4) = 1 - 0.0625 = 0.9375
curve_strength_norm = min(1, 2.4 / 3.0) = 0.80
duration_factor = min(1, 12 / 15) = 0.80

composite_quality = (0.80 * 0.9375 * 0.80 * 0.90) ** (1/4)
                   = (0.54) ** (1/4)
                   ≈ 0.857
```
A strong, well-flattened, reasonably-sustained, cleanly-decayed candidate
— high composite score.

**Contrast — identical peak and current slope, only the path differs**:
same `curve_strength`, `straightening_score`, and `duration_factor` as
above, but the slope zigzagged sharply on its way down instead of decaying
smoothly (`consistency_score = 0.25`):
```
composite_quality = (0.80 * 0.9375 * 0.80 * 0.25) ** (1/4)
                   = (0.15) ** (1/4)
                   ≈ 0.622
```
Same endpoints, same duration — but the jagged path drags the composite
down substantially. This is the intended behavior: `curve_strength` and
`straightening_score` alone couldn't see the difference between these two
cases; `consistency_score` is what makes that difference visible.

**Separately — duration alone, without consistency**: same curve strength
and straightening as the first case, but only 3 bars sustained
(`duration_factor = 0.20`), smooth path (`consistency_score = 0.90`):
```
composite_quality = (0.80 * 0.9375 * 0.20 * 0.90) ** (1/4) ≈ 0.596
```
The geometric mean drags the score down whenever *any* single component is
weak, regardless of which one — this is the intended behavior throughout.

## Output fields — report all of these, not just the composite

For every anchor, every bar:
- `curve_strength` (raw, ATR-normalized)
- `straightening_score` (0-1)
- `bars_sustained` (raw count)
- `duration_factor` (0-1)
- `consistency_score` (0-1)
- `composite_quality` (0-1)

Keep the composite alongside the individual components, not instead of
them. Ranking use cases differ: sort by `composite_quality` for overall
best candidates, sort by `curve_strength` alone for "biggest potential
moves regardless of timing," or sort by `straightening_score` alone for
"most imminent regardless of size."

## Ranking aVWAPs

Across all live anchors (one symbol or a whole scanned universe), sort
descending by `composite_quality` to surface the best curve-to-straight
candidates. Apply a minimum floor on each individual component (not just
the composite) before ranking — e.g. require `curve_strength_norm > 0.3`
and `bars_sustained >= 5` — so a candidate doesn't rank well purely by
having two very high components mask a near-zero third one after the cube
root (the geometric mean reduces this risk but doesn't eliminate it at the
extremes).

## Parameters (defaults — tunable, not settled)

| Parameter | Default | Purpose |
|---|---|---|
| Slope window | 5 bars | Smoothing for `norm_slope` |
| Minimum bars before valid | 5 bars | Avoid division-by-zero on new anchors |
| Sustain threshold | 0.85 | `straightening_score` level counted as "flat" |
| Target duration | 15 bars | Duration for `duration_factor` to reach 1.0 |
| Curve strength cap | 3.0 | Normalization ceiling for `curve_strength_norm` |

## Sanity checks

- Construct a synthetic anchor: sharp initial slope for the first ~8 bars,
  then near-zero slope for the next ~40. Confirm `curve_strength` locks in
  near the bar-8 peak and stays there, and `straightening_score` climbs
  toward 1 as the flat stretch continues.
- Construct a synthetic anchor with a weak initial move (small
  `curve_strength`) that also flattens — confirm `straightening_score` can
  still be high, but `composite_quality` stays capped by the low
  `curve_strength_norm` term.
- Construct a synthetic anchor that flattens only briefly (a few bars) then
  resumes its original slope — confirm `bars_sustained` resets and
  `duration_factor` drops, rather than the indicator treating the brief
  flat stretch as a durable readiness signal.
- Construct two synthetic anchors with identical `curve_strength` and
  identical final `straightening_score`, one where the slope decays
  smoothly and monotonically from peak to now, one where it oscillates
  sharply along the way before landing at the same final value. Confirm
  `consistency_score` (and therefore `composite_quality`) is clearly lower
  for the jagged case despite identical endpoints — this is the specific
  behavior file 09 exists to add on top of the simpler two-point version.
- On real historical data, run this against a known example (e.g. an
  anchor born at a clear swing high that visibly curves down then
  flattens for months before a breakout) and confirm the composite score
  rises through the flattening period and is near its peak right before
  the actual breakout bar.

## Explicit non-goals for this file

- No claim that this indicator predicts direction — it only measures shape
  (how curved, how flat, how long). Direction comes from elsewhere (e.g.
  whether price is above or below the anchor, or AFD if integrated later).
- No integration with AFD, relevancy, independence, or the confluence scan
  in this file — this is deliberately standalone. Integration is a later
  step, not part of this indicator's job.
- No forward-return validation — the composite ranks candidates by shape
  quality, not by demonstrated historical outcome. Treat high-ranked
  candidates as worth a closer look, not as a validated signal.
- Don't hardcode `curve_strength_cap` as if it were calibrated — it isn't
  yet. Revisit once there's real scan output to tune against.
