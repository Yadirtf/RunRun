/**
 * Contrato de la comunidad (amigos, solicitudes e invitaciones). Va aparte de
 * protocol.js porque no afecta a la carrera: todo usa el prefijo "community:".
 */
export const COMMUNITY_EVENTS = {
  // cliente → servidor (todos con ack)
  HELLO: 'community:hello',
  SET_NAME: 'community:set_name',
  REFRESH: 'community:refresh',
  REQUEST: 'community:request',
  RESPOND: 'community:respond',
  CANCEL: 'community:cancel',
  REMOVE: 'community:remove',
  INVITE: 'community:invite',
  DISMISS_INVITE: 'community:dismiss_invite',
  ROOM_PEERS: 'community:room_peers',
  PUSH_SUBSCRIBE: 'community:push_subscribe',
  PUSH_UNSUBSCRIBE: 'community:push_unsubscribe',
  LINK_CREATE: 'community:link_create',
  LINK_REDEEM: 'community:link_redeem',
  // servidor → cliente
  STATE: 'community:state',
  INVITE_RECEIVED: 'community:invite_received',
  NOTICE: 'community:notice',
};

/** Estado de un amigo visto por los demás. */
export const PRESENCE = { OFFLINE: 'offline', ONLINE: 'online', LOBBY: 'lobby', RACING: 'racing' };

export const FRIEND_CODE_LENGTH = 8;
/** Mismo alfabeto que los códigos de sala: sin 0/O ni 1/I/L. */
export const FRIEND_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const LINK_CODE_LENGTH = 6;
export const MAX_FRIENDS = 200;
export const MAX_PENDING_REQUESTS = 50;
export const INVITE_TTL_MS = 5 * 60 * 1000;

/** "abcd-2345" o "ABCD2345" → "ABCD2345"; null si no es válido. */
export function normalizeFriendCode(raw) {
  const code = String(raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length !== FRIEND_CODE_LENGTH) return null;
  for (const ch of code) if (!FRIEND_CODE_ALPHABET.includes(ch)) return null;
  return code;
}

/** Para mostrar: "ABCD2345" → "ABCD-2345". */
export function formatFriendCode(code) {
  return code ? `${code.slice(0, 4)}-${code.slice(4)}` : '';
}
