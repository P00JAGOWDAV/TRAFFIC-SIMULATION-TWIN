
import { useEffect, useRef, useState } from 'react'
import {
  Activity, AlertTriangle, Ambulance, CarFront, Clock3, Gauge, GitCompareArrows,
  RefreshCw, ShieldCheck, TrafficCone, Zap, Target, Lightbulb, Trophy
} from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer
} from 'recharts'
import './App.css'
import './Enhancements.css'
import ScenarioLab from "./ScenarioLab.jsx";

// On your laptop (npm run dev) the backend is on port 8000.
// On the server, the backend serves the website itself, so use the same address.
const API = import.meta.env.DEV ? 'http://127.0.0.1:8000' : ''

// Same names as the Scenario Lab, so the whole page uses one vocabulary.
const strategies = [
  { key: 'fixed_time', label: 'Fixed-time' },
  { key: 'fixed_time+preemption', label: 'Fixed + ambulance priority' },
  { key: 'coordinated+preemption', label: 'Coordinated + ambulance priority' },
]

const initialConfig = {
  main_vph: 900,
  side_vph: 300,
  main_green_s: 30,
  side_green_s: 25,
  yellow_s: 3,
  all_red_s: 2,
  min_green_s: 7,
  main_lanes: 2,
  side_lanes: 1,
  link_travel_s: 30,
  link_storage_veh: 8,
  duration_min: 30,
  traffic_multiplier: 1.2,
  seed: 42,
  ambulance_request_s: 600,
  ambulance_entry_junction: 0,
  gate_threshold: 0.9,
  flush_threshold: 0.6,
  max_extension_s: 20,
  record_history: false,
}

const NAV = [
  { id: 'overview', label: 'Overview', icon: Gauge },
  { id: 'lab', label: 'Simulation', icon: Activity },
  { id: 'compare', label: 'Comparisons', icon: GitCompareArrows },
  { id: 'emergency', label: 'Emergency response', icon: Ambulance },
]

// Percentage change of value vs baseline, as an honest "up/down" note.
function changeNote(value, baseline, lowerIsBetter) {
  if (typeof value !== 'number' || typeof baseline !== 'number' || baseline === 0) return null
  const pct = Math.round(((value - baseline) / baseline) * 100)
  if (pct === 0) return { text: 'same as fixed-time', good: null }
  const better = lowerIsBetter ? pct < 0 : pct > 0
  return { text: `${pct > 0 ? '+' : ''}${pct}% vs fixed-time`, good: better }
}

function MetricCard({ title, value, unit, icon: Icon, note, change }) {
  return (
    <article className="metric-card">
      <div className="metric-top">
        <span>{title}</span>
        <Icon size={19} />
      </div>
      <div className="metric-value">{value ?? '—'} <small>{unit}</small></div>
      {change && (
        <p className={`tt-delta ${change.good === true ? 'good' : change.good === false ? 'bad' : ''}`}>{change.text}</p>
      )}
      <p>{note}</p>
    </article>
  )
}

function App() {
  const [health, setHealth] = useState('Checking')
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [config, setConfig] = useState(initialConfig)
  const [active, setActive] = useState('overview')
  const autoRan = useRef(false)

  async function checkHealth() {
    try {
      const response = await fetch(`${API}/api/health`)
      if (!response.ok) throw new Error('Backend unavailable')
      setHealth('Connected')
    } catch {
      setHealth('Disconnected')
    }
  }

  async function runSimulation() {
    setLoading(true)
    setError('')
    try {
      const response = await fetch(`${API}/api/corridor/compare`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          config,
          include_history: false,
        }),
      })
      const result = await response.json()
      if (!response.ok) {
        throw new Error(result.detail || 'Simulation request failed')
      }
      setData(result)
    } catch (err) {
      setError(err.message || 'Could not run simulation')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    checkHealth()
  }, [])

  // Run the baseline comparison once as soon as the backend is reachable,
  // so the page never opens empty.
  useEffect(() => {
    if (health === 'Connected' && !autoRan.current) {
      autoRan.current = true
      runSimulation()
    }
  }, [health]) // eslint-disable-line react-hooks/exhaustive-deps

  function goTo(id) {
    setActive(id)
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const results = data?.comparison?.results || {}
  const fixed = results['fixed_time']
  const coordinated = results['coordinated+preemption']
  const ambulance = coordinated?.ambulance
  const fixedAmb = fixed?.ambulance
  const chartData = strategies.map(({ key, label }) => {
    const item = results[key]
    return {
      strategy: label,
      completed: item?.completed_vehicles ?? 0,
      spillback: item?.spillback_events ?? 0,
      blocked: item?.spillback_blocked_seconds ?? 0,
      ambulanceTime: item?.ambulance?.travel_time_s ?? 0,
    }
  })

  // Headline numbers for the story cards (computed, never hard-coded).
  const blockedChange = changeNote(coordinated?.spillback_blocked_seconds, fixed?.spillback_blocked_seconds, true)
  const ambSaved = typeof fixedAmb?.travel_time_s === 'number' && typeof ambulance?.travel_time_s === 'number'
    ? fixedAmb.travel_time_s - ambulance.travel_time_s : null

  let ambulanceText = 'Run the simulation to evaluate emergency vehicle response.'
  if (ambulance) {
    if (!ambulance.completed) ambulanceText = 'With coordinated control the ambulance did not finish within the simulated time.'
    else if (ambSaved !== null) ambulanceText = ambSaved >= 0
      ? `Coordinated control got the ambulance through ${ambSaved} s faster than fixed-time (${fixedAmb.travel_time_s} s → ${ambulance.travel_time_s} s). Free-flow time is ${ambulance.free_flow_s} s.`
      : `Coordinated control was ${-ambSaved} s slower than fixed-time for the ambulance in this run.`
    else if (fixedAmb && !fixedAmb.completed) ambulanceText = `The ambulance finished in ${ambulance.travel_time_s} s with coordinated control, but did not finish at all under fixed-time.`
    else ambulanceText = `The ambulance finished its corridor journey in ${ambulance.travel_time_s} s.`
  }

  return (
    <main className="app-shell">
      <aside className="sidebar tt-sticky">
        <div className="brand">
          <div className="brand-icon"><TrafficCone size={25} /></div>
          <div><strong>TrafficTwin</strong><span>INTELLIGENT MOBILITY</span></div>
        </div>

        <p className="nav-label">WORKSPACE</p>
        {NAV.map(({ id, label, icon: Icon }) => (
          <button key={id} type="button" className={`nav-item tt-nav-btn ${active === id ? 'active' : ''}`} onClick={() => goTo(id)}>
            <Icon size={18} /> {label}
          </button>
        ))}

        <div className="sidebar-bottom">
          <div className="connection">
            <span className={`status-dot ${health === 'Connected' ? 'online' : ''}`} />
            <div><strong>Backend API</strong><small>{health}</small></div>
          </div>
          <p>TrafficTwin · Prototype</p>
        </div>
      </aside>

      <section className="main-content">
        <header className="topbar" id="overview">
          <div>
            <span className="eyebrow">CHALLENGE: SPILLBACK AND THE AMBULANCE</span>
            <h1>Corridor Overview</h1>
          </div>
          <button className="refresh-btn" onClick={checkHealth}>
            <RefreshCw size={16} /> Check connection
          </button>
        </header>

        <section className="welcome-row">
          <div>
            <h2>Monitor. Predict. Optimize.</h2>
            <p>Simulate congestion, prevent spillback and prioritize emergency vehicles.</p>
          </div>
          <div className="live-pill">
            <span className={`status-dot ${health === 'Connected' ? 'online' : ''}`} />
            {health === 'Connected' ? 'SIMULATION READY' : health === 'Checking' ? 'CONNECTING…' : 'BACKEND OFFLINE'}
          </div>
        </section>

        {health === 'Disconnected' && (
          <p className="error-message">The backend is not reachable at {API}. Start it with: python -m uvicorn app.main:app --reload</p>
        )}

        <section className="tt-story">
          <article className="panel">
            <div className="tt-story-icon"><Target size={20} /></div>
            <span className="eyebrow">THE PROBLEM</span>
            <h3>Queues spill back</h3>
            <p>When the road between two junctions fills up, cars cannot leave the junction behind it, even on green. The jam spreads upstream and traps ambulances.</p>
          </article>
          <article className="panel">
            <div className="tt-story-icon"><Lightbulb size={20} /></div>
            <span className="eyebrow">OUR APPROACH</span>
            <h3>Coordinate + prioritise</h3>
            <p>Signals watch how full the next road is: they hold back traffic that has nowhere to go and flush full roads. Ambulances get a safe green wave (yellow and all-red are never skipped), then signals recover.</p>
          </article>
          <article className="panel">
            <div className="tt-story-icon"><Trophy size={20} /></div>
            <span className="eyebrow">RESULT (LIVE, THIS RUN)</span>
            <h3>{ambSaved !== null ? `Ambulance ${ambSaved >= 0 ? `${ambSaved} s faster` : `${-ambSaved} s slower`}` : ambulance?.completed ? 'Ambulance got through' : 'Running…'}</h3>
            <p>
              {blockedChange ? `Spillback blocking ${blockedChange.good ? 'down' : 'up'} ${blockedChange.text.replace(' vs fixed-time', '').replace(/[+-]/, '')} compared with fixed-time. ` : ''}
              {coordinated && fixed ? `${Math.abs(coordinated.completed_vehicles - fixed.completed_vehicles)} ${coordinated.completed_vehicles >= fixed.completed_vehicles ? 'more' : 'fewer'} ordinary cars finished — a trade-off we report honestly.` : 'Results appear automatically when the backend is connected.'}
            </p>
          </article>
        </section>

        <section className="corridor-panel panel">
          <div className="section-heading">
            <div><span className="eyebrow">NETWORK TOPOLOGY</span><h2>Three-Junction Corridor</h2></div>
            <span className="muted">J0 → L0 → J1 → L1 → J2 (eastbound main road)</span>
          </div>

          <div className="corridor">
            {[0, 1, 2].map((junction) => (
              <div className="junction-group" key={junction}>
                <div className="junction">
                  <div className="road horizontal" />
                  <div className="road vertical" />
                  <div className="signal signal-top"><i /><i /><i /></div>
                  <div className="signal signal-bottom"><i /><i /><i /></div>
                  <div className="junction-center"><TrafficCone size={20} /></div>
                </div>
                <strong>Junction J{junction}</strong>
                <small>{junction === 0 ? 'Entry point' : junction === 2 ? 'Exit point' : 'Intermediate'}</small>
              </div>
            ))}
          </div>
          <div className="corridor-legend">
            <span><i className="legend-road" /> Main corridor</span>
            <span><i className="legend-green" /> Signal indicator (illustrative)</span>
            <span><i className="legend-link" /> Finite-capacity roads L0, L1</span>
          </div>
        </section>

        <div id="lab" className="tt-anchor">
          <ScenarioLab apiBase={API} autoRun />
        </div>

        <section className="section-heading results-heading" id="compare">
          <div><span className="eyebrow">BASELINE STRESS TEST</span><h2>Quick strategy comparison</h2></div>
          <span className="muted">Coordinated + ambulance priority, compared with fixed-time</span>
        </section>

        <section className="metrics-grid">
          <MetricCard title="Vehicles completed" value={coordinated?.completed_vehicles} unit="vehicles" icon={CarFront}
            note="Higher is better" change={changeNote(coordinated?.completed_vehicles, fixed?.completed_vehicles, false)} />
          <MetricCard title="Spillback events" value={coordinated?.spillback_events} unit="events" icon={AlertTriangle}
            note="Lower is better" change={changeNote(coordinated?.spillback_events, fixed?.spillback_events, true)} />
          <MetricCard title="Blocked time" value={coordinated?.spillback_blocked_seconds} unit="seconds" icon={Clock3}
            note="Time junctions were blocked by full roads" change={blockedChange} />
          <MetricCard title="Ambulance travel" value={ambulance?.travel_time_s} unit="seconds" icon={Ambulance}
            note={ambulance ? (ambulance.completed ? 'Ambulance completed route' : 'Did not finish in time') : 'Awaiting simulation'}
            change={changeNote(ambulance?.travel_time_s, fixedAmb?.travel_time_s, true)} />
        </section>

        <section className="content-grid">
          <article className="panel chart-panel">
            <div className="section-heading">
              <div><span className="eyebrow">STRATEGY ANALYSIS</span><h2>Vehicle throughput</h2></div>
              <span className="chart-unit">Vehicles</span>
            </div>
            {data ? (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#263449" />
                  <XAxis dataKey="strategy" stroke="#94a3b8" tick={{ fontSize: 11 }} />
                  <YAxis stroke="#94a3b8" />
                  <Tooltip contentStyle={{ background: '#111c2d', border: '1px solid #334155', borderRadius: 8 }} />
                  <Bar dataKey="completed" name="Vehicles completed" fill="#22d3ee" radius={[5, 5, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : <div className="empty-chart">{loading ? 'Running…' : 'Run a simulation to view throughput results.'}</div>}
          </article>

          <article className="panel chart-panel">
            <div className="section-heading">
              <div><span className="eyebrow">CONGESTION ANALYSIS</span><h2>Seconds blocked by spillback</h2></div>
            </div>
            {data ? (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#263449" />
                  <XAxis dataKey="strategy" stroke="#94a3b8" tick={{ fontSize: 11 }} />
                  <YAxis stroke="#94a3b8" />
                  <Tooltip contentStyle={{ background: '#111c2d', border: '1px solid #334155', borderRadius: 8 }} />
                  <Bar dataKey="blocked" name="Seconds blocked" fill="#fb923c" radius={[5, 5, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : <div className="empty-chart">{loading ? 'Running…' : 'Run a simulation to view spillback results.'}</div>}
          </article>
        </section>

        <section className="panel ambulance-panel" id="emergency">
          <div className="ambulance-icon"><Ambulance size={25} /></div>
          <div className="ambulance-copy">
            <span className="eyebrow">EMERGENCY VEHICLE PRIORITY</span>
            <h2>Ambulance response tracking</h2>
            <p>{ambulanceText}</p>
          </div>
          <div className="ambulance-stat">
            <strong>{ambulance?.travel_time_s != null ? `${ambulance.travel_time_s}s` : '—'}</strong>
            <small>Travel time (coordinated)</small>
          </div>
          <div className="ambulance-stat">
            <strong>{fixedAmb?.travel_time_s != null ? `${fixedAmb.travel_time_s}s` : fixedAmb ? 'DNF' : '—'}</strong>
            <small>Travel time (fixed-time)</small>
          </div>
        </section>

        <section className="panel controls-panel">
          <div className="section-heading">
            <div><span className="eyebrow">EXPERIMENT CONTROLS</span><h2>Run corridor comparison</h2></div>
            <span className="muted">Uses your FastAPI simulation</span>
          </div>
          <div className="control-grid">
            <label>Main road demand (vehicles/hour)
              <input type="number" min="1" value={config.main_vph} onChange={e => setConfig({ ...config, main_vph: Number(e.target.value) })} />
            </label>
            <label>Side road demand (vehicles/hour)
              <input type="number" min="1" value={config.side_vph} onChange={e => setConfig({ ...config, side_vph: Number(e.target.value) })} />
            </label>
            <label>Link storage (vehicles)
              <input type="number" min="1" value={config.link_storage_veh} onChange={e => setConfig({ ...config, link_storage_veh: Number(e.target.value) })} />
            </label>
            <label>Traffic multiplier
              <input type="number" min="0.1" step="0.1" value={config.traffic_multiplier} onChange={e => setConfig({ ...config, traffic_multiplier: Number(e.target.value) })} />
            </label>
          </div>
          <button className="run-btn" disabled={loading || health !== 'Connected'} onClick={runSimulation}>
            {loading ? <RefreshCw className="spin" size={18} /> : <Zap size={18} />}
            {loading ? 'Running simulation...' : 'Run simulation comparison'}
          </button>
          {error && <p className="error-message">{error}</p>}
          {data && <p className="success-message"><ShieldCheck size={16} /> Simulation completed successfully. Results shown above.</p>}
        </section>

        {data && (
          <section className="panel comparison-panel">
            <div className="section-heading">
              <div><span className="eyebrow">DETAILED RESULTS</span><h2>Strategy comparison</h2></div>
            </div>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Strategy</th><th>Completed</th><th>Avg delay</th><th>Spillback</th><th>Blocked seconds</th><th>Ambulance time</th></tr></thead>
                <tbody>
                  {strategies.map(({ key, label }) => {
                    const item = results[key]
                    const amb = item?.ambulance
                    return <tr key={key}>
                      <td>{label}</td>
                      <td>{item?.completed_vehicles ?? '—'}</td>
                      <td>{item?.average_delay_s != null ? `${item.average_delay_s}s` : '—'}</td>
                      <td>{item?.spillback_events ?? '—'}</td>
                      <td>{item?.spillback_blocked_seconds ?? '—'}</td>
                      <td>{amb?.travel_time_s != null ? `${amb.travel_time_s}s` : amb?.requested ? 'Did not finish' : '—'}</td>
                    </tr>
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}

        <footer>TrafficTwin · Spillback and the Ambulance · Simplified simulation prototype, not certified traffic control</footer>
      </section>
    </main>
  )
}

export default App
