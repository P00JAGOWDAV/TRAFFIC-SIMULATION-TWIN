import { Scale, ArrowDownRight, ArrowUpRight, Check, Minus, ShieldCheck, Trophy } from 'lucide-react';
import { changeTone, fmtNumber, fmtSigned } from '../../lib/format.js';

const ROWS = [
  { key: 'delay', label: 'Avg delay', unit: 's', dp: 1, dir: 'lower' },
  { key: 'queue', label: 'Max queue', unit: 'veh', dp: 1, dir: 'lower' },
  { key: 'throughput', label: 'Throughput', unit: 'veh/h', dp: 0, dir: 'higher' },
  { key: 'spillback', label: 'Spillback', unit: '%', dp: 0, dir: 'lower', points: true },
];

const CONFIDENCE_TONE = { High: 'good', Moderate: 'warning', Low: 'serious' };

export default function RecommendationPanel({ result }) {
  const rec = result.plans.find((p) => p.plan.id === result.recommendedId);
  const base = result.plans.find((p) => p.plan.id === result.baselineId);
  const runnerUp = result.plans.find((p) => p.plan.id === result.recommendation.runnerUpId);
  const { deltas, reasons, tradeoffs, confidence, margin } = result.recommendation;
  const same = rec.plan.id === base.plan.id;

  return (
    <div>
      <div className="rec-hero">
        <span className="rec-badge" aria-hidden="true">
          <Trophy size={22} />
        </span>
        <div style={{ minWidth: 0 }}>
          <div className="rec-meta">Recommended signal plan</div>
          <div className="rec-name">{rec.plan.fullName}</div>
          <div className="rec-meta num">
            Cycle {rec.timing.cycleRange[0] === rec.timing.cycleRange[1] ? `${rec.timing.cycle} s` : `${rec.timing.cycleRange[0]}–${rec.timing.cycleRange[1]} s (adaptive)`}
            {' · '}N–S {rec.timing.greenNS} s / E–W {rec.timing.greenEW} s green · LOS {rec.los}
          </div>
        </div>
        <div className="rec-score num">
          <b>{fmtNumber(rec.composite, 1)}</b>
          <span>decision score</span>
          <div style={{ marginTop: 6 }}>
            <span className={`delta tone-${CONFIDENCE_TONE[confidence]} confidence`}>
              <ShieldCheck size={12} aria-hidden="true" />
              {confidence} · +{fmtNumber(margin, 1)} vs {runnerUp.plan.name}
            </span>
          </div>
        </div>
      </div>

      <div className="list-title" style={{ marginTop: 16 }}>
        <Scale size={14} aria-hidden="true" /> vs baseline ({base.plan.name}, {base.timing.cycle} s)
      </div>
      <div className="compare-grid num">
        {ROWS.map((r) => {
          const d = deltas[r.key];
          const tone = same ? 'neutral' : changeTone(d, r.dir);
          const Icon = Math.abs(d) < 0.5 ? Minus : d < 0 ? ArrowDownRight : ArrowUpRight;
          return (
            <div className="compare-cell" key={r.key}>
              <div className="lbl">{r.label}</div>
              <div className="vals">
                <span>{fmtNumber(base.metrics[r.key], r.dp)}</span> →{' '}
                <b>{fmtNumber(rec.metrics[r.key], r.dp)}</b> <span style={{ fontSize: 11 }}>{r.unit}</span>
              </div>
              <span className={`delta tone-${tone}`}>
                <Icon size={12} aria-hidden="true" />
                {r.points ? fmtSigned(d, 0, ' pts') : fmtSigned(d, 0, '%')}
              </span>
            </div>
          );
        })}
      </div>

      <div className="list-title">
        <Check size={14} aria-hidden="true" /> Why this plan
      </div>
      <ul className="bullets good">
        {reasons.map((r) => (
          <li key={r}>
            <Check size={15} aria-hidden="true" />
            <span>{r}</span>
          </li>
        ))}
      </ul>

      <div className="list-title">
        <Scale size={14} aria-hidden="true" /> Trade-offs &amp; caveats
      </div>
      <ul className="bullets warn">
        {tradeoffs.map((t) => (
          <li key={t}>
            <Scale size={15} aria-hidden="true" />
            <span>{t}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
