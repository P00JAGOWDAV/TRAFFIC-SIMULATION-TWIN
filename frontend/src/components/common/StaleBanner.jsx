import { Info } from 'lucide-react';
import { getScenario } from '../../data/scenarios.js';

export default function StaleBanner({ result, scenarioId, onRun, running }) {
  if (!result || result.meta.scenarioId === scenarioId) return null;
  return (
    <div className="banner" role="status">
      <Info size={16} aria-hidden="true" />
      <span>
        Showing results for <b>{result.meta.scenarioName}</b>. Run the simulation to see{' '}
        <b>{getScenario(scenarioId).name}</b>.
      </span>
      <button type="button" className="btn" onClick={onRun} disabled={running}>
        Run for {getScenario(scenarioId).name}
      </button>
    </div>
  );
}
