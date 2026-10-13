import { useState } from 'react';
import { useGameStore } from '../store/gameStore.js';
import { useGameState } from '../hooks/useGameState.js';
import { PlayerList } from '../components/PlayerList.jsx';
import { TrackPicker } from '../components/TrackPicker.jsx';
import { GarageCard, CarShowroom } from '../components/CarSelector.jsx';
import { TRACKS } from '@runrun/shared/tracks';
import { enterLandscape } from '../lib/landscape.js';

/** Pantalla 2: sala de espera con código/enlace, jugadores, pista y [LISTO]/[INICIAR]. */
export function RoomLobby({ client }) {
  const { room, me, isHost, myId } = useGameState();
  const setCarModel = useGameStore((s) => s.setCarModel);
  const setColor = useGameStore((s) => s.setColor);
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
  const changeColor = (c) => {
    setColor(c);
    client.selectCar(me?.carModel ?? 'sport', c);
  };
  const taken = room.players.filter((p) => p.id !== myId).map((p) => p.color);
  const track = TRACKS[room.trackId];
  const readyCount = others.filter((p) => p.ready).length;

  const exit = () => {
    client.leaveRoom();
    leave();
  };

  return (
    <div className={`screen room-lobby theme-${track?.theme ?? 'alpine'}`}>

      <nav className="topbar room-topbar enter">
        <button type="button" className="btn ghost small" onClick={exit}>‹ Salir</button>
        <div className="logo">RUN<span>RUN</span></div>
        <div className="room-code-chip" aria-label={`Código ${room.code.split('').join(' ')}`}>
          <span className="eyebrow">Sala</span>
          <b>{room.code}</b>
          <button type="button" className="btn accent small" onClick={copy}>
            {copied ? '¡Copiado!' : 'Invitar'}
          </button>
        </div>
      </nav>

      <div className="stage">
        <CarShowroom carModel={me?.carModel ?? 'sport'} color={me?.color} shiftX={0} shiftY={0.2} fill={0.34} />
      </div>

      <div className="room-layout">
        <section className="glass room-track enter delay-1">
          <h2>Circuito {isHost ? '' : <small>elige el anfitrión</small>}</h2>
          <TrackPicker value={room.trackId} onChange={(id) => client.selectTrack(id)} disabled={!isHost} />
          <div className="invite-box">
            <span className="eyebrow">Enlace de invitación</span>
            <button type="button" className="link-preview" onClick={copy} title="Copiar enlace">{link}</button>
          </div>
        </section>

        {me && (
          <GarageCard
            className="room-garage enter delay-2"
            carModel={me.carModel}
            onCarChange={changeCar}
            color={me.color}
            onColorChange={changeColor}
            takenColors={taken}
            keyboard
          />
        )}

        <aside className="glass room-players enter delay-3">
          <h2>Parrilla <small>{room.players.length}/8</small></h2>
          <PlayerList players={room.players} myId={myId} />
          <div className="room-cta">
            {isHost ? (
              <button
                type="button"
                className="btn primary btn-lg"
                disabled={!allReady}
                onClick={() => {
                  enterLandscape();
                  client.startRace();
                }}
                title={allReady ? '' : 'Esperando a que todos estén listos'}
              >
                {allReady ? 'Iniciar carrera' : `Esperando ${readyCount}/${others.length} listos`}
              </button>
            ) : (
              <button
                type="button"
                className={`btn btn-lg ${me?.ready ? 'success' : 'primary'}`}
                onClick={() => {
                  if (!me?.ready) enterLandscape();
                  client.setReady(!me?.ready);
                }}
              >
                {me?.ready ? '✓ Listo (cancelar)' : 'Estoy listo'}
              </button>
            )}
            <small className="hint">
              {isHost
                ? others.length === 0 ? 'Puedes correr solo o esperar a que entren tus amigos.' : 'Inicia cuando todos estén listos.'
                : 'El anfitrión inicia la carrera.'}
            </small>
          </div>
        </aside>
      </div>
    </div>
  );
}
