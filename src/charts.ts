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

import type { Activity, ActivityStats, ChartOptions } from './types.js'
import type { ChartConfiguration } from 'chart.js'
import { formatPace } from './analyzer.js'

const GREEN = 'rgba(34,197,94,1)'
const GREEN_FILL = 'rgba(34,197,94,0.15)'
const BLUE = 'rgba(59,130,246,1)'
const BLUE_FILL = 'rgba(59,130,246,0.15)'
const RED = 'rgba(239,68,68,1)'
const ORANGE = 'rgba(249,115,22,1)'
const YELLOW = 'rgba(234,179,8,1)'
const PURPLE = 'rgba(168,85,247,1)'

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
      labels: splits.map(s => `km ${s.km}`),
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
  const sampled = pts.filter((_, i) => i % step === 0)

  // Compute cumulative distance labels
  let cumDist = 0
  const labels: string[] = []
  for (let i = 0; i < sampled.length; i++) {
    if (i > 0) {
      const prev = sampled[i - 1]
      const curr = sampled[i]
      const d = Math.sqrt(
        Math.pow((curr.lat - prev.lat) * 111_000, 2) +
        Math.pow((curr.lon - prev.lon) * 111_000, 2)
      )
      cumDist += d
    }
    const distKm = cumDist / 1000
    labels.push(units === 'imperial'
      ? `${(distKm * 0.621371).toFixed(1)} mi`
      : `${distKm.toFixed(1)} km`)
  }

  const elevData = sampled.map(p =>
    units === 'imperial' ? +((p.elevation! * 3.28084).toFixed(1)) : +(p.elevation!.toFixed(1))
  )

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

export function hrZonesChartConfig(stats: ActivityStats): ChartConfiguration {
  const zones = stats.hrZones
  if (!zones) throw new Error('No heart rate data available for zone chart')

  return {
    type: 'doughnut',
    data: {
      labels: ['Z1 Easy', 'Z2 Aerobic', 'Z3 Tempo', 'Z4 Threshold', 'Z5 Max'],
      datasets: [{
        data: [zones.z1, zones.z2, zones.z3, zones.z4, zones.z5],
        backgroundColor: [BLUE, GREEN, YELLOW, ORANGE, RED],
        borderWidth: 0,
      }],
    },
    options: {
      responsive: true,
      plugins: {
        title: { display: true, text: 'Heart rate zones' },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const total = [zones.z1, zones.z2, zones.z3, zones.z4, zones.z5].reduce((a, b) => a + b, 0)
              const pct = total > 0 ? ((ctx.parsed / total) * 100).toFixed(1) : '0'
              return `${ctx.label}: ${pct}%`
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
      labels: splits.map(s => `km ${s.km}`),
      datasets: [{
        label: 'Split pace',
        data: splits.map(s => +(s.paceSecPerKm / 60).toFixed(2)),
        backgroundColor: splits.map(s =>
          s.paceSecPerKm <= avgPace ? GREEN : ORANGE
        ),
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
