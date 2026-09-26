import crypto from 'node:crypto';
import express from 'express';
import { z } from 'zod';
import { config } from './config';
import { createLogger } from './logger';

const log = createLogger('bug-reports');
const WINDOW_MS = 60 * 60 * 1000;
const MAX_REPORTS_PER_WINDOW = 3;
const hits = new Map<string, { count: number; resetAt: number }>();

const optionalText = (max: number) => z.string().trim().max(max).optional().default('');
const reportSchema = z.object({
  category: z.enum(['playback', 'cloud', 'billing', 'account', 'website', 'other']),
  severity: z.enum(['minor', 'blocking', 'critical']),
  summary: z.string().trim().min(8).max(120),
  description: z.string().trim().min(20).max(1800),
  steps: optionalText(1800),
  expected: optionalText(1000),
  contact: optionalText(160),
  page: z.string().trim().regex(/^\/[\w\-./]*$/).max(300),
  includeDiagnostics: z.boolean(),
  acknowledged: z.literal(true),
  website: optionalText(200),
  diagnostics: z.object({
    viewport: optionalText(40),
    screen: optionalText(40),
    language: optionalText(40),
    timezone: optionalText(80),
    platform: optionalText(100),
    hardwareConcurrency: z.number().int().min(1).max(1024).optional(),
    online: z.boolean().optional(),
    referrer: optionalText(300),
  }).optional(),
}).strict();

function clip(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 1))}…`;
}

function field(value: string): string {
  // Mentions are disabled on the webhook as well; stripping code fences keeps
  // user text from making the diagnostic block visually misleading.
  return clip(value.replace(/```/g, "'''"), 1024) || 'Not provided';
}

function rateLimitKey(req: express.Request): string {
  return req.ip || req.socket.remoteAddress || 'unknown';
}

function takeReportSlot(req: express.Request): { allowed: boolean; retryAfter: number } {
  const now = Date.now();
  const key = rateLimitKey(req);
  const current = hits.get(key);
  if (!current || current.resetAt <= now) {
    hits.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return { allowed: true, retryAfter: 0 };
  }
  if (current.count >= MAX_REPORTS_PER_WINDOW) {
    return { allowed: false, retryAfter: Math.max(1, Math.ceil((current.resetAt - now) / 1000)) };
  }
  current.count += 1;
  return { allowed: true, retryAfter: 0 };
}

/** Public, deliberately narrow site configuration. Secrets never leave the server. */
export function siteConfig(_req: express.Request, res: express.Response): void {
  res
    .set('cache-control', 'no-store')
    .json({
      analyticsMeasurementId: config.site.googleAnalyticsId || null,
      bugReportsConfigured: Boolean(config.site.bugReportWebhookUrl),
    });
}

/** Mounts the unauthenticated support form separately from rig APIs. */
export function mountBugReports(app: express.Express): void {
  app.post('/api/bug-reports', express.json({ limit: '24kb' }), async (req, res) => {
    const parsed = reportSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Check the highlighted details and try again.' });
      return;
    }

    const report = parsed.data;
    const reference = crypto.randomUUID().split('-')[0].toUpperCase();

    // A hidden field is cheaper and less intrusive than a challenge. Pretend a
    // bot submission worked so it has no signal with which to tune itself.
    if (report.website) {
      res.json({ ok: true, reference });
      return;
    }

    if (!config.site.bugReportWebhookUrl) {
      res.status(503).json({
        error: 'Bug reporting is being configured. Please email hello@ronation.live for now.',
      });
      return;
    }

    const slot = takeReportSlot(req);
    if (!slot.allowed) {
      res
        .set('retry-after', String(slot.retryAfter))
        .status(429)
        .json({ error: 'Too many reports from this connection. Please try again later.' });
      return;
    }

    const diagnostics = report.includeDiagnostics ? report.diagnostics : undefined;
    const diagnosticLines = diagnostics ? [
      diagnostics.viewport && `Viewport: ${diagnostics.viewport}`,
      diagnostics.screen && `Screen: ${diagnostics.screen}`,
      diagnostics.language && `Language: ${diagnostics.language}`,
      diagnostics.timezone && `Timezone: ${diagnostics.timezone}`,
      diagnostics.platform && `Platform: ${diagnostics.platform}`,
      diagnostics.hardwareConcurrency && `Logical processors: ${diagnostics.hardwareConcurrency}`,
      diagnostics.online !== undefined && `Browser online: ${diagnostics.online ? 'yes' : 'no'}`,
      diagnostics.referrer && `Same-site referrer: ${diagnostics.referrer}`,
      `User agent: ${req.get('user-agent') || 'Not supplied'}`,
    ].filter(Boolean).join('\n') : 'Reporter opted out of browser diagnostics.';

    const colour = report.severity === 'critical' ? 0xef4444 : report.severity === 'blocking' ? 0xf59e0b : 0x3b82f6;
    const webhook = new URL(config.site.bugReportWebhookUrl);
    webhook.searchParams.set('wait', 'true');

    try {
      const response = await fetch(webhook, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: AbortSignal.timeout(8_000),
        body: JSON.stringify({
          username: 'Deck bug reports',
          allowed_mentions: { parse: [] },
          embeds: [{
            title: clip(`${report.severity.toUpperCase()} · ${report.summary}`, 256),
            color: colour,
            description: field(report.description),
            fields: [
              { name: 'Area', value: field(report.category), inline: true },
              { name: 'Page', value: field(report.page), inline: true },
              { name: 'Signed in', value: req.user ? 'Yes' : 'No', inline: true },
              { name: 'Steps to reproduce', value: field(report.steps) },
              { name: 'Expected result', value: field(report.expected) },
              { name: 'Contact', value: field(report.contact) },
              { name: 'Browser diagnostics', value: field(diagnosticLines) },
            ],
            footer: { text: `Deck report ${reference}` },
            timestamp: new Date().toISOString(),
          }],
        }),
      });

      if (!response.ok) {
        throw new Error(`Discord returned HTTP ${response.status}`);
      }

      log.info(`delivered report ${reference} (${report.category}, ${report.severity})`);
      res.status(201).json({ ok: true, reference });
    } catch (err) {
      log.error(`could not deliver report ${reference}:`, (err as Error).message);
      res.status(502).json({
        error: 'The report could not be delivered. Please email hello@ronation.live instead.',
      });
    }
  });
}
