import { useState } from 'react';
import { TRACKS, MIN_LAPS, MAX_LAPS, PHASE, getCar, getTrackInfo } from '@ranran/shared';
import { useGame } from '../store/gameStore.js';
import ProfileEditor from '../ui/ProfileEditor.jsx';
import TrackOutline from '../ui/TrackOutline.jsx';
import { unlockAudio } from '../engine/Audio.js';
import { isTouchDevice, enterFullscreen } from '../ui/device.js';

const prepareDevice = () => { unlockAudio(); if (isTouchDevice()) enterFullscreen(); };

export default function LobbyScreen() {
  const room = useGame((s) => s.room);
  const playerId = useGame((s) => s.playerId);
  const connected = useGame((s) => s.connected);
  const { leaveRoom, setReady, updateSettings, startRace, toast } = useGame.getState();
  const [copied, setCopied] = useState(false);
  if (!room) return null;

  const me = room.players.find((p) => p.id === playerId);
  const isHost = room.hostId === playerId;
  const track = getTrackInfo(room.settings.trackId);
  const link = `${location.origin}${location.pathname}?sala=${room.code}`;
  const racing = room.phase !== PHASE.LOBBY;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast('No se pudo copiar; copia el enlace a mano.');
    }
  };

  return (
    <div className="screen lobby">
      <header className="lobby-head">
        <button className="btn ghost" onClick={leaveRoom}>← Salir</button>
        <div className="room-code">
          <span>Sala</span>
          <b className="code">{room.code}</b>
          <button className="btn small" onClick={copy}>{copied ? '¡Copiado!' : 'Copiar enlace'}</button>
        </div>
        <span className={`conn ${connected ? 'ok' : 'bad'}`}>{connected ? 'Conectado' : 'Reconectando…'}</span>
      </header>

      <main className="lobby-grid">
        <section className="panel players">
          <h2>Pilotos <small>{room.players.length}/8</small></h2>
          <ul>
            {room.players.map((p) => (
              <li key={p.id} className={`player ${p.connected ? '' : 'away'}`}>
                <span className="dot" style={{ background: p.color }} />
                <span className="name">{p.nickname}{p.id === playerId && <em> (tú)</em>}</span>
                <span className="car">{getCar(p.carId).name}</span>
                {p.isHost ? <span className="tag host">Anfitrión</span>
                  : <span className={`tag ${p.ready ? 'ready' : ''}`}>{p.ready ? 'Listo' : 'Esperando'}</span>}
              </li>
            ))}
          </ul>
          {room.players.length < 2 && <p className="muted">Comparte el enlace para que tus amigos se unan.</p>}
        </section>

        <section className="panel race-settings">
          <h2>Carrera</h2>
          <div className="track-picker">
            {TRACKS.map((t) => (
              <button
                key={t.id}
                className={`track-card ${room.settings.trackId === t.id ? 'active' : ''}`}
                disabled={!isHost || racing}
                onClick={() => updateSettings({ trackId: t.id })}
              >
                <TrackOutline trackId={t.id} />
                <b>{t.name}</b>
                <small>{t.country} · {(t.length / 1000).toFixed(2)} km</small>
              </button>
            ))}
          </div>
          <div className="settings-row">
            <span>Vueltas</span>
            <div className="stepper">
              <button disabled={!isHost || racing || room.settings.laps <= MIN_LAPS} onClick={() => updateSettings({ laps: room.settings.laps - 1 })}>−</button>
              <b>{room.settings.laps}</b>
              <button disabled={!isHost || racing || room.settings.laps >= MAX_LAPS} onClick={() => updateSettings({ laps: room.settings.laps + 1 })}>+</button>
            </div>
          </div>
          <p className="muted">{track.fullName} · {((track.length * room.settings.laps) / 1000).toFixed(1)} km en total</p>

          {racing ? (
            <p className="notice">Hay una carrera en curso. Entrarás en la siguiente.</p>
          ) : isHost ? (
            <button className="btn primary big" disabled={!room.canStart} onClick={() => { prepareDevice(); startRace(); }}>
              {room.canStart ? 'Iniciar carrera' : 'Esperando a que todos estén listos…'}
            </button>
          ) : (
            <button className={`btn big ${me?.ready ? 'ready' : 'primary'}`} onClick={() => { prepareDevice(); setReady(!me?.ready); }}>
              {me?.ready ? 'Listo ✓ (pulsa para cancelar)' : 'Estoy listo'}
            </button>
          )}
        </section>

        <section className="panel garage">
          <h2>Tu coche</h2>
          <ProfileEditor takenColors={room.players.filter((p) => p.id !== playerId).map((p) => p.color)} />
        </section>
      </main>
    </div>
  );
}
