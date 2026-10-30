import { useMemo } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Award, List, Loader, ShieldAlert, ShieldCheck, TrendingDown } from 'lucide-react';
import Panel from '../components/common/Panel.jsx';
import MockBadge from '../components/common/MockBadge.jsx';
import { EmptyState } from '../components/common/StatusStates.jsx';
import { SIGNAL_PLANS, SERIES_COLORS } from '../data/scenarios.js';
import { fmtNumber, spillbackLevel } from '../lib/format.js';
import { AXIS, CURSOR, GRID } from '../components/dashboard/chartTheme.js';

function summarise(results) {
  return SIGNAL_PLANS.map((plan) => {
    const rows = results.map((r) => r.plans.find((p) => p.plan.id === plan.id));
    const scores = rows.map((p) => p.composite);
    return {
      plan,
      wins: results.filter((r) => r.recommendedId === plan.id).length,
      avgScore: scores.reduce((a, b) => a + b, 0) / scores.length,
      worstScore: Math.min(...scores),
      worstSpillback: Math.max(...rows.map((p) => p.metrics.spillback)),
      worstDelay: Math.max(...rows.map((p) => p.metrics.delay)),
    };
  });
}

function DelayTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return (
    <div className="tooltip num">
      <div className="tooltip-title">{label}</div>
      <div className="tooltip-row">
        <span className="swatch" style={{ background: SERIES_COLORS.baseline }} />
        <span>Baseline (Fixed-Time)</span>
        <span>{fmtNumber(row.baseline, 1)} s</span>
      </div>
      <div className="tooltip-row">
        <span className="swatch" style={{ background: SERIES_COLORS.recommended }} />
        <span>{row.recName}</span>
        <span>{fmtNumber(row.recommended, 1)} s</span>
      </div>
    </div>
  );
}

export default function StressTestPage({ sim }) {
  const { stress, stressStatus, runStress } = sim;
  const running = stressStatus === 'running';
  const summary = useMemo(() => (stress ? summarise(stress.results) : []), [stress]);
  const robust = summary.length ? [...summary].sort((a, b) => b.avgScore - a.avgScore)[0] : null;

  const runBtn = (
    <button type="button" className="btn btn-primary" onClick={runStress} disabled={running} aria-busy={running}>
      {running ? <Loader size={16} className="spin" aria-hidden="true" /> : <ShieldAlert size={16} aria-hidden="true" />}
      {running ? 'Running 5 scenarios…' : stress ? 'Re-run stress test' : 'Run stress test'}
    </button>
  );

  if (!stress || running) {
    return (
      <Panel title="Stress testing" subtitle="Run every plan against all five scenarios" icon={ShieldAlert} actions={<MockBadge />}>
        {running ? (
          <div className="empty" role="status" aria-live="polite">
            <span className="empty-icon" aria-hidden="true"><Loader size={24} className="spin" /></span>
            <h3>Evaluating 4 plans × 5 scenarios</h3>
            <p>Using one shared synthetic demand draw per scenario.</p>
          </div>
        ) : (
          <EmptyState
            icon={ShieldAlert}
            title="No stress test yet"
            message="Check which signal plan stays robust across Normal, Peak, Uneven Demand, Traffic Surge and Blocked Lane conditions."
          />
        )}
        {!running && <div style={{ display: 'flex', justifyContent: 'center', paddingBottom: 12 }}>{runBtn}</div>}
      </Panel>
    );
  }

  const delayData = stress.results.map((r) => {
    const base = r.plans.find((p) => p.plan.id === r.baselineId);
    const rec = r.plans.find((p) => p.plan.id === r.recommendedId);
    return { scenario: r.meta.scenarioName, baseline: base.metrics.delay, recommended: rec.metrics.delay, recName: rec.plan.name };
  });

  return (
    <>
      <Panel
        title="Robustness summary"
        subtitle={`All plans × all scenarios · run #${stress.runNumber}`}
        icon={Award}
        actions={
          <>
            <MockBadge />
            {runBtn}
          </>
        }
      >
        <div className="robust-grid">
          {summary.map((s) => {
            const lvl = spillbackLevel(s.worstSpillback);
            const top = s.plan.id === robust.plan.id;
            return (
              <div key={s.plan.id} className={`robust-card ${top ? 'top-pick' : ''}`}>
                <h4>
                  {s.plan.name}
                  {top && (
                    <span className="tag tag-rec">
                      <ShieldCheck size={11} aria-hidden="true" /> Most robust
                    </span>
                  )}
                  {s.plan.isBaseline && <span className="tag tag-base">Baseline</span>}
                </h4>
                <div className="robust-stats num">
                  <div>Scenario wins<b>{s.wins} / {stress.results.length}</b></div>
                  <div>Avg score<b>{fmtNumber(s.avgScore, 1)}</b></div>
                  <div>Worst score<b>{fmtNumber(s.worstScore, 1)}</b></div>
                  <div>
                    Worst spillback
                    <b>
                      {fmtNumber(s.worstSpillback, 0)}% <span className={`delta tone-${lvl.tone}`}>{lvl.label}</span>
                    </b>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </Panel>

      <div className="stack">
        <Panel title="Score matrix" subtitle="Decision score per scenario (★ = scenario winner)" icon={List} actions={<MockBadge />}>
          <div className="table-wrap">
            <table className="table matrix num">
              <caption className="sr-only">Decision score of each plan in each scenario</caption>
              <thead>
                <tr>
                  <th scope="col">Scenario</th>
                  {SIGNAL_PLANS.map((p) => (
                    <th scope="col" key={p.id}>{p.name}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {stress.results.map((r) => (
                  <tr key={r.meta.scenarioId}>
                    <th scope="row" style={{ fontWeight: 600 }}>{r.meta.scenarioName}</th>
                    {SIGNAL_PLANS.map((plan) => {
                      const p = r.plans.find((x) => x.plan.id === plan.id);
                      const win = r.recommendedId === plan.id;
                      return (
                        <td key={plan.id} className={`cell-score ${win ? 'cell-win' : ''}`}>
                          {fmtNumber(p.composite, 1)}
                          {win ? ' ★' : ''}
                          <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 500 }}>
                            {fmtNumber(p.metrics.delay, 0)} s · LOS {p.los}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel title="Delay: baseline vs scenario winner" subtitle="Average control delay, s/veh" icon={TrendingDown} actions={<MockBadge />}>
          <div className="chart-legend">
            <span className="legend-item"><span className="swatch" style={{ background: SERIES_COLORS.baseline }} />Baseline (Fixed-Time)</span>
            <span className="legend-item"><span className="swatch" style={{ background: SERIES_COLORS.recommended }} />Recommended plan for that scenario</span>
          </div>
          <div className="chart-box">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={delayData} margin={{ top: 8, right: 8, left: -8, bottom: 0 }} barGap={2} barCategoryGap="24%">
                <CartesianGrid {...GRID} />
                <XAxis dataKey="scenario" {...AXIS} interval={0} tick={{ ...AXIS.tick, fontSize: 11 }} />
                <YAxis {...AXIS} width={48} />
                <Tooltip content={<DelayTooltip />} cursor={CURSOR} />
                <Bar dataKey="baseline" fill={SERIES_COLORS.baseline} radius={[4, 4, 0, 0]} maxBarSize={36} />
                <Bar dataKey="recommended" fill={SERIES_COLORS.recommended} radius={[4, 4, 0, 0]} maxBarSize={36} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="chart-note">
            The blocked-lane case shows why a fixed plan is fragile: losing one lane pushes the east approach past capacity.
          </p>
        </Panel>
      </div>
    </>
  );
}
