/**
 * Two rigs in one process, and the import that gets an old one there.
 *
 *   npm run build -w server && npm run tenancy -w server
 *
 * The audio graph was always instance-scoped, so the risk in going multi-guild
 * was never the mixer — it was the data layer that replaced one JSON document
 * with a shared database. A missing `WHERE guild_id` does not throw; it quietly
 * shows one server another server's library, and puts one set's queue on
 * somebody else's decks.
 *
 * So this asserts isolation directly rather than by inspection, and checks the
 * one-way door: that importing an existing db.json keeps the library.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dj-tenancy-'));

// Config is read at import time, so the environment has to be right first.
process.env.DATA_DIR = tmp;
process.env.DISCORD_BOT_TOKEN = 'test-token';
process.env.DISCORD_CLIENT_ID = 'test-app';
process.env.DISCORD_CLIENT_SECRET = 'test-secret';
process.env.SESSION_SECRET = 'x'.repeat(48);
process.env.PUBLIC_URL = 'http://localhost:7403';
process.env.DISCORD_GUILD_ID = '111111111111111111';
process.env.PLATFORM_ADMIN_IDS = '999';
process.env.LOG_LEVEL = 'error';

/** A legacy document for the importer to find, written before anything loads. */
const legacy = {
  version: 1,
  media: {
    'track-a': {
      id: 'track-a',
      title: 'Old Favourite',
      originalName: 'old.mp3',
      durationMs: 210000,
      sizeBytes: 5_000_000,
      uploadedBy: { id: '1', name: 'chris' },
      uploadedAt: 1700000000000,
      peaks: [0.1, 0.9],
      bpm: 128,
      beatGrid: { bpm: 128, beatOffsetMs: 12, beatsPerBar: 4, downbeat: 0, confidence: 0.8, source: 'auto' },
      key: '8A',
      tags: ['house'],
      status: 'ready',
    },
  },
  mixer: { crossfader: -0.5, master: 0.8 },
  tools: { osc: true, oscPort: 9001 },
  pads: [{ mediaId: 'track-a', gain: 0.7, mode: 'loop' }],
  lastVoiceChannelId: '999',
  queue: { items: [{ id: 'q1', mediaId: 'track-a', addedBy: { id: '1', name: 'chris' }, addedAt: 1 }], auto: true },
  waitlist: [{ id: 'w1', discord: 'someone', email: 'a@b.co', community: 'Radio', size: '100', note: '', at: 1 }],
  bots: [],
  activeBotId: null,
};
fs.writeFileSync(path.join(tmp, 'db.json'), JSON.stringify(legacy));

const { db, closeDb } = await import('../dist/db/index.js');
const platform = await import('../dist/db/platform.js');
const { importLegacyDb } = await import('../dist/db/migrate.js');
const { GuildStore } = await import('../dist/store.js');

const checks = [];
function check(name, ok, detail = '') {
  checks.push({ name, ok });
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}   ${name}${detail ? `  ${detail}` : ''}`);
}

console.log('\nmulti-tenancy — isolation between rigs, and the import that seeds one\n');

db();
importLegacyDb();

/* --------------------------------------------------------------- import */

const A = '111111111111111111';
const imported = platform.getGuild(A);
check('the legacy document creates a rig', imported !== null, imported?.slug);

const storeA = new GuildStore(A);
storeA.load();

check('its library came across', storeA.listMedia().length === 1, `${storeA.listMedia().length} tracks`);
check(
  'and kept what somebody had decided about it',
  storeA.getMedia('track-a')?.bpm === 128 && storeA.getMedia('track-a')?.key === '8A',
  'bpm and key survived',
);
check('the beat grid survived', storeA.getMedia('track-a')?.beatGrid?.confidence === 0.8);
check('the queue survived', storeA.db.queue.items.length === 1 && storeA.db.queue.auto === true);
check('the pads survived', storeA.db.pads[0].mediaId === 'track-a' && storeA.db.pads[0].mode === 'loop');
check('mixer settings survived', storeA.db.mixer.crossfader === -0.5);
check(
  'and gained defaults for knobs that did not exist yet',
  storeA.db.mixer.masterEq.low === 0 && storeA.db.mixer.fx.type === 'echo',
  'no undefined reaching the audio thread',
);
check('tools survived', storeA.db.tools.osc === true && storeA.db.tools.oscPort === 9001);
check('the waitlist came across', platform.listWaitlist().length === 1);
check('db.json is left in place', fs.existsSync(path.join(tmp, 'db.json')));

// Running it again must not duplicate anything.
importLegacyDb();
const storeAgain = new GuildStore(A);
storeAgain.load();
check('importing twice changes nothing', storeAgain.listMedia().length === 1);

/* ------------------------------------------------------------ isolation */

const B = '222222222222222222';
platform.createGuild({ id: B, name: 'Second Rig', createdBy: 'someone' });
const storeB = new GuildStore(B);
storeB.load();

check('a new rig starts empty', storeB.listMedia().length === 0 && storeB.db.queue.items.length === 0);
check('and does not inherit the other one\'s mixer', storeB.db.mixer.crossfader === 0);

storeB.putMedia({
  id: 'track-b',
  title: 'Only In B',
  originalName: 'b.mp3',
  durationMs: 1000,
  sizeBytes: 1,
  uploadedBy: { id: '2', name: 'someone' },
  uploadedAt: 2,
  peaks: [],
  bpm: null,
  beatGrid: null,
  key: null,
  tags: [],
  status: 'ready',
});
storeB.db.queue.items.push({ id: 'q2', mediaId: 'track-b', addedBy: { id: '2', name: 'x' }, addedAt: 2 });
storeB.db.mixer.crossfader = 0.9;
storeB.db.pads[3] = { mediaId: 'track-b', gain: 0.5, mode: 'gate' };
storeB.save();
await storeB.flush();

// Reloaded from disk rather than trusted from memory — the whole question is
// what the database actually holds, not what each store thinks it does.
const reloadA = new GuildStore(A);
reloadA.load();
const reloadB = new GuildStore(B);
reloadB.load();

check(
  'writing to one rig does not touch the other',
  reloadA.listMedia().length === 1 && reloadA.getMedia('track-b') === undefined,
  'A still has only its own track',
);
check('the other rig kept its own write', reloadB.getMedia('track-b')?.title === 'Only In B');
check(
  'queues do not cross',
  reloadA.db.queue.items.length === 1 &&
    reloadA.db.queue.items[0].mediaId === 'track-a' &&
    reloadB.db.queue.items.length === 1 &&
    reloadB.db.queue.items[0].mediaId === 'track-b',
);
check(
  'mixers do not cross',
  reloadA.db.mixer.crossfader === -0.5 && reloadB.db.mixer.crossfader === 0.9,
);
check(
  'pads do not cross',
  reloadA.db.pads[3].mediaId === null && reloadB.db.pads[3].mediaId === 'track-b',
);

/* -------------------------------------------------------------- removal */

const slugA = platform.getGuild(A).slug;
platform.deleteGuild(B);
const afterDelete = new GuildStore(A);
afterDelete.load();

check('deleting a rig leaves the others alone', afterDelete.listMedia().length === 1);
check('and the survivor keeps its slug', platform.getGuild(A)?.slug === slugA);
check('while the deleted one is gone', platform.getGuild(B) === null);
check('slugs are unique', platform.uniqueSlug('Second Rig') !== slugA);

/* ------------------------------------------------------------ allowlist */

platform.allow({ discordId: '4242', note: 'a friend', addedBy: 'admin' });
check('the allowlist answers', platform.isAllowed('4242')?.note === 'a friend');
check('and refuses anyone not on it', platform.isAllowed('9999') === null);
platform.disallow('4242');
check('removing works', platform.isAllowed('4242') === null);

closeDb();
fs.rmSync(tmp, { recursive: true, force: true });

const failed = checks.filter((c) => !c.ok);
console.log(
  failed.length === 0
    ? '\nall checks passed\n'
    : `\n${failed.length} check${failed.length > 1 ? 's' : ''} failed\n`,
);
process.exit(failed.length === 0 ? 0 : 1);
