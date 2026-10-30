import { useCallback, useEffect, useRef, useState } from 'react';
import { SCENARIOS } from '../data/scenarios.js';
import { runSimulation, runStressTest } from '../lib/simulation.js';

// Purely cosmetic progress steps. The mock model itself runs in milliseconds;
// the short delay just makes the state change readable during a demo.
export const RUN_STEPS = [
  'Generating synthetic demand',
  'Evaluating 4 signal plans × 12 intervals',
  'Scoring and ranking plans',
];
const STEP_MS = 380;

function clearAll(ref) {
  ref.current.forEach(clearTimeout);
  ref.current = [];
}

export function useSimulation() {
  const [scenarioId, setScenarioId] = useState('peak');
  const [result, setResult] = useState(null);
  const [status, setStatus] = useState('idle'); // idle | running | ready
  const [step, setStep] = useState(0);
  const [runCount, setRunCount] = useState(0);

  const [stress, setStress] = useState(null);
  const [stressStatus, setStressStatus] = useState('idle');

  const timers = useRef([]); // simulation run
  const stressTimers = useRef([]); // stress test, kept separate so a run can't cancel it
  useEffect(() => {
    const runQueue = timers;
    const stressRun = stressTimers;
    return () => {
      clearAll(runQueue);
      clearAll(stressRun);
    };
  }, []);

  const run = useCallback(() => {
    clearAll(timers);
    const nextRun = runCount + 1;
    setRunCount(nextRun);
    setStatus('running');
    setStep(0);
    RUN_STEPS.forEach((_, i) => {
      timers.current.push(setTimeout(() => setStep(i), i * STEP_MS));
    });
    timers.current.push(
      setTimeout(() => {
        setResult(runSimulation(scenarioId, nextRun));
        setStatus('ready');
      }, RUN_STEPS.length * STEP_MS),
    );
  }, [runCount, scenarioId]);

  const runStress = useCallback(() => {
    clearAll(stressTimers);
    setStressStatus('running');
    const runNumber = Math.max(1, runCount);
    stressTimers.current.push(
      setTimeout(() => {
        setStress({ runNumber, results: runStressTest(SCENARIOS, runNumber) });
        setStressStatus('ready');
      }, 900),
    );
  }, [runCount]);

  // Results belong to one scenario; flag them as stale when the selection changes.
  const isStale = Boolean(result) && result.meta.scenarioId !== scenarioId;

  return {
    scenarioId,
    setScenarioId,
    result,
    status,
    step,
    runCount,
    run,
    isStale,
    stress,
    stressStatus,
    runStress,
  };
}
