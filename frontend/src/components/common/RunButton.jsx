import { Loader, Play, RotateCw } from 'lucide-react';

export default function RunButton({ onRun, running, hasResult, size = '', label }) {
  const text = label ?? (running ? 'Simulating…' : hasResult ? 'Re-run Simulation' : 'Run Simulation');
  const Icon = running ? Loader : hasResult ? RotateCw : Play;
  return (
    <button
      type="button"
      className={`btn btn-primary ${size === 'lg' ? 'btn-lg' : ''}`}
      onClick={onRun}
      disabled={running}
      aria-busy={running}
    >
      <Icon size={16} className={running ? 'spin' : ''} aria-hidden="true" />
      {text}
    </button>
  );
}
