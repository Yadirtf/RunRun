import { getCar } from '@runrun/shared/cars';
import { MAX_PLAYERS } from '@runrun/shared/protocol';

/** Parrilla de salida: una plaza por posición, con la pintura y el coche de cada piloto. */
export function PlayerList({ players, myId }) {
  const sorted = [...players].sort((a, b) => a.slot - b.slot);
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
      {Array.from({ length: Math.max(0, MAX_PLAYERS - players.length) }, (_, i) => (
        <li key={`empty-${i}`} className="player-row empty">
          <span className="grid-pos">P{players.length + i + 1}</span>
          <span className="pname">Plaza libre</span>
        </li>
      ))}
    </ol>
  );
}
