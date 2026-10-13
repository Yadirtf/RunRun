import { useEffect, useState } from 'react';
import { NICKNAME_MIN, NICKNAME_MAX, normalizeRoomCode, sanitizeNickname } from '@runrun/shared/protocol';
import { getCar } from '@runrun/shared/cars';
import { useGameStore } from '../store/gameStore.js';
import { CarShowroom, CarPicker } from '../components/CarSelector.jsx';

function inviteCodeFromUrl() {
  return normalizeRoomCode(new URLSearchParams(window.location.search).get('room'));
}

/** Pantalla 1: nombre, coche y crear/unirse a sala. Abre el modal si llega un enlace ?room=. */
export function MainLobby({ client }) {
  const nickname = useGameStore((s) => s.nickname);
  const setNickname = useGameStore((s) => s.setNickname);
  const carModel = useGameStore((s) => s.carModel);
  const setCarModel = useGameStore((s) => s.setCarModel);
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
    if (validName && online) client.createRoom(validName, carModel);
  };
  const join = (e) => {
    e?.preventDefault();
    setTouched(true);
    const c = normalizeRoomCode(code);
    if (validName && c && online) client.joinRoom(c, validName, carModel);
  };

  useEffect(() => {
    if (!joinOpen) return undefined;
    const onKey = (e) => e.key === 'Escape' && setJoinOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [joinOpen]);

  return (
    <div className="screen main-lobby">
      <CarShowroom carModel={carModel} color={getCar(carModel).defaultColor} />
      <div className="speedlines" aria-hidden="true">
        {Array.from({ length: 14 }, (_, i) => <i key={i} style={{ '--i': i }} />)}
      </div>

      <header className="brand enter">
        <h1>RUN<span>RUN</span></h1>
        <p>Carreras 3D multijugador · crea una sala y comparte el código</p>
      </header>

      <section className="lobby-panel glass enter delay-1">
        <label className="field">
          <span>Tu nombre de piloto</span>
          <input
            value={nickname}
            maxLength={NICKNAME_MAX}
            placeholder="p. ej. Checo"
            onChange={(e) => setNickname(e.target.value)}
            onBlur={() => setTouched(true)}
            onKeyDown={(e) => e.key === 'Enter' && create()}
            autoFocus={!nickname}
            aria-invalid={Boolean(nameError)}
          />
          <small className="field-error">{nameError}</small>
        </label>

        <CarPicker value={carModel} onChange={setCarModel} />

        {invite && (
          <div className="invite-banner">
            Te invitaron a la sala <b>{invite}</b>
          </div>
        )}

        <div className="actions">
          <button type="button" className="btn primary" onClick={create} disabled={!online}>
            Crear sala privada
          </button>
          <button type="button" className="btn ghost" onClick={() => setJoinOpen(true)} disabled={!online}>
            Unirse con código
          </button>
        </div>
        <p className="hint">W A S D o flechas para conducir · Espacio freno de mano · R recolocar · C cámara</p>
      </section>

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
