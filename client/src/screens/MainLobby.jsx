import { useEffect, useState } from 'react';
import { NICKNAME_MIN, NICKNAME_MAX, normalizeRoomCode, sanitizeNickname } from '@runrun/shared/protocol';
import { useGameStore } from '../store/gameStore.js';
import { CarShowroom, GarageCard } from '../components/CarSelector.jsx';
import { QualityPicker } from '../components/QualityPicker.jsx';
import { TRACK_IDS, TRACKS } from '@runrun/shared/tracks';

function inviteCodeFromUrl() {
  return normalizeRoomCode(new URLSearchParams(window.location.search).get('room'));
}

/** Pantalla 1: nombre, coche y crear/unirse a sala. Abre el modal si llega un enlace ?room=. */
export function MainLobby({ client }) {
  const nickname = useGameStore((s) => s.nickname);
  const setNickname = useGameStore((s) => s.setNickname);
  const carModel = useGameStore((s) => s.carModel);
  const setCarModel = useGameStore((s) => s.setCarModel);
  const color = useGameStore((s) => s.color);
  const setColor = useGameStore((s) => s.setColor);
  const connection = useGameStore((s) => s.connection);
  const [invite] = useState(inviteCodeFromUrl);
  const [joinOpen, setJoinOpen] = useState(Boolean(invite));
  const [code, setCode] = useState(invite ?? '');
  const [touched, setTouched] = useState(false);

  const validName = sanitizeNickname(nickname);
  const online = connection === 'connected';
  const nameError = touched && !validName ? `Entre ${NICKNAME_MIN} y ${NICKNAME_MAX} caracteres` : '';

  const create = () => {
    setTouched(true);
    if (validName && online) client.createRoom(validName, carModel, color);
  };
  const join = (e) => {
    e?.preventDefault();
    setTouched(true);
    const c = normalizeRoomCode(code);
    if (validName && c && online) client.joinRoom(c, validName, carModel, color);
  };

  useEffect(() => {
    if (!joinOpen) return undefined;
    const onKey = (e) => e.key === 'Escape' && setJoinOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [joinOpen]);

  return (
    <div className="screen main-lobby">
      <div className="speedlines" aria-hidden="true">
        {Array.from({ length: 14 }, (_, i) => <i key={i} style={{ '--i': i }} />)}
      </div>

      <nav className="topbar enter">
        <div className="logo">RUN<span>RUN</span></div>
        <div className="topbar-meta">
          <span>{TRACK_IDS.length} circuitos</span>
          <span>Hasta 8 pilotos</span>
          <span>Online</span>
        </div>
      </nav>

      <div className="stage">
        <CarShowroom carModel={carModel} color={color} shiftX={0.12} fill={0.4} />
      </div>

      <div className="home-grid">
        <div className="home-left">
          <header className="brand enter delay-1">
            <span className="eyebrow accent">Racing multijugador online</span>
            <h1>RUN<span>RUN</span></h1>
            <p>Crea una sala privada, comparte el código y compite en tiempo real contra tus amigos.</p>
          </header>

          <section className="lobby-panel glass enter delay-2">
            <label className="field">
              <span>Nombre de piloto</span>
              <input
                value={nickname}
                maxLength={NICKNAME_MAX}
                placeholder="p. ej. Checo"
                onChange={(e) => setNickname(e.target.value)}
                onBlur={() => setTouched(true)}
                onKeyDown={(e) => e.key === 'Enter' && create()}
                autoFocus={!nickname && window.matchMedia('(pointer: fine)').matches}
                aria-invalid={Boolean(nameError)}
              />
              <small className="field-error">{nameError}</small>
            </label>

            {invite && (
              <div className="invite-banner">
                Te invitaron a la sala <b>{invite}</b>
              </div>
            )}

            <div className="actions">
              <button type="button" className="btn primary" onClick={create} disabled={!online}>
                Crear sala
              </button>
              <button type="button" className="btn ghost" onClick={() => setJoinOpen(true)} disabled={!online}>
                Unirse con código
              </button>
            </div>
            <div className="keys" aria-label="Controles">
              <span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> conducir</span>
              <span><kbd>Espacio</kbd> freno de mano</span>
              <span><kbd>R</kbd> recolocar</span>
              <span><kbd>C</kbd> cámara</span>
            </div>
            <QualityPicker />
          </section>

          <ul className="track-strip enter delay-3" aria-label="Circuitos">
            {TRACK_IDS.map((id) => (
              <li key={id} className={`theme-${TRACKS[id].theme}`}>
                <strong>{TRACKS[id].name}</strong>
                <span>{TRACKS[id].tagline}</span>
              </li>
            ))}
          </ul>
        </div>

        <GarageCard
          className="home-garage enter delay-2"
          carModel={carModel}
          onCarChange={setCarModel}
          color={color}
          onColorChange={setColor}
        />
      </div>

      {joinOpen && (
        <div className="modal-backdrop" onClick={() => setJoinOpen(false)}>
          <form className="modal glass" onSubmit={join} onClick={(e) => e.stopPropagation()}>
            <h2>Unirse a una sala</h2>
            <p>Escribe el código de 6 caracteres que te compartieron.</p>
            <input
              className="code-input"
              value={code}
              maxLength={7}
              autoFocus
              placeholder="ABC123"
              onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
            />
            {!validName && <small className="field-error">Primero escribe tu nombre de piloto</small>}
            <div className="actions">
              <button type="button" className="btn ghost" onClick={() => setJoinOpen(false)}>Cancelar</button>
              <button type="submit" className="btn primary" disabled={!normalizeRoomCode(code) || !validName || !online}>
                Entrar
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
