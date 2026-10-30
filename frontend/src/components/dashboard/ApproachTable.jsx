import { fmtNumber, spillbackLevel } from '../../lib/format.js';

export default function ApproachTable({ planResult }) {
  return (
    <div className="table-wrap">
      <table className="table num">
        <caption className="sr-only">Per-approach simulated performance for {planResult.plan.fullName}</caption>
        <thead>
          <tr>
            <th scope="col">Approach</th>
            <th scope="col">Lanes</th>
            <th scope="col">Demand</th>
            <th scope="col">Green</th>
            <th scope="col">v/c</th>
            <th scope="col">Delay (s)</th>
            <th scope="col">Peak queue</th>
            <th scope="col">Spillback</th>
          </tr>
        </thead>
        <tbody>
          {planResult.approaches.map((a) => {
            const lvl = spillbackLevel(a.spillback);
            return (
              <tr key={a.id}>
                <th scope="row" style={{ fontWeight: 600 }}>{a.label}</th>
                <td>{a.lanes}</td>
                <td>{fmtNumber(a.demand)} veh/h</td>
                <td>{a.green} s</td>
                <td style={{ color: a.x > 1 ? '#fca5a5' : a.x > 0.9 ? '#fcd34d' : undefined }}>{a.x.toFixed(2)}</td>
                <td>{fmtNumber(a.delay, 1)}</td>
                <td>
                  {fmtNumber(a.queuePerLane, 1)} veh · {a.queueM} m
                </td>
                <td>
                  <span className={`delta tone-${lvl.tone}`}>
                    {fmtNumber(a.spillback, 0)}% {lvl.label}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
