import { create } from 'zustand';
import { sanitizeNickname, normalizeRoomCode } from '@runrun/shared/protocol';
import { COMMUNITY_EVENTS as C } from '@runrun/shared/community';
import { getSocketClient } from '../net/SocketClient.js';
import { useGameStore } from '../store/gameStore.js';

const ACCOUNT_KEY = 'runrun:account';

function loadAccount() {
  try {
    const raw = JSON.parse(localStorage.getItem(ACCOUNT_KEY) || 'null');
    return raw?.userId && raw?.token ? raw : null;
  } catch {
    return null;
  }
}
function saveAccount(credentials) {
  try {
    localStorage.setItem(ACCOUNT_KEY, JSON.stringify(credentials));
  } catch {
    /* modo privado: la cuenta dura lo que la pestaña */
  }
}

/**
 * Estado de la comunidad (amigos, solicitudes, invitaciones y notificaciones).
 * Store propio para no mezclarlo con el de la carrera.
 */
export const useCommunityStore = create((set) => ({
  ready: false,
  me: null,
  friends: [],
  incoming: [],
  outgoing: [],
  invites: [],
  /** Invitación recién llegada que se muestra como tarjeta emergente. */
  popup: null,
  panelOpen: false,
  tab: 'friends',
  /** unsupported | ios-install | default | denied | on | off | working */
  push: 'default',
  vapidPublicKey: null,
  openPanel: (tab) => set((s) => ({ panelOpen: true, tab: tab ?? s.tab })),
  closePanel: () => set({ panelOpen: false }),
  setTab: (tab) => set({ tab }),
  setPopup: (popup) => set({ popup }),
}));

/** Para que otras pantallas abran el panel (p. ej. un botón "Amigos" propio). */
export const openCommunity = (tab) => useCommunityStore.getState().openPanel(tab);

const store = useCommunityStore;
let client = null;
let account = loadAccount();
const call = (event, payload = {}) => new Promise((resolve) => {
  if (!client?.socket.connected) return resolve({ error: 'Sin conexión con el servidor.' });
  const timer = setTimeout(() => resolve({ error: 'El servidor no respondió.' }), 8000);
  client.socket.emit(event, payload, (res) => {
    clearTimeout(timer);
    resolve(res ?? { error: 'Respuesta vacía.' });
  });
});

function applyState(state) {
  if (!state) return;
  store.setState({ ready: true, me: state.me, friends: state.friends, incoming: state.incoming, outgoing: state.outgoing, invites: state.invites });
}

function currentName() {
  return sanitizeNickname(useGameStore.getState().nickname);
}

async function hello() {
  const res = await call(C.HELLO, { ...(account ?? {}), name: currentName() });
  if (res.error) return;
  if (res.credentials) {
    account = res.credentials;
    saveAccount(account);
  }
  store.setState({ vapidPublicKey: res.vapidPublicKey });
  applyState(res.state);
  syncPush();
}

let started = false;
/** Se llama una vez al montar la app. */
export function startCommunity() {
  if (started) return;
  started = true;
  client = getSocketClient();
  const s = client.socket;
  s.on('connect', hello);
  if (s.connected) hello();
  s.on(C.STATE, applyState);
  s.on(C.INVITE_RECEIVED, (invite) => store.setState({ popup: invite }));
  s.on(C.NOTICE, ({ kind, name }) => {
    const toast = useGameStore.getState().showToast;
    if (kind === 'request') toast(`${name} te envió una solicitud de amistad`, 'info');
    if (kind === 'accepted') toast(`${name} y tú ya son amigos`, 'info');
  });

  // Mantener el nombre de la cuenta igual al nombre de piloto.
  let nameTimer = null;
  useGameStore.subscribe((st, prev) => {
    if (st.nickname === prev.nickname) return;
    clearTimeout(nameTimer);
    nameTimer = setTimeout(() => {
      const name = currentName();
      if (name && store.getState().me && name !== store.getState().me.name) call(C.SET_NAME, { name });
    }, 800);
  });

  // Clic en una notificación con la app ya abierta: el service worker nos pasa la URL.
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', (e) => {
      const msg = e.data || {};
      if (msg.type === 'navigate') handleUrl(new URL(msg.url, window.location.origin));
      if (msg.type === 'push' && msg.data?.kind === 'invite') call(C.REFRESH).then((r) => applyState(r.state));
    });
  }
  handleUrl(new URL(window.location.href), { initial: true });
}

/** ?friends=1 abre el panel; ?room=X&invite=1 entra directo a la sala si ya tienes nombre. */
function handleUrl(url, { initial = false } = {}) {
  const params = url.searchParams;
  if (params.has('friends')) openCommunity('friends');
  const code = normalizeRoomCode(params.get('room'));
  if (code && params.has('invite')) {
    if (initial) {
      // Al abrir desde una notificación: esperar a estar conectado.
      const tryJoin = () => joinRoom(code, { quiet: true });
      if (client.socket.connected) tryJoin();
      else client.socket.once('connect', tryJoin);
    } else {
      joinRoom(code);
    }
  }
  if (initial && (params.has('friends') || params.has('invite'))) {
    const clean = new URL(window.location.href);
    clean.searchParams.delete('friends');
    clean.searchParams.delete('invite');
    window.history.replaceState(window.history.state, '', clean);
  }
}

// ----- Acciones -----

export async function refresh() {
  const res = await call(C.REFRESH);
  applyState(res.state);
  return res;
}

export const sendRequest = (code) => call(C.REQUEST, { code });
export const addPlayer = (userId) => call(C.REQUEST, { userId });
export const respond = (fromId, accept) => call(C.RESPOND, { fromId, accept });
export const cancelRequest = (toId) => call(C.CANCEL, { toId });
export const removeFriend = (friendId) => call(C.REMOVE, { friendId });
export const inviteFriend = (friendId) => call(C.INVITE, { friendId });
export const roomPeers = () => call(C.ROOM_PEERS);
export const createLinkCode = () => call(C.LINK_CREATE);

export function dismissInvite(inviteId) {
  store.setState((s) => ({
    invites: s.invites.filter((i) => i.id !== inviteId),
    popup: s.popup?.id === inviteId ? null : s.popup,
  }));
  return call(C.DISMISS_INVITE, { inviteId });
}

/** Cambia este dispositivo a la cuenta del código (la actual se abandona). */
export async function redeemLinkCode(code) {
  const res = await call(C.LINK_REDEEM, { code });
  if (res.error) return res;
  account = res.credentials;
  saveAccount(account);
  await hello();
  return res;
}

/** Entra en la sala de una invitación o de un amigo con el coche y nombre actuales. */
export function joinRoom(roomCode, { quiet = false } = {}) {
  const g = useGameStore.getState();
  const nickname = sanitizeNickname(g.nickname);
  if (!nickname) {
    if (!quiet) g.showToast('Escribe tu nombre de piloto para unirte.');
    store.setState({ panelOpen: false });
    return false;
  }
  if (g.room?.code === roomCode) return true;
  if (g.room && g.room.status !== 'LOBBY') {
    g.showToast('Termina la carrera antes de cambiar de sala.');
    return false;
  }
  // Salir bien de la sala actual para que el resto vea que te fuiste.
  if (g.room) {
    client.leaveRoom();
    g.leaveRoom();
  }
  client.joinRoom(roomCode, nickname, g.carModel, g.color);
  store.setState((s) => ({ panelOpen: false, popup: null, invites: s.invites.filter((i) => i.roomCode !== roomCode) }));
  return true;
}

// ----- Notificaciones push -----

const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches
  || window.matchMedia('(display-mode: fullscreen)').matches || navigator.standalone === true;

function pushSupport() {
  const hasApi = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  // En iPhone/iPad las notificaciones web solo existen con la app añadida a la pantalla de inicio.
  if (isIOS() && !isStandalone()) return 'ios-install';
  if (!hasApi || !window.isSecureContext) return 'unsupported';
  return 'ok';
}

function keyToBytes(base64) {
  const pad = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

function sameKey(buffer, base64) {
  if (!buffer) return false;
  const a = new Uint8Array(buffer);
  const b = keyToBytes(base64);
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

async function registration() {
  const reg = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;
  return reg;
}

/** Al conectar: registra el service worker y renueva la suscripción si ya había permiso. */
async function syncPush() {
  const support = pushSupport();
  if (support !== 'ok') return store.setState({ push: support });
  try {
    const reg = await registration();
    if (Notification.permission === 'denied') return store.setState({ push: 'denied' });
    const sub = await reg.pushManager.getSubscription();
    if (Notification.permission !== 'granted') return store.setState({ push: 'default' });
    if (!sub) return store.setState({ push: 'off' });
    const key = store.getState().vapidPublicKey;
    if (key && !sameKey(sub.options?.applicationServerKey, key)) {
      // El servidor cambió de claves: la suscripción vieja ya no sirve.
      await sub.unsubscribe();
      return enablePush();
    }
    await call(C.PUSH_SUBSCRIBE, { subscription: sub.toJSON() });
    store.setState({ push: 'on' });
  } catch {
    store.setState({ push: 'unsupported' });
  }
}

export async function enablePush() {
  const support = pushSupport();
  if (support !== 'ok') {
    store.setState({ push: support });
    return { error: support };
  }
  const key = store.getState().vapidPublicKey;
  if (!key) return { error: 'Sin conexión con el servidor.' };
  store.setState({ push: 'working' });
  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      store.setState({ push: permission === 'denied' ? 'denied' : 'default' });
      return { error: permission };
    }
    const reg = await registration();
    // subscribe() puede quedarse colgado si el navegador no llega a su servicio push.
    const sub = (await reg.pushManager.getSubscription()) ?? await Promise.race([
      reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyToBytes(key) }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 20_000)),
    ]);
    const res = await call(C.PUSH_SUBSCRIBE, { subscription: sub.toJSON() });
    store.setState({ push: res.error ? 'off' : 'on' });
    return res;
  } catch (err) {
    store.setState({ push: 'off' });
    return { error: err?.message || 'No se pudieron activar.' };
  }
}

export async function disablePush() {
  try {
    const reg = await navigator.serviceWorker.getRegistration('/sw.js');
    const sub = await reg?.pushManager.getSubscription();
    if (sub) {
      await call(C.PUSH_UNSUBSCRIBE, { endpoint: sub.endpoint });
      await sub.unsubscribe();
    }
  } finally {
    store.setState({ push: 'off' });
  }
}
