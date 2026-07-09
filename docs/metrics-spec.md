# Metrics Correctness Specification

**Status:** Proposed
**Applies to:** `src/analyzer.ts` (`analyze()` @ line 49, `hrZones()` @ line 25) and `src/types.ts`
**Audience:** the implementing agent. The worked examples in this document are **normative fixtures** — the implementation must reproduce them exactly, and must not substitute its own invented inputs or outputs.

---

## 0. Why this document exists

Five metrics in `analyze()` return numbers that are plausible on sight and wrong on inspection. None throws, none is obviously broken in a single-file smoke test, and every one of them has already shipped to users (through `0.2.2`). This spec fixes the definition of each metric, cites the behaviour of the systems users compare us against (Garmin, Strava, the FIT/ANT+ specification), and pins down every edge case and the exact arithmetic so the fix is mechanical.

| # | Metric | File / line | Defect | Direction of change |
|---|--------|-------------|--------|---------------------|
| 1 | HR zones | `analyzer.ts:25` `hrZones()` | Counts samples, not time. Documented as seconds (`types.ts:32`). | Redistributes toward sparsely-sampled zones; total becomes real seconds |
| 2 | Best 1 km pace | `analyzer.ts:135` | Fastest *bucketed split*, not a rolling window | Faster or equal, never slower |
| 3 | Trailing split | `analyzer.ts:127` | Final partial km silently dropped | Adds a partial split; `sum(splits.distanceM) === distanceM` |
| 4 | Split boundaries | `analyzer.ts:136` | Overshoot discarded, boundaries drift | Split paces recomputed over true 1000 m |
| 5 | Elevation gain | `analyzer.ts:110` | Raw positive deltas — integrates GPS noise as climb | Drops, often substantially |

A note on the current `hrZones()` signature: `analyze()` already computes `segTimeSec` for every segment inside its main loop (`analyzer.ts:95–99`), but `hrZones(pts, maxHR)` is called (`analyzer.ts:158`) with a bare point array that carries **no timing**. The time information the fix needs already exists in the caller; it simply is not passed in. This is a signature change, not a new computation.

---

## 1. Time-weighted HR zones

### 1.1 The defect

`hrZones()` (`analyzer.ts:25–43`) increments a per-zone counter once per point. `types.ts:32` documents each zone field as **(seconds)**. The two disagree unless every sample is exactly 1 s apart. Garmin's default "smart recording" samples irregularly — commonly every 3–7 s, and *denser during hard efforts* — so a count-based zone distribution is biased toward whatever the watch happened to sample densely, which is exactly the high-intensity segments. The units are also simply wrong: the field claims seconds and returns a sample count.

### 1.2 The standard formulation

Time-in-zone is defined as the **integral of time over the intervals spent in each zone**, not a sample count. The universally implemented discretisation is: attribute the *duration of each segment* to a single zone, and sum those durations per zone. This is what Garmin Connect and TrainingPeaks report as "time in zone."

- **Attribution rule.** Segment *i* spans point *i−1* → point *i* and has duration `segTimeSec[i]`. Attribute that whole duration to the zone of the **segment's ending sample** (point *i*). This matches the attribution the analyzer already uses for per-split HR (`splitHrSum += curr.heartRate`, `analyzer.ts:122`) and keeps a single convention across the file. (Choosing the *starting* sample, or splitting the segment 50/50, are both defensible; ending-sample is chosen for consistency with the existing split code. The implementation must use ending-sample.)
- **Zone boundaries.** Keep the existing HRmax-percentage bands, documented below with their source.

### 1.3 Zone boundaries and their source

The current code uses `< 60 / 60–70 / 70–80 / 80–90 / ≥ 90` percent of HRmax (`analyzer.ts:33–37`). This is **Garmin's default 5-zone model**, with one deviation. Garmin's published defaults are:

| Zone | Garmin default (% HRmax) | Garmin label |
|------|--------------------------|--------------|
| 1 | 50–60 | Warm-up |
| 2 | 60–70 | Easy |
| 3 | 70–80 | Aerobic |
| 4 | 80–90 | Threshold |
| 5 | 90–100 | Maximum |

Source: Garmin, *About Heart Rate Zones* (Forerunner owner's manual). See references [G1].

**Deviation to preserve intentionally:** Garmin's Zone 1 *floor* is 50 % HRmax; anything below 50 % is "no zone." The current code has no floor — it puts everything `< 60 %` into `z1`. Keep the current behaviour (`z1` = everything below 60 %), because dropping sub-50 % samples would make `sum(zones) < total time` and break the invariant in §1.4. Document `z1` as "below 60 % HRmax (includes warm-up / recovery / below-zone)." Do **not** silently adopt other conventions (e.g. Karvonen %HRR, or the BCF/Coggan 7-zone power-style model) — those change the boundaries and are out of scope. If the maintainer later wants configurable boundaries, that is a separate feature.

### 1.4 Units, shape, and the invariant

- **Value = seconds** (not a fraction of total). Seconds is what `types.ts:32` already promises, keeps the field a plain additive quantity, and lets consumers derive fractions themselves. Returning a fraction would be a second, gratuitous semantic break.
- **Shape unchanged.** `HeartRateZones` stays `{ z1, z2, z3, z4, z5 }`, five numbers. Do **not** add a `totalSec` field — it is derivable and adding it is an avoidable type change. (The *meaning* of the numbers changes; the shape does not. See §7.)
- **Invariant:** `z1 + z2 + z3 + z4 + z5 === Σ segTimeSec[i]` over all segments that have an HR sample at their ending point. With every point carrying HR this equals the HR-covered elapsed time.

### 1.5 Edge cases (precise)

1. **First point.** Point 0 has no preceding segment, so it contributes **zero** duration. Its HR value is never attributed on its own; it only matters as the *start* of segment 1, whose duration is attributed to point 1. (Under the ending-sample rule the first sample's HR is simply never weighted. This is correct: a single instant has zero duration.)
2. **Missing or non-monotonic timestamp on a segment.** If either endpoint lacks a timestamp, or `curr.timestamp - prev.timestamp <= 0`, that segment's duration is **0** for zone weighting — skip it, contributing nothing to any zone. Do **not** fall back to `1` here (the `analyzer.ts:99` `segTimeSec = 1` clamp exists to protect *pace/speed* division from divide-by-zero; it must not leak into time-in-zone, where it would re-introduce the count bias for exactly the corrupt segments). A segment with a missing HR sample at its ending point is likewise skipped for zones (no zone to attribute to).
3. **File with no timestamps at all.** The parser leaves `timestamp` undefined, and `segTimeSec` defaults to `1` for pace. For zones, detect the whole-activity no-timestamp case and **fall back to 1 s per segment** (i.e. count-weighting), because with no time information sample-count is the only available proxy. In this one case the corrected result equals the old count-based result — but it is now honestly labelled "1 s assumed per sample," and every timestamped file (the overwhelming majority) is fixed. Document this fallback in the field doc.

### 1.6 Worked example — HR zones

`maxHR = 190`. Six samples; the hard surge (z5) is sampled every 1 s, the easy running (z3) every 8 s — the exact bias Garmin smart-recording produces.

| Point | timestamp (offset s) | heartRate | % HRmax | zone |
|------:|---------------------:|----------:|--------:|:----:|
| p0 | 0  | 140 | 73.7 % | z3 |
| p1 | 8  | 145 | 76.3 % | z3 |
| p2 | 9  | 185 | 97.4 % | z5 |
| p3 | 10 | 186 | 97.9 % | z5 |
| p4 | 11 | 184 | 96.8 % | z5 |
| p5 | 19 | 142 | 74.7 % | z3 |

**Current implementation** (count per sample, all six counted):

```
z1=0  z2=0  z3=3  z4=0  z5=3     (total 6 "seconds")
→ z5 appears to be 50 % of the activity
```

**Corrected** (attribute each segment's duration to its ending sample's zone):

| segment | duration | ending sample | zone | credited |
|---------|---------:|:-------------:|:----:|---------:|
| p0→p1 | 8 s | p1 (145) | z3 | z3 += 8 |
| p1→p2 | 1 s | p2 (185) | z5 | z5 += 1 |
| p2→p3 | 1 s | p3 (186) | z5 | z5 += 1 |
| p3→p4 | 1 s | p4 (184) | z5 | z5 += 1 |
| p4→p5 | 8 s | p5 (142) | z3 | z3 += 8 |

```
z1=0  z2=0  z3=16  z4=0  z5=3    (total 19 s = elapsed time p0→p5)
→ z5 is 3/19 = 15.8 % of the activity
```

The count method reports the surge as half the run; time-weighting reports it as ~16 %. The total also changes from a meaningless `6` to a real `19 s`.

---

## 2. Rolling best-kilometre pace

### 2.1 The defect

`bestKmPaceSecPerKm` is the fastest **whole-kilometre split** (`analyzer.ts:135`): it only ever considers the buckets `[0,1000)`, `[1000,2000)`, … A runner's actual fastest kilometre almost never begins on a split boundary, so this systematically *overestimates* (reports a slower time than) the true best km. It also inherits the boundary-drift bug of §4, so the "split" it compares can span more than 1000 m.

### 2.2 What Garmin and Strava actually compute

Both compute a **best effort** as a *rolling (sliding) window* over the activity: the fastest elapsed time to cover the target distance *anywhere* in the activity, with the window free to start between recorded points. Strava documents that Best Efforts use **elapsed time**, not moving time, and are found automatically from the activity's GPS stream (references [S3]). Neither vendor publishes the interpolation detail, but every faithful open implementation (e.g. GoldenCheetah's "best intervals") interpolates linearly at the window edges, because without it the window is quantised to sample spacing and the result is wrong by up to one sample interval.

**Where they differ / what to recommend.** Strava uses *elapsed* time for best efforts; a pause inside the window therefore counts against it. The current `bestKmPace` is built from `splitTimeSec`, which is *total* segment time (it is not filtered by `isMoving`), so it is already elapsed-time based. **Recommendation: match Strava — use elapsed time** (the sum of `segTimeSec` across the window), and interpolate at the edges. Do not switch to moving time; that would be a third convention and would disagree with the number users see in Strava.

### 2.3 Algorithm (implementable)

Work over the **cumulative-distance / cumulative-elapsed-time** series built from the points:

```
cumDist[0] = 0,           cumDist[i] = cumDist[i-1] + haversine(p[i-1], p[i])
cumTime[0] = 0,           cumTime[i] = cumTime[i-1] + segTimeSec[i]   // elapsed, unfiltered
```

Define `timeAt(x)` = elapsed time at cumulative distance `x`, by **linear interpolation** within the segment that contains `x`:

```
find segment i with cumDist[i-1] <= x <= cumDist[i]
f = (x - cumDist[i-1]) / (cumDist[i] - cumDist[i-1])
timeAt(x) = cumTime[i-1] + f * (cumTime[i] - cumTime[i-1])
```

The fastest 1000 m window is `min over s in [0, total-1000] of ( timeAt(s+1000) - timeAt(s) )`.

The minimum of that continuous function is attained at a **breakpoint** — a window position where either edge coincides with a recorded point. So it is not necessary to scan continuously: evaluate the window at the finite candidate set

```
candidates = { p.cumDist         for each point p, if p.cumDist + 1000 <= total }   // point as window START
           ∪ { p.cumDist - 1000  for each point p, if p.cumDist - 1000 >= 0 }       // point as window END
           ∪ { 0, total - 1000 }
```

and take the minimum window time. (A two-pointer sweep advancing both edges through the points, interpolating the trailing edge, is the equivalent O(n) form; either is acceptable.) Report `Math.round(bestWindowTimeSec)` since the window is exactly 1000 m so seconds-per-km equals the window time.

### 2.4 Edge cases

- **Total distance < 1000 m:** no full window exists → `bestKmPaceSecPerKm = null` (unchanged from today, where no split is ever emitted).
- **Partial trailing window:** never considered — a window must be a full 1000 m. The trailing partial *split* of §3 does **not** feed best-km. (This keeps the "never slower" guarantee: a sub-km fragment can look fast but is not a kilometre.)
- **Relationship to splits:** `bestKmPaceSecPerKm` is computed by this rolling scan and is **independent** of the `splits[]` array. Do not derive it from `splits`. §3/§4 fix `splits[]`; §2 fixes best-km; they are separate computations sharing only the cumulative series.
- **No timestamps at all:** `segTimeSec` defaults to 1 per segment, so the window time is a sample count — degraded but consistent with everything else in that (rare) case.

### 2.5 Worked example — rolling best-km with interpolation

Three points on the equator (`lat = 0`), so haversine distance ≈ `lon_deg × 111 319.5 m`. The middle segment is faster than the first.

| Point | lat | lon | cumulative dist | timestamp (offset s) |
|------:|----:|------------:|----------------:|---------------------:|
| p0 | 0 | 0.0000000 | 0 m    | 0   |
| p1 | 0 | 0.0053959 | 600 m  | 180 |
| p2 | 0 | 0.0125905 | 1400 m | 380 |

Segment speeds: p0→p1 is 600 m in 180 s (**300 s/km**); p1→p2 is 800 m in 200 s (**250 s/km**).

**Current implementation.** Accumulating splits: after p1 `splitDist = 600` (no emit); after p2 `splitDist = 1400 ≥ 1000` → emit one "split" over 1400 m, `pace = 380 / 1.4 = 271.4 → 271`. `bestKmPaceSecPerKm = 271` (and note the split is mislabelled "1 km" but spans 1400 m — that is defect §4 leaking in).

**Corrected.** Slide a 1000 m window; the optimum pushes its trailing edge to the fast material, giving window `[400 m, 1400 m]`:

```
timeAt(400)  : within p0→p1, f = 400/600      → 180 * (400/600)          = 120 s
timeAt(1400) : = 380 s
window time  : 380 - 120 = 260 s              → bestKmPaceSecPerKm = 260
```

Interpolation at 400 m is essential — there is no recorded point there. Rolling best **260 s/km** vs bucketed **271 s/km**: faster, as guaranteed.

---

## 3. Split accounting — trailing partial split

### 3.1 The defect

The final partial split is discarded. A 10.9 km run emits 10 splits and drops the last 900 m from `splits[]` **and** (today) from best-pace consideration. Users see a distance of 10.9 km but only 10 km of splits.

### 3.2 Specification

- **Emit the trailing partial split.** After the last full-km boundary, if `total - lastMark > 0`, append one final `Split` covering the remainder.
- **`Split` gains a `distanceM` field** so consumers can tell a partial from a full km. Every split (full or partial) carries its `distanceM`; full kilometres carry `distanceM: 1000` (see §4), the trailing one carries the remainder. Its `paceSecPerKm` is normalised to a kilometre: `pace = remainderTimeSec / (remainderM / 1000)`, so a partial split's pace is directly comparable to a full one.
- **Invariant (normative):** `sum(splits[i].distanceM) === round(distanceM)`. This is the acceptance test for §3 and §4 together.
- **Best-km:** the trailing partial is **not** eligible for `bestKmPaceSecPerKm` (§2.4) — only full 1000 m windows are.
- **Type change.** Adding `distanceM` to `Split` (`types.ts:66–71`) is a type-level, additive change. Making it **required** is a breaking change for anyone constructing `Split` objects (rare — it is an output type), but is correct because every emitted split can and should populate it. See §7 for the versioning consequence.

### 3.3 Edge cases

- **Exact multiple of 1000 m** (e.g. 3000.0 m): no trailing partial; last full km ends exactly at `total`. Use a small epsilon (`total - lastMark > 1e-6`) so floating-point dust does not emit a spurious 0 m split.
- **Total < 1000 m:** no full split; emit a single partial split covering the whole activity, `km: 1`, `distanceM: round(total)`. (Today this run has an empty `splits[]`; the invariant now requires the partial.)
- **`km` numbering:** the partial split takes the next integer `km` index (a 2500 m run yields `km: 1, 2, 3` where `km: 3` is the 500 m partial). It is identified as partial by `distanceM !== 1000`, not by a separate flag.

### 3.4 Worked example — trailing partial split

Four points on the equator; a 2500 m run.

| Point | lat | lon | cumulative dist | timestamp (offset s) |
|------:|----:|------------:|----------------:|---------------------:|
| p0 | 0 | 0.0000000 | 0 m    | 0   |
| p1 | 0 | 0.0089932 | 1000 m | 300 |
| p2 | 0 | 0.0179864 | 2000 m | 630 |
| p3 | 0 | 0.0224830 | 2500 m | 780 |

**Current:** `splits = [ {km:1, pace:300}, {km:2, pace:330} ]`. The final 500 m (150 s) is dropped. `sum(distance) = 2000 ≠ 2500`.

**Corrected:**

```
km 1: 0–1000 m,  300 s over 1000 m → pace 300, distanceM 1000
km 2: 1000–2000, 330 s over 1000 m → pace 330, distanceM 1000
km 3: 2000–2500, 150 s over 500 m  → pace 150/(500/1000) = 300, distanceM 500   ← partial
sum(distanceM) = 1000 + 1000 + 500 = 2500 = distanceM  ✓
```

---

## 4. Split boundaries — carry the overshoot forward

### 4.1 The defect

On crossing 1000 m the code sets `splitDistM = 0` (`analyzer.ts:136`), **discarding the overshoot** rather than carrying it into the next split. Because a segment can be tens or hundreds of metres long, the split is emitted at, say, 1043 m, and the next split starts counting from 0 at that 1043 m mark. Consequences:

1. Each split's pace is computed over `splitDistM` (e.g. 1043 m or 1400 m), **not** 1000 m — the km labels are fictional.
2. Boundaries **drift**: the *n*-th "kilometre" no longer starts at *n* km of real distance.
3. Splits do not tile the activity at true km marks.

### 4.2 Specification

Split at **exact 1000 m marks** using the interpolation of §2.3, carrying the overshoot forward:

```
mark = 0
while mark + 1000 <= total:
    t0 = timeAt(mark);  t1 = timeAt(mark + 1000)
    emit Split { km, distanceM: 1000, paceSecPerKm: round(t1 - t0), ... }
    mark += 1000
# trailing partial per §3
```

Per-split **elevation gain** and **average HR** should likewise be accumulated to the true km boundary. HR is naturally handled by weighting samples within `[mark, mark+1000)`; elevation gain per split should use the **smoothed** series of §5 (a split's gain is a slice of the activity's smoothed gain), not raw deltas — otherwise per-split gains will not sum to `elevationGainM`. Interpolating HR/elevation exactly at the metre mark is unnecessary precision; attributing whole segments to the split that contains the segment's *ending* point (consistent with §1.2) is sufficient, provided the same rule is used for the total so the parts sum to the whole.

- **Invariant:** full splits each have `distanceM === 1000`; with the §3 trailing partial, `sum(distanceM) === round(distanceM_total)`.

### 4.3 Worked example — boundary drift vs carry-forward

Four points on the equator. The first segment is a long 1400 m — it overshoots the 1 km mark by 400 m in a single step, which is exactly what triggers the drift bug.

| Point | lat | lon | cumulative dist | timestamp (offset s) |
|------:|----:|------------:|----------------:|---------------------:|
| p0 | 0 | 0.0000000 | 0 m    | 0    |
| p1 | 0 | 0.0125905 | 1400 m | 420  |
| p2 | 0 | 0.0215837 | 2400 m | 700  |
| p3 | 0 | 0.0305769 | 3400 m | 1000 |

**Current implementation** (overshoot discarded at each boundary):

```
seg p0→p1: splitDist 1400 ≥ 1000 → emit "km 1" over 1400 m, pace 420/1.4 = 300; reset to 0 (400 m lost)
seg p1→p2: splitDist 1000        → emit "km 2" over 1000 m, pace 280/1.0 = 280; reset
seg p2→p3: splitDist 1000        → emit "km 3" over 1000 m, pace 300/1.0 = 300; reset
splits = [300, 280, 300]   labelled 3 km but actually spanning 3400 m
bestKmPaceSecPerKm = 280
```

Each "km" is computed over a different distance, and three "kilometres" of splits cover 3.4 real km.

**Corrected** (exact 1 km marks, overshoot carried forward, trailing partial per §3):

```
km 1: 0–1000 m    → timeAt(1000)=420*(1000/1400)=300;               pace 300, distanceM 1000
km 2: 1000–2000 m → 1000–1400 (120 s left in seg1) + 1400–2000 (600 m of seg2 = 168 s) = 288; pace 288, distanceM 1000
km 3: 2000–3000 m → 2000–2400 (112 s left in seg2) + 2400–3000 (600 m of seg3 = 180 s) = 292; pace 292, distanceM 1000
km 4: 3000–3400 m → 120 s over 400 m → 120/(400/1000) = 300;         pace 300, distanceM 400 (partial)
sum(distanceM) = 1000+1000+1000+400 = 3400 = distanceM  ✓
```

**Best-km for this activity (independent, §2):** the fastest 1000 m window is `[1400, 2400]` = 280 s/km, so `bestKmPaceSecPerKm = 280` — here it happens to *equal* the old bucketed best, illustrating the "faster **or equal**, never slower" guarantee. Note that the corrected *splits'* fastest value is `288`, which is **not** the best-km — a reminder that best-km must come from the rolling scan, never from `min(splits.pace)`.

---

## 5. Elevation gain — smoothing before differencing

### 5.1 The defect

`elevationGainM` sums every positive delta of **raw** elevation (`analyzer.ts:108–112`). Consumer GPS altitude noise is on the order of ±3–5 m per fix even when stationary; barometric noise is smaller but non-zero. Summing raw positive deltas integrates that noise as climb, inflating gain — often by tens of percent, more on flat routes where the signal is almost all noise.

### 5.2 What the authoritative sources actually say

⚠️ **The sources disagree, and the popular "2–3 m" figure is only half-right.** The disagreement is real and is called out here rather than papered over.

- **Strava.** Smooths the elevation stream (discarding outliers) *before* computing gain, then applies a **threshold** below which a rise is not counted. The threshold is **~2 m for activities with barometric data** and **~10 m for activities without** (GPS-only). Strava also does *more* smoothing on non-barometric data. References [S1], [S2].
- **Garmin.** Total ascent is computed **on the device** and stored in the file; Garmin's algorithm is a proprietary hysteresis filter — climb is accumulated only once a running rise exceeds an (undisclosed) threshold. Garmin Connect *re-derives* elevation from a DEM for watches **without** a barometer. References [G2], [G3].
- **FIT / ANT+.** The FIT `session`/`lap` messages carry a device-computed `total_ascent` (uint16, metres). The specification's own position is therefore that the *authoritative* ascent for a FIT file is the value the device already filtered and wrote — not something a downstream tool should re-integrate from the raw altitude stream. Reference [F1].
- **GPS Visualizer** (widely-cited practitioner reference). Recommends a threshold approach and states the threshold should scale with data quality: **~2 m (6 ft) for barometric** altitude, but **~6–9 m (20–30 ft) for GPS-derived** altitude, precisely because GPS vertical noise is larger. Reference [V1].

**Where "2–3 m" comes from:** it is the *barometric* threshold (Strava's 2 m, GPS Visualizer's 6 ft ≈ 1.8 m). It is **not** appropriate for raw GPS altitude, for which every authoritative source uses a larger figure (Strava 10 m, GPS Visualizer 6–9 m). Applying 2–3 m to a GPS-only stream will still integrate most of the noise.

### 5.3 Recommendation

⚠️ **Recommended: a hysteresis threshold, with the threshold chosen by data source, and — when available — deference to the device's own figure.**

1. **If the source file already carries a device-computed total ascent** (FIT `session.total_ascent`), prefer it. It is what Garmin/Strava will agree with and it was filtered on-device. (This requires the parser to surface that field; if out of scope for this change, note it as the preferred long-term path and proceed with step 2.)
2. **Otherwise apply a hysteresis threshold** to the raw elevation series:

   ```
   gain = 0; ref = ele[first defined]
   for each subsequent defined ele e:
       if      e - ref >=  T:  gain += (e - ref); ref = e     // confirmed climb
       else if ref - e >=  T:                     ref = e     // confirmed descent, drop reference
       // else: within noise band → ignore, keep ref
   ```

   Hysteresis (rather than a plain per-delta threshold) is what Garmin does and is required so that a slow steady climb made of sub-threshold steps is still counted once the *cumulative* rise clears `T`, while oscillation within the band is rejected.

3. **Threshold value `T`:** default **`T = 3 m`**. Rationale: the library ingests predominantly GPS/FIT data whose provenance (barometric vs GPS) it cannot always determine, and 3 m sits at the top of the barometric band while still removing the bulk of per-fix GPS jitter — a deliberately conservative single default. Where the source is known to be GPS-only, a larger `T` (toward Strava's 10 m) is more faithful; expose `T` as a parameter so this is tunable rather than hard-coded. Document the default and its source.
4. **Moving-average alternative (rejected as the primary method).** Smoothing elevation with a moving average *before* differencing also reduces noise (and is what Strava does *in addition* to its threshold). It is rejected as the sole mechanism because a moving average alone still accumulates small residual positive deltas across the whole track (see the worked example: it yields 2.67 m of "gain" on a noise-only-plus-5 m signal, better than raw but with no principled zero). Hysteresis has a clean noise-rejection floor. The maintainer may layer a moving average *before* the hysteresis pass for extra robustness; that is compatible with this spec.
5. **`elevationLossM`** must use the **same** filter (accumulate confirmed descents), so gain and loss are symmetric and both denoised. Today loss has the identical raw-delta defect.

### 5.4 Edge cases

- **Missing elevation on some points:** skip to the next defined elevation; never treat `undefined` as 0.
- **No elevation anywhere:** `elevationGainM = elevationLossM = 0` (unchanged).
- **Per-split elevation gain** (`splits[].elevationGainM`) must use the **same smoothed/hysteresis pass** restricted to the split's distance range, so per-split gains sum to the total (§4.2).

### 5.5 Worked example — elevation smoothing

Seven points, one per fix, elevations in metres. The underlying truth is a gentle 5 m rise (100 → 105) buried in ±1–2 m jitter.

| Point | p0 | p1 | p2 | p3 | p4 | p5 | p6 |
|------:|---:|---:|---:|---:|---:|---:|---:|
| elevation (m) | 100 | 102 | 101 | 103 | 104 | 102 | 105 |

Raw positive deltas: `+2, +2, +1, +3` (the −1, −2 drops are ignored).

**Current implementation:** `elevationGainM = 2 + 2 + 1 + 3 = 8 m` — against a true net rise of 5 m, a 60 % over-count.

**Corrected (hysteresis, `T = 3 m`):**

```
ref=100
102: +2 (<3) ignore                     ref=100
101: −1      ignore                      ref=100
103: +3 (≥3) → gain += 3 = 3; ref=103
104: +1 (<3) ignore                      ref=103
102: −1      ignore                      ref=103
105: +2 (<3) ignore                      ref=103
elevationGainM = 3 m
```

For reference, the same input under the **rejected** alternatives:

- Hysteresis `T = 2 m`: **7 m** (barely better than raw — shows why a 2 m threshold is too small for GPS-grade jitter).
- Centred 3-point moving average, then sum positive deltas: smoothed series `[101, 101, 102, 102.667, 103, 103.667, 103.5]` → **2.667 m** (good, but no principled zero).

Chosen output: **3 m** (raw was 8 m). Direction: **down**, as it will be for essentially every real activity.

---

## 6. Which published numbers change (CHANGELOG material)

Every one of these alters output users have already seen in `≤ 0.2.2`. This section is the CHANGELOG "Changed" body.

| Metric | Before → after | Direction | Magnitude in the wild |
|--------|----------------|-----------|-----------------------|
| `hrZones.z*` | sample count → **seconds**; redistributed by time | Densely-sampled (hard) zones **shrink**; sparsely-sampled zones **grow**; the total changes from a count to real elapsed seconds | Large for smart-recorded files; ~0 for 1 Hz files |
| `bestKmPaceSecPerKm` | bucketed split → **rolling window** | **Faster or equal, never slower** — see below | A few s/km to tens of s/km faster |
| `splits[]` | drops trailing partial | **Adds** a final partial split; gains a `distanceM` field on every split | +1 split on most runs |
| `splits[].paceSecPerKm` | over drifting distance → over true 1000 m | Individual paces shift up or down | Usually small |
| `elevationGainM` / `elevationLossM` | raw deltas → **hysteresis-filtered** | **Down** (both) | Often 10–40 %; largest on flat/GPS-only |

**The "never slower" claim for best-km — confirmed.** The rolling window's minimum is taken over a superset of the positions the bucketed method could pick (every bucket boundary is also a candidate window start). A minimum over a superset is `≤` the minimum over the subset. Therefore the rolling best is always `≤` the bucketed best: **faster or equal, never slower.** The equal case is real (Example §4.3: both 280 s/km) and occurs whenever the true best km happens to align with a boundary. It is never slower.

**Elevation always drops (or is unchanged).** Hysteresis with `T > 0` accumulates a subset of the raw positive deltas, so filtered gain `≤` raw gain, always. It is never inflated by the fix.

**HR zones can move in either direction per zone**, but the *bias* is systematic: because smart recording over-samples hard efforts, high zones (`z4`/`z5`) almost always **shrink** relative to their old share and easy zones (`z2`/`z3`) **grow**. Communicate this explicitly so a user whose "z5 time" halves understands it as a correction, not a regression.

---

## 7. Versioning

**Recommendation: this is a major version bump (`1.0.0`).**

There are two independent breaking changes:

1. **A type-level break.** `Split` gains a required `distanceM` field (§3.2). Under semver, changing an exported interface that consumers may construct or exhaustively type-check is breaking.
2. **A silent semantic break, which is the more serious one.** `HeartRateZones` keeps its exact shape — five numbers — but those numbers stop meaning "sample count" and start meaning "seconds." **The type never changes; the values just start meaning something else.** A consumer that summed zones, drew a pie chart, or thresholded "minutes in z5" keeps compiling and silently produces different results. TypeScript cannot catch this; only a version signal can. The same is true, to a lesser degree, of `elevationGainM` (same type, smaller numbers) and `bestKmPaceSecPerKm` (same type, faster numbers).

**The argument for a minor bump** would be that no *removals* occur and most fields keep their names and types — one could frame this as "bug fixes" under `0.x`. Under strict semver a `0.x → 0.y` minor is even permitted to break. **That argument is rejected** because the semantic break in `hrZones` is exactly the kind of change semver's major bump exists to announce: it is invisible to the compiler and changes results for every existing consumer. Shipping it as a patch or minor would be the difference, in the words of the brief, "between a release users trust and one that looks like a regression."

Ship as **`1.0.0`**, with the §6 table as the CHANGELOG "Changed" / "BREAKING" section, and call out the `hrZones` seconds-vs-count change first and in bold.

---

## 8. References

Primary / authoritative sources only.

- **[G1]** Garmin — *About Heart Rate Zones* (Forerunner 245 owner's manual). Default 5-zone model 50/60/70/80/90 % HRmax. <https://www8.garmin.com/manuals-apac/webhelp/forerunner245245music/EN-SG/GUID-931BB1F6-0716-4387-9EB0-E6EEDBF5DD09-9894.html>
- **[G2]** Garmin Support — *How Are Elevation Readings Calculated for My Activity in Garmin Connect?* Device-computed ascent; DEM correction for non-barometric watches. <https://support.garmin.com/en-US/?faq=dRY70Lc6yv2oY3eam1ZWxA>
- **[G3]** Garmin Support — *Total Ascent, Average Ascent, and Maximum Elevation.* <https://support.garmin.com/en-US/?faq=FtXxClClew2f9R84UqglS8>
- **[S1]** Strava Support — *Elevation on Strava (FAQs).* ~2 m (barometric) / ~10 m (non-barometric) thresholds; smoothing + outlier discard. <https://support.strava.com/hc/en-us/articles/115001294564-Elevation-on-Strava-FAQs>
- **[S2]** Strava Support — *Elevation.* Smoothing before gain; more smoothing without barometric data. <https://support.strava.com/hc/en-us/articles/216919447-Elevation>
- **[S3]** Strava Support — *Best Efforts (Running).* Rolling best efforts over GPS stream; uses elapsed time. <https://support.strava.com/hc/en-us/articles/16601494390285-Best-Efforts-Running>
- **[F1]** Garmin — *FIT SDK*, `session`/`lap` message `total_ascent`/`total_descent` fields (device-computed, metres). <https://developer.garmin.com/fit/protocol/> and FIT SDK profile.
- **[V1]** GPS Visualizer — *Tutorial: Calculating Elevation Gain.* Threshold approach; ~2 m (6 ft) barometric vs ~6–9 m (20–30 ft) GPS. <https://www.gpsvisualizer.com/tutorials/elevation_gain.php>

---

## Appendix A — Fixture provenance

All worked-example distances are generated on the equator (`lat = 0`) so that haversine distance is `lon_deg × 111 319.49 m`. The `lon` values quoted (7 decimal places) reproduce the stated cumulative distances to within 0.5 m — i.e. each rounds to the exact integer metre value used in the arithmetic above. The current-vs-corrected outputs in §§1.6, 2.5, 3.4, 4.3, 5.5 were computed, not estimated, and are the **normative** expected values for the implementation's test fixtures. An example whose output the implementer changes is a spec violation, not a judgement call.
