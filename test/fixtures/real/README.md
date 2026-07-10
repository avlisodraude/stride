# Real-device fixtures

Drop real watch exports (`.fit`, `.gpx`, `.tcx`) into this directory and
`test/real-fixtures.test.js` picks them up automatically — no test code to
write. The suite asserts only universal invariants (no NaN anywhere, split
sums, source labels, `deviceDistanceM >= distanceM`, …), so any valid
activity file works. When this directory holds no activity files, the suite
skips itself.

Why: the synthetic fixtures in `test/fixtures/` are clean by construction.
Real exports carry the mess the 2.0.0 guards exist for — dropped GPS fixes,
pauses, absent fields, vendor extension quirks. One real file per format is
the goal.

Where to get them:

- **Garmin Connect** → activity → gear icon → *Export Original* (.fit) or
  *Export to GPX/TCX*
- **Strava** → activity → ⋯ → *Export Original* / *Export GPX*
- Any watch's USB mass-storage mode (`GARMIN/Activity/*.fit`)

Privacy note before committing: these files contain real GPS coordinates
(and start times). If the run starts at your front door, either pick an
activity that doesn't (a race, a park loop away from home), crop the first
few hundred metres, or shift the coordinates with a fixed offset — the
invariants tested here don't care where on Earth the track is.
