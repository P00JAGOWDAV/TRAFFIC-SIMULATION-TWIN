import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { GEOMETRY, getPlan } from '../../data/scenarios.js';
import { fmtNumber } from '../../lib/format.js';
import { AXIS, ROLE_COLORS } from './chartTheme.js';

const STORAGE = GEOMETRY.storageLengthM / GEOMETRY.vehicleSpacingM;

function TimelineTooltip({ active, payload, label, planName }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return (
    <div className="tooltip num">
      <div className="tooltip-title">Minute {label} · demand ×{row.demandFactor.toFixed(2)}</div>
      {payload.map((p) => (
        <div className="tooltip-row" key={p.dataKey}>
          <span className="line-swatch" style={{ borderColor: p.color }} />
          <span>{p.dataKey === 'fixed' ? 'Baseline' : planName}</span>
          <span>{fmtNumber(p.value, 1)} veh/lane</span>
        </div>
      ))}
    </div>
  );
}

export default function QueueTimelineChart({ result, planId }) {
  const plan = getPlan(planId);
  const showBaseline = planId !== result.baselineId;
  const color =
    planId === result.recommendedId
      ? ROLE_COLORS.recommended
      : planId === result.baselineId
        ? ROLE_COLORS.baseline
        : '#a855f7';

  return (
    <div>
      <div className="chart-legend">
        <span className="legend-item">
          <span className="line-swatch" style={{ borderColor: color }} />
          {plan.name}
        </span>
        {showBaseline && (
          <span className="legend-item">
            <span className="line-swatch dashed" style={{ borderColor: ROLE_COLORS.baseline }} />
            Baseline (Fixed-Time)
          </span>
        )}
        <span className="legend-item">
          <span className="line-swatch dashed" style={{ borderColor: '#ef4444' }} />
          Storage limit ({Math.round(STORAGE)} veh)
        </span>
      </div>
      <div className="chart-box sm">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={result.timeline} margin={{ top: 8, right: 16, left: -8, bottom: 0 }}>
            <CartesianGrid stroke="#1d2a44" strokeDasharray="3 4" vertical={false} />
            <XAxis dataKey="minute" {...AXIS} tickFormatter={(m) => `${m}′`} />
            <YAxis {...AXIS} width={48} />
            <Tooltip content={<TimelineTooltip planName={plan.name} />} cursor={{ stroke: '#475569' }} />
            <ReferenceLine y={STORAGE} stroke="#ef4444" strokeDasharray="5 5" strokeOpacity={0.7} />
            {showBaseline && (
              <Line
                type="monotone"
                dataKey="fixed"
                stroke={ROLE_COLORS.baseline}
                strokeWidth={2}
                strokeDasharray="6 4"
                dot={false}
                activeDot={{ r: 5, stroke: '#111a2e', strokeWidth: 2 }}
              />
            )}
            <Line
              type="monotone"
              dataKey={planId}
              stroke={color}
              strokeWidth={2.5}
              dot={{ r: 3, fill: color, stroke: '#111a2e', strokeWidth: 2 }}
              activeDot={{ r: 6, stroke: '#111a2e', strokeWidth: 2 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="chart-note">
        Worst-lane back-of-queue in each 5-minute interval of the {result.meta.horizonMin}-minute synthetic horizon.
        Queues above the red line would spill back into the upstream junction.
      </p>
    </div>
  );
}
