'use client'

import { Sparkles, Activity, HeartPulse, Droplet, Moon, Heart, Scale, Wind, ArrowUp, ArrowDown, ArrowRight } from 'lucide-react'
import { Card } from '../ui/Card'
import { PanelHeader } from '../ui/PanelHeader'
import { KpiCard } from '../ui/KpiCard'
import { st, MMOL_TO_MGDL } from '../thresholds'
import type { DailyMetricRow, LatestKpis, FingerstickPoint } from '@/app/lib/dashboard/daily-metrics'

interface Props {
  series: DailyMetricRow[]      // already range-sliced
  latest: LatestKpis
  glucoseUnit: 'mmol/L' | 'mg/dL'
  rangeDays: number
  /** Recent fingersticks — used as the glucose KPI fallback when CGM is stale. */
  fingersticks?: FingerstickPoint[]
}

const FINGERSTICK_SOURCE_LABEL: Record<string, string> = {
  contour: 'Contour',
  manual: 'Manual log',
}

function fmtAgo(time: Date): string {
  const dt = Date.now() - time.getTime()
  const h = 60 * 60 * 1000
  if (dt < h) return `${Math.max(1, Math.round(dt / 60000))}m ago`
  if (dt < 24 * h) return `${Math.round(dt / h)}h ago`
  return `${Math.round(dt / (24 * h))}d ago`
}

function take<T>(rows: T[], k: number): T[] {
  return rows.slice(-k)
}

function nullable(v: number | null | undefined): React.ReactNode {
  if (v === null || v === undefined) return '—'
  return v
}

export function TodayAtAGlance({ series, latest, glucoseUnit, rangeDays, fingersticks = [] }: Props) {
  const recoverySpark = take(series, 16).map((d) => d.recovery).filter((v): v is number => v !== null)
  const sysSpark = take(series, 16).map((d) => d.sys).filter((v): v is number => v !== null)
  const sleepSpark = take(series, 16).map((d) => d.sleep_total).filter((v): v is number => v !== null)
  const rhrSpark = take(series, 16).map((d) => d.rhr).filter((v): v is number => v !== null)
  const weightSpark = take(series, 16).map((d) => d.weight).filter((v): v is number => v !== null)
  const spo2MinSpark = take(series, 16).map((d) => d.spo2_min).filter((v): v is number => v !== null)

  // Weight delta over range — based on first & last non-null in the slice
  const weightFirst = series.find((d) => d.weight !== null)?.weight ?? null
  const weightLast = [...series].reverse().find((d) => d.weight !== null)?.weight ?? null
  const weightDelta = weightFirst !== null && weightLast !== null ? +(weightLast - weightFirst).toFixed(1) : null

  const toG = (mmol: number) => (glucoseUnit === 'mmol/L' ? +mmol.toFixed(1) : Math.round(mmol * MMOL_TO_MGDL))

  // ─── Glucose KPI: CGM if live, fingerstick fallback otherwise ─────────
  // Mirrors the GlucosePanel's branching so the top-of-dashboard tile stays
  // useful when CGM is stale and only fingersticks are populated.
  const fingersticksNewestFirst = [...fingersticks].reverse()
  const latestFingerstick = fingersticksNewestFirst[0] ?? null
  const cgmLive = latest.cgm !== null
  const glucoseValueMmol = cgmLive ? latest.cgm!.value : latestFingerstick?.mmol ?? null
  const glucoseStatus = st.glucose(glucoseValueMmol)
  const glucoseValue = cgmLive && latest.cgm
    ? (
        <span className="kpi-glucose">
          {toG(latest.cgm.value)}
          <span className="g-arrow">
            {latest.cgm.trendDir === 'rising' ? <ArrowUp size={16} /> : latest.cgm.trendDir === 'falling' ? <ArrowDown size={16} /> : <ArrowRight size={16} />}
          </span>
        </span>
      )
    : latestFingerstick
      ? toG(latestFingerstick.mmol)
      : '—'
  const glucoseSub = cgmLive
    ? 'CGM · live'
    : latestFingerstick
      ? `${fmtAgo(latestFingerstick.time)} · ${FINGERSTICK_SOURCE_LABEL[latestFingerstick.source] ?? latestFingerstick.source}`
      : 'No recent CGM'
  // Sparkline: in fallback, draw the recent fingerstick trail so the tile
  // still says something at a glance. CGM-live path stays empty (the big
  // 24h chart is the place for that trend).
  const glucoseSpark: number[] = cgmLive
    ? []
    : fingersticks.map((fs) => toG(fs.mmol))

  return (
    <Card className="col-12 glance-card">
      <PanelHeader
        icon={<Sparkles size={18} />}
        title="Today at a glance"
        accent="var(--teal)"
        right={<span className="muted-note">Latest readings</span>}
      />
      <div className="kpi-grid">
        <KpiCard
          icon={<Activity size={17} />}
          label="Recovery"
          value={nullable(latest.recovery?.value ?? null)}
          unit={latest.recovery ? '%' : undefined}
          status={st.recovery(latest.recovery?.value ?? null)}
          spark={recoverySpark}
          sub="Whoop"
        />
        <KpiCard
          icon={<HeartPulse size={17} />}
          label="Blood pressure"
          value={latest.bp ? `${latest.bp.sys}/${latest.bp.dia}` : '—'}
          unit={latest.bp ? 'mmHg' : undefined}
          status={st.bp(latest.bp?.sys ?? null, latest.bp?.dia ?? null)}
          spark={sysSpark}
          sub="Withings · manual"
        />
        <KpiCard
          icon={<Droplet size={17} />}
          label="Glucose"
          value={glucoseValue}
          unit={glucoseValueMmol !== null ? glucoseUnit : undefined}
          status={glucoseStatus}
          spark={glucoseSpark}
          sparkColor="var(--purple)"
          sub={glucoseSub}
        />
        <KpiCard
          icon={<Moon size={17} />}
          label="Sleep"
          value={latest.sleep ? +latest.sleep.total.toFixed(1) : '—'}
          unit={latest.sleep ? 'h' : undefined}
          status={st.sleep(latest.sleep?.total ?? null)}
          spark={sleepSpark}
          sparkColor="var(--purple)"
          sub={latest.sleep && latest.sleep.performance ? `${Math.round(latest.sleep.performance)}% performance` : 'Whoop'}
        />
        <KpiCard
          icon={<Heart size={17} />}
          label="Resting HR"
          value={nullable(latest.rhr?.value ?? null)}
          unit={latest.rhr ? 'bpm' : undefined}
          status={st.rhr(latest.rhr?.value ?? null)}
          spark={rhrSpark}
          sub="Whoop"
        />
        <KpiCard
          icon={<Scale size={17} />}
          label="Weight"
          value={latest.weight ? +latest.weight.value.toFixed(1) : '—'}
          unit={latest.weight ? 'kg' : undefined}
          status="good"
          spark={weightSpark}
          deltaText={weightDelta !== null ? `${Math.abs(weightDelta)} kg` : undefined}
          deltaDir={weightDelta !== null ? (weightDelta <= 0 ? 'down' : 'up') : undefined}
          deltaGood={weightDelta !== null ? weightDelta <= 0 : undefined}
          sub={`${rangeDays}d trend`}
        />
        <KpiCard
          icon={<Wind size={17} />}
          label="Min SpO2"
          value={latest.spo2 ? Math.round(latest.spo2.min) : '—'}
          unit={latest.spo2 ? '%' : undefined}
          status={st.spo2(latest.spo2?.min ?? null)}
          spark={spo2MinSpark}
          sub={latest.spo2 ? 'overnight · Oxylink' : 'Oxylink'}
        />
      </div>
    </Card>
  )
}
