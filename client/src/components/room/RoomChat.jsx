import { useEffect, useRef, useState } from 'react';
import { CHAT_MAX } from '@runrun/shared/protocol';
import { useGameStore } from '../../store/gameStore.js';
import { CloseIcon, SendIcon } from './icons.jsx';

const time = (at) => new Date(at).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });

/**
 * Chat temporal de la sala. Los mensajes solo viven en memoria mientras estás
 * en la sala: el servidor los retransmite sin guardarlos y al salir se borran.
 */
export function RoomChat({ client, myId, onClose, autoFocus = false }) {
  const chat = useGameStore((s) => s.chat);
  const [text, setText] = useState('');
  const listRef = useRef(null);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat.length]);

  const send = (e) => {
    e.preventDefault();
    const clean = text.trim();
    if (!clean) return;
    client.sendChat(clean);
    setText('');
  };

  return (
    <section className="room-chat" aria-label="Chat de la sala">
      <header className="panel-head">
        <h2>Chat <small>temporal · se borra al salir</small></h2>
        {onClose && (
          <button type="button" className="icon-btn small" onClick={onClose} aria-label="Cerrar chat"><CloseIcon /></button>
        )}
      </header>
      <ol className="chat-list" ref={listRef} aria-live="polite">
        {chat.length === 0 && <li className="chat-empty">Saluda a la parrilla 👋</li>}
        {chat.map((m) =>
          m.system ? (
            <li key={m.id} className="chat-system">{m.text}</li>
          ) : (
            <li key={m.id} className={`chat-msg ${m.playerId === myId ? 'mine' : ''}`} style={{ '--c': m.color }}>
              {m.playerId !== myId && <b className="chat-author">{m.nickname}</b>}
              <span className="chat-text">{m.text}</span>
              <time>{time(m.at)}</time>
            </li>
          ),
        )}
      </ol>
      <form className="chat-form" onSubmit={send}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={CHAT_MAX}
          placeholder="Escribe un mensaje…"
          aria-label="Mensaje"
          autoComplete="off"
          enterKeyHint="send"
          autoFocus={autoFocus}
        />
        <button type="submit" className="icon-btn send" disabled={!text.trim()} aria-label="Enviar"><SendIcon /></button>
      </form>
    </section>
  );
}
