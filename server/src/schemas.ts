import { z } from 'zod';
import { PAD_COUNT } from './protocol';

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
      master: finite.min(0).max(1.5).optional(),
      padBus: finite.min(0).max(1.5).optional(),
      padDuck: finite.min(0).max(1).optional(),
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
  'pad:assign',
  'pad:trigger',
  'pad:stop',
  'pad:set',
  'mixer:set',
  'voice:join',
  'voice:leave',
]);
