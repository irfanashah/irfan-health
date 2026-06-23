'use client'

import { Sparkles, Activity, HeartPulse, Droplet, Moon, Heart, Scale, Wind, ArrowUp, ArrowDown, ArrowRight } from 'lucide-react'
import { Card } from '../ui/Card'
import { PanelHeader } from '../ui/PanelHeader'
import { KpiCard } from '../ui/KpiCard'
import { st, MMOL_TO_MGDL } from '../thresholds'
import type { DailyMetricRow } from '@/app/lib/dashboard/daily-metrics'
import type { LatestKpis } from '@/app/lib/dashboard/daily-metrics'

interface Props {
  series: DailyMetricRow[]      // already range-sliced
  latest: LatestKpis
  glucoseUnit: 'mmol/L' | 'mg/dL'
  rangeDays: number
}

function take<T>(rows: T[], k: number): T[] {
  return rows.slice(-k)
}

function nullable(v: number | null | undefined): React.ReactNode {
  if (v === null || v === undefined) return '—'
  return v
}

export function TodayAtAGlance({ series, latest, glucoseUnit, rangeDays }: Props) {
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

  const glucoseValue = latest.cgm
    ? (
        <span className="kpi-glucose">
          {toG(latest.cgm.value)}
          <span className="g-arrow">
            {latest.cgm.trendDir === 'rising' ? <ArrowUp size={16} /> : latest.cgm.trendDir === 'falling' ? <ArrowDown size={16} /> : <ArrowRight size={16} />}
          </span>
        </span>
      )
    : '—'

  const glucoseSpark: number[] = [] // 24h CGM spark goes in the Glucose panel; KPI is just latest + arrow

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
          unit={latest.cgm ? glucoseUnit : undefined}
          status={st.glucose(latest.cgm?.value ?? null)}
          spark={glucoseSpark}
          sparkColor="var(--purple)"
          sub={latest.cgm ? 'CGM · live' : 'No recent CGM'}
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
