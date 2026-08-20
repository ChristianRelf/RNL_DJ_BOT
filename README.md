# RNL DJ Bot

A Discord music bot you drive like a DJ rig. Point it at the folder your music
lives in, load tracks onto two decks, ride the EQ and crossfader, fire sample
pads - all from a React control surface, streamed live into a Discord voice
channel.

**Nothing is uploaded.** The server stores no audio at all: it holds a few
seconds of each playing deck in memory and asks your machine for the rest as it
goes. One deployment runs many servers' rigs at once, each with its own decks,
its own library and its own Discord account.

Any number of DJs can be signed in at once; a control lock makes sure only one of
them is touching the decks at a time, with a hand-over queue for the rest.

```text
 your machine                          server (Node)                    Discord
 ┌───────────────────────────┐   ws    ┌──────────────────────────┐    ┌─────────┐
 │ music folder (read-only)  │◀──────▶ │ Rig per guild           │    │  voice  │
 │ decoded cache (OPFS)      │  audio  │  control lock            │───▶│ channel │
 │ decks · mixer · fx · pads │  state  │  mix graph (48k stereo)  │opus│         │
 └───────────────────────────┘ +meters │  8 s ring per deck       │    └─────────┘
              ▲ Discord OAuth2         └──────────────────────────┘
```

## What it does

**Decks (A/B)** - waveform overview with click-to-seek, play/pause, cue point,
loop in/out with halve/double, pitch fader (0.5×–2× turntable-style, pitch follows
speed), nudge, repeat.

**Mixer** - per channel: trim, 3-band isolator EQ (a full cut is a real kill, not a
dip), single-knob LP/HP filter, pan, mute, channel fader with peak metering.
Crossfader with a blend-to-cut curve, master fader, and clip indication.

**Advanced mixer** - the rest of the desk, on its own tool: per-channel sends and
pan, a 3-band isolator across the master, left/right balance, a mono fold-down, a
brickwall limiter with gain-reduction metering, and the bus routing.

**Effects** - one send effect at a time on a bus both decks feed post-fader: tape
echo, Schroeder reverb, or flanger. Time can be set in beats off whichever deck is
playing, and follows its pitch fader.

**MIDI** - map a hardware controller onto anything on the console via Web MIDI,
with pickup, jump and endless-encoder modes. Mappings live in the browser and go
out as ordinary commands, so the control lock still applies.

**Sample pads** - eight slots for stings and drops, each one-shot / loop / hold,
with their own bus level and an auto-duck that pulls the decks down under a pad hit.

**Queue** - a shared list of what plays next. Anyone signed in can add to it
without holding the decks; loading, reordering and clearing need control. Auto
mode loads and plays the next track whenever a deck runs out.

**Media pool** - drag-and-drop upload, per-track rename, tags, BPM, delete. Anything
ffmpeg can read is accepted and decoded once at upload time. Drag a track straight
onto a deck or a pad. The headphone button pre-listens **in your own browser only**,
so you can audition a track without it going to air.

**Requests** - a page at `deck.example/<rig>/request` for the room rather than the
booth. Anyone in the Discord server can open it - no DJ role, and they sign in with
Discord the same way you did - search what is in the rig's library and pick a
record, or just type what they are after. Nothing they send touches the decks:
requests land on a Requests panel on the console, and accepting one queues it,
credited to whoever asked. Off until somebody switches it on from the tools page,
five asks per person per fifteen minutes.

**Multi-DJ control lock** - one controller at a time. Others watch the live state
and queue up. Control hands over when the holder releases, hands it to someone
directly, disconnects (after a grace period), or goes idle while somebody is waiting.
Admins can force-take.

**Discord gating** - OAuth2 sign-in; membership and roles are verified server-side
with a bot token, so the gate cannot be spoofed by the client.

**Swappable playback bot** - the account the room hears is separate from the one
people sign in through. An owner can add bots by pasting a token and switch which
one is on air without a restart; tokens are encrypted at rest and never sent back
to a browser.

**Waitlist** - access is granted in batches rather than self-served. `/home/access`
takes requests (honeypot, per-address rate limit, no duplicates) and the owner
works through them from the tools page.

**Slash commands** - `/dj panel`, `/dj now`, `/dj summon [channel]`, `/dj leave`.

## Quick start (Docker)

1. **Create a Discord application** at <https://discord.com/developers/applications>.
   - *Bot* tab: add a bot, copy the token.
   - *OAuth2* tab: copy the client ID and client secret, and add the redirect URI
     `http://localhost:7403/api/auth/callback` (swap in your public URL in production -
     it must match `PUBLIC_URL` exactly).
   - Invite the bot with the `bot` and `applications.commands` scopes and the
     **Connect** + **Speak** permissions.
   - No privileged intents are required.

2. **Configure**

   ```bash
   cp .env.example .env
   # fill in DISCORD_BOT_TOKEN, DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET,
   # DISCORD_GUILD_ID and a long random SESSION_SECRET
   ```

3. **Run**

   ```bash
   docker compose up --build
   ```

   Open <http://localhost:7403>, sign in with Discord, hit **Take control**, pick a
   voice channel and **Go live**.

Uploads, decoded audio and the track database live in the `dj-data` volume.

## Deploying behind Caddy

The production host is `deck.ronation.live`. Compose binds the app to
`127.0.0.1:7403` so only the reverse proxy can reach it.

1. Copy [`deploy/Caddyfile`](deploy/Caddyfile) to `/etc/caddy/Caddyfile` (or
   `import` it), point an A record at the box, and reload:

   ```bash
   caddy validate --config /etc/caddy/Caddyfile
   systemctl reload caddy
   ```

2. In `.env` on the VPS:

   ```ini
   PUBLIC_URL=https://deck.ronation.live
   ```

3. Register the matching redirect URI in the Discord developer portal:

   ```ini
   https://deck.ronation.live/api/auth/callback
   ```

4. `docker compose up -d --build`

Because `PUBLIC_URL` starts with `https://`, session cookies are issued with the
`Secure` flag automatically, and Express is configured to trust the proxy's
`X-Forwarded-*` headers.

Two things worth checking if something misbehaves:

- **Uploads 413** - Caddy's `request_body max_size` (200 MB in the supplied
  config) must stay above `MAX_UPLOAD_MB`.
- **Socket drops** - `reverse_proxy` upgrades websockets on its own, but the
  `flush_interval -1` in the config is what stops state and meter frames being
  buffered.

### If Caddy runs in a container

A containerised Caddy cannot reach `127.0.0.1:7403` - inside the container that
address is Caddy itself, not the host. Both containers have to share a network,
and Caddy proxies to the container name:

```caddyfile
reverse_proxy rnl-dj-bot:7403
```

`docker-compose.yml` already joins the shared network, declared as `proxy` and
resolving to `edge` by default:

```yaml
networks:
  proxy:
    external: true
    name: ${CADDY_NETWORK:-edge}
```

Set `CADDY_NETWORK` in `.env` if the reverse proxy sits on a differently named
network. Find it with:

```bash
docker inspect <caddy-container> \
  --format '{{range $net, $c := .NetworkSettings.Networks}}{{$net}}{{"\n"}}{{end}}'
```

Because it lives in the compose file rather than an overlay, a plain
`docker compose up -d` always reattaches it. Attaching by hand with
`docker network connect` does **not** survive a recreate and is the usual cause
of a sudden 502 after a restart.

Note that the authoritative Caddyfile is then whichever file that project
bind-mounts into the container - editing `/etc/caddy/Caddyfile` on the host has
no effect, and the reload is `docker exec <caddy-container> caddy reload --config
/etc/caddy/Caddyfile`.

### Verifying a deploy

```bash
./deploy/verify.sh
```

Checks the container is running, is attached to the proxy network, answers on
`127.0.0.1:7403`, and is reachable at the public URL - and names the fix for
whichever step fails.

### DigitalOcean Spaces and CDN

Spaces is optional. When configured, Deck issues short-lived S3-compatible PUT
URLs so browsers upload directly to the Space; media does not pass through or
remain on the Droplet. Objects are isolated under `rigs/<guild-id>/<uuid>`.

1. Create a Standard Storage Space, preferably in the same region as the Droplet.
2. Create a Spaces access key and fill the `SPACES_*` variables in `.env`.
3. Replace the origin in `deploy/spaces-cors.xml`, then apply it with:

   ```sh
   s3cmd setcors deploy/spaces-cors.xml s3://YOUR_SPACE
   ```

Private mode is the default. Downloads use one-hour presigned origin URLs. DigitalOcean
does not cache presigned requests at its CDN. To use Spaces as a real CDN, enable a CDN
endpoint, set `SPACES_CDN_URL`, and explicitly set `SPACES_PUBLIC_CDN=true`. That marks
objects public-read: their random URL is difficult to guess, but anyone who receives it
can fetch it. Do not enable that mode for a library that must remain access-controlled.

The `/api/health` response reports whether Spaces and public-CDN mode are active.

## Configuration

| Variable | Default | Notes |
| --- | --- | --- |
| `DISCORD_BOT_TOKEN` | - | Required. deck's bot token. Playback *and* membership lookups. |
| `DISCORD_CLIENT_ID` | - | Required. deck's application ID. |
| `DISCORD_CLIENT_SECRET` | - | Required. Drives the OAuth2 sign-in. |
| `DISCORD_GUILD_ID` | - | Only to import a legacy `db.json` on first start. Unset it afterwards. |
| `PLATFORM_ADMIN_IDS` | - | Who runs the platform: the portal, the allowlist, the bot pool, every rig. Read as `OWNER_USER_IDS` too, for installs that predate the rename. |
| `PORTAL_HOST` | - | Hostname the owner portal answers on, e.g. `portal.deck.ronation.live`. |
| `COOKIE_DOMAIN` | - | Scopes the session cookie so one sign-in covers the console and the portal. |
| `SESSION_SECRET` | - | Required, ≥32 chars. Rotating it signs everyone out. |
| `PUBLIC_URL` | `http://localhost:7403` | Must match the registered redirect URI. |
| `PORT` | `7403` | |
| `DJ_ROLE_IDS` | *(empty)* | Seeds the imported guild only. Per-rig roles are chosen during onboarding. |
| `ADMIN_ROLE_IDS` / `ADMIN_USER_IDS` | *(empty)* | Seeds the imported guild only. The server owner is always an admin. |
| `MAX_UPLOAD_MB` | `100` | Per file, on the legacy upload route. Nothing else uploads. |
| `CONTROL_IDLE_TIMEOUT_S` | `180` | Idle hand-over, applied **only** when someone is queued. `0` disables. |
| `CONTROL_DISCONNECT_GRACE_S` | `20` | Survives a page refresh without losing the decks. |
| `DATA_DIR` | `./data` | `deck.db` - metadata only. No audio is ever stored here. |
| `FFMPEG_PATH` / `FFPROBE_PATH` | `ffmpeg` / `ffprobe` | Only needed if they are not on `PATH`. |
| `LOG_LEVEL` | `info` | `debug` also prints boot stack traces. |

## Local development

Needs Node 20+ and ffmpeg on `PATH`.

```bash
npm install
cp .env.example .env      # PUBLIC_URL=http://localhost:5173 for the dev server
npm run dev               # API on :7403, Vite UI on :5173 with a proxy
```

Register `http://localhost:5173/api/auth/callback` as a redirect URI too if you
want to sign in against the Vite dev server.

```bash
npm run typecheck         # both workspaces
npm run build             # web bundle + server JS
npm run smoke -w server   # audio engine checks, no Discord or ffmpeg needed
```

`npm run smoke` synthesises PCM directly and asserts frame size, crossfade,
EQ kills, looping, seeking, rate, the streaming path, pads and the limiter.

## How the audio works

Your files never leave your machine. The console decodes a track **once**, the
first time it is loaded, into headerless 48 kHz stereo `s16le` - exactly the
format the Opus encoder wants - and keeps that in an OPFS cache on your device
(1 GB, least-recently-used). The waveform envelope is built in the same pass.

The server asks for quarter-second chunks a few times a second per playing deck,
keeping an 8-second ring per source. Nothing on the realtime path touches a
codec, and a seek is a byte offset rather than a re-decode. Steady state is about
**1.8 Mbit/s of upstream per playing deck**; a paused deck costs nothing.

The mix graph renders in 20 ms blocks (one Opus frame). Each deck resamples its
source with linear interpolation for pitch, runs the isolator and filter, applies
its smoothed fader and pan; the mixer sums both decks through the crossfader, adds
the pad bus and the effects return, runs the master isolator, balance and optional
mono fold, then master gain, the limiter and a cubic soft clipper behind it.

Effect sends are taken **post-fader**, so pulling a channel down takes its tail
with it, and the wet return is **not** crossfaded - an echo thrown at the end of a
track has to survive the fade out of it. When nothing is playing the freewheel
keeps turning for five seconds so a tail rings out rather than being cut off.

Rendering is **pull-driven** by the voice player, so Discord's own 20 ms packet
cadence clocks the mix and no buffer can drift. When the bot is not in a channel a
local timer takes over so deck positions stay truthful while you cue up.

Each source holds a 4-second window as planar float, refilled from an 8-second
ring the host device fills on demand - about 1.5 MB per source, so two decks and
eight pads come to well under 15 MB per rig. When the ring runs dry the source
fades out over 30 ms and back in when audio arrives, because a late frame is the
one thing the voice player cannot absorb but a short dropout it can.

Every command - from the web UI *and* from slash commands - goes through one
`Rig.execute` path where it is schema-validated and permission-checked, so the
control lock cannot be bypassed by talking to the socket directly.

## One bot, several jobs

Everything runs on a single Discord application - **deck**. It is the bot people
invite, the account the room hears by default, the application `/dj` is
registered against, and the token that answers "is this person in the server, and
what roles do they have?".

That last one is why the gate reads the token from the environment rather than
whichever bot is currently on air. A rig can be pointed at a different playback
account from its tools page, and who is allowed to sign in must not change when
the account the room hears does. `deck` is in every server this runs for - the
onboarding wizard is what put it there - so it is the stable thing to ask.

A platform admin (`PLATFORM_ADMIN_IDS`) can add further playback bots from a
rig's tools page by pasting a token. The application ID is read back from the token, and the bot
is checked for guild membership before anything is stored. Switching drops the
voice connection and remakes it as the new bot - the old one leaves the channel,
the new one rejoins it, and `/dj` is re-registered against the new application.
The decks keep running throughout, but the room hears the gap.

Tokens are sealed with AES-256-GCM under a key derived from `SESSION_SECRET`
before they reach the database, and no endpoint ever returns one - the console sees
a name, an application ID and a fingerprint. Rotating `SESSION_SECRET` signs
everyone out *and* invalidates the stored tokens, which is the right blast
radius if it has leaked.

## Rigs, and setting one up

A rig is one Discord server's decks. They live in the database, not in the
environment, and are addressed by slug:

| URL | What |
| --- | --- |
| `/` | sign in, then straight through to your rig |
| `/rigs` | the picker, when you DJ in more than one server |
| `/g/<slug>/deck` | that server's console |
| `/g/<slug>/tools` | its tools page |
| `/onboard` | setting a new one up |
| `portal.deck.ronation.live` | the owner portal |

Signing in at all takes being on the allowlist, which is a list of Discord user
ids a platform admin keeps in the portal. Being on it does not grant access to
anything by itself - each server's own roles still decide who can DJ there.

Setting a rig up is two steps. **Add deck to your server** hands you to
Discord's own bot-authorisation dialog, and Discord tells the server which guild
you picked; the rig is created there and then. The second step names it and
chooses which role may DJ and which may take over. Both have sane defaults, so
abandoning the wizard halfway leaves a working rig rather than a broken one.

Nothing here ever asks anyone to find and paste a guild id, and no OAuth token
is kept: the only scope sign-in asks for is `identify`.

## Upgrading from a single-guild install

The first start after upgrading imports `data/db.json` into the guild named by
`DISCORD_GUILD_ID` - its library, queue, pads, mixer, tools, bots and waitlist.
It runs once, and **the file is left where it is**: it is the only copy of that
library's tempos and cue points, and losing it to a half-finished migration is
not a risk worth taking. Unset `DISCORD_GUILD_ID` afterwards.

The audio itself is a different matter. Tracks that were uploaded still have
their decoded PCM under `data/pcm`, and those keep playing from disk exactly as
before. Anything else needs to be in the music folder the console is pointed at.

## Known limits

- **A rig only plays while a console is open.** The audio comes off somebody's
  machine, so closing that tab drains the buffer and pauses the decks about six
  seconds later. There is no unattended playback.
- **One library per rig.** Whoever is hosting serves every track; a second DJ can
  drive the decks but can only load what the host's folder has.
- **Chromium for the folder.** `showDirectoryPicker` is Chrome and Edge only.
  Firefox and Safari fall back to re-picking the folder each session.
- **Tracks over 12 minutes will not decode.** `decodeAudioData` is all-or-nothing
  and an hour of stereo is 1.4 GB in one allocation. Lifting this needs WebCodecs.
- **No true headphone cue.** Discord gets one bus, so pre-listen happens locally in
  the DJ's browser and is not sample-accurate against the live mix.
- Opus encoding for one stereo stream is roughly a tenth of a core, so ten
  simultaneous rigs is about one core; the mix graph itself is well under that.

## Layout

```text
server/src
  server.ts      boot: bot → commands → engine → http → socket
  engine.ts      command execution, permissions, media ingest, state
  control.ts     the single-operator lock and hand-over queue
  auth.ts        Discord OAuth2, session JWT, guild/role gate
  secrets.ts     encryption for runtime secrets (added bot tokens)
  realtime.ts    Socket.IO transport, state coalescing, meter broadcast
  http.ts        auth routes, uploads, pre-listen streaming, static SPA
  audio/         transcode · source · deck · pad · mixer · fx · dsp
  discord/       gateway client · bot registry · sign-in gate · voice · commands
  protocol.ts    wire contract (mirrored at web/src/protocol.ts)
web/src
  App.tsx        console assembly, keyboard shortcuts, lock gating
  socket.ts      socket client, throttled command sender
  lib/layout.ts  the console grid: cells, collision, presets, storage
  lib/midi.ts    Web MIDI access, mapping targets, stored bindings
  components/    deck · mixer · fx · midi · pads · pool · queue · crew · grid
                 site: home · access (waitlist) · help centre · legal
```

## The console

The deck page is a twelve-column grid and every tool sits in an explicit cell of
it. Tools are dragged in from a tray, moved by their handle and sized by their
edges; everything snaps to the grid, nothing may overlap (whatever you drop onto
is pushed down), and a tile shorter than its panel scrolls rather than cropping
it. Below 860 px the grid stacks into one column and each tool sizes to its own
content.

The arrangement lives in `localStorage`, never on the server: two operators on
two screens want different consoles, and tidying yours mid-set should not move
anyone else's furniture. MIDI mappings are stored the same way, for the same
reason.

## Keyboard

`Q` / `P` play-pause deck A/B · `1`–`8` fire pads · `[` `]` crossfade ·
double-click a knob to reset it · shift-drag for fine adjustment.
