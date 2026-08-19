import { z } from 'zod';
import { PAD_COUNT, PEAK_BUCKETS } from './protocol';
import { WEBHOOK_PATTERN } from './tools/nowPlaying';

const deckId = z.enum(['A', 'B']);
const padIndex = z.number().int().min(0).max(PAD_COUNT - 1);
const finite = z.number().finite();
const mediaId = z.string().min(1).max(64);

const eq = z
  .object({
    low: finite.min(-26).max(6).optional(),
    mid: finite.min(-26).max(6).optional(),
    high: finite.min(-26).max(6).optional(),
  })
  .strict();

/**
 * Every inbound command is validated before it reaches the audio engine —
 * a NaN or an out-of-range gain would otherwise poison the mix buffers.
 */
export const commandSchemas = {
  'deck:load': z.object({ deck: deckId, mediaId }).strict(),
  'deck:eject': z.object({ deck: deckId }).strict(),
  'deck:play': z.object({ deck: deckId }).strict(),
  'deck:pause': z.object({ deck: deckId }).strict(),
  'deck:cue': z.object({ deck: deckId }).strict(),
  'deck:setCue': z.object({ deck: deckId, ms: finite.min(0) }).strict(),
  'deck:seek': z.object({ deck: deckId, ms: finite.min(0) }).strict(),
  'deck:nudge': z.object({ deck: deckId, deltaMs: finite.min(-60_000).max(60_000) }).strict(),
  'deck:set': z
    .object({
      deck: deckId,
      gain: finite.min(0).max(1.25).optional(),
      trim: finite.min(0).max(2).optional(),
      rate: finite.min(0.5).max(2).optional(),
      filter: finite.min(-1).max(1).optional(),
      pan: finite.min(-1).max(1).optional(),
      fxSend: finite.min(0).max(1).optional(),
      muted: z.boolean().optional(),
      repeat: z.boolean().optional(),
      eq: eq.optional(),
    })
    .strict(),
  'deck:loop': z
    .object({
      deck: deckId,
      active: z.boolean(),
      startMs: finite.min(0).optional(),
      endMs: finite.min(0).optional(),
    })
    .strict(),
  'queue:add': z.object({ mediaId, next: z.boolean().optional() }).strict(),
  'queue:remove': z.object({ id: z.string().min(1).max(64) }).strict(),
  'queue:move': z.object({ id: z.string().min(1).max(64), to: z.number().int().min(0).max(500) }).strict(),
  'queue:clear': z.object({}).strict(),
  'queue:load': z.object({ deck: deckId, play: z.boolean().optional() }).strict(),
  'queue:set': z.object({ auto: z.boolean() }).strict(),
  'requests:accept': z
    .object({ id: z.string().min(1).max(64), next: z.boolean().optional() })
    .strict(),
  'requests:decline': z.object({ id: z.string().min(1).max(64) }).strict(),
  'requests:clear': z.object({}).strict(),
  'pad:assign': z.object({ index: padIndex, mediaId: mediaId.nullable() }).strict(),
  'pad:trigger': z.object({ index: padIndex }).strict(),
  'pad:stop': z.object({ index: padIndex }).strict(),
  'pad:set': z
    .object({
      index: padIndex,
      gain: finite.min(0).max(1.5).optional(),
      mode: z.enum(['oneshot', 'loop', 'gate']).optional(),
    })
    .strict(),
  'mixer:set': z
    .object({
      crossfader: finite.min(-1).max(1).optional(),
      crossfaderCurve: finite.min(0).max(1).optional(),
      master: finite.min(0).max(1.5).optional(),
      balance: finite.min(-1).max(1).optional(),
      mono: z.boolean().optional(),
      limiter: z.boolean().optional(),
      masterEq: eq.optional(),
      padBus: finite.min(0).max(1.5).optional(),
      padDuck: finite.min(0).max(1).optional(),
      fx: z
        .object({
          type: z.enum(['echo', 'reverb', 'flanger']).optional(),
          mix: finite.min(0).max(1).optional(),
          timeMs: finite.min(20).max(2000).optional(),
          feedback: finite.min(0).max(0.95).optional(),
          tone: finite.min(0).max(1).optional(),
        })
        .strict()
        .optional(),
    })
    .strict(),
  'tools:set': z
    .object({
      timecode: z.boolean().optional(),
      urlImport: z.boolean().optional(),
      osc: z.boolean().optional(),
      // Where OSC frames go. Kept to a hostname or literal address; the sender
      // resolves it and refuses anything that is not a plain unicast target.
      oscHost: z.string().trim().min(1).max(190).optional(),
      oscPort: z.number().int().min(1).max(65535).optional(),
      channelStatus: z.boolean().optional(),
      // Discord's own cap on a voice channel status is 500; this is shorter
      // because it is a caption, and a paragraph in a channel list is a mess.
      channelStatusText: z.string().trim().max(120).optional(),
      presence: z.boolean().optional(),
      announce: z.boolean().optional(),
      requests: z.boolean().optional(),
      // Only a Discord webhook, and only https. That is what makes the tool
      // safe to point anywhere: there is no host here for anyone to aim back
      // at the machine the rig runs on. Empty clears it.
      announceWebhook: z
        .string()
        .trim()
        .max(220)
        .refine((value) => value === '' || WEBHOOK_PATTERN.test(value), {
          message: 'That is not a Discord webhook URL.',
        })
        .optional(),
    })
    .strict(),
  'voice:join': z.object({ channelId: z.string().min(1).max(32) }).strict(),
  'voice:leave': z.object({}).strict(),
  'media:update': z
    .object({
      id: mediaId,
      title: z.string().trim().min(1).max(120).optional(),
      bpm: finite.min(20).max(300).nullable().optional(),
      tags: z.array(z.string().trim().min(1).max(24)).max(12).optional(),
    })
    .strict(),
  'media:analyse': z.object({ id: mediaId }).strict(),
  'media:delete': z.object({ id: mediaId }).strict(),
  'control:request': z.object({}).strict(),
  'control:release': z.object({}).strict(),
  'control:cancel': z.object({}).strict(),
  'control:grant': z.object({ userId: z.string().min(1).max(32) }).strict(),
  'control:take': z.object({}).strict(),
  'control:heartbeat': z.object({}).strict(),
} as const;

export type CommandSchemas = typeof commandSchemas;
export type CommandKey = keyof CommandSchemas;

export function isCommand(name: string): name is CommandKey {
  return Object.prototype.hasOwnProperty.call(commandSchemas, name);
}

/** Commands that mutate the live mix and therefore need the control lock. */
export const NEEDS_CONTROL = new Set<CommandKey>([
  'deck:load',
  'deck:eject',
  'deck:play',
  'deck:pause',
  'deck:cue',
  'deck:setCue',
  'deck:seek',
  'deck:nudge',
  'deck:set',
  'deck:loop',
  // Anyone signed in may line a track up — that is the point of a shared queue,
  // and it does not touch what the room is hearing. Rearranging what somebody
  // else is about to play does, so the rest of these need the lock.
  'queue:move',
  'queue:clear',
  // A request is the room asking rather than telling, so what happens to one is
  // the booth's call — not any signed-in tab's, the way adding to the queue is.
  'requests:accept',
  'requests:decline',
  'requests:clear',
  'queue:load',
  'queue:set',
  'pad:assign',
  'pad:trigger',
  'pad:stop',
  'pad:set',
  'mixer:set',
  // Tools change how the rig behaves for everyone, so they belong to whoever
  // is driving it rather than to any signed-in tab.
  'tools:set',
  'voice:join',
  'voice:leave',
]);

/**
 * The audio-streaming channel.
 *
 * Kept apart from `commandSchemas` because these are not commands: they carry
 * no authority over the mix, they are answered rather than executed, and they
 * arrive at a few a second per playing deck rather than when somebody touches a
 * control. They still get validated, and harder than most — `frames` sizes a
 * buffer, so a NaN or a negative here is not a bad command but a crash.
 */
const trackId = z.string().min(1).max(128);

export const hostTrackSchema = z
  .object({
    trackId,
    title: z.string().min(1).max(200),
    path: z.string().max(1024),
    // A quarter of a million frames is about 90 minutes. Long enough for a
    // recorded set, short enough that a bad number cannot ask for a gigabyte.
    frames: z.number().int().min(0).max(48000 * 60 * 90),
    sizeBytes: z.number().int().min(0).max(4 * 1024 * 1024 * 1024),
  })
  .strict();

/** A folder scan. The ceiling is a backstop against somebody picking C:\. */
export const hostTracksSchema = z
  .object({ tracks: z.array(hostTrackSchema).max(20_000) })
  .strict();

export const audioChunkSchema = z
  .object({
    sourceKey: z.string().min(1).max(32),
    fromFrame: z.number().int().min(0),
    seq: z.number().int().min(0),
  })
  .strict();

/** "I have this track but cannot serve it yet." Same shape as a chunk header. */
export const audioNoneSchema = audioChunkSchema;

export const audioGoneSchema = z.object({ trackId }).strict();

/** The waveform envelope, computed on the device while it decodes. */
export const mediaPeaksSchema = z
  .object({
    trackId,
    peaks: z.array(z.number().min(0).max(1)).length(PEAK_BUCKETS),
    frames: z.number().int().min(0),
  })
  .strict();
