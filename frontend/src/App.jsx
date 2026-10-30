import { useEffect, useState } from 'react';
import Sidebar from './components/layout/Sidebar.jsx';
import { NAV_ITEMS } from './data/navigation.js';
import Header from './components/layout/Header.jsx';
import { useSimulation } from './hooks/useSimulation.js';
import OverviewPage from './pages/OverviewPage.jsx';
import SimulationPage from './pages/SimulationPage.jsx';
import ComparisonPage from './pages/ComparisonPage.jsx';
import StressTestPage from './pages/StressTestPage.jsx';

const PAGES = {
  overview: OverviewPage,
  simulation: SimulationPage,
  comparison: ComparisonPage,
  stress: StressTestPage,
};

export default function App() {
  const sim = useSimulation();
  const [page, setPage] = useState('overview');
  const [navOpen, setNavOpen] = useState(false);

  const current = NAV_ITEMS.find((n) => n.id === page);
  const Page = PAGES[page];

  const navigate = (id) => {
    setPage(id);
    setNavOpen(false);
    window.scrollTo({ top: 0 });
  };

  // Keyboard shortcuts for demos: 1–4 switch pages, R runs the simulation.
  useEffect(() => {
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 'Escape') setNavOpen(false);
      const idx = Number(e.key) - 1;
      if (NAV_ITEMS[idx]) navigate(NAV_ITEMS[idx].id);
      if ((e.key === 'r' || e.key === 'R') && sim.status !== 'running') sim.run();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  useEffect(() => {
    document.title = `${current.title} · TrafficTwin`;
  }, [current.title]);

  return (
    <div className="app">
      <Sidebar active={page} onNavigate={navigate} open={navOpen} onClose={() => setNavOpen(false)} />
      <div className="main">
        <Header
          title={current.title}
          subtitle={current.subtitle}
          onMenu={() => setNavOpen(true)}
          onRun={sim.run}
          status={sim.status}
          result={sim.result}
        />
        <main className="content" id="main">
          <Page sim={sim} />
          <p className="footer-note">
            TrafficTwin prototype · every number on this page is synthetic output from a local mock model, not
            measured traffic data.
          </p>
        </main>
      </div>
    </div>
  );
}
