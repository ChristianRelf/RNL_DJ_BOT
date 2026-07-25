# RNL DJ Bot

A Discord music bot you drive like a DJ rig. Upload audio to a shared media pool,
load it onto two decks, ride the EQ and crossfader, fire sample pads — all from a
React control surface, streamed live into a Discord voice channel.

Any number of DJs can be signed in at once; a control lock makes sure only one of
them is touching the decks at a time, with a hand-over queue for the rest.

```text
 browser (TSX control surface)          server (Node)                    Discord
 ┌───────────────────────────┐   ws    ┌──────────────────────────┐    ┌─────────┐
 │ decks · mixer · fx · pads │◀──────▶ │ control lock             │    │  voice  │
 │ pool · crew · midi        │  state  │ mix graph (48k stereo)   │───▶│ channel │
 └───────────────────────────┘ +meters │ ffmpeg decode on upload  │opus└─────────┘
              ▲ Discord OAuth2         └──────────────────────────┘
```

## What it does

**Decks (A/B)** — waveform overview with click-to-seek, play/pause, cue point,
loop in/out with halve/double, pitch fader (0.5×–2× turntable-style, pitch follows
speed), nudge, repeat.

**Mixer** — per channel: trim, 3-band isolator EQ (a full cut is a real kill, not a
dip), single-knob LP/HP filter, pan, mute, channel fader with peak metering.
Crossfader with a blend-to-cut curve, master fader, and clip indication.

**Advanced mixer** — the rest of the desk, on its own tool: per-channel sends and
pan, a 3-band isolator across the master, left/right balance, a mono fold-down, a
brickwall limiter with gain-reduction metering, and the bus routing.

**Effects** — one send effect at a time on a bus both decks feed post-fader: tape
echo, Schroeder reverb, or flanger. Time can be set in beats off whichever deck is
playing, and follows its pitch fader.

**MIDI** — map a hardware controller onto anything on the console via Web MIDI,
with pickup, jump and endless-encoder modes. Mappings live in the browser and go
out as ordinary commands, so the control lock still applies.

**Sample pads** — eight slots for stings and drops, each one-shot / loop / hold,
with their own bus level and an auto-duck that pulls the decks down under a pad hit.

**Media pool** — drag-and-drop upload, per-track rename, tags, BPM, delete. Anything
ffmpeg can read is accepted and decoded once at upload time. Drag a track straight
onto a deck or a pad. The headphone button pre-listens **in your own browser only**,
so you can audition a track without it going to air.

**Multi-DJ control lock** — one controller at a time. Others watch the live state
and queue up. Control hands over when the holder releases, hands it to someone
directly, disconnects (after a grace period), or goes idle while somebody is waiting.
Admins can force-take.

**Discord gating** — OAuth2 sign-in; the bot verifies guild membership and roles
server-side using its own token, so the gate cannot be spoofed by the client.

**Slash commands** — `/dj panel`, `/dj now`, `/dj summon [channel]`, `/dj leave`.

## Quick start (Docker)

1. **Create a Discord application** at <https://discord.com/developers/applications>.
   - *Bot* tab: add a bot, copy the token.
   - *OAuth2* tab: copy the client ID and client secret, and add the redirect URI
     `http://localhost:7403/api/auth/callback` (swap in your public URL in production —
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

- **Uploads 413** — Caddy's `request_body max_size` (200 MB in the supplied
  config) must stay above `MAX_UPLOAD_MB`.
- **Socket drops** — `reverse_proxy` upgrades websockets on its own, but the
  `flush_interval -1` in the config is what stops state and meter frames being
  buffered.

### If Caddy runs in a container

A containerised Caddy cannot reach `127.0.0.1:7403` — inside the container that
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
bind-mounts into the container — editing `/etc/caddy/Caddyfile` on the host has
no effect, and the reload is `docker exec <caddy-container> caddy reload --config
/etc/caddy/Caddyfile`.

### Verifying a deploy

```bash
./deploy/verify.sh
```

Checks the container is running, is attached to the proxy network, answers on
`127.0.0.1:7403`, and is reachable at the public URL — and names the fix for
whichever step fails.

## Configuration

| Variable | Default | Notes |
| --- | --- | --- |
| `DISCORD_BOT_TOKEN` | — | Required. Bot token. |
| `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` | — | Required. OAuth2 credentials. |
| `DISCORD_GUILD_ID` | — | Required. The one server this rig serves. |
| `SESSION_SECRET` | — | Required, ≥32 chars. Rotating it signs everyone out. |
| `PUBLIC_URL` | `http://localhost:7403` | Must match the registered redirect URI. |
| `PORT` | `7403` | |
| `DJ_ROLE_IDS` | *(empty)* | Comma separated. Empty means any guild member may sign in. |
| `ADMIN_ROLE_IDS` / `ADMIN_USER_IDS` | *(empty)* | May force-take control and delete anyone's media. The guild owner is always an admin. |
| `MAX_UPLOAD_MB` | `100` | Per file. |
| `CONTROL_IDLE_TIMEOUT_S` | `180` | Idle hand-over, applied **only** when someone is queued. `0` disables. |
| `CONTROL_DISCONNECT_GRACE_S` | `20` | Survives a page refresh without losing the decks. |
| `DATA_DIR` | `./data` | Uploads, decoded PCM and `db.json`. |
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
EQ kills, looping, seeking, rate, the >28 MB streaming path, pads and the limiter.

## How the audio works

Uploads are decoded **once**, at upload time, into headerless 48 kHz stereo
`s16le` — exactly the format the Opus encoder wants. Nothing on the realtime path
touches a codec, and seeking is a byte offset rather than a re-decode. The waveform
envelope is captured during that same pass.

The mix graph renders in 20 ms blocks (one Opus frame). Each deck resamples its
source with linear interpolation for pitch, runs the isolator and filter, applies
its smoothed fader and pan; the mixer sums both decks through the crossfader, adds
the pad bus and the effects return, runs the master isolator, balance and optional
mono fold, then master gain, the limiter and a cubic soft clipper behind it.

Effect sends are taken **post-fader**, so pulling a channel down takes its tail
with it, and the wet return is **not** crossfaded — an echo thrown at the end of a
track has to survive the fade out of it. When nothing is playing the freewheel
keeps turning for five seconds so a tail rings out rather than being cut off.

Rendering is **pull-driven** by the voice player, so Discord's own 20 ms packet
cadence clocks the mix and no buffer can drift. When the bot is not in a channel a
local timer takes over so deck positions stay truthful while you cue up.

Files up to 28 MB (≈2.5 min of stereo) are held in RAM; longer ones stream through
a 2-second sliding window, refilled with a positional read roughly once every two
seconds per deck.

Every command — from the web UI *and* from slash commands — goes through one
`Engine.execute` path where it is schema-validated and permission-checked, so the
control lock cannot be bypassed by talking to the socket directly.

## Known limits

- **One rig per deployment.** A single guild, a single voice connection, one set of
  decks. Multiple simultaneous voice channels would need the mixer and lock to be
  keyed by guild.
- **No true headphone cue.** Discord gets one bus, so pre-listen happens locally in
  the DJ's browser and is not sample-accurate against the live mix.
- **No beat detection or sync.** BPM is a manual field; matching tempo is done by
  ear with the pitch fader.
- Opus encoding for one stereo stream is roughly a tenth of a core; the mix graph
  itself is well under that.

## Layout

```text
server/src
  server.ts      boot: bot → commands → engine → http → socket
  engine.ts      command execution, permissions, media ingest, state
  control.ts     the single-operator lock and hand-over queue
  auth.ts        Discord OAuth2, session JWT, guild/role gate
  realtime.ts    Socket.IO transport, state coalescing, meter broadcast
  http.ts        auth routes, uploads, pre-listen streaming, static SPA
  audio/         transcode · source · deck · pad · mixer · fx · dsp
  discord/       gateway client · voice connection · slash commands
  protocol.ts    wire contract (mirrored at web/src/protocol.ts)
web/src
  App.tsx        console assembly, keyboard shortcuts, lock gating
  socket.ts      socket client, throttled command sender
  lib/layout.ts  the console grid: cells, collision, presets, storage
  lib/midi.ts    Web MIDI access, mapping targets, stored bindings
  components/    deck · mixer · fx · midi · pads · media pool · crew · grid
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
