import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { SCORE_WEIGHTS } from '../../data/scenarios.js';
import { fmtNumber } from '../../lib/format.js';
import { AXIS, CURSOR } from './chartTheme.js';

function BreakdownTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload.raw;
  return (
    <div className="tooltip num">
      <div className="tooltip-title">{p.plan.fullName}</div>
      {SCORE_WEIGHTS.map((w) => (
        <div className="tooltip-row" key={w.key}>
          <span className="swatch" style={{ background: w.color }} />
          <span>
            {w.label} {fmtNumber(p.scores[w.key], 0)} × {w.weight * 100}%
          </span>
          <span>{fmtNumber(p.contributions[w.key], 1)}</span>
        </div>
      ))}
      <div className="tooltip-row" style={{ borderTop: '1px solid var(--border)', marginTop: 4, paddingTop: 4 }}>
        <span>Decision score</span>
        <span>{fmtNumber(p.composite, 1)}</span>
      </div>
    </div>
  );
}

export default function ScoreBreakdown({ result, showWeights = true }) {
  const data = [...result.plans]
    .sort((a, b) => a.rank - b.rank)
    .map((p) => ({
      name: `${p.plan.name}${p.plan.id === result.recommendedId ? ' ★' : ''}`,
      ...p.contributions,
      raw: p,
    }));

  return (
    <div>
      {showWeights && (
        <div className="weights">
          {SCORE_WEIGHTS.map((w) => (
            <div className="weight-card" key={w.key}>
              <div className="top">
                <span className="swatch" style={{ background: w.color }} />
                {w.label}
              </div>
              <b className="num">{w.weight * 100}%</b>
              <div className="weight-bar">
                <span style={{ width: `${w.weight * 250}%`, background: w.color }} />
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="chart-box sm">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ top: 0, right: 16, left: 0, bottom: 0 }} barCategoryGap="26%">
            <CartesianGrid stroke="#1d2a44" strokeDasharray="3 4" horizontal={false} />
            <XAxis type="number" domain={[0, 100]} {...AXIS} />
            <YAxis type="category" dataKey="name" {...AXIS} width={128} />
            <Tooltip content={<BreakdownTooltip />} cursor={CURSOR} />
            <Legend
              iconType="square"
              iconSize={10}
              wrapperStyle={{ fontSize: 12, color: '#b4c0d4', paddingTop: 8 }}
            />
            {SCORE_WEIGHTS.map((w, i) => (
              <Bar
                key={w.key}
                dataKey={w.key}
                name={`${w.label} (${w.weight * 100}%)`}
                stackId="score"
                fill={w.color}
                stroke="#111a2e"
                strokeWidth={2}
                radius={i === SCORE_WEIGHTS.length - 1 ? [0, 4, 4, 0] : 0}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="formula" aria-label="Decision score formula">
        score = 0.40·delay + 0.30·queue + 0.20·throughput + 0.10·spillback &nbsp;·&nbsp; each sub-score = 100 × (best ÷
        value) or (value ÷ best) for throughput, relative to the best plan in this run
      </div>
    </div>
  );
}
