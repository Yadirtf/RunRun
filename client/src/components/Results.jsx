import { formatTime } from './format.js';

export function Results({ results, myId, isHost, onRematch, onExit }) {
  const winner = results[0];
  return (
    <div className="results-backdrop">
      <div className="results glass">
        <h2>Resultados</h2>
        {winner && <p className="winner">🏆 Gana <b style={{ color: winner.color }}>{winner.nickname}</b></p>}
        <table>
          <thead>
            <tr><th>#</th><th>Piloto</th><th>Tiempo</th><th>Mejor vuelta</th></tr>
          </thead>
          <tbody>
            {results.map((r) => (
              <tr key={r.id} className={r.id === myId ? 'me' : ''}>
                <td>{r.position}</td>
                <td><span className="swatch" style={{ background: r.color }} />{r.nickname}</td>
                <td>{r.finished ? formatTime(r.totalTime) : `No terminó (${r.laps} v.)`}</td>
                <td>{formatTime(r.bestLap)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="actions">
          <button type="button" className="btn ghost" onClick={onExit}>Salir al menú</button>
          {isHost ? (
            <button type="button" className="btn primary" onClick={onRematch}>Volver a la sala</button>
          ) : (
            <span className="hint">El anfitrión puede volver a la sala para la revancha</span>
          )}
        </div>
      </div>
    </div>
  );
}
