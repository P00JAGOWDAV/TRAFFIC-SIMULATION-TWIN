
import { useEffect, useState } from 'react'
import {
  Activity, AlertTriangle, Ambulance, ArrowDown,
  ArrowUp, CarFront, Clock3, Gauge, GitCompareArrows,
  RefreshCw, ShieldCheck, TrafficCone, Zap
} from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend
} from 'recharts'
import './App.css'
import ScenarioLab from "./ScenarioLab.jsx";

const API = 'http://127.0.0.1:8000'

const strategies = [
  { key: 'fixed_time', label: 'Fixed Time' },
  { key: 'fixed_time+preemption', label: 'Preemption' },
  { key: 'coordinated+preemption', label: 'Coordinated + Preemption' },
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

function MetricCard({ title, value, unit, icon: Icon, note }) {
  return (
    <article className="metric-card">
      <div className="metric-top">
        <span>{title}</span>
        <Icon size={19} />
      </div>
      <div className="metric-value">{value ?? '—'} <small>{unit}</small></div>
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

  const results = data?.comparison?.results || {}
  const coordinated = results['coordinated+preemption']
  const ambulance = coordinated?.ambulance
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

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-icon"><TrafficCone size={25} /></div>
          <div><strong>TrafficTwin</strong><span>INTELLIGENT MOBILITY</span></div>
        </div>

        <p className="nav-label">WORKSPACE</p>
        <div className="nav-item active"><Gauge size={18} /> Overview</div>
        <div className="nav-item"><Activity size={18} /> Simulation</div>
        <div className="nav-item"><GitCompareArrows size={18} /> Comparisons</div>
        <div className="nav-item"><Ambulance size={18} /> Emergency response</div>

        <div className="sidebar-bottom">
          <div className="connection">
            <span className={`status-dot ${health === 'Connected' ? 'online' : ''}`} />
            <div><strong>Backend API</strong><small>{health}</small></div>
          </div>
          <p>TrafficTwin · Prototype</p>
        </div>
      </aside>

      <section className="main-content">
        <header className="topbar">
          <div>
            <span className="eyebrow">TRAFFIC INTELLIGENCE PLATFORM</span>
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
          <div className="live-pill"><span className="status-dot online" /> SIMULATION READY</div>
        </section>

        <section className="corridor-panel panel">
          <div className="section-heading">
            <div><span className="eyebrow">NETWORK TOPOLOGY</span><h2>Three-Junction Corridor</h2></div>
            <span className="muted">Junction 01 — 02 — 03</span>
          </div>

          <div className="corridor">
            {[1, 2, 3].map((junction, index) => (
              <div className="junction-group" key={junction}>
                <div className="junction">
                  <div className="road horizontal" />
                  <div className="road vertical" />
                  <div className="signal signal-top"><i /><i /><i /></div>
                  <div className="signal signal-bottom"><i /><i /><i /></div>
                  <div className="junction-center"><TrafficCone size={20} /></div>
                </div>
                <strong>Junction 0{junction}</strong>
                <small>{index === 0 ? 'Entry point' : index === 2 ? 'Exit point' : 'Intermediate'}</small>
              </div>
            ))}
          </div>
          <div className="corridor-legend">
            <span><i className="legend-road" /> Main corridor</span>
            <span><i className="legend-green" /> Signal indicator (illustrative)</span>
            <span><i className="legend-link" /> Finite-capacity links</span>
          </div>
        </section>

        <section className="section-heading results-heading">
          <div><span className="eyebrow">PERFORMANCE MONITORING</span><h2>Simulation results</h2></div>
          <span className="muted">Updates after each run</span>
        </section>

        <section className="metrics-grid">
          <MetricCard title="Vehicles completed" value={coordinated?.completed_vehicles} unit="vehicles" icon={CarFront} note="Coordinated + preemption" />
          <MetricCard title="Spillback events" value={coordinated?.spillback_events} unit="events" icon={AlertTriangle} note="Lower is better" />
          <MetricCard title="Blocked time" value={coordinated?.spillback_blocked_seconds} unit="seconds" icon={Clock3} note="Spillback blockage duration" />
          <MetricCard title="Ambulance travel" value={ambulance?.travel_time_s} unit="seconds" icon={Ambulance} note={ambulance?.completed ? 'Ambulance completed route' : 'Awaiting simulation'} />
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
            ) : <div className="empty-chart">Run a simulation to view throughput results.</div>}
          </article>

          <article className="panel chart-panel">
            <div className="section-heading">
              <div><span className="eyebrow">CONGESTION ANALYSIS</span><h2>Spillback events</h2></div>
            </div>
            {data ? (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#263449" />
                  <XAxis dataKey="strategy" stroke="#94a3b8" tick={{ fontSize: 11 }} />
                  <YAxis stroke="#94a3b8" />
                  <Tooltip contentStyle={{ background: '#111c2d', border: '1px solid #334155', borderRadius: 8 }} />
                  <Bar dataKey="spillback" name="Spillback events" fill="#fb923c" radius={[5, 5, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : <div className="empty-chart">Run a simulation to view spillback results.</div>}
          </article>
        </section>

        <section className="panel ambulance-panel">
          <div className="ambulance-icon"><Ambulance size={25} /></div>
          <div className="ambulance-copy">
            <span className="eyebrow">EMERGENCY VEHICLE PRIORITY</span>
            <h2>Ambulance response tracking</h2>
            <p>{ambulance?.completed ? 'The ambulance completed its simulated corridor journey.' : 'Run the simulation to evaluate emergency vehicle response.'}</p>
          </div>
          <div className="ambulance-stat">
            <strong>{ambulance?.travel_time_s != null ? `${ambulance.travel_time_s}s` : '—'}</strong>
            <small>Travel time</small>
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
                <thead><tr><th>Strategy</th><th>Completed</th><th>Spillback</th><th>Blocked seconds</th><th>Ambulance time</th></tr></thead>
                <tbody>
                  {strategies.map(({ key, label }) => {
                    const item = results[key]
                    return <tr key={key}>
                      <td>{label}</td>
                      <td>{item?.completed_vehicles ?? '—'}</td>
                      <td>{item?.spillback_events ?? '—'}</td>
                      <td>{item?.spillback_blocked_seconds ?? '—'}</td>
                      <td>{item?.ambulance?.travel_time_s ?? '—'}s</td>
                    </tr>
                  })}
                </tbody>
              </table>
            </div>
            <ScenarioLab />
          </section>
        )}

        <footer>TrafficTwin · Spillback and the Ambulance · Simulation prototype</footer>
      </section>
    </main>
  )
}

export default App
