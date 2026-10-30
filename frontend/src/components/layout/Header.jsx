import { Menu } from 'lucide-react';
import RunButton from '../common/RunButton.jsx';
import { fmtTime } from '../../lib/format.js';

export default function Header({ title, subtitle, onMenu, onRun, status, result }) {
  return (
    <header className="header">
      <button type="button" className="icon-btn menu-btn" onClick={onMenu} aria-label="Open navigation">
        <Menu size={18} />
      </button>

      <div className="header-title">
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>

      <div className="header-actions">
        <span className="synthetic-pill" role="note" aria-label="All data shown is synthetic simulation output">
          <span className="pulse-dot" aria-hidden="true" />
          Synthetic Simulation
        </span>

        {result && (
          <div className="run-meta num" aria-live="polite">
            <div>
              Run <b>#{result.meta.runNumber}</b> · seed <b>{result.meta.seed}</b>
            </div>
            <div>
              {result.meta.scenarioName} · {fmtTime(result.meta.generatedAt)}
            </div>
          </div>
        )}

        <RunButton onRun={onRun} running={status === 'running'} hasResult={Boolean(result)} />
      </div>
    </header>
  );
}
