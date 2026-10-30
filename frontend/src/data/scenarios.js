// ---------------------------------------------------------------------------
// TrafficTwin — local MOCK configuration.
// Every number in this file is synthetic and hand-tuned for demo purposes.
// Nothing here comes from a real sensor feed, a real simulator, or a backend.
// ---------------------------------------------------------------------------

export const APPROACHES = [
  { id: 'N', name: 'North approach', label: 'North', phase: 'NS' },
  { id: 'S', name: 'South approach', label: 'South', phase: 'NS' },
  { id: 'E', name: 'East approach', label: 'East', phase: 'EW' },
  { id: 'W', name: 'West approach', label: 'West', phase: 'EW' },
];

// Geometry assumptions used by the mock model.
export const GEOMETRY = {
  lanesPerApproach: 2,
  saturationFlowPerLane: 1700, // veh/h/lane (adjusted for turning movements)
  storageLengthM: 250, // metres of queue storage before the upstream junction
  vehicleSpacingM: 7, // metres per queued vehicle
  analysisPeriodH: 0.25, // 15-minute analysis period
};

export const SCENARIOS = [
  {
    id: 'normal',
    name: 'Normal',
    short: 'Off-peak, balanced demand',
    description: 'Balanced weekday off-peak demand on all four approaches.',
    demand: { N: 820, S: 760, E: 940, W: 880 }, // veh/h
    blockedLanes: {},
    profile: [0.92, 0.95, 0.98, 1.0, 1.02, 1.04, 1.03, 1.01, 0.99, 0.97, 0.96, 0.94],
  },
  {
    id: 'peak',
    name: 'Peak',
    short: 'Commuter peak, E–W heavy',
    description: 'Evening commuter peak with the arterial (East–West) carrying most traffic.',
    demand: { N: 900, S: 840, E: 1320, W: 1240 },
    blockedLanes: {},
    profile: [0.88, 0.93, 0.98, 1.04, 1.08, 1.1, 1.08, 1.04, 0.99, 0.95, 0.92, 0.9],
  },
  {
    id: 'uneven',
    name: 'Uneven Demand',
    short: 'North approach dominates',
    description: 'Event traffic loads the north approach while other legs stay light.',
    demand: { N: 1380, S: 560, E: 700, W: 640 },
    blockedLanes: {},
    profile: [0.9, 0.96, 1.02, 1.08, 1.1, 1.06, 1.02, 0.98, 0.96, 0.95, 0.94, 0.93],
  },
  {
    id: 'surge',
    name: 'Traffic Surge',
    short: 'Sudden 20-minute spike',
    description: 'A short, sharp surge (e.g. stadium release) pushes every approach toward capacity.',
    demand: { N: 1080, S: 1040, E: 1250, W: 1190 },
    blockedLanes: {},
    profile: [0.82, 0.86, 0.95, 1.12, 1.24, 1.26, 1.14, 1.0, 0.92, 0.88, 0.86, 0.85],
  },
  {
    id: 'blocked',
    name: 'Blocked Lane',
    short: 'East approach lane closed',
    description: 'One of two inbound east-approach lanes is blocked by a stalled vehicle, halving that capacity.',
    demand: { N: 860, S: 800, E: 840, W: 860 },
    blockedLanes: { E: 1 },
    profile: [0.94, 0.97, 1.0, 1.02, 1.04, 1.05, 1.04, 1.02, 1.0, 0.98, 0.96, 0.95],
  },
];

// Candidate signal plans. `strategy` tells the mock model how to derive greens.
// Colours were validated (OKLCH band, CVD separation, contrast) on the dark panel.
export const SIGNAL_PLANS = [
  {
    id: 'fixed',
    name: 'Fixed-Time',
    fullName: 'Fixed-Time 90 s (Baseline)',
    isBaseline: true,
    strategy: 'fixed',
    cycle: 90,
    lostTime: 16,
    description: 'Current timing: 90 s cycle with equal 37 s greens for both phases.',
    caveat: 'Ignores demand imbalance; equal splits waste green on light approaches.',
  },
  {
    id: 'weighted',
    name: 'Demand-Weighted',
    fullName: 'Demand-Weighted Split',
    strategy: 'weighted',
    cycle: 100,
    lostTime: 16,
    description: 'Keeps a 100 s cycle but splits green in proportion to critical flow ratios.',
    caveat: 'Fixed cycle can be too short under surge conditions.',
  },
  {
    id: 'webster',
    name: 'Webster Optimal',
    fullName: 'Webster Optimal Cycle',
    strategy: 'webster',
    lostTime: 16,
    minCycle: 60,
    maxCycle: 150,
    description: "Sets cycle length with Webster's formula, then splits green proportionally.",
    caveat: 'Timing is optimised once for the average hour, so it cannot react to short surges.',
  },
  {
    id: 'adaptive',
    name: 'Adaptive Actuated',
    fullName: 'Adaptive Actuated (mock)',
    strategy: 'adaptive',
    lostTime: 14,
    minCycle: 70,
    maxCycle: 120,
    description:
      'Mock actuated control: re-times every 5 min (70–120 s) from the last interval of detector counts; gap-out trims lost time to 14 s.',
    caveat: 'Reacts one interval late and needs working detectors on every lane; a detector fault degrades to fixed-time.',
  },
];

export const SCORE_WEIGHTS = [
  { key: 'delay', label: 'Average delay', weight: 0.4, direction: 'lower', color: '#3b82f6' },
  { key: 'queue', label: 'Maximum queue', weight: 0.3, direction: 'lower', color: '#d97706' },
  { key: 'throughput', label: 'Throughput', weight: 0.2, direction: 'higher', color: '#a855f7' },
  { key: 'spillback', label: 'Spillback risk', weight: 0.1, direction: 'lower', color: '#0d9488' },
];

// Two-series colours for "baseline vs recommended" charts (validated pair).
export const SERIES_COLORS = { baseline: '#3b82f6', recommended: '#0d9488' };

export const getScenario = (id) => SCENARIOS.find((s) => s.id === id) ?? SCENARIOS[0];
export const getPlan = (id) => SIGNAL_PLANS.find((p) => p.id === id);
