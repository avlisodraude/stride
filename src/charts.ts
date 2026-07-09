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
 *   import { paceChartConfig } from '@alosha/stride'
 *   new Chart(canvas, paceChartConfig(activity, stats))
 */

import type { Activity, ActivityStats, ChartOptions, Split } from './types.js'
import type { ChartConfiguration } from 'chart.js'
import { formatPace, formatDuration } from './analyzer.js'
import { cumulativeDistances } from './geo.js'

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
  if (split.distanceM === 1000) return `km ${split.km}`
  const partialDist = units === 'imperial'
    ? `${(split.distanceM / 1609.34).toFixed(2)} mi`
    : `${(split.distanceM / 1000).toFixed(2)} km`
  return `km ${split.km} (${partialDist})`
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
        title: { display: true, text: 'Pace per km' },
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
  _stats: ActivityStats,
  opts: ChartOptions = {}
): ChartConfiguration {
  const units = opts.units ?? 'metric'

  // Downsample to max 200 points for performance
  const pts = activity.points.filter(p => p.elevation != null)
  const step = Math.max(1, Math.floor(pts.length / 200))

  // Cumulative distance over every point (see src/geo.ts) — sampling below
  // indexes into this, rather than summing chords of the decimated points,
  // which would undercount the true path length. Uses the same haversine
  // maths as analyze(), so this chart's distance axis never disagrees with
  // stats.distanceM.
  const cumDist = cumulativeDistances(pts)

  const labels: string[] = []
  const elevData: number[] = []
  for (let i = 0; i < pts.length; i += step) {
    const distKm = cumDist[i] / 1000
    labels.push(units === 'imperial'
      ? `${(distKm * 0.621371).toFixed(1)} mi`
      : `${distKm.toFixed(1)} km`)

    const elevation = pts[i].elevation!
    elevData.push(units === 'imperial' ? +(elevation * 3.28084).toFixed(1) : +elevation.toFixed(1))
  }

  return {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: `Elevation (${units === 'imperial' ? 'ft' : 'm'})`,
        data: elevData,
        borderColor: BLUE,
        backgroundColor: BLUE_FILL,
        fill: true,
        tension: 0.2,
        pointRadius: 0,
        borderWidth: 1.5,
      }],
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: false },
        title: { display: true, text: 'Elevation profile' },
      },
      scales: {
        x: { ticks: { maxTicksLimit: 8 } },
      },
    },
  }
}

// ---------------------------------------------------------------------------
// Heart rate over distance
// ---------------------------------------------------------------------------

export function heartRateChartConfig(
  activity: Activity,
  _stats: ActivityStats,
): ChartConfiguration {
  const pts = activity.points.filter(p => p.heartRate != null)
  const step = Math.max(1, Math.floor(pts.length / 200))
  const sampled = pts.filter((_, i) => i % step === 0)

  return {
    type: 'line',
    data: {
      labels: sampled.map((_, i) => `${i + 1}`),
      datasets: [{
        label: 'Heart rate (bpm)',
        data: sampled.map(p => p.heartRate!),
        borderColor: RED,
        backgroundColor: 'rgba(239,68,68,0.1)',
        fill: true,
        tension: 0.3,
        pointRadius: 0,
        borderWidth: 1.5,
      }],
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: false },
        title: { display: true, text: 'Heart rate' },
      },
      scales: { x: { display: false } },
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
          return s.distanceM === 1000 ? base : fade(base, 0.5)
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
