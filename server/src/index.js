import { config } from './config.js';
import { createGameServer } from './app.js';

const { server, close } = createGameServer(config);

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[RanRan] El puerto ${config.port} ya está en uso (¿otra instancia del servidor abierta?). Ciérrala o usa otro con PORT=xxxx.`);
    process.exit(1);
  }
  throw err;
});

server.listen(config.port, () => {
  console.log(`[RanRan] servidor escuchando en http://localhost:${config.port}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    console.log(`[RanRan] ${signal}: cerrando…`);
    await close();
    process.exit(0);
  });
}
