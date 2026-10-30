export default function SignalTimingBars({ result, selectedId, onSelect }) {
  return (
    <div role="list" aria-label="Signal timing per plan">
      {result.plans.map((p) => {
        const t = p.timing;
        const pct = (v) => `${(v / t.cycle) * 100}%`;
        const lostHalf = t.lostTime / 2;
        const selected = p.plan.id === selectedId;
        return (
          <div
            key={p.plan.id}
            className="timing-row"
            role="listitem"
            style={{ opacity: selectedId && !selected ? 0.62 : 1 }}
          >
            <button
              type="button"
              className="name"
              onClick={() => onSelect?.(p.plan.id)}
              style={{ background: 'none', border: 0, padding: 0, cursor: onSelect ? 'pointer' : 'default', textAlign: 'left' }}
              aria-pressed={onSelect ? selected : undefined}
            >
              {p.plan.name}
              {p.plan.id === result.recommendedId && <span className="tag tag-rec">★</span>}
            </button>
            <div className="timing-bar num" aria-label={`N–S green ${t.greenNS} s, E–W green ${t.greenEW} s, lost time ${t.lostTime} s`}>
              <span className="seg-ns" style={{ width: pct(t.greenNS) }}>N–S {t.greenNS}s</span>
              <span className="seg-lost" style={{ width: pct(lostHalf) }} />
              <span className="seg-ew" style={{ width: pct(t.greenEW) }}>E–W {t.greenEW}s</span>
              <span className="seg-lost" style={{ width: pct(lostHalf) }} />
            </div>
            <div className="cyc num">
              {t.cycleRange[0] === t.cycleRange[1] ? `${t.cycle} s` : `${t.cycleRange[0]}–${t.cycleRange[1]} s`}
            </div>
          </div>
        );
      })}
      <div className="diagram-legend" style={{ justifyContent: 'flex-start', marginTop: 8 }}>
        <span className="legend-item"><span className="swatch seg-ns" /> N–S green</span>
        <span className="legend-item"><span className="swatch seg-ew" /> E–W green</span>
        <span className="legend-item"><span className="swatch seg-lost" /> Amber + all-red (lost time)</span>
        <span className="legend-item">Adaptive shows its starting split; it re-times every 5 min.</span>
      </div>
    </div>
  );
}
