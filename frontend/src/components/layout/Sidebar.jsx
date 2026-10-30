import { Info, TrafficCone } from 'lucide-react';
import { NAV_ITEMS } from '../../data/navigation.js';

export default function Sidebar({ active, onNavigate, open, onClose }) {
  return (
    <>
      <button
        type="button"
        className={`scrim ${open ? 'open' : ''}`}
        aria-label="Close navigation"
        tabIndex={open ? 0 : -1}
        onClick={onClose}
      />
      <aside className={`sidebar ${open ? 'open' : ''}`} aria-label="Primary">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <TrafficCone size={20} strokeWidth={2.4} />
          </span>
          <div>
            <div className="brand-name">TrafficTwin</div>
            <div className="brand-sub">Smart Intersection Digital Twin</div>
          </div>
        </div>

        <nav>
          <div className="nav-label">Workspace</div>
          <div className="nav">
            {NAV_ITEMS.map(({ id, label, icon: Icon }, i) => (
              <button
                key={id}
                type="button"
                className="nav-item"
                aria-current={active === id ? 'page' : undefined}
                onClick={() => onNavigate(id)}
              >
                <Icon size={18} aria-hidden="true" />
                {label}
                <span className="nav-hint" aria-hidden="true">
                  {i + 1}
                </span>
              </button>
            ))}
          </div>
        </nav>

        <div className="sidebar-foot">
          <strong>
            <Info size={13} aria-hidden="true" /> Prototype notice
          </strong>
          All figures are generated in your browser by a simplified mock model. No live sensors, no
          backend, no real-world calibration.
        </div>
      </aside>
    </>
  );
}
