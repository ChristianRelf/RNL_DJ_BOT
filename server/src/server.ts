import http from 'node:http';
import { config, ensureDirs } from './config';
import { createLogger, setLogLevel } from './logger';
import { closeDb, db } from './db';
import { importLegacyDb } from './db/migrate';
import { checkVoiceDependencies } from './discord/deps';
import { rigs } from './rigManager';
import { createApp } from './http';
import { createRealtime } from './realtime';

const log = createLogger('boot');

export async function start(): Promise<void> {
  setLogLevel(config.logLevel);
  ensureDirs();

  // Opened and migrated before anything asks it a question. A rig that started
  // against a half-built schema would fail in a way that reads like a Discord
  // problem rather than a database one.
  db();
  importLegacyDb();

  checkVoiceDependencies();
  await rigs.startAll();

  const app = createApp();
  const server = http.createServer(app);
  const io = createRealtime(server);

  await new Promise<void>((resolve) => server.listen(config.http.port, resolve));
  log.info(`control surface on ${config.http.publicUrl} (listening on :${config.http.port})`);
  if (config.http.portalHost) log.info(`portal on https://${config.http.portalHost}`);
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
      await rigs.stopAll();
      closeDb();
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
