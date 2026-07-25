import http from 'node:http';
import { config, ensureDirs } from './config';
import { createLogger, setLogLevel } from './logger';
import { store } from './store';
import { bot } from './discord/bot';
import { startActive } from './discord/bots';
import { verifyAuthAccess } from './discord/gate';
import { attachCommandHandlers, registerCommands } from './discord/commands';
import { checkVoiceDependencies } from './discord/deps';
import { engine } from './engine';
import { createApp } from './http';
import { createRealtime } from './realtime';

const log = createLogger('boot');

export async function start(): Promise<void> {
  setLogLevel(config.logLevel);
  ensureDirs();
  store.load();

  // Handlers first: they are registered against every client the bot connects,
  // including the one `startActive` is about to bring up.
  attachCommandHandlers();
  await startActive();
  checkVoiceDependencies();
  await registerCommands();
  await verifyAuthAccess();
  await engine.start();

  const app = createApp();
  const server = http.createServer(app);
  const io = createRealtime(server);

  await new Promise<void>((resolve) => server.listen(config.http.port, resolve));
  log.info(`control surface on ${config.http.publicUrl} (listening on :${config.http.port})`);
  log.info(`OAuth2 redirect URI must be ${config.http.publicUrl}/api/auth/callback`);

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info(`${signal} received, shutting down`);
    const force = setTimeout(() => process.exit(1), 8_000);
    force.unref();
    try {
      io.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await engine.shutdown();
      await bot.destroy();
    } catch (err) {
      log.warn('shutdown error:', (err as Error).message);
    }
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('unhandledRejection', (reason) => log.error('unhandled rejection:', reason));
  process.on('uncaughtException', (err) => log.error('uncaught exception:', err));
}
