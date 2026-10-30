// ScenarioLab: scenario selection, custom inputs, strategy choice, playback of
// the real backend simulation history, queue-over-time chart and comparison table.
// Self-contained: add  <ScenarioLab />  anywhere in App.jsx.
import { useEffect, useMemo, useRef, useState } from "react";
import { Play, Pause, RotateCcw } from "lucide-react";
import "./ScenarioLab.css";

const DEFAULT_API = "http://127.0.0.1:8000";

const VARIANT_LABELS = {
  fixed_time: "Fixed-time",
  "fixed_time+preemption": "Fixed + ambulance priority",
  "coordinated+preemption": "Coordinated + ambulance priority",
};
const VARIANT_COLORS = {
  fixed_time: "#f59e0b",
  "fixed_time+preemption": "#a78bfa",
  "coordinated+preemption": "#22d3ee",
};
const EVENT_KEYS = ["surge", "blocked_lane", "spillback", "ambulance"];

// Which inputs belong to which scenario (only sent when that scenario is on).
const FIELD_GROUPS = {
  always: [
    ["main_vph", "Main road (cars/hour)", 0, 5000, 50],
    ["side_vph", "Each side road (cars/hour)", 0, 5000, 10],
    ["traffic_multiplier", "Traffic intensity (x)", 0, 5, 0.1],
    ["duration_min", "Duration (minutes)", 1, 240, 1],
    ["seed", "Random seed", 0, 99999, 1],
  ],
  surge: [
    ["surge_start_s", "Surge start (s)", 0, 14400, 30],
    ["surge_end_s", "Surge end (s)", 1, 14400, 30],
    ["surge_multiplier", "Surge intensity (x)", 1, 5, 0.1],
  ],
  blocked_lane: [
    ["closure_junction", "Closed after junction", 0, 2, 1, "junction"],
    ["closure_start_s", "Closure start (s)", 0, 14400, 30],
    ["closure_end_s", "Closure end (s)", 1, 14400, 30],
    ["closure_lanes_closed", "Lanes closed", 1, 6, 1],
  ],
  spillback: [["link_storage_veh", "Road space (cars per road)", 1, 1000, 1]],
  ambulance: [
    ["ambulance_request_s", "Ambulance arrives at (s)", 0, 14400, 30],
    ["ambulance_entry_junction", "Ambulance enters at", 0, 2, 1, "junction"],
  ],
};

const fmtTime = (s) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const first = (v) => (Array.isArray(v) ? v[0] : v);

// One-click demos for presentations (they use the same backend presets).
const DEMOS = [
  { label: "Calm day + ambulance", level: "normal", events: ["ambulance"] },
  { label: "Rush-hour spillback + ambulance", level: "peak_hour", events: ["spillback", "ambulance"] },
  { label: "Everything at once", level: "peak_hour", events: ["surge", "blocked_lane", "spillback", "ambulance"] },
];

export default function ScenarioLab({ apiBase = DEFAULT_API, autoRun = false }) {
  const [meta, setMeta] = useState(null);
  const [metaError, setMetaError] = useState("");
  const [level, setLevel] = useState("normal");
  const [events, setEvents] = useState(["ambulance"]);
  const [custom, setCustom] = useState({});
  const [variants, setVariants] = useState(Object.keys(VARIANT_LABELS));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [data, setData] = useState(null);

  useEffect(() => {
    fetch(`${apiBase}/api/scenarios`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setMeta)
      .catch((e) => setMetaError(`Could not load scenarios from the backend (${e.message}).`));
  }, [apiBase]);

  // Optional: run the rush-hour demo once when the page opens.
  const autoRan = useRef(false);
  useEffect(() => {
    if (meta && autoRun && !autoRan.current) {
      autoRan.current = true;
      const d = DEMOS[1];
      setLevel(d.level);
      setEvents(d.events);
      run(d.level, d.events, {});
    }
  }, [meta, autoRun]); // eslint-disable-line react-hooks/exhaustive-deps

  const chosen = [level, ...events];
  const activeGroups = ["always", ...events.filter((e) => FIELD_GROUPS[e])];

  // Values shown in the boxes = base settings + chosen presets + user's own values.
  const shown = useMemo(() => {
    if (!meta) return {};
    const out = { ...meta.base };
    Object.keys(meta.scenarios).forEach((k) => {
      if (chosen.includes(k)) Object.assign(out, meta.scenarios[k].settings);
    });
    return { ...out, ...custom };
  }, [meta, level, events, custom]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (list, setList, key) =>
    setList(list.includes(key) ? list.filter((k) => k !== key) : [...list, key]);

  const setField = (name, raw) =>
    setCustom((c) => ({ ...c, [name]: raw === "" ? "" : Number(raw) }));

  async function run(lv = level, ev = events, cu = custom) {
    if (!variants.length) {
      setError("Choose at least one strategy.");
      return;
    }
    setLoading(true);
    setError("");
    const groups = ["always", ...ev.filter((e) => FIELD_GROUPS[e])];
    const allowed = new Set(groups.flatMap((g) => FIELD_GROUPS[g].map((f) => f[0])));
    const overrides = Object.fromEntries(Object.entries(cu).filter(([k]) => allowed.has(k)));
    const request = { scenarios: [lv, ...ev], overrides, variants };
    try {
      const res = await fetch(`${apiBase}/api/scenarios/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...request, include_history: true, history_step_s: 2 }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.detail || `HTTP ${res.status}`);
      setData({ ...body, request });
    } catch (e) {
      setError(`Simulation failed: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="tt-lab">
      <header className="tt-lab-head">
        <h2>Scenario Lab</h2>
        <p>Select scenario → set inputs → choose strategies → run → watch playback → compare.</p>
      </header>

      {metaError && <div className="tt-error">{metaError}</div>}

      {meta && (
        <div className="tt-demos">
          <span>Quick demo:</span>
          {DEMOS.map((d) => (
            <button key={d.label} type="button" disabled={loading}
              onClick={() => { setLevel(d.level); setEvents(d.events); setCustom({}); run(d.level, d.events, {}); }}>
              {d.label}
            </button>
          ))}
        </div>
      )}

      {meta && (
        <div className="tt-setup">
          <div className="tt-card">
            <h3>1. Traffic level</h3>
            {meta.traffic_levels.map((k) => (
              <label key={k} className="tt-choice">
                <input type="radio" name="tt-level" checked={level === k} onChange={() => setLevel(k)} />
                <span><b>{meta.scenarios[k].label}</b><small>{meta.scenarios[k].description}</small></span>
              </label>
            ))}
            <h3>2. Events (combine any)</h3>
            {EVENT_KEYS.map((k) => (
              <label key={k} className="tt-choice">
                <input type="checkbox" checked={events.includes(k)} onChange={() => toggle(events, setEvents, k)} />
                <span><b>{meta.scenarios[k].label}</b><small>{meta.scenarios[k].description}</small></span>
              </label>
            ))}
          </div>

          <div className="tt-card">
            <h3>3. Settings</h3>
            <div className="tt-fields">
              {activeGroups.flatMap((g) => FIELD_GROUPS[g]).map(([name, label, min, max, step, kind]) => (
                <label key={name} className="tt-field">
                  <span>{label}</span>
                  {kind === "junction" ? (
                    <select value={shown[name] ?? 0} onChange={(e) => setField(name, e.target.value)}>
                      {[0, 1, 2].map((j) => <option key={j} value={j}>J{j}</option>)}
                    </select>
                  ) : (
                    <input type="number" min={min} max={max} step={step}
                      value={shown[name] === null || shown[name] === undefined ? "" : first(shown[name])}
                      onChange={(e) => setField(name, e.target.value)} />
                  )}
                </label>
              ))}
            </div>
            <button type="button" className="tt-link-btn" onClick={() => setCustom({})}>Reset to scenario values</button>
          </div>

          <div className="tt-card">
            <h3>4. Strategies</h3>
            {Object.entries(VARIANT_LABELS).map(([k, label]) => (
              <label key={k} className="tt-choice">
                <input type="checkbox" checked={variants.includes(k)} onChange={() => toggle(variants, setVariants, k)} />
                <span><b style={{ color: VARIANT_COLORS[k] }}>{label}</b></span>
              </label>
            ))}
            <button type="button" className="tt-run" onClick={() => run()} disabled={loading}>
              {loading ? "Running simulation…" : "Run simulation"}
            </button>
            {error && <div className="tt-error">{error}</div>}
            <p className="tt-note">All strategies receive identical traffic from the same random seed.</p>
          </div>
        </div>
      )}

      {data && <Results data={data} apiBase={apiBase} />}

      <p className="tt-disclaimer">
        Simplified educational model. The animation replays a finished simulation; it is not live road data
        and not a certified traffic-control system.
      </p>
    </section>
  );
}

function Results({ data, apiBase }) {
  const runs = data.comparison.runs;
  const names = Object.keys(runs);
  const [variant, setVariant] = useState(names[names.length - 1]);
  const run = runs[variant] || runs[names[0]];
  const history = run.history;
  const step = data.history_step_s || 1;
  const duration = history.length ? history[history.length - 1].t : 0;

  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(30);
  const last = useRef(null);

  // Open the playback one minute before the ambulance arrives (or at the start).
  useEffect(() => {
    const req = data.config && data.config.ambulance_request_s;
    setTime(typeof req === "number" ? Math.max(0, Math.round((req - 60) / step) * step) : 0);
    setPlaying(false);
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!playing) { last.current = null; return undefined; }
    let raf;
    const tick = (now) => {
      if (last.current !== null) {
        const dt = (now - last.current) / 1000;
        setTime((t) => {
          const nt = t + dt * speed;
          if (nt >= duration) { setPlaying(false); return duration; }
          return nt;
        });
      }
      last.current = now;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, duration]);

  const idx = Math.min(history.length - 1, Math.max(0, Math.round(time / step)));
  const frame = history[idx];

  return (
    <div className="tt-results">
      <div className="tt-card">
        <div className="tt-play-head">
          <h3>Playback</h3>
          <select value={variant} onChange={(e) => setVariant(e.target.value)}>
            {names.map((n) => <option key={n} value={n}>{VARIANT_LABELS[n] || n}</option>)}
          </select>
        </div>
        {frame && <Corridor frame={frame} time={frame.t} run={run} config={data.config} />}
        <div className="tt-controls">
          <button type="button" onClick={() => { if (time >= duration) setTime(0); setPlaying(!playing); }}
            aria-label={playing ? "Pause" : "Play"}>
            {playing ? <Pause size={16} /> : <Play size={16} />} {playing ? "Pause" : "Play"}
          </button>
          <button type="button" onClick={() => { setPlaying(false); setTime(0); }} aria-label="Reset">
            <RotateCcw size={16} /> Reset
          </button>
          <label>Speed
            <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
              {[5, 10, 30, 60, 120].map((s) => <option key={s} value={s}>{s}x</option>)}
            </select>
          </label>
          <input type="range" min={0} max={duration} step={step} value={time}
            onChange={(e) => { setPlaying(false); setTime(Number(e.target.value)); }} />
          <span className="tt-clock">{fmtTime(frame ? frame.t : 0)} / {fmtTime(duration)}</span>
        </div>
      </div>

      <div className="tt-card">
        <h3>Cars waiting over time (all queues)</h3>
        <QueueChart runs={runs} time={frame ? frame.t : 0} config={data.config} />
      </div>

      <div className="tt-card">
        <h3>Strategy comparison</h3>
        <ComparisonTable results={data.comparison.results} />
      </div>

      <div className="tt-card">
        <h3>Key findings (from these results)</h3>
        <Findings results={data.comparison.results} />
      </div>

      <div className="tt-card">
        <h3>Is it just luck? Check with more seeds</h3>
        <SeedCheck apiBase={apiBase} request={data.request} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- corridor drawing
const JX = [170, 450, 730];
const ROAD_Y = 150;
const HALF = 22;
const LIGHT = { green: "#22c55e", yellow: "#facc15", red: "#ef4444" };

function dots(n, x0, dir, max, y, cls) {
  const out = [];
  for (let i = 0; i < Math.min(n, max); i += 1) {
    out.push(<rect key={`${cls}${i}`} className={cls} x={x0 + dir * i * 10 - 3} y={y - 3} width={7} height={6} rx={1.5} />);
  }
  return out;
}

function ambulancePosition(run, time, config) {
  const amb = run.summary.ambulance;
  if (!amb || !amb.requested || !amb.trace || time < amb.request_s) return null;
  let ev = null;
  amb.trace.forEach((e) => { if (e.t <= time) ev = e; });
  if (!ev) return null;
  if (ev.location === "done") return { x: 860, label: "Arrived" };
  if (ev.location === "queue") return { x: JX[ev.index] - HALF - 16, label: `Waiting at J${ev.index}` };
  const p = Math.min(1, (time - ev.t) / config.link_travel_s);
  const a = JX[ev.index] + HALF + 8;
  const b = JX[ev.index + 1] - HALF - 8;
  return { x: a + p * (b - a), label: `On road L${ev.index}` };
}

function Corridor({ frame, time, run, config }) {
  const amb = ambulancePosition(run, time, config);
  return (
    <svg className="tt-svg" viewBox="0 0 900 300" role="img" aria-label="Corridor playback">
      <rect x="0" y={ROAD_Y - 14} width="900" height="28" className="tt-road" />
      <text x="10" y={ROAD_Y - 62} className="tt-label">Traffic enters →</text>
      <text x="830" y={ROAD_Y - 20} className="tt-label">Exit →</text>

      {frame.links.map((lk, i) => {
        const a = JX[i] + HALF + 6;
        const b = JX[i + 1] - HALF - 6;
        const queued = frame.junctions[i + 1].queues.main;
        const moving = lk.moving;
        const tail = b - Math.min(queued, 24) * 10;
        const gap = moving > 0 ? Math.max(4, (tail - a - 10) / moving) : 0;
        const fill = lk.storage ? lk.occupancy / lk.storage : 0;
        return (
          <g key={`l${i}`}>
            {Array.from({ length: Math.min(moving, 40) }).map((_, k) => (
              <rect key={k} className="tt-car" x={a + k * gap} y={ROAD_Y - 3} width={7} height={6} rx={1.5} />
            ))}
            <rect x={a} y={ROAD_Y + 24} width={b - a} height={8} className="tt-bar-bg" />
            <rect x={a} y={ROAD_Y + 24} width={(b - a) * Math.min(1, fill)} height={8}
              className={lk.blocked ? "tt-bar-red" : fill > 0.8 ? "tt-bar-amber" : "tt-bar-ok"} />
            <text x={a} y={ROAD_Y + 46} className="tt-label">
              L{i}: {lk.occupancy}/{lk.storage} cars{lk.blocked ? " — SPILLBACK: J" + i + " blocked" : ""}
            </text>
          </g>
        );
      })}

      {frame.junctions.map((jn, j) => {
        const x = JX[j];
        const ew = jn.lights.W;
        const ns = jn.lights.N;
        return (
          <g key={`j${j}`}>
            <rect x={x - 6} y={20} width={12} height={260} className="tt-side-road" />
            <rect x={x - HALF} y={ROAD_Y - HALF} width={HALF * 2} height={HALF * 2} className="tt-box" />
            <text x={x} y={ROAD_Y + 4} textAnchor="middle" className="tt-jlabel">J{j}</text>
            {dots(jn.queues.main, x - HALF - 10, -1, j === 0 ? 13 : 24, ROAD_Y + 6, "tt-car")}
            <text x={x - HALF - 4} y={ROAD_Y + 22} textAnchor="end" className="tt-label">queue {jn.queues.main}</text>
            {Array.from({ length: Math.min(jn.queues.N, 9) }).map((_, k) => (
              <rect key={`n${k}`} className="tt-car-side" x={x - 3} y={ROAD_Y - HALF - 12 - k * 10} width={6} height={7} rx={1.5} />
            ))}
            {Array.from({ length: Math.min(jn.queues.S, 9) }).map((_, k) => (
              <rect key={`s${k}`} className="tt-car-side" x={x - 3} y={ROAD_Y + HALF + 5 + k * 10} width={6} height={7} rx={1.5} />
            ))}
            <text x={x + 10} y={30} className="tt-label">N {jn.queues.N}</text>
            <text x={x + 10} y={278} className="tt-label">S {jn.queues.S}</text>
            <circle cx={x - HALF - 6} cy={ROAD_Y - HALF - 6} r={6} fill={LIGHT[ew]} className="tt-light" />
            <circle cx={x + HALF + 6} cy={ROAD_Y - HALF - 6} r={6} fill={LIGHT[ns]} className="tt-light" />
            {jn.closure && (
              <g>
                <rect x={x + HALF + 2} y={ROAD_Y - 14} width={34} height={14} className="tt-closure" />
                <text x={x + HALF + 4} y={ROAD_Y - 30} className="tt-warn">LANE CLOSED</text>
              </g>
            )}
            {jn.mode !== "normal" && (
              <text x={x} y={ROAD_Y + 70} textAnchor="middle" className={jn.mode === "preempt" ? "tt-mode-pre" : "tt-mode-rec"}>
                {jn.mode === "preempt" ? "AMBULANCE PRIORITY" : "RECOVERING"}
              </text>
            )}
          </g>
        );
      })}

      {amb && (
        <g>
          <rect x={amb.x - 11} y={ROAD_Y - 9} width={22} height={18} rx={3} className="tt-amb" />
          <path d={`M${amb.x - 5} ${ROAD_Y}h10M${amb.x} ${ROAD_Y - 5}v10`} className="tt-amb-cross" />
          <text x={amb.x} y={ROAD_Y - 44} textAnchor="middle" className="tt-amb-label">🚑 {amb.label}</text>
        </g>
      )}
      <text x="10" y="292" className="tt-label">Lights: left = main road, right = side roads. Moving cars on a road are spaced evenly; all counts come from the simulation.</text>
    </svg>
  );
}

// ---------------------------------------------------------------- queue chart
function QueueChart({ runs, time, config }) {
  const W = 900; const H = 220; const L = 50; const B = 30; const T = 10; const R = 10;
  const series = Object.entries(runs).map(([name, run]) => ({
    name,
    pts: run.history.map((f) => [f.t, f.junctions.reduce((s, j) => s + j.queues.main + j.queues.N + j.queues.S, 0)]),
  }));
  const maxT = Math.max(1, ...series.flatMap((s) => s.pts.map((p) => p[0])));
  const maxQ = Math.max(5, ...series.flatMap((s) => s.pts.map((p) => p[1])));
  const sx = (t) => L + (t / maxT) * (W - L - R);
  const sy = (q) => H - B - (q / maxQ) * (H - B - T);
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(f * maxQ));
  const xTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * maxT);
  return (
    <div>
      <svg className="tt-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Cars waiting over time">
        {yTicks.map((q) => (
          <g key={`y${q}`}>
            <line x1={L} x2={W - R} y1={sy(q)} y2={sy(q)} className="tt-grid" />
            <text x={L - 6} y={sy(q) + 4} textAnchor="end" className="tt-label">{q}</text>
          </g>
        ))}
        {xTicks.map((t, i) => (
          <text key={`x${t}`} x={sx(t)} y={H - 10} className="tt-label"
            textAnchor={i === 0 ? "start" : i === xTicks.length - 1 ? "end" : "middle"}>{fmtTime(t)}</text>
        ))}
        {series.map((s) => (
          <polyline key={s.name} fill="none" stroke={VARIANT_COLORS[s.name] || "#94a3b8"} strokeWidth="2"
            points={s.pts.map(([t, q]) => `${sx(t).toFixed(1)},${sy(q).toFixed(1)}`).join(" ")} />
        ))}
        {config && config.surge_start_s !== null && config.surge_start_s !== undefined && config.surge_multiplier !== 1 && (
          <g>
            <rect x={sx(config.surge_start_s)} y={T} width={Math.max(1, sx(config.surge_end_s) - sx(config.surge_start_s))}
              height={H - B - T} className="tt-band-surge" />
            <text x={sx(config.surge_start_s) + 4} y={T + 12} className="tt-band-label">Traffic surge</text>
          </g>
        )}
        {config && config.closure_junction !== null && config.closure_junction !== undefined && (
          <g>
            <rect x={sx(config.closure_start_s)} y={T}
              width={Math.max(1, sx(config.closure_end_s ?? maxT) - sx(config.closure_start_s))}
              height={H - B - T} className="tt-band-closure" />
            <text x={sx(config.closure_start_s) + 4} y={T + 26} className="tt-band-label">Lane closed (J{config.closure_junction})</text>
          </g>
        )}
        {config && config.ambulance_request_s !== null && config.ambulance_request_s !== undefined && (
          <g>
            <line x1={sx(config.ambulance_request_s)} x2={sx(config.ambulance_request_s)} y1={T} y2={H - B} className="tt-amb-line" />
            <text x={sx(config.ambulance_request_s) + 4} y={T + 40} className="tt-amb-text">Ambulance</text>
          </g>
        )}
        <line x1={sx(time)} x2={sx(time)} y1={T} y2={H - B} className="tt-now" />
      </svg>
      <div className="tt-legend">
        {series.map((s) => (
          <span key={s.name}><i style={{ background: VARIANT_COLORS[s.name] }} />{VARIANT_LABELS[s.name] || s.name}</span>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- comparison table
const ROWS = [
  ["Cars arrived", (s) => s.total_arrivals, null],
  ["Cars that finished", (s) => s.completed_vehicles, "high"],
  ["Cars still in corridor", (s) => s.vehicles_still_in_corridor, "low"],
  ["Throughput (cars/hour)", (s) => s.throughput_vph, "high"],
  ["Average delay (s)", (s) => s.average_delay_s, "low"],
  ["Average delay incl. still waiting (s)", (s) => s.average_delay_incl_waiting_s, "low"],
  ["Longest main-road queue", (s) => Math.max(...s.max_queues.map((q) => q.main)), "low"],
  ["Spillback events", (s) => s.spillback_events, "low"],
  ["Seconds blocked by spillback", (s) => s.spillback_blocked_seconds, "low"],
  ["Fullest road (L0 / L1)", (s) => `${s.max_link_occupancy.join(" / ")} of ${s.link_storage_veh}`, null],
  ["Ambulance finished", (s) => (s.ambulance.requested ? (s.ambulance.completed ? "Yes" : "No") : "—"), null],
  ["Ambulance trip time (s)", (s) => s.ambulance.travel_time_s ?? "—", "low"],
  ["Ambulance free-flow time (s)", (s) => s.ambulance.free_flow_s ?? "—", null],
  ["Ambulance delay (s)", (s) => s.ambulance.delay_s ?? "—", "low"],
  ["Signal recovery time (s)", (s) => s.recovery_time_s ?? "—", "low"],
];

function ComparisonTable({ results }) {
  const names = Object.keys(results);
  return (
    <div className="tt-table-wrap">
      <table className="tt-table">
        <thead>
          <tr><th>Metric</th>{names.map((n) => <th key={n} style={{ color: VARIANT_COLORS[n] }}>{VARIANT_LABELS[n] || n}</th>)}</tr>
        </thead>
        <tbody>
          {ROWS.map(([label, get, better]) => {
            const vals = names.map((n) => get(results[n]));
            const nums = vals.filter((v) => typeof v === "number");
            const best = better && nums.length > 1 ? (better === "high" ? Math.max(...nums) : Math.min(...nums)) : null;
            return (
              <tr key={label}>
                <td>{label}</td>
                {vals.map((v, i) => (
                  <td key={names[i]} className={best !== null && v === best ? "tt-best" : ""}>{v}</td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="tt-note">Highlighted = best value in that row. No strategy is assumed to be best overall.</p>
    </div>
  );
}

// ---------------------------------------------------------------- key findings
const pct = (a, b) => (b ? Math.round(((a - b) / b) * 100) : null);

function Findings({ results }) {
  const names = Object.keys(results);
  const label = (n) => VARIANT_LABELS[n] || n;
  const lines = [];
  const bestOf = (get, high) => {
    const vals = names.map((n) => [n, get(results[n])]).filter(([, v]) => typeof v === "number");
    if (vals.length < 2) return null;
    const target = high ? Math.max(...vals.map((v) => v[1])) : Math.min(...vals.map((v) => v[1]));
    const winners = vals.filter(([, v]) => v === target).map(([n]) => label(n));
    return { winners, target };
  };
  const add = (title, get, high, unit) => {
    const b = bestOf(get, high);
    if (b) lines.push(`${title}: ${b.winners.join(" and ")} (${b.target}${unit}).`);
  };
  add("Most cars finished", (s) => s.completed_vehicles, true, "");
  add("Lowest average delay", (s) => s.average_delay_s, false, " s");
  add("Least time blocked by spillback", (s) => s.spillback_blocked_seconds, false, " s");
  add("Fastest ambulance", (s) => s.ambulance.travel_time_s ?? null, false, " s");

  const base = results.fixed_time;
  if (base) {
    names.filter((n) => n !== "fixed_time").forEach((n) => {
      const s = results[n];
      const parts = [];
      const d1 = pct(s.spillback_blocked_seconds, base.spillback_blocked_seconds);
      if (d1 !== null) parts.push(`spillback blocking ${d1 <= 0 ? "down" : "up"} ${Math.abs(d1)}%`);
      const d2 = pct(s.average_delay_s, base.average_delay_s);
      if (d2 !== null) parts.push(`average delay ${d2 <= 0 ? "down" : "up"} ${Math.abs(d2)}%`);
      const d3 = s.completed_vehicles - base.completed_vehicles;
      parts.push(`${Math.abs(d3)} ${d3 >= 0 ? "more" : "fewer"} cars finished`);
      const a0 = base.ambulance.travel_time_s; const a1 = s.ambulance.travel_time_s;
      if (typeof a0 === "number" && typeof a1 === "number") parts.push(`ambulance ${a0 - a1 >= 0 ? `${a0 - a1} s faster` : `${a1 - a0} s slower`}`);
      else if (s.ambulance.requested && a1 === null) parts.push("ambulance did not finish");
      else if (base.ambulance.requested && a0 === null && typeof a1 === "number") parts.push("ambulance finished (it did not under fixed-time)");
      lines.push(`${label(n)} vs Fixed-time: ${parts.join(", ")}.`);
    });
  }
  return (
    <ul className="tt-findings">
      {lines.map((l) => <li key={l}>{l}</li>)}
      <li className="tt-muted">These come from this one run. Use the seed check below to see if they hold up.</li>
    </ul>
  );
}

// ---------------------------------------------------------------- multi-seed check
const SEED_ROWS = [
  ["Cars that finished", "completed_vehicles", "high"],
  ["Average delay (s)", "average_delay_s", "low"],
  ["Seconds blocked by spillback", "spillback_blocked_seconds", "low"],
  ["Ambulance trip time (s)", "ambulance_travel_time_s", "low"],
];

function SeedCheck({ apiBase, request }) {
  const [n, setN] = useState(5);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [res, setRes] = useState(null);
  useEffect(() => { setRes(null); setErr(""); }, [request]);

  async function check() {
    setBusy(true); setErr("");
    try {
      const r = await fetch(`${apiBase}/api/scenarios/multi-seed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...request, n_seeds: n }),
      });
      const body = await r.json();
      if (!r.ok) throw new Error(body.detail || `HTTP ${r.status}`);
      setRes(body);
    } catch (e) {
      setErr(`Seed check failed: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }

  const names = res ? Object.keys(res.mean) : [];
  return (
    <div>
      <div className="tt-controls">
        <label>Seeds
          <select value={n} onChange={(e) => setN(Number(e.target.value))}>
            {[3, 5, 10].map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        </label>
        <button type="button" onClick={check} disabled={busy}>{busy ? "Checking…" : "Run seed check"}</button>
      </div>
      {err && <div className="tt-error">{err}</div>}
      {res && (
        <div className="tt-table-wrap">
          <table className="tt-table">
            <thead>
              <tr><th>Average over seeds {res.seeds.join(", ")}</th>
                {names.map((k) => <th key={k} style={{ color: VARIANT_COLORS[k] }}>{VARIANT_LABELS[k] || k}</th>)}</tr>
            </thead>
            <tbody>
              {SEED_ROWS.map(([label, key, better]) => {
                const vals = names.map((k) => res.mean[k][key]);
                const nums = vals.filter((v) => typeof v === "number");
                const best = nums.length > 1 ? (better === "high" ? Math.max(...nums) : Math.min(...nums)) : null;
                return (
                  <tr key={key}>
                    <td>{label}</td>
                    {names.map((k, i) => (
                      <td key={k} className={best !== null && vals[i] === best ? "tt-best" : ""}>
                        {vals[i] ?? "—"}
                        <small className="tt-wins"> best in {res.wins[k][key]}/{res.seeds.length}</small>
                      </td>
                    ))}
                  </tr>
                );
              })}
              <tr>
                <td>Ambulance finished</td>
                {names.map((k) => <td key={k}>{res.ambulance_completed_runs[k]}/{res.seeds.length} runs</td>)}
              </tr>
            </tbody>
          </table>
          <p className="tt-note">Every seed gives all strategies the same traffic. "Best in X/N" counts the seeds where that strategy had the best value (ties count for each).</p>
        </div>
      )}
    </div>
  );
}
