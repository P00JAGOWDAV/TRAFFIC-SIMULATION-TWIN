import { useEffect, useMemo, useState } from 'react';
import { getScenario } from '../../data/scenarios.js';
import { fmtNumber, spillbackLevel } from '../../lib/format.js';

// ---------------------------------------------------------------------------
// Four-way intersection, drawn for LEFT-hand traffic (as in India).
// viewBox 400×400. Roads occupy 150–250 on both axes; each inbound half has
// two 25 px lanes. Queues are scaled from the selected plan's simulated
// peak back-of-queue; the signal phases cycle using that plan's timing,
// time-compressed 6× so a judge can watch a full cycle in ~15 seconds.
// ---------------------------------------------------------------------------

const SPEEDUP = 6;
const TICK_MS = 250;
const AMBER = 3;
const VEH_PER_SLOT = 6.5; // one drawn car ≈ 6.5 queued vehicles
const MAX_SLOTS = 5;

const QUEUE_COLORS = {
  good: '#94a3b8',
  warning: '#fbbf24',
  serious: '#fb923c',
  critical: '#f87171',
  neutral: '#94a3b8',
};

// Lane centres (inbound) and queue geometry per approach.
const LEGS = {
  N: { lanes: [237.5, 212.5], axis: 'v', stop: 134, dir: -1, signal: { x: 256, y: 98, horiz: false } },
  S: { lanes: [162.5, 187.5], axis: 'v', stop: 266, dir: 1, signal: { x: 132, y: 270, horiz: false } },
  E: { lanes: [237.5, 212.5], axis: 'h', stop: 266, dir: 1, signal: { x: 270, y: 256, horiz: true } },
  W: { lanes: [162.5, 187.5], axis: 'h', stop: 134, dir: -1, signal: { x: 98, y: 132, horiz: true } },
};

const LABELS = {
  N: { x: 262, y: 26, anchor: 'start' },
  S: { x: 138, y: 366, anchor: 'end' },
  E: { x: 392, y: 282, anchor: 'end' },
  W: { x: 8, y: 104, anchor: 'start' },
};

const DEFAULT_TIMING = { cycle: 90, greenNS: 37, greenEW: 37, lostTime: 16 };

function buildPhases(t) {
  const allRed = Math.max(1, t.lostTime / 2 - AMBER);
  return [
    { phase: 'NS', light: 'green', dur: t.greenNS },
    { phase: 'NS', light: 'amber', dur: AMBER },
    { phase: 'ALL', light: 'red', dur: allRed },
    { phase: 'EW', light: 'green', dur: t.greenEW },
    { phase: 'EW', light: 'amber', dur: AMBER },
    { phase: 'ALL', light: 'red', dur: allRed },
  ];
}

function usePhaseClock(timing) {
  const phases = useMemo(() => buildPhases(timing), [timing]);
  const cycle = phases.reduce((s, p) => s + p.dur, 0);
  const [t, setT] = useState(0);

  // When the timing changes, `% cycle` folds the clock into the new cycle.
  useEffect(() => {
    const id = setInterval(() => setT((v) => (v + (TICK_MS / 1000) * SPEEDUP) % cycle), TICK_MS);
    return () => clearInterval(id);
  }, [cycle, phases]);

  let acc = 0;
  for (const p of phases) {
    if (t < acc + p.dur) return { ...p, remaining: Math.ceil(acc + p.dur - t), cycle };
    acc += p.dur;
  }
  return { ...phases[0], remaining: phases[0].dur, cycle };
}

function Car({ cx, cy, axis, color, blocked = false }) {
  const w = axis === 'v' ? 13 : 19;
  const h = axis === 'v' ? 19 : 13;
  return (
    <g>
      <rect x={cx - w / 2} y={cy - h / 2} width={w} height={h} rx={3.5} fill={color} />
      <rect
        x={cx - w / 2 + (axis === 'v' ? 2.5 : 4)}
        y={cy - h / 2 + (axis === 'v' ? 4 : 2.5)}
        width={axis === 'v' ? w - 5 : w - 8}
        height={axis === 'v' ? h - 8 : h - 5}
        rx={2}
        fill="#0b1222"
        opacity={0.55}
      />
      {blocked && (
        <>
          <circle cx={cx - w / 2 + 2} cy={cy - h / 2 + 2} r={2.2} fill="#fbbf24" />
          <circle cx={cx + w / 2 - 2} cy={cy + h / 2 - 2} r={2.2} fill="#fbbf24" />
        </>
      )}
    </g>
  );
}

function SignalHead({ x, y, horiz, light }) {
  const lamps = ['red', 'amber', 'green'];
  const colors = { red: '#ef4444', amber: '#f59e0b', green: '#22c55e' };
  const w = horiz ? 34 : 13;
  const h = horiz ? 13 : 34;
  return (
    <g aria-hidden="true">
      <rect x={x} y={y} width={w} height={h} rx={4} fill="#05080f" stroke="#334155" />
      {lamps.map((l, i) => {
        const on = l === light;
        const cx = horiz ? x + 6.5 + i * 10.5 : x + 6.5;
        const cy = horiz ? y + 6.5 : y + 6.5 + i * 10.5;
        return (
          <circle
            key={l}
            className="signal-lamp"
            cx={cx}
            cy={cy}
            r={4}
            fill={on ? colors[l] : '#1e293b'}
            style={on ? { filter: `drop-shadow(0 0 4px ${colors[l]})` } : undefined}
          />
        );
      })}
    </g>
  );
}

// Position of the i-th queued car (0 = at the stop line).
function queuePos(leg, laneCenter, i) {
  const offset = 4 + 11 + i * 24;
  return leg.axis === 'v'
    ? { cx: laneCenter, cy: leg.stop + leg.dir * offset }
    : { cx: leg.stop + leg.dir * offset, cy: laneCenter };
}

export default function IntersectionDiagram({ result, planId, scenarioId }) {
  const scenario = getScenario(result?.meta.scenarioId ?? scenarioId);
  const planResult = result?.plans.find((p) => p.plan.id === (planId ?? result.recommendedId));
  const timing = planResult?.timing ?? DEFAULT_TIMING;
  const clock = usePhaseClock(timing);

  const lightFor = (phase) => {
    if (clock.phase === phase) return clock.light;
    return 'red';
  };

  const approaches = planResult?.approaches ?? [];
  const byId = Object.fromEntries(approaches.map((a) => [a.id, a]));
  const phaseLabel =
    clock.phase === 'ALL' ? 'All-red clearance' : `${clock.phase === 'NS' ? 'North–South' : 'East–West'} ${clock.light}`;

  return (
    <div className="diagram-wrap">
      <svg
        className="diagram-svg"
        viewBox="0 0 400 400"
        role="img"
        aria-labelledby="diagram-title diagram-desc"
      >
        <title id="diagram-title">Four-way intersection — synthetic simulation view</title>
        <desc id="diagram-desc">
          {planResult
            ? `${planResult.plan.fullName}. ${phaseLabel}. Peak queues per lane: ${approaches
                .map((a) => `${a.label} ${a.queuePerLane} vehicles`)
                .join(', ')}.`
            : 'No simulation has been run yet; signals cycle with the baseline 90 second plan.'}
        </desc>

        <defs>
          <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
            <path d="M20 0H0V20" fill="none" stroke="#132038" strokeWidth="1" />
          </pattern>
          <pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="3" height="6" fill="#ef4444" opacity="0.55" />
          </pattern>
        </defs>

        {/* ground */}
        <rect width="400" height="400" fill="#0a1222" />
        <rect width="400" height="400" fill="url(#grid)" />

        {/* sidewalks */}
        <rect x="142" y="0" width="116" height="400" fill="#18233a" />
        <rect x="0" y="142" width="400" height="116" fill="#18233a" />

        {/* roads */}
        <rect x="150" y="0" width="100" height="400" fill="var(--road)" />
        <rect x="0" y="150" width="400" height="100" fill="var(--road)" />

        {/* centre lines (double yellow) and lane dividers, outside the box */}
        {[
          ['M198.5 0V134', 'M201.5 0V134'],
          ['M198.5 266V400', 'M201.5 266V400'],
          ['M0 198.5H134', 'M0 201.5H134'],
          ['M266 198.5H400', 'M266 201.5H400'],
        ].map((pair) =>
          pair.map((d) => <path key={d} d={d} stroke="#eab308" strokeWidth="1.5" opacity="0.8" />),
        )}
        {['M175 0V134', 'M225 0V134', 'M175 266V400', 'M225 266V400', 'M0 175H134', 'M0 225H134', 'M266 175H400', 'M266 225H400'].map(
          (d) => (
            <path key={d} d={d} stroke="var(--lane-mark)" strokeWidth="1.5" strokeDasharray="10 10" />
          ),
        )}

        {/* crosswalks */}
        {Array.from({ length: 9 }).map((_, i) => (
          <g key={i} fill="#cbd5e1" opacity="0.32">
            <rect x={154 + i * 11} y="138" width="6" height="10" />
            <rect x={154 + i * 11} y="252" width="6" height="10" />
            <rect x="138" y={154 + i * 11} width="10" height="6" />
            <rect x="252" y={154 + i * 11} width="10" height="6" />
          </g>
        ))}

        {/* stop lines on inbound halves */}
        <path d="M200 134H250" stroke="#e2e8f0" strokeWidth="2.5" />
        <path d="M150 266H200" stroke="#e2e8f0" strokeWidth="2.5" />
        <path d="M266 200V250" stroke="#e2e8f0" strokeWidth="2.5" />
        <path d="M134 150V200" stroke="#e2e8f0" strokeWidth="2.5" />

        {/* queued vehicles */}
        {Object.entries(LEGS).map(([id, leg]) => {
          const a = byId[id];
          const blockedCount = scenario.blockedLanes[id] ?? 0;
          const tone = a ? spillbackLevel(a.spillback).tone : 'neutral';
          const green = lightFor(id === 'N' || id === 'S' ? 'NS' : 'EW') === 'green';
          return leg.lanes.map((laneCenter, laneIdx) => {
            const isBlocked = laneIdx < blockedCount;
            if (isBlocked) {
              const p = queuePos(leg, laneCenter, 1);
              const w = leg.axis === 'v' ? 22 : 64;
              const h = leg.axis === 'v' ? 64 : 22;
              return (
                <g key={`${id}-${laneIdx}`}>
                  <rect
                    x={p.cx - w / 2}
                    y={p.cy - h / 2}
                    width={w}
                    height={h}
                    rx="3"
                    fill="url(#hatch)"
                    stroke="#ef4444"
                    strokeOpacity="0.6"
                  />
                  <Car {...queuePos(leg, laneCenter, 0)} axis={leg.axis} color="#dc2626" blocked />
                </g>
              );
            }
            if (!a) return null;
            let slots = Math.min(MAX_SLOTS, Math.ceil(a.queuePerLane / VEH_PER_SLOT));
            if (green) slots = Math.max(0, slots - 1); // front of queue discharging
            const overflow = a.queuePerLane / VEH_PER_SLOT > MAX_SLOTS;
            return (
              <g key={`${id}-${laneIdx}`}>
                {Array.from({ length: slots }).map((_, i) => (
                  <Car
                    key={i}
                    {...queuePos(leg, laneCenter, i + (green ? 1 : 0))}
                    axis={leg.axis}
                    color={QUEUE_COLORS[tone]}
                  />
                ))}
                {overflow && (
                  <text
                    x={leg.axis === 'v' ? laneCenter : leg.dir > 0 ? 396 : 4}
                    y={leg.axis === 'v' ? (leg.dir > 0 ? 397 : 9) : laneCenter + 4}
                    textAnchor={leg.axis === 'v' ? 'middle' : leg.dir > 0 ? 'end' : 'start'}
                    fontSize="10"
                    fontWeight="700"
                    fill={QUEUE_COLORS[tone]}
                  >
                    {leg.axis === 'v' ? '▲▼'[leg.dir > 0 ? 1 : 0] : '◀▶'[leg.dir > 0 ? 1 : 0]}
                  </text>
                )}
              </g>
            );
          });
        })}

        {/* moving vehicles on the green approaches */}
        {Object.entries(LEGS).map(([id, leg]) => {
          const phase = id === 'N' || id === 'S' ? 'NS' : 'EW';
          if (lightFor(phase) !== 'green') return null;
          const blockedCount = scenario.blockedLanes[id] ?? 0;
          return leg.lanes.map((laneCenter, laneIdx) =>
            laneIdx < blockedCount
              ? null
              : [0, 1].map((k) => {
                  const start =
                    leg.axis === 'v'
                      ? { cx: laneCenter, cy: leg.stop - leg.dir * 12 }
                      : { cx: leg.stop - leg.dir * 12, cy: laneCenter };
                  return (
                    <g
                      key={`${id}-${laneIdx}-${k}-${clock.phase}`}
                      className={`car-flow flow-${id}`}
                      style={{ animationDelay: `${-k * 1.2 - laneIdx * 0.5}s` }}
                    >
                      <Car {...start} axis={leg.axis} color="#e2e8f0" />
                    </g>
                  );
                }),
          );
        })}

        {/* signals */}
        {Object.entries(LEGS).map(([id, leg]) => (
          <SignalHead key={id} {...leg.signal} light={lightFor(id === 'N' || id === 'S' ? 'NS' : 'EW')} />
        ))}

        {/* approach labels */}
        {Object.entries(LABELS).map(([id, l]) => {
          const a = byId[id];
          const tone = a ? spillbackLevel(a.spillback).tone : 'neutral';
          return (
            <g key={id}>
              <text x={l.x} y={l.y} textAnchor={l.anchor} fontSize="12" fontWeight="700" fill="#e6edf7">
                {getLegName(id)}
                {scenario.blockedLanes[id] ? ' · 1 lane blocked' : ''}
              </text>
              <text x={l.x} y={l.y + 14} textAnchor={l.anchor} fontSize="10.5" fill={a ? QUEUE_COLORS[tone] : '#8a99b4'}>
                {a
                  ? `${fmtNumber(a.queuePerLane, 1)} veh/lane · ${fmtNumber(a.demand)} veh/h`
                  : `${fmtNumber(scenario.demand[id])} veh/h nominal`}
              </text>
            </g>
          );
        })}

        {/* centre readout */}
        <g>
          <rect x="166" y="186" width="68" height="28" rx="7" fill="#05080f" stroke="#334155" opacity="0.92" />
          <text x="200" y="198" textAnchor="middle" fontSize="8.5" fill="#8a99b4" letterSpacing="0.06em">
            {clock.phase === 'ALL' ? 'ALL RED' : `${clock.phase} ${clock.light.toUpperCase()}`}
          </text>
          <text x="200" y="209.5" textAnchor="middle" fontSize="10.5" fontWeight="700" fill="#e6edf7">
            {clock.remaining}s
          </text>
        </g>
      </svg>

      <div className="diagram-legend">
        <span className="phase-chip num">
          <i style={{ background: clock.light === 'green' ? '#22c55e' : clock.light === 'amber' ? '#f59e0b' : '#ef4444' }} />
          {phaseLabel} · {clock.remaining}s left · cycle {timing.cycle}s
        </span>
        <span className="legend-item">
          <span className="swatch" style={{ background: QUEUE_COLORS.good }} /> Queue low
        </span>
        <span className="legend-item">
          <span className="swatch" style={{ background: QUEUE_COLORS.warning }} /> Elevated
        </span>
        <span className="legend-item">
          <span className="swatch" style={{ background: QUEUE_COLORS.critical }} /> Spillback likely
        </span>
        <span className="legend-item">1 car ≈ {VEH_PER_SLOT} queued veh · left-hand traffic · 6× speed</span>
      </div>
    </div>
  );
}

function getLegName(id) {
  return { N: 'North', S: 'South', E: 'East', W: 'West' }[id];
}
