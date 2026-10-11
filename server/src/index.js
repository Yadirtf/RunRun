import { config } from './config.js';
import { createGameServer } from './app.js';

const { server, close } = createGameServer(config);

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
