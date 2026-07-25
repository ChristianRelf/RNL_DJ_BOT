import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
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
import { fetchAudio, ImportError } from './tools/importUrl';
import { DECK_IDS, type MediaItem, type SessionUser } from './protocol';

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

    // Failures go back to /login rather than /, so the reason lands beside the
    // button that failed instead of on the marketing page.
    if (error) return res.redirect(`/login?error=${encodeURIComponent(error)}`);
    if (!code || !state || !expected || state !== expected) {
      return res.redirect('/login?error=' + encodeURIComponent('Login state mismatch — try again.'));
    }

    try {
      const profile = await exchangeCode(code);
      const fallbackName = profile.global_name || profile.username;
      const access = await checkAccess(profile.id, fallbackName);
      if (!access.allowed) {
        return res.redirect('/login?error=' + encodeURIComponent(access.reason ?? 'Access denied.'));
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
      res.redirect('/login?error=' + encodeURIComponent((err as Error).message));
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

  // ------------------------------------------------------------ tools ---

  /**
   * Live deck positions for lighting desks, overlays and video.
   *
   * Consumers of this cannot hold a Discord session, so the key in the query
   * string is the credential. It is rotated every time the tool is switched on,
   * and the endpoint disappears entirely when it is off.
   */
  app.get('/api/timecode', (req, res) => {
    const tools = store.db.tools;
    if (!tools.timecode) return res.status(404).json({ error: 'The timecode feed is off.' });

    const supplied = String(req.query.key ?? '');
    const expected = tools.timecodeKey;
    // Compared over fixed-length digests so a wrong key cannot be narrowed down
    // by timing the response.
    const ok =
      expected.length > 0 &&
      crypto.timingSafeEqual(
        crypto.createHash('sha256').update(supplied).digest(),
        crypto.createHash('sha256').update(expected).digest(),
      );
    if (!ok) return res.status(403).json({ error: 'Bad or missing key.' });

    const state = engine.state();
    res.setHeader('cache-control', 'no-store');
    res.setHeader('access-control-allow-origin', '*');
    res.json({
      serverTime: state.serverTime,
      decks: DECK_IDS.map((id) => {
        const deck = state.decks[id];
        return {
          deck: id,
          mediaId: deck.mediaId,
          title: deck.title,
          playing: deck.playing,
          positionMs: deck.positionMs,
          durationMs: deck.durationMs,
          remainingMs: Math.max(0, deck.durationMs - deck.positionMs),
          rate: deck.rate,
          bpm: deck.bpm === null ? null : deck.bpm * deck.rate,
        };
      }),
      mixer: { crossfader: state.mixer.crossfader, master: state.mixer.master },
      voice: { status: state.voice.status, channelName: state.voice.channelName },
    });
  });

  /** Pulls a direct audio link into the pool through the normal ingest path. */
  app.post('/api/media/import', requireUser, express.json({ limit: '4kb' }), async (req, res) => {
    if (!store.db.tools.urlImport) {
      return res.status(403).json({ error: 'URL import is switched off for this rig.' });
    }
    const url = typeof req.body?.url === 'string' ? req.body.url.trim() : '';
    if (!url) return res.status(400).json({ error: 'Give it a link to fetch.' });

    let fetched: Awaited<ReturnType<typeof fetchAudio>> | null = null;
    try {
      fetched = await fetchAudio(url);
      const item = await engine.ingest({
        tempPath: fetched.tempPath,
        originalName: fetched.originalName,
        sizeBytes: fetched.sizeBytes,
        user: req.user as SessionUser,
      });
      res.json({ media: item });
    } catch (err) {
      if (fetched) await fs.promises.unlink(fetched.tempPath).catch(() => undefined);
      const message =
        err instanceof ImportError ? err.message : 'That import failed — check the logs.';
      if (!(err instanceof ImportError)) log.error('import failed:', err);
      res.status(400).json({ error: message });
    }
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
