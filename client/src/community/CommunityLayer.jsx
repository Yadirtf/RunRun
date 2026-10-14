import { useEffect, useMemo, useState } from 'react';
import { formatFriendCode, normalizeFriendCode } from '@runrun/shared/community';
import { TRACKS } from '@runrun/shared/tracks';
import { useGameStore, selectPhase } from '../store/gameStore.js';
import {
  useCommunityStore, startCommunity, refresh, sendRequest, addPlayer, respond, cancelRequest, removeFriend,
  inviteFriend, dismissInvite, roomPeers, joinRoom, enablePush, disablePush, createLinkCode, redeemLinkCode,
} from './community.js';
import './community.css';

const STATUS_LABEL = { online: 'En línea', lobby: 'En una sala', racing: 'Corriendo', offline: 'Desconectado' };
const STATUS_ORDER = { lobby: 0, online: 1, racing: 2, offline: 3 };

function PeopleIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <path fill="currentColor" d="M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0 2c-3.3 0-7 1.6-7 4.5V20h14v-2.5C16 14.6 12.3 13 9 13Zm7.5-2.2a3.3 3.3 0 1 0-1.3-6.4 5.9 5.9 0 0 1 0 6.2c.4.1.8.2 1.3.2Zm1.6 2.4a5.4 5.4 0 0 1 1.9 4.3V20h3v-2.2c0-2.2-2.3-3.9-4.9-4.6Z" />
    </svg>
  );
}

/**
 * Capa de comunidad que se monta sobre cualquier pantalla de menú: botón
 * "Amigos" con contador, panel lateral y tarjeta emergente de invitación.
 * Durante la carrera no se muestra nada (las invitaciones esperan en el panel).
 */
export function CommunityLayer() {
  const phase = useGameStore(selectPhase);
  const open = useCommunityStore((s) => s.panelOpen);
  const ready = useCommunityStore((s) => s.ready);
  const incoming = useCommunityStore((s) => s.incoming.length);
  const invites = useCommunityStore((s) => s.invites.length);
  const openPanel = useCommunityStore((s) => s.openPanel);

  useEffect(() => startCommunity(), []);

  if (phase === 'RACE') return null;
  const badge = incoming + invites;
  return (
    <>
      {!open && (
        <button
          type="button"
          className="cm-fab"
          onClick={() => openPanel(incoming || invites ? 'friends' : undefined)}
          aria-label={badge ? `Amigos, ${badge} pendientes` : 'Amigos'}
          disabled={!ready}
        >
          <PeopleIcon />
          <span>Amigos</span>
          {badge > 0 && <b className="cm-badge">{badge}</b>}
        </button>
      )}
      {open && <CommunityPanel />}
      <InvitePopup />
    </>
  );
}

function InvitePopup() {
  const popup = useCommunityStore((s) => s.popup);
  const panelOpen = useCommunityStore((s) => s.panelOpen);
  const setPopup = useCommunityStore((s) => s.setPopup);
  useEffect(() => {
    if (!popup) return undefined;
    const t = setTimeout(() => setPopup(null), Math.max(0, Math.min(25_000, popup.expiresAt - Date.now())));
    return () => clearTimeout(t);
  }, [popup, setPopup]);
  if (!popup || panelOpen) return null;
  return (
    <div className="cm-invite-pop glass" role="alertdialog" aria-label="Invitación a una sala">
      <div className="cm-invite-pop-text">
        <span className="eyebrow accent">Invitación</span>
        <strong>{popup.from.name} te invita a correr</strong>
        <small>Sala {popup.roomCode}{popup.trackName ? ` · ${popup.trackName}` : ''}</small>
      </div>
      <div className="cm-row-actions">
        <button type="button" className="btn ghost small" onClick={() => setPopup(null)}>Ahora no</button>
        <button type="button" className="btn primary small" onClick={() => joinRoom(popup.roomCode)}>Unirme</button>
      </div>
    </div>
  );
}

function CommunityPanel() {
  const tab = useCommunityStore((s) => s.tab);
  const setTab = useCommunityStore((s) => s.setTab);
  const close = useCommunityStore((s) => s.closePanel);
  const incoming = useCommunityStore((s) => s.incoming.length);
  const invites = useCommunityStore((s) => s.invites.length);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 15_000);
    const onKey = (e) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => {
      clearInterval(timer);
      window.removeEventListener('keydown', onKey);
    };
  }, [close]);

  return (
    <div className="cm-backdrop" onClick={close}>
      <aside className="cm-panel" role="dialog" aria-label="Amigos" onClick={(e) => e.stopPropagation()}>
        <header className="cm-head">
          <h2>Amigos</h2>
          <button type="button" className="icon-btn" onClick={close} aria-label="Cerrar">×</button>
        </header>
        <nav className="cm-tabs" role="tablist">
          {[['friends', 'Mis amigos', incoming + invites], ['add', 'Agregar', 0], ['settings', 'Ajustes', 0]].map(([id, label, n]) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>
              {label}
              {n > 0 && <b className="cm-badge inline">{n}</b>}
            </button>
          ))}
        </nav>
        <div className="cm-body">
          {tab === 'friends' && <FriendsTab />}
          {tab === 'add' && <AddTab />}
          {tab === 'settings' && <SettingsTab />}
        </div>
      </aside>
    </div>
  );
}

/** Ejecuta una acción del servidor y muestra el error, si hay, como aviso. */
function useAction() {
  const showToast = useGameStore((s) => s.showToast);
  const [busy, setBusy] = useState(null);
  const run = async (key, fn, success) => {
    setBusy(key);
    const res = await fn();
    setBusy(null);
    if (res?.error) showToast(res.error);
    else if (success) showToast(typeof success === 'function' ? success(res) : success, 'info');
    return res;
  };
  return [busy, run];
}

function FriendsTab() {
  const friends = useCommunityStore((s) => s.friends);
  const incoming = useCommunityStore((s) => s.incoming);
  const outgoing = useCommunityStore((s) => s.outgoing);
  const invites = useCommunityStore((s) => s.invites);
  const setTab = useCommunityStore((s) => s.setTab);
  const room = useGameStore((s) => s.room);
  const [busy, run] = useAction();
  const [invited, setInvited] = useState({});
  const [confirmRemove, setConfirmRemove] = useState(null);

  const inLobby = room?.status === 'LOBBY';
  const sorted = useMemo(
    () => [...friends].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.name.localeCompare(b.name)),
    [friends],
  );
  const onlineCount = friends.filter((f) => f.status !== 'offline').length;

  const invite = (f) => run(`inv-${f.id}`, () => inviteFriend(f.id), (res) => {
    setInvited((s) => ({ ...s, [f.id]: true }));
    return res.online ? `Invitación enviada a ${f.name}` : `${f.name} no está conectado: le llegará una notificación si las tiene activas`;
  });

  return (
    <>
      {invites.length > 0 && (
        <section className="cm-section">
          <h3>Invitaciones</h3>
          {invites.map((inv) => (
            <div key={inv.id} className="cm-row cm-row-invite">
              <div className="cm-who">
                <strong>{inv.from.name}</strong>
                <small>Sala {inv.roomCode}{inv.trackName ? ` · ${inv.trackName}` : ''}</small>
              </div>
              <div className="cm-row-actions">
                <button type="button" className="btn ghost small" onClick={() => dismissInvite(inv.id)} aria-label="Descartar">×</button>
                <button type="button" className="btn primary small" onClick={() => joinRoom(inv.roomCode)}>Unirme</button>
              </div>
            </div>
          ))}
        </section>
      )}

      {incoming.length > 0 && (
        <section className="cm-section">
          <h3>Solicitudes recibidas</h3>
          {incoming.map((r) => (
            <div key={r.id} className="cm-row">
              <div className="cm-who">
                <strong>{r.name}</strong>
                <small>{formatFriendCode(r.friendCode)}</small>
              </div>
              <div className="cm-row-actions">
                <button type="button" className="btn ghost small" disabled={busy === `no-${r.id}`} onClick={() => run(`no-${r.id}`, () => respond(r.id, false))}>Rechazar</button>
                <button type="button" className="btn success small" disabled={busy === `ok-${r.id}`} onClick={() => run(`ok-${r.id}`, () => respond(r.id, true), `${r.name} ya es tu amigo`)}>Aceptar</button>
              </div>
            </div>
          ))}
        </section>
      )}

      <section className="cm-section">
        <h3>Amigos <small>{onlineCount} en línea · {friends.length}</small></h3>
        {friends.length === 0 && (
          <div className="cm-empty">
            <p>Aún no tienes amigos guardados. Agrega a tus rivales con su código y la próxima vez invítalos con un toque, sin compartir enlaces.</p>
            <button type="button" className="btn accent small" onClick={() => setTab('add')}>Agregar amigos</button>
          </div>
        )}
        {sorted.map((f) => {
          const inMyRoom = room && f.roomCode === room.code;
          const canJoin = !room && f.status === 'lobby' && !f.full;
          return (
            <div key={f.id} className={`cm-row friend ${f.status}`}>
              <i className="cm-dot" aria-hidden="true" />
              <div className="cm-who">
                <strong>{f.name}</strong>
                <small>
                  {inMyRoom ? 'En tu sala' : STATUS_LABEL[f.status]}
                  {f.status === 'lobby' && !inMyRoom && ` · ${TRACKS[f.trackId]?.name ?? ''} · ${f.players}/8`}
                </small>
              </div>
              <div className="cm-row-actions">
                {confirmRemove === f.id ? (
                  <>
                    <button type="button" className="btn ghost small" onClick={() => setConfirmRemove(null)}>No</button>
                    <button type="button" className="btn primary small" onClick={() => { setConfirmRemove(null); run(`rm-${f.id}`, () => removeFriend(f.id)); }}>Eliminar</button>
                  </>
                ) : (
                  <>
                    {inLobby && !inMyRoom && (
                      <button type="button" className="btn accent small" disabled={busy === `inv-${f.id}` || invited[f.id]} onClick={() => invite(f)}>
                        {invited[f.id] ? 'Invitado ✓' : 'Invitar'}
                      </button>
                    )}
                    {canJoin && <button type="button" className="btn primary small" onClick={() => joinRoom(f.roomCode)}>Unirme</button>}
                    <button type="button" className="cm-more" onClick={() => setConfirmRemove(f.id)} aria-label={`Eliminar a ${f.name}`} title="Eliminar amigo">×</button>
                  </>
                )}
              </div>
            </div>
          );
        })}
        {!inLobby && friends.length > 0 && <p className="hint cm-hint">Crea una sala para invitar a tus amigos con un toque.</p>}
      </section>

      {outgoing.length > 0 && (
        <section className="cm-section">
          <h3>Solicitudes enviadas</h3>
          {outgoing.map((r) => (
            <div key={r.id} className="cm-row">
              <div className="cm-who">
                <strong>{r.name}</strong>
                <small>Pendiente</small>
              </div>
              <div className="cm-row-actions">
                <button type="button" className="btn ghost small" onClick={() => run(`c-${r.id}`, () => cancelRequest(r.id))}>Cancelar</button>
              </div>
            </div>
          ))}
        </section>
      )}
    </>
  );
}

function AddTab() {
  const me = useCommunityStore((s) => s.me);
  const friends = useCommunityStore((s) => s.friends);
  const outgoing = useCommunityStore((s) => s.outgoing);
  const incoming = useCommunityStore((s) => s.incoming);
  const room = useGameStore((s) => s.room);
  const showToast = useGameStore((s) => s.showToast);
  const [code, setCode] = useState('');
  const [busy, run] = useAction();
  const [peers, setPeers] = useState([]);
  const [copied, setCopied] = useState(false);

  // Jugadores de mi sala con cuenta: se recalcula al cambiar la sala o las relaciones.
  const roomKey = room ? `${room.code}:${room.players.map((p) => p.id).join(',')}` : '';
  useEffect(() => {
    if (!room) return setPeers([]);
    let alive = true;
    roomPeers().then((res) => alive && setPeers(res.peers ?? []));
    return () => { alive = false; };
  }, [roomKey, friends.length, outgoing.length, incoming.length]);

  const valid = normalizeFriendCode(code);
  const submit = async (e) => {
    e.preventDefault();
    if (!valid) return;
    const res = await run('code', () => sendRequest(valid), (r) => (r.status === 'accepted' ? `${r.name} ya es tu amigo` : `Solicitud enviada a ${r.name}`));
    if (!res?.error) setCode('');
  };

  const share = async () => {
    const text = `Agrégame en RunRun: mi código de piloto es ${me.friendCodeLabel}`;
    try {
      if (navigator.share && window.matchMedia('(pointer: coarse)').matches) await navigator.share({ title: 'RunRun', text, url: `${window.location.origin}/?friends=1` });
      else await navigator.clipboard.writeText(me.friendCodeLabel);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      showToast(`Tu código: ${me.friendCodeLabel}`, 'info');
    }
  };

  const nameOf = (playerId) => room?.players.find((p) => p.id === playerId)?.nickname ?? 'Piloto';
  const strangers = peers.filter((p) => p.relation !== 'friend');

  return (
    <>
      {me && (
        <section className="cm-section cm-mycode">
          <span className="eyebrow">Tu código de piloto</span>
          <div className="cm-code-line">
            <b>{me.friendCodeLabel}</b>
            <button type="button" className="btn accent small" onClick={share}>{copied ? '¡Copiado!' : 'Compartir'}</button>
          </div>
          <small className="hint">Pásalo a tus amigos para que te agreguen. Apareces como <b>{me.name}</b>.</small>
        </section>
      )}

      <section className="cm-section">
        <h3>Agregar por código</h3>
        <form className="cm-add" onSubmit={submit}>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 9))}
            placeholder="ABCD-2345"
            aria-label="Código de amigo"
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
          />
          <button type="submit" className="btn primary small" disabled={!valid || busy === 'code'}>Enviar</button>
        </form>
      </section>

      {room && (
        <section className="cm-section">
          <h3>En esta sala</h3>
          {strangers.length === 0 && <p className="hint cm-hint">{peers.length ? 'Ya eres amigo de todos los de la sala.' : 'Cuando entren otros pilotos podrás agregarlos aquí.'}</p>}
          {strangers.map((p) => (
            <div key={p.playerId} className="cm-row">
              <div className="cm-who"><strong>{nameOf(p.playerId)}</strong></div>
              <div className="cm-row-actions">
                {p.relation === 'outgoing' && <small className="hint">Solicitud enviada</small>}
                {p.relation === 'incoming' && (
                  <button type="button" className="btn success small" onClick={() => run(`ok-${p.userId}`, () => respond(p.userId, true), `${nameOf(p.playerId)} ya es tu amigo`)}>Aceptar</button>
                )}
                {p.relation === 'none' && (
                  <button type="button" className="btn accent small" disabled={busy === p.userId} onClick={() => run(p.userId, () => addPlayer(p.userId), `Solicitud enviada a ${nameOf(p.playerId)}`)}>Agregar</button>
                )}
              </div>
            </div>
          ))}
        </section>
      )}
    </>
  );
}

const PUSH_COPY = {
  unsupported: 'Este navegador no admite notificaciones web.',
  'ios-install': 'En iPhone y iPad: toca Compartir → «Añadir a pantalla de inicio» y abre RunRun desde ese icono para poder activarlas.',
  denied: 'Las bloqueaste en este navegador. Actívalas desde los permisos del sitio (icono junto a la dirección) y vuelve aquí.',
  default: 'Te avisamos cuando un amigo te invite a su sala o te envíe una solicitud, aunque RunRun esté cerrado.',
  off: 'Te avisamos cuando un amigo te invite a su sala o te envíe una solicitud, aunque RunRun esté cerrado.',
  working: 'Activando…',
  on: 'Activadas en este dispositivo. Recibirás invitaciones y solicitudes aunque RunRun esté cerrado.',
};

function SettingsTab() {
  const push = useCommunityStore((s) => s.push);
  const me = useCommunityStore((s) => s.me);
  const showToast = useGameStore((s) => s.showToast);
  const [link, setLink] = useState(null);
  const [redeem, setRedeem] = useState('');
  const [confirmSwitch, setConfirmSwitch] = useState(false);
  const [busy, run] = useAction();

  useEffect(() => {
    if (!link) return undefined;
    const t = setTimeout(() => setLink(null), Math.max(0, link.expiresAt - Date.now()));
    return () => clearTimeout(t);
  }, [link]);

  const toggle = async () => {
    if (push === 'on') return disablePush();
    const res = await enablePush();
    if (!res?.error) showToast('Notificaciones activadas', 'info');
    else if (!['default', 'denied', 'unsupported', 'ios-install'].includes(res.error)) {
      showToast('No se pudieron activar las notificaciones en este navegador (en modo incógnito no funcionan).');
    }
  };
  const canToggle = ['default', 'off', 'on'].includes(push);

  const doRedeem = async (e) => {
    e.preventDefault();
    if (!confirmSwitch) return setConfirmSwitch(true);
    setConfirmSwitch(false);
    const res = await run('redeem', () => redeemLinkCode(redeem), 'Cuenta vinculada a este dispositivo');
    if (!res?.error) setRedeem('');
  };

  return (
    <>
      <section className="cm-section">
        <h3>Notificaciones</h3>
        <div className="cm-toggle-row">
          <p className="hint">{PUSH_COPY[push]}</p>
          {canToggle && (
            <button type="button" className={`cm-switch ${push === 'on' ? 'on' : ''}`} role="switch" aria-checked={push === 'on'} onClick={toggle} aria-label="Notificaciones">
              <i />
            </button>
          )}
        </div>
      </section>

      <section className="cm-section">
        <h3>Usar tu cuenta en otro dispositivo</h3>
        <p className="hint">Tus amigos se guardan en esta cuenta. Para verlos también en tu móvil, tablet u otro navegador, genera un código y escríbelo allí.</p>
        {link ? (
          <div className="cm-code-line">
            <b>{link.code}</b>
            <small className="hint">Válido 10 min, un solo uso</small>
          </div>
        ) : (
          <button type="button" className="btn ghost small" disabled={busy === 'link'} onClick={() => run('link', async () => {
            const res = await createLinkCode();
            if (!res.error) setLink(res);
            return res;
          })}>Generar código</button>
        )}
        <form className="cm-add" onSubmit={doRedeem}>
          <input
            value={redeem}
            onChange={(e) => { setRedeem(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6)); setConfirmSwitch(false); }}
            placeholder="Código de otro dispositivo"
            aria-label="Código de vinculación"
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
          />
          <button type="submit" className={`btn small ${confirmSwitch ? 'primary' : 'ghost'}`} disabled={redeem.length !== 6 || busy === 'redeem'}>
            {confirmSwitch ? 'Confirmar' : 'Vincular'}
          </button>
        </form>
        {confirmSwitch && <small className="field-error">Este dispositivo dejará la cuenta {me?.friendCodeLabel} y usará la del código.</small>}
      </section>
    </>
  );
}
