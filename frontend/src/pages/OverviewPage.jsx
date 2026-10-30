import { GitCompare, Crosshair, Lightbulb, ListChecks, SlidersHorizontal } from 'lucide-react';
import Panel from '../components/common/Panel.jsx';
import MockBadge from '../components/common/MockBadge.jsx';
import StaleBanner from '../components/common/StaleBanner.jsx';
import { ResultGate } from '../components/common/StatusStates.jsx';
import KpiCards from '../components/dashboard/KpiCards.jsx';
import ScenarioSelector from '../components/dashboard/ScenarioSelector.jsx';
import IntersectionDiagram from '../components/dashboard/IntersectionDiagram.jsx';
import RecommendationPanel from '../components/dashboard/RecommendationPanel.jsx';
import PlanComparisonChart from '../components/dashboard/PlanComparisonChart.jsx';
import ScoreBreakdown from '../components/dashboard/ScoreBreakdown.jsx';

export default function OverviewPage({ sim }) {
  const { scenarioId, setScenarioId, result, status, step, run } = sim;
  const gate = { status, result, step, onRun: run };

  return (
    <>
      <Panel
        id="scenario"
        title="Traffic scenario"
        subtitle="Choose the synthetic demand pattern to test"
        icon={SlidersHorizontal}
        actions={<MockBadge label="Synthetic demand" />}
      >
        <ScenarioSelector value={scenarioId} onChange={setScenarioId} disabled={status === 'running'} />
      </Panel>

      <StaleBanner result={result} scenarioId={scenarioId} onRun={run} running={status === 'running'} />

      <KpiCards result={result} status={status} />

      <div className="grid grid-main">
        <Panel
          id="intersection"
          title="Intersection digital twin"
          subtitle={
            result
              ? `Live view of the recommended plan — ${result.meta.scenarioName}`
              : 'Signals cycling on the current fixed-time plan'
          }
          icon={Crosshair}
          actions={<MockBadge />}
        >
          <IntersectionDiagram result={status === 'running' ? null : result} scenarioId={scenarioId} />
        </Panel>

        <Panel
          id="recommendation"
          title="Recommendation"
          subtitle="Best plan by weighted decision score"
          icon={Lightbulb}
          actions={<MockBadge />}
        >
          <ResultGate {...gate}>{result && <RecommendationPanel result={result} />}</ResultGate>
        </Panel>
      </div>

      <div className="grid grid-2">
        <Panel
          id="comparison"
          title="Signal-plan comparison"
          subtitle="Four candidate plans under identical synthetic demand"
          icon={GitCompare}
          actions={<MockBadge />}
        >
          <ResultGate {...gate}>{result && <PlanComparisonChart result={result} compact />}</ResultGate>
        </Panel>
        <Panel
          id="breakdown"
          title="Decision-score breakdown"
          subtitle="How each metric contributes to the final score"
          icon={ListChecks}
          actions={<MockBadge />}
        >
          <ResultGate {...gate}>{result && <ScoreBreakdown result={result} showWeights={false} />}</ResultGate>
        </Panel>
      </div>
    </>
  );
}
