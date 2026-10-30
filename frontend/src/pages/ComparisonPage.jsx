import { GitCompare, Lightbulb, ListChecks } from 'lucide-react';
import Panel from '../components/common/Panel.jsx';
import MockBadge from '../components/common/MockBadge.jsx';
import StaleBanner from '../components/common/StaleBanner.jsx';
import { ResultGate } from '../components/common/StatusStates.jsx';
import PlanComparisonChart from '../components/dashboard/PlanComparisonChart.jsx';
import ScoreBreakdown from '../components/dashboard/ScoreBreakdown.jsx';
import RecommendationPanel from '../components/dashboard/RecommendationPanel.jsx';
import { fmtNumber } from '../lib/format.js';
import { SCORE_WEIGHTS } from '../data/scenarios.js';

function SubScoreTable({ result }) {
  return (
    <div className="table-wrap" style={{ marginTop: 16 }}>
      <table className="table num">
        <caption className="sr-only">Sub-scores and weighted contributions per plan</caption>
        <thead>
          <tr>
            <th scope="col">Plan</th>
            {SCORE_WEIGHTS.map((w) => (
              <th scope="col" key={w.key}>
                {w.label} ({w.weight * 100}%)
              </th>
            ))}
            <th scope="col">Score</th>
            <th scope="col">Rank</th>
          </tr>
        </thead>
        <tbody>
          {[...result.plans]
            .sort((a, b) => a.rank - b.rank)
            .map((p) => (
              <tr key={p.plan.id} className={p.plan.id === result.recommendedId ? 'is-rec' : ''}>
                <th scope="row" style={{ fontWeight: 600 }}>{p.plan.name}</th>
                {SCORE_WEIGHTS.map((w) => (
                  <td key={w.key}>
                    {fmtNumber(p.scores[w.key], 0)} <span style={{ color: 'var(--muted)' }}>→ {fmtNumber(p.contributions[w.key], 1)}</span>
                  </td>
                ))}
                <td><b>{fmtNumber(p.composite, 1)}</b></td>
                <td>#{p.rank}</td>
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
}

export default function ComparisonPage({ sim }) {
  const { scenarioId, result, status, step, run } = sim;
  const gate = { status, result, step, onRun: run };
  const ready = status !== 'running' && result;

  return (
    <>
      <StaleBanner result={result} scenarioId={scenarioId} onRun={run} running={status === 'running'} />

      <Panel
        title="Signal-plan comparison"
        subtitle={ready ? `${result.meta.scenarioName} · run #${result.meta.runNumber} · identical demand for all plans` : 'Four candidate plans'}
        icon={GitCompare}
        actions={<MockBadge />}
      >
        <ResultGate {...gate}>{ready && <PlanComparisonChart result={result} />}</ResultGate>
      </Panel>

      <div className="grid grid-2">
        <Panel
          title="Explainable decision score"
          subtitle="Delay 40% · Queue 30% · Throughput 20% · Spillback 10%"
          icon={ListChecks}
          actions={<MockBadge />}
        >
          <ResultGate {...gate}>
            {ready && (
              <>
                <ScoreBreakdown result={result} />
                <SubScoreTable result={result} />
              </>
            )}
          </ResultGate>
        </Panel>
        <Panel title="Recommendation" subtitle="Reasons and trade-offs" icon={Lightbulb} actions={<MockBadge />}>
          <ResultGate {...gate}>{ready && <RecommendationPanel result={result} />}</ResultGate>
        </Panel>
      </div>
    </>
  );
}
