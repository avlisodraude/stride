// zoneModel: %HRmax vs heart-rate reserve (Karvonen), on the same activity.
//
// Both models bucket samples into the same five zones with the same default
// boundaries [0.6, 0.7, 0.8, 0.9] — what differs is the percentage a given
// heart rate maps to:
//
//   hrmax:    pct = hr / maxHR                                (default)
//   reserve:  pct = (hr - restingHR) / (maxHR - restingHR)    (Karvonen)
//
// For the same beat, the reserve percentage is always lower, so time shifts
// toward lower zones relative to %HRmax. Run both on one file to see the
// distribution actually move.
import { parseFile, analyze } from '@alosha/stride'

const activity = await parseFile(new URL('../test/fixtures/sample-run.tcx', import.meta.url).pathname)

const hrmax = analyze(activity, {
  maxHR: 190,
  zoneModel: { type: 'hrmax' }, // the default — spelled out for the comparison
})

const reserve = analyze(activity, {
  maxHR: 190,
  zoneModel: { type: 'reserve', restingHR: 50 },
})

const row = (label, z) =>
  console.log(`${label}  z1=${z.z1}s  z2=${z.z2}s  z3=${z.z3}s  z4=${z.z4}s  z5=${z.z5}s`)

row('hrmax  ', hrmax.hrZones)
row('reserve', reserve.hrZones)

// Custom boundaries work on either model. They must be strictly increasing
// and each strictly between 0 and 1 — anything else throws instead of
// silently mis-bucketing:
try {
  analyze(activity, { zoneModel: { type: 'hrmax', boundaries: [0.7, 0.6, 0.8, 0.9] } })
} catch (err) {
  console.log(`invalid boundaries throw: ${err.message}`)
}

// Output (node examples/02-zone-models.mjs, after npm run build at the repo root):
//
// hrmax    z1=0s  z2=160s  z3=293s  z4=147s  z5=0s
// reserve  z1=164s  z2=167s  z3=225s  z4=44s  z5=0s
// invalid boundaries throw: Invalid HR zone boundaries [0.7, 0.6, 0.8, 0.9]: boundaries must be strictly increasing.
