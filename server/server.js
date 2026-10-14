import express from 'express';
import cors from 'cors';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import { RoomManager } from './RoomManager.js';
import { registerSocketHandlers } from './socketHandlers.js';
import { CommunityStore } from './community/CommunityStore.js';
import { PushService } from './community/PushService.js';
import { registerCommunityHandlers } from './community/communityHandlers.js';

const PORT = Number(process.env.PORT) || 3001;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5173';
const origins = CLIENT_ORIGIN.split(',').map((o) => o.trim()).filter(Boolean);
const isProd = process.env.NODE_ENV === 'production';
const here = path.dirname(fileURLToPath(import.meta.url));
/** Base de datos de la comunidad (amigos). En los tests, en memoria. */
const DEFAULT_DB = process.env.COMMUNITY_DB_PATH
  || (process.env.NODE_TEST_CONTEXT ? ':memory:' : path.join(here, 'data', 'runrun.db'));

export function createServer({ dbPath = DEFAULT_DB } = {}) {
  const app = express();
  app.use(cors({ origin: isProd ? origins : true }));
  app.get('/health', (_req, res) => res.json({ ok: true, uptime: process.uptime() }));

  // Opcional: si existe el build del cliente se sirve desde aquí (despliegue en un solo servicio).
  const dist = path.resolve(here, '../client/dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist, { maxAge: '1h', index: false }));
    app.get(/^\/(?!socket\.io|health).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  const server = http.createServer(app);
  const io = new Server(server, {
    cors: { origin: isProd ? origins : true, methods: ['GET', 'POST'] },
    transports: ['websocket', 'polling'],
    maxHttpBufferSize: 1e5,
  });
  const rooms = new RoomManager();
  const stop = registerSocketHandlers(io, rooms);
  const community = new CommunityStore(dbPath);
  const push = new PushService(community);
  const stopCommunity = registerCommunityHandlers(io, rooms, { store: community, push });
  server.on('close', () => {
    stop();
    stopCommunity();
    community.close();
  });
  return { app, server, io, rooms, community, push };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const { server } = createServer();
  server.listen(PORT, () => console.log(`RunRun server activo en puerto ${PORT}`));
}
