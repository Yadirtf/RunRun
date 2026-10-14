import { useEffect, useState } from 'react';
import { useGameStore } from '../store/gameStore.js';
import { useGameState } from '../hooks/useGameState.js';
import { PlayerList } from '../components/PlayerList.jsx';
import { PowerupToggle } from '../components/PowerupToggle.jsx';
import { GarageCard, CarShowroom } from '../components/CarSelector.jsx';
import { QualityPicker } from '../components/QualityPicker.jsx';
import { TrackSection } from '../components/room/TrackSection.jsx';
import { RoomChat } from '../components/room/RoomChat.jsx';
import { CarIcon, ChatIcon, GearIcon, PlayersIcon, TrackIcon } from '../components/room/icons.jsx';
import { TRACKS } from '@runrun/shared/tracks';
import { MAX_PLAYERS } from '@runrun/shared/protocol';
import { enterLandscape } from '../lib/landscape.js';

/** Hay sitio para la columna fija de participantes + chat a la derecha. */
const WIDE_QUERY = '(min-width: 1100px) and (min-height: 560px)';

function useMediaQuery(query) {
  const [match, setMatch] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMatch(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return match;
}

/**
 * Pantalla 2: sala de espera por secciones. Un menú (Coche / Circuito, y
 * Pilotos en pantallas pequeñas) muestra una sola cosa a la vez; a la derecha
 * quedan siempre los participantes, el chat temporal y el botón de salida.
 */
export function RoomLobby({ client }) {
  const { room, me, isHost, myId } = useGameState();
  const setCarModel = useGameStore((s) => s.setCarModel);
  const setColor = useGameStore((s) => s.setColor);
  const showToast = useGameStore((s) => s.showToast);
  const leave = useGameStore((s) => s.leaveRoom);
  const chat = useGameStore((s) => s.chat);
  const wide = useMediaQuery(WIDE_QUERY);
  const [section, setSection] = useState('car');
  const [copied, setCopied] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [seenSeq, setSeenSeq] = useState(0);

  const link = `${window.location.origin}/?room=${room.code}`;
  const track = TRACKS[room.trackId];
  const active = wide && section === 'players' ? 'car' : section;

  // Mensajes sin leer (solo cuenta cuando el chat está oculto en un cajón).
  const chatVisible = wide || chatOpen;
  const lastSeq = chat.at(-1)?.seq ?? 0;
  useEffect(() => {
    if (chatVisible) setSeenSeq(lastSeq);
  }, [chatVisible, lastSeq]);
  const unread = chat.filter((m) => m.seq > seenSeq && !m.system && m.playerId !== myId).length;

  useEffect(() => {
    if (!chatOpen && !settingsOpen) return undefined;
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      setChatOpen(false);
      setSettingsOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [chatOpen, settingsOpen]);

  const copy = async () => {
    try {
      if (navigator.share && window.matchMedia('(pointer: coarse)').matches) {
        await navigator.share({ title: 'RunRun', text: `¡Corre conmigo en RunRun! Sala ${room.code}`, url: link });
      } else {
        await navigator.clipboard.writeText(link);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch (err) {
      if (err?.name !== 'AbortError') showToast(`Copia este enlace: ${link}`, 'info');
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

  const exit = () => {
    client.leaveRoom();
    leave();
  };

  const sections = [
    ['car', 'Coche', CarIcon],
    ['track', 'Circuito', TrackIcon],
    ...(wide ? [] : [['players', `Pilotos ${room.players.length}/${MAX_PLAYERS}`, PlayersIcon]]),
  ];

  const players = (
    <section className="room-players" aria-label="Participantes">
      <header className="panel-head">
        <h2>Participantes <small>{room.players.length}/{MAX_PLAYERS}</small></h2>
      </header>
      <PlayerList players={room.players} myId={myId} onInvite={copy} />
    </section>
  );

  return (
    <div className={`screen room-lobby theme-${track?.theme ?? 'alpine'} ${wide ? 'is-wide' : 'is-compact'}`}>
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
        <button type="button" className="icon-btn" onClick={() => setSettingsOpen(true)} aria-label="Ajustes">
          <GearIcon />
        </button>
      </nav>

      <div className="room-shell">
        <nav className="room-nav enter delay-1" role="tablist" aria-label="Secciones de la sala">
          {sections.map(([id, label, Icon]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={active === id}
              className={active === id ? 'active' : ''}
              onClick={() => setSection(id)}
            >
              <Icon />
              <span>{label}</span>
            </button>
          ))}
        </nav>

        <main className="room-main" key={active}>
          {active === 'car' && me && (
            <section className="car-section swap-in" aria-label="Coche">
              <div className="car-stage">
                <CarShowroom carModel={me.carModel} color={me.color} fill={0.72} />
                <span className="stage-hint">Arrastra para girar</span>
              </div>
              <GarageCard
                className="car-details"
                carModel={me.carModel}
                onCarChange={changeCar}
                color={me.color}
                onColorChange={changeColor}
                takenColors={taken}
                keyboard
              />
            </section>
          )}
          {active === 'track' && (
            <TrackSection trackId={room.trackId} isHost={isHost} onSelect={(id) => client.selectTrack(id)}>
              <PowerupToggle enabled={room.powerups !== false} disabled={!isHost} onChange={(on) => client.setOptions({ powerups: on })} />
            </TrackSection>
          )}
          {active === 'players' && <div className="glass players-section swap-in">{players}</div>}
        </main>

        {wide && (
          <aside className="room-side glass enter delay-2">
            {players}
            <RoomChat client={client} myId={myId} />
            <RaceButton client={client} room={room} me={me} isHost={isHost} />
          </aside>
        )}
      </div>

      {!wide && (
        <footer className="room-dock">
          <RaceButton client={client} room={room} me={me} isHost={isHost} />
          <button type="button" className="icon-btn chat-toggle" onClick={() => setChatOpen(true)} aria-label={`Abrir chat${unread ? ` (${unread} sin leer)` : ''}`}>
            <ChatIcon />
            {unread > 0 && <i className="badge">{unread > 9 ? '9+' : unread}</i>}
          </button>
        </footer>
      )}

      {!wide && chatOpen && (
        <div className="drawer-backdrop" onClick={() => setChatOpen(false)}>
          <div className="chat-drawer glass" onClick={(e) => e.stopPropagation()}>
            <RoomChat client={client} myId={myId} onClose={() => setChatOpen(false)} autoFocus={window.matchMedia('(pointer: fine)').matches} />
          </div>
        </div>
      )}

      {settingsOpen && (
        <div className="modal-backdrop" onClick={() => setSettingsOpen(false)}>
          <div className="modal glass settings-modal" role="dialog" aria-label="Ajustes" onClick={(e) => e.stopPropagation()}>
            <h2>Ajustes</h2>
            <QualityPicker />
            <div className="keys" aria-label="Controles">
              <span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> conducir</span>
              <span><kbd>Espacio</kbd> freno de mano</span>
              <span><kbd>R</kbd> recolocar</span>
              <span><kbd>C</kbd> cámara</span>
              <span><kbd>E</kbd><kbd>Q</kbd> poder adelante / atrás · <kbd>Tab</kbd> cambiar</span>
            </div>
            <div className="invite-box">
              <span className="eyebrow">Enlace de invitación</span>
              <button type="button" className="link-preview" onClick={copy} title="Copiar enlace">{link}</button>
            </div>
            <div className="actions">
              <button type="button" className="btn ghost" onClick={() => setSettingsOpen(false)}>Cerrar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** [INICIAR] para el anfitrión cuando todos están listos; [ESTOY LISTO] para el resto. */
function RaceButton({ client, room, me, isHost }) {
  const others = room.players.filter((p) => !p.isHost);
  const readyCount = others.filter((p) => p.ready).length;
  const allReady = readyCount === others.length;
  return (
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
          ? others.length === 0 ? 'Puedes correr solo o esperar a tus amigos.' : 'Inicia cuando todos estén listos.'
          : 'El anfitrión inicia la carrera.'}
      </small>
    </div>
  );
}
