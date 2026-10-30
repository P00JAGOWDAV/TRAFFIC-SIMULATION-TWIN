import { ArrowDownRight, ArrowUpRight, Car, Clock, Minus, Layers, Waves } from 'lucide-react';
import { changeTone, fmtNumber, fmtSigned, pctChange, spillbackLevel } from '../../lib/format.js';

const KPIS = [
  {
    key: 'delay',
    label: 'Average Delay',
    icon: Clock,
    unit: 's/veh',
    dp: 1,
    weight: '40%',
    direction: 'lower',
    accent: '#3b82f6',
  },
  {
    key: 'queue',
    label: 'Maximum Queue',
    icon: Layers,
    unit: 'veh/lane',
    dp: 1,
    weight: '30%',
    direction: 'lower',
    accent: '#d97706',
  },
  {
    key: 'throughput',
    label: 'Throughput',
    icon: Car,
    unit: 'veh/h',
    dp: 0,
    weight: '20%',
    direction: 'higher',
    accent: '#a855f7',
  },
  {
    key: 'spillback',
    label: 'Spillback Risk',
    icon: Waves,
    unit: '%',
    dp: 0,
    weight: '10%',
    direction: 'lower',
    accent: '#0d9488',
  },
];

function Delta({ value, base, direction, isPoints }) {
  const delta = isPoints ? value - base : pctChange(value, base);
  const tone = changeTone(delta, direction);
  const Icon = Math.abs(delta) < 0.5 ? Minus : delta < 0 ? ArrowDownRight : ArrowUpRight;
  return (
    <span className={`delta tone-${tone} num`}>
      <Icon size={13} aria-hidden="true" />
      {isPoints ? fmtSigned(delta, 0, ' pts') : fmtSigned(delta, 0, '%')}
    </span>
  );
}

export default function KpiCards({ result, status }) {
  const rec = result?.plans.find((p) => p.plan.id === result.recommendedId);
  const base = result?.plans.find((p) => p.plan.id === result.baselineId);
  const loading = status === 'running';

  return (
    <div className="grid grid-kpi" role="list" aria-label="Key performance indicators for the recommended plan">
      {KPIS.map((k) => {
        const Icon = k.icon;
        const value = rec?.metrics[k.key];
        const level = k.key === 'spillback' && rec ? spillbackLevel(value) : null;
        return (
          <article key={k.key} className="panel kpi" role="listitem" style={{ '--kpi-accent': k.accent }}>
            <div className="kpi-top">
              <Icon size={16} aria-hidden="true" />
              {k.label}
              <span className="kpi-weight">weight {k.weight}</span>
            </div>

            {loading ? (
              <>
                <div className="skeleton" style={{ height: 32, width: '60%', marginTop: 10 }} />
                <div className="skeleton" style={{ height: 16, width: '80%', marginTop: 12 }} />
              </>
            ) : rec ? (
              <>
                <div className="kpi-value num">
                  {fmtNumber(value, k.dp)}
                  <span className="kpi-unit">{k.unit}</span>
                </div>
                <div className="kpi-foot num">
                  <Delta
                    value={value}
                    base={base.metrics[k.key]}
                    direction={k.direction}
                    isPoints={k.key === 'spillback'}
                  />
                  <span>
                    vs baseline {fmtNumber(base.metrics[k.key], k.dp)}
                    {k.key === 'spillback' ? '%' : ''}
                  </span>
                  {level && <span className={`delta tone-${level.tone}`}>{level.label}</span>}
                  {k.key === 'queue' && <span>· {rec.metrics.queueApproach} leg, ≈{rec.metrics.queueM} m</span>}
                  {k.key === 'delay' && <span>· LOS {rec.los}</span>}
                </div>
              </>
            ) : (
              <>
                <div className="kpi-value num" style={{ color: 'var(--muted)' }}>
                  —<span className="kpi-unit">{k.unit}</span>
                </div>
                <div className="kpi-foot">Run a simulation to populate</div>
              </>
            )}
          </article>
        );
      })}
    </div>
  );
}
