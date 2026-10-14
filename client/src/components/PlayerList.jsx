import { getCar } from '@runrun/shared/cars';
import { MAX_PLAYERS } from '@runrun/shared/protocol';

/**
 * Parrilla de salida: una fila por piloto (posición, pintura, coche y estado).
 * Las plazas libres se resumen en una sola fila para no alargar la lista.
 */
export function PlayerList({ players, myId, onInvite }) {
  const sorted = [...players].sort((a, b) => a.slot - b.slot);
  const free = Math.max(0, MAX_PLAYERS - players.length);
  return (
    <ol className="player-list">
      {sorted.map((p, i) => (
        <li key={p.id} className={`player-row ${p.ready || p.isHost ? 'ready' : ''} ${p.id === myId ? 'me' : ''}`} style={{ '--c': p.color }}>
          <span className="grid-pos">P{i + 1}</span>
          <span className="pname">
            {p.nickname}
            {p.id === myId && <em> tú</em>}
          </span>
          <span className="pcar">{getCar(p.carModel).name}</span>
          <span className="pstate">{p.isHost ? 'Anfitrión' : p.ready ? 'Listo' : 'Esperando'}</span>
        </li>
      ))}
      {free > 0 && (
        <li className="player-row empty">
          <span className="pname">{free === 1 ? '1 plaza libre' : `${free} plazas libres`}</span>
          {onInvite && (
            <button type="button" className="link-btn" onClick={onInvite}>Invitar</button>
          )}
        </li>
      )}
    </ol>
  );
}
