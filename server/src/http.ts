import path from 'node:path';
import fs from 'node:fs';
import express, { type Request, type Response } from 'express';
import cookieParser from 'cookie-parser';
import multer from 'multer';
import {
  attachUser,
  authorizeUrl,
  avatarUrl,
  checkAccess,
  clearSession,
  cookieNames,
  exchangeCode,
  issueSession,
  newState,
  requireUser,
  setStateCookie,
} from './auth';
import { config } from './config';
import { engine } from './engine';
import { store } from './store';
import { createLogger } from './logger';
import type { MediaItem, SessionUser } from './protocol';

const log = createLogger('http');

const upload = multer({
  dest: config.paths.tmpDir,
  limits: { fileSize: config.http.maxUploadBytes, files: 8 },
});

function mediaFilePath(item: MediaItem): string {
  const ext = path.extname(item.originalName).slice(0, 12) || '.bin';
  return path.join(config.paths.mediaDir, `${item.id}${ext}`);
}

export function createApp(): express.Express {
  const app = express();
  app.set('trust proxy', true);
  app.disable('x-powered-by');
  app.use(cookieParser());
  app.use(attachUser);

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, voice: engine.voice.snapshot().status, uptime: process.uptime() });
  });

  // ------------------------------------------------------------- auth ---

  app.get('/api/auth/login', (req, res) => {
    const state = newState();
    setStateCookie(res, state);
    res.redirect(authorizeUrl(state));
  });

  app.get('/api/auth/callback', async (req, res) => {
    const { code, state, error } = req.query as Record<string, string | undefined>;
    const expected = req.cookies?.[cookieNames.state];
    res.clearCookie(cookieNames.state, { path: '/' });

    if (error) return res.redirect(`/?error=${encodeURIComponent(error)}`);
    if (!code || !state || !expected || state !== expected) {
      return res.redirect('/?error=' + encodeURIComponent('Login state mismatch — try again.'));
    }

    try {
      const profile = await exchangeCode(code);
      const fallbackName = profile.global_name || profile.username;
      const access = await checkAccess(profile.id, fallbackName);
      if (!access.allowed) {
        return res.redirect('/?error=' + encodeURIComponent(access.reason ?? 'Access denied.'));
      }
      const user: SessionUser = {
        id: profile.id,
        username: profile.username,
        displayName: access.displayName || fallbackName,
        avatarUrl: avatarUrl(profile),
        isAdmin: access.isAdmin,
      };
      issueSession(res, user);
      log.info(`${user.displayName} signed in`);
      res.redirect('/');
    } catch (err) {
      log.warn('login failed:', (err as Error).message);
      res.redirect('/?error=' + encodeURIComponent((err as Error).message));
    }
  });

  app.post('/api/auth/logout', (req, res) => {
    clearSession(res);
    res.json({ ok: true });
  });

  app.get('/api/me', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Not signed in.' });
    res.json({ user: req.user, publicUrl: config.http.publicUrl });
  });

  // ------------------------------------------------------------ media ---

  app.get('/api/media', requireUser, (_req, res) => {
    res.json({ media: store.listMedia() });
  });

  app.post(
    '/api/media',
    requireUser,
    upload.array('files', 8),
    async (req: Request, res: Response) => {
      const files = (req.files as Express.Multer.File[] | undefined) ?? [];
      if (files.length === 0) return res.status(400).json({ error: 'No files were uploaded.' });

      const created: MediaItem[] = [];
      for (const file of files) {
        try {
          created.push(
            await engine.ingest({
              tempPath: file.path,
              originalName: file.originalname,
              sizeBytes: file.size,
              user: req.user as SessionUser,
            }),
          );
        } catch (err) {
          log.error('ingest failed:', (err as Error).message);
          await fs.promises.unlink(file.path).catch(() => undefined);
        }
      }
      res.json({ media: created });
    },
  );

  /**
   * Serves the original upload so a DJ can pre-listen in their own browser
   * without touching the live mix — the closest thing to a headphone cue when
   * the output bus lives on Discord.
   */
  app.get('/api/media/:id/audio', requireUser, (req, res) => {
    const item = store.getMedia(req.params.id);
    if (!item) return res.status(404).json({ error: 'Not found.' });
    const filePath = mediaFilePath(item);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File is missing.' });
    res.sendFile(filePath, { headers: { 'cache-control': 'private, max-age=3600' } });
  });

  // ----------------------------------------------------------- static ---

  const webDist = config.paths.webDist;
  if (fs.existsSync(webDist)) {
    app.use(
      express.static(webDist, {
        index: false,
        setHeaders: (res, filePath) => {
          if (filePath.includes(`${path.sep}assets${path.sep}`)) {
            res.setHeader('cache-control', 'public, max-age=31536000, immutable');
          }
        },
      }),
    );
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api/') || req.path.startsWith('/socket.io')) return next();
      res.sendFile(path.join(webDist, 'index.html'));
    });
  } else {
    log.warn(`web build not found at ${webDist} — run "npm run build -w web"`);
    app.get('/', (_req, res) => {
      res.status(503).send('Web UI has not been built yet. Run: npm run build -w web');
    });
  }

  app.use((err: Error & { code?: string }, _req: Request, res: Response, _next: express.NextFunction) => {
    if (err?.code === 'LIMIT_FILE_SIZE') {
      res.status(413).json({ error: `Files must be under ${config.http.maxUploadBytes / 1048576} MB.` });
      return;
    }
    log.error('unhandled http error:', err?.message ?? err);
    res.status(500).json({ error: 'Internal error.' });
  });

  return app;
}
