import { formatTime, getCar } from '@ranran/shared';

export default function Results({ results, meId, actions }) {
  const winner = results[0];
  return (
    <div className="overlay results">
      <div className="panel results-panel">
        <h2>Resultados</h2>
        {winner && <p className="winner">🏆 {winner.nickname} {winner.id === meId ? '(¡tú!)' : ''}</p>}
        <table>
          <thead>
            <tr><th>#</th><th>Piloto</th><th>Coche</th><th>Tiempo</th><th>Mejor vuelta</th></tr>
          </thead>
          <tbody>
            {results.map((r) => (
              <tr key={r.id} className={r.id === meId ? 'me' : ''}>
                <td>{r.position}</td>
                <td><span className="dot" style={{ background: r.color }} /> {r.nickname}</td>
                <td>{getCar(r.carId).name}</td>
                <td>{r.finished ? formatTime(r.time) : `No terminó (${r.laps} v.)`}</td>
                <td>{formatTime(r.bestLap)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="actions">{actions}</div>
      </div>
    </div>
  );
}
