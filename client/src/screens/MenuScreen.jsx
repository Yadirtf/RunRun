import { useState } from 'react';
import { NICKNAME_MIN, NICKNAME_MAX, TRACKS, sanitizeNickname } from '@ranran/shared';
import { useGame } from '../store/gameStore.js';
import ProfileEditor from '../ui/ProfileEditor.jsx';
import TrackOutline from '../ui/TrackOutline.jsx';
import { unlockAudio } from '../engine/Audio.js';

export default function MenuScreen() {
  const profile = useGame((s) => s.profile);
  const setProfile = useGame((s) => s.setProfile);
  const pending = useGame((s) => s.pendingRoomCode);
  const error = useGame((s) => s.error);
  const busy = useGame((s) => s.busy);
  const quality = useGame((s) => s.quality);
  const { createRoom, joinRoom, startPractice, setQuality, setError } = useGame.getState();
  const [code, setCode] = useState(pending);
  const [practiceTrack, setPracticeTrack] = useState(TRACKS[0].id);

  const nickOk = sanitizeNickname(profile.nickname) !== null;
  const guard = (fn) => () => {
    unlockAudio();
    if (!nickOk) return setError(`Escribe un apodo de ${NICKNAME_MIN} a ${NICKNAME_MAX} caracteres.`);
    fn();
  };

  return (
    <div className="screen menu">
      <div className="speedlines" aria-hidden="true" />
      <header className="brand">
        <h1>RAN<span>RAN</span></h1>
        <p>Carreras 3D en circuitos reales · compite con tus amigos</p>
      </header>

      <main className="menu-grid">
        <section className="panel garage">
          <h2>Tu coche</h2>
          <ProfileEditor />
        </section>

        <section className="panel play">
          <label className="field">
            <span>Apodo</span>
            <input
              value={profile.nickname}
              maxLength={NICKNAME_MAX}
              placeholder="Tu nombre de piloto"
              onChange={(e) => setProfile({ nickname: e.target.value })}
              autoFocus={!profile.nickname}
            />
          </label>

          {pending ? (
            <div className="invite">
              <p>Te han invitado a la sala <b className="code">{pending}</b></p>
              <button className="btn primary big" disabled={busy} onClick={guard(() => joinRoom(pending))}>Unirme a la sala</button>
            </div>
          ) : (
            <button className="btn primary big" disabled={busy} onClick={guard(createRoom)}>Crear sala privada</button>
          )}

          <div className="join-row">
            <input
              className="code-input"
              value={code}
              maxLength={5}
              placeholder="CÓDIGO"
              onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
              onKeyDown={(e) => { if (e.key === 'Enter' && code.length === 5) guard(() => joinRoom(code))(); }}
            />
            <button className="btn" disabled={busy || code.length !== 5} onClick={guard(() => joinRoom(code))}>Unirse</button>
          </div>

          {error && <p className="error" role="alert">{error}</p>}

          <div className="divider"><span>o practica en solitario</span></div>
          <div className="track-picker">
            {TRACKS.map((t) => (
              <button
                key={t.id}
                className={`track-card ${practiceTrack === t.id ? 'active' : ''}`}
                onClick={() => setPracticeTrack(t.id)}
              >
                <TrackOutline trackId={t.id} />
                <b>{t.name}</b>
                <small>{t.country} · {(t.length / 1000).toFixed(2)} km</small>
              </button>
            ))}
          </div>
          <button className="btn" onClick={() => { unlockAudio(); startPractice(practiceTrack, 1); }}>Vuelta de práctica</button>

          <div className="settings-row">
            <span>Calidad gráfica</span>
            <div className="segmented">
              {[['low', 'Baja'], ['medium', 'Media'], ['high', 'Alta']].map(([q, label]) => (
                <button key={q} className={quality === q ? 'active' : ''} onClick={() => setQuality(q)}>{label}</button>
              ))}
            </div>
          </div>
        </section>
      </main>

      <footer className="controls-help">
        <span><kbd>W</kbd><kbd>↑</kbd> acelerar</span>
        <span><kbd>S</kbd><kbd>↓</kbd> frenar / atrás</span>
        <span><kbd>A</kbd><kbd>D</kbd> girar</span>
        <span><kbd>Espacio</kbd> freno de mano</span>
        <span><kbd>C</kbd> cámara</span>
        <span><kbd>R</kbd> volver a pista</span>
        <span>Mando compatible</span>
        <a href="/creditos.html" target="_blank" rel="noopener">Créditos y licencias</a>
      </footer>
    </div>
  );
}
