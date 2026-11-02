/**
 * Chart.js config builders for Stride.
 *
 * This module is intentionally side-effect free — it returns plain Chart.js
 * config objects. The caller is responsible for instantiating Chart.js, which
 * allows use in any environment (browser, Node canvas, etc.) and keeps the
 * library tree-shakeable.
 *
 * Usage:
 *   import { Chart } from 'chart.js/auto'
 *   import { paceChartConfig } from '@alosha/stride/charts'
 *   new Chart(canvas, paceChartConfig(activity, stats))
 */

import type { Activity, ActivityStats, ChartOptions, Split } from './types.js'
import type { ChartConfiguration } from 'chart.js'
import { formatPace, formatDuration } from './analyzer.js'
import { cumulativeDistances, cumulativeDistanceSeries } from './geo.js'

interface ProfileReading { x: number; y: number; span: number }

// Retain both endpoints and each bucket's minimum/maximum in original order.
// Uniform sampling can erase a short effort or summit completely. Span IDs
// survive selection, so omitted readings can never reconnect separate runs.
function sampleProfile(readings: ProfileReading[]): ProfileReading[] {
  const limit = 200
  if (readings.length <= limit) return readings
  const selected = new Set<number>([0, readings.length - 1])
  const buckets = (limit - 2) / 2
  const interior = readings.length - 2
  for (let bucket = 0; bucket < buckets; bucket++) {
    const start = 1 + Math.floor(bucket * interior / buckets)
    const end = 1 + Math.floor((bucket + 1) * interior / buckets)
    let min = start
    let max = start
    for (let i = start + 1; i < end; i++) {
      if (readings[i].y < readings[min].y) min = i
      if (readings[i].y > readings[max].y) max = i
    }
    selected.add(min)
    selected.add(max)
  }
  return [...selected].sort((a, b) => a - b).map(i => readings[i])
}

function profileData(
  activity: Activity, stats: ActivityStats, field: 'elevation' | 'heartRate',
  units: 'metric' | 'imperial',
): { x: number; y: number }[][] {
  const points = activity.points
  // Preserve the full route and its origin before selecting sensor readings.
  const cumDist = stats.distanceSource === 'device'
    ? cumulativeDistanceSeries(points).cumDist
    : cumulativeDistances(points)
  const origin = points.find(p => p.timestamp != null)?.timestamp?.getTime() ?? 0
  const useTime = stats.distanceSource === 'unavailable'
  const hasTime = points.some(p => p.timestamp != null)
  let span = 0
  const readings: ProfileReading[] = []
  for (let i = 0; i < points.length; i++) {
    const p = points[i]
    if (p.segmentStart) span++
    // Missing values (including time needed by a time-axis profile) end a
    // sensor run. Filtering them out without a marker would bridge the gap.
    if (p[field] == null || (useTime && hasTime && p.timestamp == null)) { span++; continue }
    readings.push({
      x: useTime ? (hasTime ? (p.timestamp!.getTime() - origin) / 60000 : i) : cumDist[i] / (units === 'imperial' ? 1609.344 : 1000),
      y: p[field]! * (field === 'elevation' && units === 'imperial' ? 3.28084 : 1),
      span,
    })
  }
  const series: { x: number; y: number }[][] = [[]]
  let previousSpan: number | undefined
  for (const reading of sampleProfile(readings)) {
    if (previousSpan != null && reading.span !== previousSpan) series.push([])
    series[series.length - 1].push({ x: reading.x, y: reading.y })
    previousSpan = reading.span
  }
  return series
}

const GREEN = 'rgba(34,197,94,1)'
const GREEN_FILL = 'rgba(34,197,94,0.15)'
const BLUE = 'rgba(59,130,246,1)'
const BLUE_FILL = 'rgba(59,130,246,0.15)'
const RED = 'rgba(239,68,68,1)'
const ORANGE = 'rgba(249,115,22,1)'
const YELLOW = 'rgba(234,179,8,1)'

// Fades an `rgba(...,1)` constant to a lower alpha, used to visually mark the
// trailing partial split's bar as "less than the others" rather than letting
// it read as a full kilometre.
function fade(rgba: string, alpha: number): string {
  return rgba.replace(/,1\)$/, `,${alpha})`)
}

// A partial split's `distanceM` differs from 1000 (see types.ts) — label it
// distinctly so a chart never presents it as if a full kilometre were run.
function splitLabel(split: Split, units: 'metric' | 'imperial'): string {
  const label = (split.targetDistanceM ?? 1000) === 1000 ? `km ${split.km}` : (split.targetDistanceM === 1609.344 ? `mi ${split.index}` : `Split ${split.index}`)
  if (!(split.isPartial ?? split.distanceM !== 1000)) return label
  const partialDist = units === 'imperial'
    ? `${(split.distanceM / 1609.34).toFixed(2)} mi`
    : `${(split.distanceM / 1000).toFixed(2)} km`
  return `${label} (${partialDist})`
}

// ---------------------------------------------------------------------------
// Pace over distance
// ---------------------------------------------------------------------------

export function paceChartConfig(
  activity: Activity,
  stats: ActivityStats,
  opts: ChartOptions = {}
): ChartConfiguration {
  const units = opts.units ?? 'metric'
  const splits = stats.splits

  return {
    type: 'line',
    data: {
      labels: splits.map(s => splitLabel(s, units)),
      datasets: [{
        label: `Pace (${units === 'metric' ? 'min/km' : 'min/mi'})`,
        data: splits.map(s => +(s.paceSecPerKm / 60).toFixed(2)),
        borderColor: GREEN,
        backgroundColor: GREEN_FILL,
        fill: true,
        tension: 0.3,
        pointRadius: 4,
      }],
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: false },
        title: { display: true, text: (stats.splitDistanceM ?? 1000) === 1000 ? 'Pace per km' : 'Pace per split' },
        tooltip: {
          callbacks: {
            label: (ctx) => ctx.parsed.y != null ? formatPace(ctx.parsed.y * 60, units) : '',
          },
        },
      },
      scales: {
        y: {
          reverse: true, // lower pace = faster = top of chart
          ticks: {
            callback: (v) => formatPace(Number(v) * 60, units),
          },
        },
      },
    },
  }
}

// ---------------------------------------------------------------------------
// Elevation profile
// ---------------------------------------------------------------------------

export function elevationChartConfig(
  activity: Activity,
  stats: ActivityStats,
  opts: ChartOptions = {}
): ChartConfiguration {
  const units = opts.units ?? 'metric'

  return {
    type: 'line',
    data: {
      datasets: profileData(activity, stats, 'elevation', units).map(data => ({
        label: `Elevation (${units === 'imperial' ? 'ft' : 'm'})`,
        data,
        spanGaps: false,
        borderColor: BLUE,
        backgroundColor: BLUE_FILL,
        fill: true,
        tension: 0.2,
        pointRadius: data.length === 1 ? 2 : 0,
        borderWidth: 1.5,
      })),
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: false },
        title: { display: true, text: 'Elevation profile' },
      },
      scales: {
        x: {
          type: 'linear',
          title: { display: true, text: stats.distanceSource === 'unavailable' ? (activity.points.some(p => p.timestamp != null) ? 'Elapsed time (min)' : 'Sample index') : units === 'imperial' ? 'Distance (mi)' : 'Distance (km)' },
          ticks: { maxTicksLimit: 8 },
        },
      },
    },
  }
}

// ---------------------------------------------------------------------------
// Heart rate over distance
// ---------------------------------------------------------------------------

export function heartRateChartConfig(
  activity: Activity,
  stats: ActivityStats,
  opts: ChartOptions = {}
): ChartConfiguration {
  const units = opts.units ?? 'metric'

  return {
    type: 'line',
    data: {
      datasets: profileData(activity, stats, 'heartRate', units).map(data => ({
        label: 'Heart rate (bpm)',
        data,
        spanGaps: false,
        borderColor: RED,
        backgroundColor: 'rgba(239,68,68,0.1)',
        fill: true,
        tension: 0.3,
        pointRadius: data.length === 1 ? 2 : 0,
        borderWidth: 1.5,
      })),
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: false },
        title: { display: true, text: 'Heart rate' },
      },
      scales: {
        x: {
          type: 'linear',
          title: { display: true, text: stats.distanceSource === 'unavailable' ? (activity.points.some(p => p.timestamp != null) ? 'Elapsed time (min)' : 'Sample index') : units === 'imperial' ? 'Distance (mi)' : 'Distance (km)' },
          ticks: { maxTicksLimit: 8 },
        },
      },
    },
  }
}

// ---------------------------------------------------------------------------
// HR zone doughnut
// ---------------------------------------------------------------------------

// A GPX/TCX/FIT file with no heart rate data is ordinary input (many watches
// don't pair a strap), not an error condition — so this returns a usable,
// all-zero placeholder chart rather than throwing. A caller rendering a
// dashboard of several charts gets a clearly-labelled empty doughnut instead
// of a crash that takes the rest of the dashboard down with it.
export function hrZonesChartConfig(stats: ActivityStats): ChartConfiguration {
  const zones = stats.hrZones ?? { z1: 0, z2: 0, z3: 0, z4: 0, z5: 0 }
  const zoneValues = [zones.z1, zones.z2, zones.z3, zones.z4, zones.z5]

  return {
    type: 'doughnut',
    data: {
      labels: ['Z1 Easy', 'Z2 Aerobic', 'Z3 Tempo', 'Z4 Threshold', 'Z5 Max'],
      datasets: [{
        data: zoneValues,
        backgroundColor: [BLUE, GREEN, YELLOW, ORANGE, RED],
        borderWidth: 0,
      }],
    },
    options: {
      responsive: true,
      plugins: {
        title: {
          display: true,
          text: stats.hrZones
            ? 'Heart rate zones'
            : ['Heart rate zones', 'No heart rate data recorded'],
        },
        tooltip: {
          callbacks: {
            // Zones are seconds (as of 1.0.0, not sample counts) — show them
            // as minutes:seconds, which is friendlier than a bare number of
            // seconds, alongside the share of HR-covered time it represents.
            label: (ctx) => {
              const total = zoneValues.reduce((a, b) => a + b, 0)
              const pct = total > 0 ? ((ctx.parsed / total) * 100).toFixed(1) : '0'
              return `${ctx.label}: ${formatDuration(ctx.parsed)} (${pct}%)`
            },
          },
        },
      },
    },
  }
}

// ---------------------------------------------------------------------------
// Splits bar chart
// ---------------------------------------------------------------------------

export function splitsChartConfig(
  stats: ActivityStats,
  opts: ChartOptions = {}
): ChartConfiguration {
  const units = opts.units ?? 'metric'
  const splits = stats.splits
  const avgPace = stats.avgPaceSecPerKm

  return {
    type: 'bar',
    data: {
      labels: splits.map(s => splitLabel(s, units)),
      datasets: [{
        label: 'Split pace',
        data: splits.map(s => +(s.paceSecPerKm / 60).toFixed(2)),
        // Trailing partial split's bar is faded to signal "less than the
        // others" visually, on top of its distinct label.
        backgroundColor: splits.map(s => {
          const base = s.paceSecPerKm <= avgPace ? GREEN : ORANGE
          return (s.isPartial ?? s.distanceM !== 1000) ? fade(base, 0.5) : base
        }),
        borderRadius: 4,
      }],
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: false },
        title: { display: true, text: 'Splits (green = faster than avg)' },
        tooltip: {
          callbacks: {
            label: (ctx) => ctx.parsed.y != null ? formatPace(ctx.parsed.y * 60, units) : '',
          },
        },
      },
      scales: {
        y: {
          reverse: true,
          ticks: { callback: (v) => formatPace(Number(v) * 60, units) },
        },
      },
    },
  }
}
