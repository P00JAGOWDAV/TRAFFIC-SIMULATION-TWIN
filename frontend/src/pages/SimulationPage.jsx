import { useState } from 'react';
import { Crosshair, TrendingUp as LineIcon, List, Timer } from 'lucide-react';
import Panel from '../components/common/Panel.jsx';
import MockBadge from '../components/common/MockBadge.jsx';
import StaleBanner from '../components/common/StaleBanner.jsx';
import { ResultGate } from '../components/common/StatusStates.jsx';
import IntersectionDiagram from '../components/dashboard/IntersectionDiagram.jsx';
import QueueTimelineChart from '../components/dashboard/QueueTimelineChart.jsx';
import SignalTimingBars from '../components/dashboard/SignalTimingBars.jsx';
import ApproachTable from '../components/dashboard/ApproachTable.jsx';
import ScenarioSelector from '../components/dashboard/ScenarioSelector.jsx';

export default function SimulationPage({ sim }) {
  const { scenarioId, setScenarioId, result, status, step, run } = sim;
  const [pickedId, setPickedId] = useState(null);
  const ready = status !== 'running' && result;
  // Fall back to the recommended plan whenever a new result arrives.
  const planId = ready && result.plans.some((p) => p.plan.id === pickedId) ? pickedId : result?.recommendedId;
  const planResult = ready ? result.plans.find((p) => p.plan.id === planId) : null;
  const gate = { status, result, step, onRun: run };

  const planPicker = ready && (
    <div className="segmented" role="group" aria-label="Plan to display">
      {result.plans.map((p) => (
        <button key={p.plan.id} type="button" aria-pressed={p.plan.id === planId} onClick={() => setPickedId(p.plan.id)}>
          {p.plan.name}
          {p.plan.id === result.recommendedId ? ' ★' : ''}
        </button>
      ))}
    </div>
  );

  return (
    <>
      <Panel title="Scenario" subtitle="Synthetic demand pattern" icon={Timer} actions={<MockBadge label="Synthetic demand" />}>
        <ScenarioSelector value={scenarioId} onChange={setScenarioId} disabled={status === 'running'} />
      </Panel>

      <StaleBanner result={result} scenarioId={scenarioId} onRun={run} running={status === 'running'} />

      <div className="grid grid-main">
        <Panel
          title="Intersection state"
          subtitle={planResult ? planResult.plan.description : 'Run a simulation to load plan timing and queues'}
          icon={Crosshair}
          actions={planPicker || <MockBadge />}
        >
          <IntersectionDiagram result={ready ? result : null} planId={planId} scenarioId={scenarioId} />
        </Panel>

        <div className="stack">
          <Panel title="Signal timing" subtitle="Green split and cycle length per plan" icon={Timer} actions={<MockBadge />}>
            <ResultGate {...gate}>
              {ready && <SignalTimingBars result={result} selectedId={planId} onSelect={setPickedId} />}
            </ResultGate>
          </Panel>
          <Panel title="Queue evolution" subtitle="60-minute synthetic horizon" icon={LineIcon} actions={<MockBadge />}>
            <ResultGate {...gate}>{ready && <QueueTimelineChart result={result} planId={planId} />}</ResultGate>
          </Panel>
        </div>
      </div>

      <Panel
        title="Per-approach detail"
        subtitle={planResult ? planResult.plan.fullName : 'Approach-level results'}
        icon={List}
        actions={<MockBadge />}
      >
        <ResultGate {...gate}>{planResult && <ApproachTable planResult={planResult} />}</ResultGate>
      </Panel>
    </>
  );
}
