import { useRef } from 'react';
import { Ban, Clock, Split, Sun, Zap } from 'lucide-react';
import { SCENARIOS } from '../../data/scenarios.js';
import { fmtNumber } from '../../lib/format.js';

const ICONS = { normal: Sun, peak: Clock, uneven: Split, surge: Zap, blocked: Ban };

export default function ScenarioSelector({ value, onChange, disabled }) {
  const refs = useRef([]);
  const current = SCENARIOS.find((s) => s.id === value);

  // Arrow-key navigation, as expected for a radio group.
  const onKeyDown = (e, index) => {
    const delta = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!delta) return;
    e.preventDefault();
    const next = (index + delta + SCENARIOS.length) % SCENARIOS.length;
    onChange(SCENARIOS[next].id);
    refs.current[next]?.focus();
  };

  return (
    <div>
      <div className="scenario-grid" role="radiogroup" aria-label="Traffic scenario">
        {SCENARIOS.map((s, i) => {
          const Icon = ICONS[s.id];
          const total = Object.values(s.demand).reduce((a, b) => a + b, 0);
          const checked = s.id === value;
          return (
            <button
              key={s.id}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="radio"
              aria-checked={checked}
              tabIndex={checked ? 0 : -1}
              className="scenario-card"
              onClick={() => onChange(s.id)}
              onKeyDown={(e) => onKeyDown(e, i)}
              disabled={disabled}
            >
              <Icon size={18} className="sc-icon" aria-hidden="true" />
              <span className="sc-name">{s.name}</span>
              <span className="sc-short">{s.short}</span>
              <span className="sc-demand num">{fmtNumber(total)} veh/h nominal</span>
            </button>
          );
        })}
      </div>
      {current && <p className="scenario-desc">{current.description}</p>}
    </div>
  );
}
