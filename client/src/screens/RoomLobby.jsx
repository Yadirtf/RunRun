import { useState } from 'react';
import { useGameStore } from '../store/gameStore.js';
import { useGameState } from '../hooks/useGameState.js';
import { PlayerList } from '../components/PlayerList.jsx';
import { TrackPicker } from '../components/TrackPicker.jsx';
import { CarPicker, CarShowroom } from '../components/CarSelector.jsx';

/** Pantalla 2: sala de espera con código/enlace, jugadores, pista y [LISTO]/[INICIAR]. */
export function RoomLobby({ client }) {
  const { room, me, isHost, myId } = useGameState();
  const setCarModel = useGameStore((s) => s.setCarModel);
  const showToast = useGameStore((s) => s.showToast);
  const leave = useGameStore((s) => s.leaveRoom);
  const [copied, setCopied] = useState(false);

  const link = `${window.location.origin}/?room=${room.code}`;
  const others = room.players.filter((p) => !p.isHost);
  const allReady = others.every((p) => p.ready);

  const copy = async () => {
    try {
      if (navigator.share && window.matchMedia('(pointer: coarse)').matches) {
        await navigator.share({ title: 'RunRun', text: `¡Corre conmigo en RunRun! Sala ${room.code}`, url: link });
      } else {
        await navigator.clipboard.writeText(link);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      showToast(`Copia este enlace: ${link}`, 'info');
    }
  };

  const changeCar = (id) => {
    setCarModel(id);
    client.selectCar(id);
  };

  const exit = () => {
    client.leaveRoom();
    leave();
  };

  return (
    <div className="screen room-lobby">
      <CarShowroom carModel={me?.carModel ?? 'sport'} color={me?.color} />
      <div className="room-layout">
        <section className="glass room-code-card enter">
          <span className="label">Código de sala</span>
          <div className="room-code" aria-label={`Código ${room.code.split('').join(' ')}`}>{room.code}</div>
          <button type="button" className="btn accent" onClick={copy}>
            {copied ? '¡Enlace copiado!' : 'Copiar enlace directo'}
          </button>
          <small className="link-preview">{link}</small>
        </section>

        <section className="glass room-track enter delay-1">
          <h2>Pista {isHost ? '' : <small>(elige el anfitrión)</small>}</h2>
          <TrackPicker value={room.trackId} onChange={(id) => client.selectTrack(id)} disabled={!isHost} />
        </section>

        <aside className="glass room-players enter delay-2">
          <h2>Pilotos <small>{room.players.length}/8</small></h2>
          <PlayerList players={room.players} myId={myId} />
        </aside>

        <section className="glass room-actions enter delay-3">
          {me && <CarPicker value={me.carModel} onChange={changeCar} compact />}
          <div className="actions">
            <button type="button" className="btn ghost" onClick={exit}>Salir</button>
            {isHost ? (
              <button
                type="button"
                className="btn primary"
                disabled={!allReady}
                onClick={() => client.startRace()}
                title={allReady ? '' : 'Esperando a que todos estén listos'}
              >
                {allReady ? 'Iniciar carrera' : `Esperando (${others.filter((p) => p.ready).length}/${others.length})`}
              </button>
            ) : (
              <button
                type="button"
                className={`btn ${me?.ready ? 'success' : 'primary'}`}
                onClick={() => client.setReady(!me?.ready)}
              >
                {me?.ready ? '¡Listo! (cancelar)' : 'Estoy listo'}
              </button>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
