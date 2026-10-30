import { Check, Circle, Gauge, Loader } from 'lucide-react';
import { RUN_STEPS } from '../../hooks/useSimulation.js';
import RunButton from './RunButton.jsx';

export function EmptyState({ title = 'No simulation results yet', message, onRun, icon: Icon = Gauge }) {
  return (
    <div className="empty">
      <span className="empty-icon" aria-hidden="true">
        <Icon size={24} />
      </span>
      <h3>{title}</h3>
      <p>
        {message ??
          'Pick a traffic scenario and run the synthetic simulation to compare signal plans.'}
      </p>
      {onRun && (
        <div style={{ marginTop: 8 }}>
          <RunButton onRun={onRun} running={false} hasResult={false} />
        </div>
      )}
    </div>
  );
}

export function RunningState({ step }) {
  return (
    <div className="empty" role="status" aria-live="polite">
      <span className="empty-icon" aria-hidden="true">
        <Loader size={24} className="spin" />
      </span>
      <h3>Running synthetic simulation</h3>
      <ul className="progress-list">
        {RUN_STEPS.map((label, i) => {
          const state = i < step ? 'done' : i === step ? 'active' : '';
          const Icon = i < step ? Check : i === step ? Loader : Circle;
          return (
            <li key={label} className={state}>
              <Icon size={15} className={i === step ? 'spin' : ''} aria-hidden="true" />
              {label}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// Convenience wrapper: render children only when results are ready.
export function ResultGate({ status, result, step, onRun, emptyMessage, children }) {
  if (status === 'running') return <RunningState step={step} />;
  if (!result) return <EmptyState onRun={onRun} message={emptyMessage} />;
  return children;
}
