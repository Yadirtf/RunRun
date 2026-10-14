import { useEffect, useState } from 'react';
import { NICKNAME_MIN, NICKNAME_MAX, normalizeRoomCode, sanitizeNickname } from '@runrun/shared/protocol';
import { useGameStore } from '../store/gameStore.js';

function inviteCodeFromUrl() {
  return normalizeRoomCode(new URLSearchParams(window.location.search).get('room'));
}

/**
 * Pantalla 1, minimalista: logo, lema, nombre de piloto y crear/unirse.
 * El coche, la pista y los ajustes se eligen ya dentro de la sala.
 * Abre el modal de código si llega un enlace ?room=.
 */
export function MainLobby({ client }) {
  const nickname = useGameStore((s) => s.nickname);
  const setNickname = useGameStore((s) => s.setNickname);
  const carModel = useGameStore((s) => s.carModel);
  const color = useGameStore((s) => s.color);
  const connection = useGameStore((s) => s.connection);
  const [invite] = useState(inviteCodeFromUrl);
  const [joinOpen, setJoinOpen] = useState(false);
  const [code, setCode] = useState(invite ?? '');
  const [touched, setTouched] = useState(false);

  const validName = sanitizeNickname(nickname);
  const online = connection === 'connected';
  const nameError = touched && !validName ? `Entre ${NICKNAME_MIN} y ${NICKNAME_MAX} caracteres` : '';

  const create = () => {
    setTouched(true);
    if (validName && online) client.createRoom(validName, carModel, color);
  };
  const joinCode = (c) => {
    setTouched(true);
    if (validName && c && online) client.joinRoom(c, validName, carModel, color);
  };
  const join = (e) => {
    e?.preventDefault();
    joinCode(normalizeRoomCode(code));
  };
  // Con enlace de invitación el botón principal es "Entrar a la sala": un clic y dentro.
  const primary = invite ? () => joinCode(invite) : create;

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

      <main className="home-hero">
        <header className="brand enter">
          <span className="eyebrow accent">Racing multijugador online</span>
          <h1>RUN<span>RUN</span></h1>
          <p>Crea una sala privada, comparte el código y compite en tiempo real contra tus amigos.</p>
        </header>

        <form
          className="lobby-panel glass enter delay-1"
          onSubmit={(e) => {
            e.preventDefault();
            primary();
          }}
        >
          <label className="field">
            <span>Nombre de piloto</span>
            <input
              value={nickname}
              maxLength={NICKNAME_MAX}
              placeholder="p. ej. Checo"
              onChange={(e) => setNickname(e.target.value)}
              onBlur={() => setTouched(true)}
              autoFocus={!nickname && window.matchMedia('(pointer: fine)').matches}
              aria-invalid={Boolean(nameError)}
              autoComplete="nickname"
              enterKeyHint="go"
            />
            <small className="field-error">{nameError}</small>
          </label>

          {invite && (
            <div className="invite-banner">
              Te invitaron a la sala <b>{invite}</b>
            </div>
          )}

          <div className="actions">
            <button type="submit" className="btn primary" disabled={!online}>
              {invite ? 'Entrar a la sala' : 'Crear sala'}
            </button>
            <button type="button" className="btn ghost" onClick={invite ? create : () => setJoinOpen(true)} disabled={!online}>
              {invite ? 'Crear otra sala' : 'Unirse con código'}
            </button>
          </div>
        </form>
      </main>

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
