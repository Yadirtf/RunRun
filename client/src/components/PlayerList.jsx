import { getCar } from '@runrun/shared/cars';
import { MAX_PLAYERS } from '@runrun/shared/protocol';

export function PlayerList({ players, myId }) {
  return (
    <ul className="player-list">
      {players.map((p) => (
        <li key={p.id} className={`player-row ${p.ready || p.isHost ? 'ready' : ''}`}>
          <span className="swatch" style={{ background: p.color }} />
          <span className="pname">
            {p.nickname}
            {p.id === myId && <em> (tú)</em>}
          </span>
          <span className="pcar">{getCar(p.carModel).name}</span>
          <span className="pstate">{p.isHost ? 'Anfitrión' : p.ready ? 'Listo' : 'Esperando'}</span>
        </li>
      ))}
      {Array.from({ length: Math.max(0, MAX_PLAYERS - players.length) }, (_, i) => (
        <li key={`empty-${i}`} className="player-row empty">
          <span className="swatch" />
          <span className="pname">Plaza libre</span>
        </li>
      ))}
    </ul>
  );
}
