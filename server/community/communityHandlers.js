import crypto from 'node:crypto';
import { EVENTS, ROOM_STATUS, MAX_PLAYERS, sanitizeNickname } from '@runrun/shared/protocol';
import {
  COMMUNITY_EVENTS as C, PRESENCE, INVITE_TTL_MS, LINK_CODE_LENGTH,
  normalizeFriendCode, formatFriendCode,
} from '@runrun/shared/community';
import { TRACKS } from '@runrun/shared/tracks';

/** Eventos de sala tras los que cambia la presencia (en sala, corriendo...). */
const ROOM_EVENTS = new Set([EVENTS.CREATE_ROOM, EVENTS.JOIN_ROOM, EVENTS.LEAVE_ROOM, EVENTS.START_RACE, EVENTS.RETURN_TO_LOBBY]);
const INVITE_COOLDOWN_MS = 10_000;

/**
 * Capa de transporte de la comunidad: amigos, solicitudes, presencia e
 * invitaciones a sala, sobre el mismo Socket.io que el juego. Vive aparte de
 * socketHandlers.js; de las salas solo lee (RoomManager.roomOf / rooms).
 */
export function registerCommunityHandlers(io, rooms, { store, push, log = console, now = Date.now } = {}) {
  /** userId → Set<socket> conectados con esa cuenta. */
  const online = new Map();
  /** userId → Map<inviteId, invite> recibidas (en memoria: caducan en minutos). */
  const invites = new Map();
  /** userId → firma de presencia enviada por última vez a sus amigos. */
  const lastPresence = new Map();
  /** "from>to" → instante de la última invitación (evita spam). */
  const inviteCooldown = new Map();

  /** Tras cerrar el servidor no se toca la base de datos (puede haber timers pendientes). */
  let stopped = false;
  const userRoom = (userId) => `user:${userId}`;

  function presenceOf(userId) {
    const sockets = online.get(userId);
    if (!sockets?.size) return { status: PRESENCE.OFFLINE };
    let best = { status: PRESENCE.ONLINE };
    for (const s of sockets) {
      const room = rooms.roomOf(s.id);
      if (!room) continue;
      if (room.status === ROOM_STATUS.LOBBY) {
        return { status: PRESENCE.LOBBY, roomCode: room.code, trackId: room.trackId, players: room.size, full: room.size >= MAX_PLAYERS };
      }
      best = { status: PRESENCE.RACING };
    }
    return best;
  }

  function liveInvites(userId) {
    const mine = invites.get(userId);
    if (!mine) return [];
    const t = now();
    const here = new Set([...(online.get(userId) ?? [])].map((s) => rooms.roomOf(s.id)?.code).filter(Boolean));
    for (const [id, inv] of mine) {
      const room = rooms.rooms.get(inv.roomCode);
      if (inv.expiresAt < t || !room || room.status !== ROOM_STATUS.LOBBY || here.has(inv.roomCode)) mine.delete(id);
    }
    if (!mine.size) invites.delete(userId);
    return [...mine.values()].sort((a, b) => b.createdAt - a.createdAt);
  }

  function stateFor(userId) {
    const me = store.getUser(userId);
    if (!me) return null;
    const { friends, incoming, outgoing } = store.listFor(userId);
    return {
      me: { ...me, friendCodeLabel: formatFriendCode(me.friendCode) },
      friends: friends.map((f) => ({ ...f, ...presenceOf(f.id) })),
      incoming,
      outgoing,
      invites: liveInvites(userId),
    };
  }

  function sendState(userId) {
    if (stopped || !online.get(userId)?.size) return;
    io.to(userRoom(userId)).emit(C.STATE, stateFor(userId));
  }

  /** Si la presencia del usuario cambió, avisa a sus amigos conectados. */
  function checkPresence(userId) {
    if (stopped) return;
    const sig = JSON.stringify(presenceOf(userId));
    if (lastPresence.get(userId) === sig) return;
    if (sig === JSON.stringify({ status: PRESENCE.OFFLINE })) lastPresence.delete(userId);
    else lastPresence.set(userId, sig);
    for (const fid of store.friendIds(userId)) sendState(fid);
  }

  const notice = (userId, payload) => io.to(userRoom(userId)).emit(C.NOTICE, payload);

  io.on('connection', (socket) => {
    let userId = null;
    let bucket = { tokens: 20, at: now() };
    /** Limita las acciones que escriben o notifican: 20 de golpe, 1 cada 2 s. */
    const allow = () => {
      const t = now();
      bucket = { tokens: Math.min(20, bucket.tokens + (t - bucket.at) / 2000), at: t };
      if (bucket.tokens < 1) return false;
      bucket.tokens -= 1;
      return true;
    };

    const attach = (user) => {
      if (userId === user.id) return;
      detach();
      userId = user.id;
      if (!online.has(userId)) online.set(userId, new Set());
      online.get(userId).add(socket);
      socket.data.communityUserId = userId;
      socket.join(userRoom(userId));
    };
    function detach() {
      if (!userId) return;
      const prev = userId;
      online.get(prev)?.delete(socket);
      if (!online.get(prev)?.size) online.delete(prev);
      socket.leave(userRoom(prev));
      socket.data.communityUserId = null;
      userId = null;
      checkPresence(prev);
    }

    /**
     * Registra un manejador con ack que exige sesión iniciada. El manejador
     * devuelve el objeto de respuesta; los errores se devuelven como {error}.
     */
    const handle = (event, fn, { limited = false } = {}) => {
      socket.on(event, (payload, ack) => {
        const reply = typeof ack === 'function' ? ack : () => {};
        if (!userId) return reply({ error: 'Sin sesión de comunidad.' });
        if (limited && !allow()) return reply({ error: 'Vas demasiado rápido. Espera un momento.' });
        try {
          reply(fn(payload && typeof payload === 'object' ? payload : {}) ?? { ok: true });
        } catch (err) {
          log.error?.('[comunidad]', err);
          reply({ error: 'Error inesperado del servidor.' });
        }
      });
    };

    socket.on(C.HELLO, (payload = {}, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      try {
        const name = sanitizeNickname(payload?.name);
        if (!allow()) return reply({ error: 'Vas demasiado rápido. Espera un momento.' });
        let user = store.authenticate(payload?.userId, payload?.token);
        let credentials = null;
        // Una cuenta nueva como mucho por conexión.
        if (!user && userId) user = store.getUser(userId);
        if (!user) {
          const created = store.createUser(name);
          user = created.user;
          credentials = { userId: user.id, token: created.token };
        } else if (name && name !== user.name) {
          store.setName(user.id, name);
        }
        attach(user);
        reply({ ok: true, credentials, vapidPublicKey: push?.publicKey ?? null, state: stateFor(user.id) });
        checkPresence(user.id);
      } catch (err) {
        log.error?.('[comunidad] hello', err);
        reply({ error: 'No se pudo iniciar la comunidad.' });
      }
    });

    handle(C.SET_NAME, ({ name }) => {
      const clean = sanitizeNickname(name);
      if (!clean) return { error: 'Nombre no válido.' };
      store.setName(userId, clean);
      for (const fid of store.friendIds(userId)) sendState(fid);
      return { ok: true };
    }, { limited: true });

    handle(C.REFRESH, () => ({ ok: true, state: stateFor(userId) }));

    handle(C.REQUEST, ({ code, userId: targetId }) => {
      let target = null;
      if (code != null) {
        const normalized = normalizeFriendCode(code);
        if (!normalized) return { error: 'El código de amigo tiene 8 caracteres (p. ej. ABCD-2345).' };
        target = store.findByFriendCode(normalized);
      } else if (typeof targetId === 'string') {
        // Por id solo se puede agregar a alguien con quien compartes sala.
        const myRoom = mySockets().map((s) => rooms.roomOf(s.id)).find(Boolean);
        const shared = myRoom && [...myRoom.players.keys()].some((sid) => socketUser(sid) === targetId);
        if (shared) target = store.getUser(targetId);
      }
      if (!target) return { error: 'No existe ningún piloto con ese código.' };
      const res = store.sendRequest(userId, target.id);
      if (res.error) return res;
      const me = store.getUser(userId);
      sendState(userId);
      sendState(target.id);
      if (res.status === 'accepted') {
        notice(target.id, { kind: 'accepted', name: me.name });
        push?.sendTo(target.id, {
          kind: 'accepted', title: 'Nuevo amigo en RunRun', body: `${me.name} y tú ya son amigos.`, tag: `friend-${userId}`, url: '/?friends=1',
        });
      } else {
        notice(target.id, { kind: 'request', name: me.name });
        push?.sendTo(target.id, {
          kind: 'request', title: 'Solicitud de amistad', body: `${me.name} quiere agregarte como amigo en RunRun.`, tag: `request-${userId}`, url: '/?friends=1',
        }, { ttl: 7 * 24 * 3600 });
      }
      return { ok: true, status: res.status, name: target.name };
    }, { limited: true });

    handle(C.RESPOND, ({ fromId, accept }) => {
      if (typeof fromId !== 'string') return { error: 'Solicitud no válida.' };
      const res = store.respond(userId, fromId, Boolean(accept));
      if (res.error) return res;
      sendState(userId);
      sendState(fromId);
      if (accept) {
        const me = store.getUser(userId);
        notice(fromId, { kind: 'accepted', name: me.name });
        push?.sendTo(fromId, {
          kind: 'accepted', title: 'Solicitud aceptada', body: `${me.name} aceptó tu solicitud de amistad.`, tag: `friend-${userId}`, url: '/?friends=1',
        });
      }
      return { ok: true };
    }, { limited: true });

    handle(C.CANCEL, ({ toId }) => {
      if (typeof toId === 'string' && store.cancelRequest(userId, toId)) {
        sendState(userId);
        sendState(toId);
      }
      return { ok: true };
    });

    handle(C.REMOVE, ({ friendId }) => {
      if (typeof friendId === 'string' && store.removeFriend(userId, friendId)) {
        invites.get(userId)?.forEach((inv, id) => inv.from.id === friendId && invites.get(userId).delete(id));
        invites.get(friendId)?.forEach((inv, id) => inv.from.id === userId && invites.get(friendId).delete(id));
        sendState(userId);
        sendState(friendId);
      }
      return { ok: true };
    });

    handle(C.INVITE, ({ friendId }) => {
      if (typeof friendId !== 'string' || !store.areFriends(userId, friendId)) return { error: 'Solo puedes invitar a tus amigos.' };
      const room = rooms.roomOf(socket.id);
      if (!room) return { error: 'Crea o únete a una sala para invitar.' };
      if (room.status !== ROOM_STATUS.LOBBY) return { error: 'La carrera ya empezó.' };
      if (room.size >= MAX_PLAYERS) return { error: 'La sala está llena.' };
      const friendPresence = presenceOf(friendId);
      if (friendPresence.roomCode === room.code) return { error: 'Ya está en tu sala.' };
      const key = `${userId}>${friendId}`;
      const t = now();
      if (t - (inviteCooldown.get(key) ?? 0) < INVITE_COOLDOWN_MS) return { error: 'Ya le enviaste una invitación hace un momento.' };
      inviteCooldown.set(key, t);

      const me = store.getUser(userId);
      const inbox = invites.get(friendId) ?? new Map();
      for (const [id, inv] of inbox) if (inv.from.id === userId) inbox.delete(id);
      const invite = {
        id: crypto.randomUUID(),
        from: { id: userId, name: me.name },
        roomCode: room.code,
        trackId: room.trackId,
        trackName: TRACKS[room.trackId]?.name ?? '',
        createdAt: t,
        expiresAt: t + INVITE_TTL_MS,
      };
      inbox.set(invite.id, invite);
      invites.set(friendId, inbox);
      io.to(userRoom(friendId)).emit(C.INVITE_RECEIVED, invite);
      sendState(friendId);
      push?.sendTo(friendId, {
        kind: 'invite',
        title: `${me.name} te invita a correr`,
        body: invite.trackName ? `Sala ${room.code} · ${invite.trackName}. Toca para unirte.` : `Sala ${room.code}. Toca para unirte.`,
        tag: `invite-${room.code}`,
        url: `/?room=${room.code}&invite=1`,
        roomCode: room.code,
      }, { ttl: Math.round(INVITE_TTL_MS / 1000), urgency: 'high' });
      return { ok: true, online: friendPresence.status !== PRESENCE.OFFLINE };
    }, { limited: true });

    handle(C.DISMISS_INVITE, ({ inviteId }) => {
      if (invites.get(userId)?.delete(inviteId)) sendState(userId);
      return { ok: true };
    });

    /** Quién de mi sala tiene cuenta y qué relación tengo con cada uno (para "Agregar"). */
    handle(C.ROOM_PEERS, () => {
      const room = rooms.roomOf(socket.id);
      if (!room) return { ok: true, peers: [] };
      const peers = [];
      for (const sid of room.players.keys()) {
        const uid = socketUser(sid);
        if (!uid || uid === userId) continue;
        const relation = store.areFriends(userId, uid) ? 'friend'
          : store.hasRequest(userId, uid) ? 'outgoing'
            : store.hasRequest(uid, userId) ? 'incoming' : 'none';
        peers.push({ playerId: sid, userId: uid, relation });
      }
      return { ok: true, peers };
    });

    handle(C.PUSH_SUBSCRIBE, ({ subscription }) => (
      store.savePushSubscription(userId, subscription) ? { ok: true } : { error: 'Suscripción no válida.' }
    ));

    handle(C.PUSH_UNSUBSCRIBE, ({ endpoint }) => {
      if (typeof endpoint === 'string') store.removePushSubscription(endpoint, userId);
      return { ok: true };
    });

    handle(C.LINK_CREATE, () => ({ ok: true, ...store.createLinkCode(userId) }), { limited: true });

    // Canjear un código no exige sesión previa (es justo para conseguirla).
    socket.on(C.LINK_REDEEM, (payload, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      if (!allow()) return reply({ error: 'Vas demasiado rápido. Espera un momento.' });
      const code = String(payload?.code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (code.length !== LINK_CODE_LENGTH) return reply({ error: 'El código tiene 6 caracteres.' });
      const res = store.redeemLinkCode(code);
      if (!res) return reply({ error: 'Código incorrecto o caducado.' });
      reply({ ok: true, credentials: { userId: res.user.id, token: res.token } });
    });

    // La presencia cambia al entrar/salir de salas: se revisa tras el manejador del juego.
    socket.onAny((event) => {
      if (!ROOM_EVENTS.has(event)) return;
      const before = rooms.roomOf(socket.id);
      setTimeout(() => {
        const after = rooms.roomOf(socket.id);
        for (const room of new Set([before, after])) {
          if (!room) continue;
          for (const sid of room.players.keys()) {
            const uid = socketUser(sid);
            if (uid) checkPresence(uid);
          }
        }
        if (userId) checkPresence(userId);
      }, 30);
    });

    socket.on('disconnect', () => setTimeout(detach, 0));

    function mySockets() {
      return [...(online.get(userId) ?? [])];
    }
  });

  /** socket.id → userId de las cuentas conectadas. */
  function socketUser(socketId) {
    return io.sockets.sockets.get(socketId)?.data.communityUserId ?? null;
  }

  // Red de seguridad: presencia (p. ej. la sala de un amigo empezó a correr) e invitaciones caducadas.
  const sweep = setInterval(() => {
    for (const uid of online.keys()) checkPresence(uid);
    for (const uid of invites.keys()) liveInvites(uid);
    const t = now();
    for (const [k, at] of inviteCooldown) if (t - at > INVITE_COOLDOWN_MS) inviteCooldown.delete(k);
  }, 10_000);

  return () => {
    stopped = true;
    clearInterval(sweep);
  };
}
