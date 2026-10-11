import { randomInt } from 'node:crypto';

// Sin caracteres ambiguos (0/O, 1/I/L) para que los códigos se puedan dictar.
const ROOM_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

export function roomCode(length) {
  let s = '';
  for (let i = 0; i < length; i++) s += ROOM_ALPHABET[randomInt(ROOM_ALPHABET.length)];
  return s;
}

export function randomId(length) {
  let s = '';
  for (let i = 0; i < length; i++) s += ID_ALPHABET[randomInt(ID_ALPHABET.length)];
  return s;
}
