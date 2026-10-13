import express from 'express';
import cors from 'cors';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import { RoomManager } from './RoomManager.js';
import { registerSocketHandlers } from './socketHandlers.js';

const PORT = Number(process.env.PORT) || 3001;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5173';
const origins = CLIENT_ORIGIN.split(',').map((o) => o.trim()).filter(Boolean);
const isProd = process.env.NODE_ENV === 'production';

export function createServer() {
  const app = express();
  app.use(cors({ origin: isProd ? origins : true }));
  app.get('/health', (_req, res) => res.json({ ok: true, uptime: process.uptime() }));

  // Opcional: si existe el build del cliente se sirve desde aquí (despliegue en un solo servicio).
  const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../client/dist');
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
  server.on('close', stop);
  return { app, server, io, rooms };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const { server } = createServer();
  server.listen(PORT, () => console.log(`RunRun server activo en puerto ${PORT}`));
}
