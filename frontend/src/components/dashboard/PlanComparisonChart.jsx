import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { fmtNumber } from '../../lib/format.js';
import { AXIS, CURSOR, GRID, ROLE_COLORS } from './chartTheme.js';

const METRICS = [
  { key: 'delay', label: 'Delay', unit: 's/veh', dp: 1, better: 'lower' },
  { key: 'queue', label: 'Max queue', unit: 'veh/lane', dp: 1, better: 'lower' },
  { key: 'throughput', label: 'Throughput', unit: 'veh/h', dp: 0, better: 'higher' },
  { key: 'spillback', label: 'Spillback', unit: '%', dp: 0, better: 'lower' },
  { key: 'composite', label: 'Score', unit: '/ 100', dp: 1, better: 'higher' },
];

const roleOf = (p, result) =>
  p.plan.id === result.recommendedId ? 'recommended' : p.plan.isBaseline ? 'baseline' : 'other';

function ChartTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload.raw;
  return (
    <div className="tooltip num">
      <div className="tooltip-title">{p.plan.fullName}</div>
      <div className="tooltip-row"><span>Avg delay</span><span>{fmtNumber(p.metrics.delay, 1)} s/veh</span></div>
      <div className="tooltip-row"><span>Max queue</span><span>{fmtNumber(p.metrics.queue, 1)} veh/lane</span></div>
      <div className="tooltip-row"><span>Throughput</span><span>{fmtNumber(p.metrics.throughput)} veh/h</span></div>
      <div className="tooltip-row"><span>Spillback risk</span><span>{fmtNumber(p.metrics.spillback, 0)}%</span></div>
      <div className="tooltip-row"><span>Decision score</span><span>{fmtNumber(p.composite, 1)}</span></div>
      <div className="tooltip-row"><span>Cycle</span><span>{p.timing.cycle} s</span></div>
    </div>
  );
}

export default function PlanComparisonChart({ result, compact = false }) {
  const [metric, setMetric] = useState('delay');
  const [view, setView] = useState('chart');
  const m = METRICS.find((x) => x.key === metric);

  const data = result.plans.map((p) => ({
    name: p.plan.name,
    value: metric === 'composite' ? p.composite : p.metrics[metric],
    role: roleOf(p, result),
    raw: p,
  }));

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
        <div className="segmented" role="group" aria-label="Metric">
          {METRICS.map((x) => (
            <button key={x.key} type="button" aria-pressed={metric === x.key} onClick={() => setMetric(x.key)}>
              {x.label}
            </button>
          ))}
        </div>
        <div className="segmented" role="group" aria-label="View" style={{ marginLeft: 'auto' }}>
          <button type="button" aria-pressed={view === 'chart'} onClick={() => setView('chart')}>
            Chart
          </button>
          <button type="button" aria-pressed={view === 'table'} onClick={() => setView('table')}>
            Table
          </button>
        </div>
      </div>

      {view === 'chart' ? (
        <>
          <div className="chart-legend">
            <span className="legend-item"><span className="swatch" style={{ background: ROLE_COLORS.recommended }} />Recommended</span>
            <span className="legend-item"><span className="swatch" style={{ background: ROLE_COLORS.baseline }} />Baseline (current)</span>
            <span className="legend-item"><span className="swatch" style={{ background: ROLE_COLORS.other }} />Alternatives</span>
            <span style={{ marginLeft: 'auto', color: 'var(--muted)' }}>
              {m.unit} · {m.better} is better
            </span>
          </div>
          <div className={`chart-box ${compact ? 'sm' : ''}`}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} margin={{ top: 22, right: 8, left: -8, bottom: 0 }} barCategoryGap="28%">
                <CartesianGrid {...GRID} />
                <XAxis dataKey="name" {...AXIS} interval={0} />
                <YAxis {...AXIS} width={52} domain={metric === 'composite' || metric === 'spillback' ? [0, 100] : [0, 'auto']} />
                <Tooltip content={<ChartTooltip />} cursor={CURSOR} />
                <Bar dataKey="value" radius={[4, 4, 0, 0]} maxBarSize={64} isAnimationActive>
                  {data.map((d) => (
                    <Cell key={d.name} fill={ROLE_COLORS[d.role]} />
                  ))}
                  <LabelList
                    dataKey="value"
                    position="top"
                    fill="#e6edf7"
                    fontSize={12}
                    fontWeight={600}
                    formatter={(v) => fmtNumber(v, m.dp)}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </>
      ) : (
        <div className="table-wrap">
          <table className="table num">
            <caption className="sr-only">Simulated performance of each signal plan</caption>
            <thead>
              <tr>
                <th scope="col">Plan</th>
                <th scope="col">Cycle</th>
                <th scope="col">Delay (s)</th>
                <th scope="col">LOS</th>
                <th scope="col">Queue (veh/ln)</th>
                <th scope="col">Throughput</th>
                <th scope="col">Spillback</th>
                <th scope="col">Score</th>
              </tr>
            </thead>
            <tbody>
              {[...result.plans]
                .sort((a, b) => a.rank - b.rank)
                .map((p) => (
                  <tr key={p.plan.id} className={p.plan.id === result.recommendedId ? 'is-rec' : ''}>
                    <th scope="row" style={{ fontWeight: 600 }}>
                      <span className="plan-cell">
                        {p.plan.name}
                        {p.plan.id === result.recommendedId && <span className="tag tag-rec">Recommended</span>}
                        {p.plan.isBaseline && <span className="tag tag-base">Baseline</span>}
                      </span>
                    </th>
                    <td>
                      {p.timing.cycleRange[0] === p.timing.cycleRange[1]
                        ? `${p.timing.cycle} s`
                        : `${p.timing.cycleRange[0]}–${p.timing.cycleRange[1]} s`}
                    </td>
                    <td>{fmtNumber(p.metrics.delay, 1)}</td>
                    <td><span className={`los los-${p.los}`}>{p.los}</span></td>
                    <td>{fmtNumber(p.metrics.queue, 1)}</td>
                    <td>{fmtNumber(p.metrics.throughput)}</td>
                    <td>{fmtNumber(p.metrics.spillback, 0)}%</td>
                    <td><b>{fmtNumber(p.composite, 1)}</b></td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
