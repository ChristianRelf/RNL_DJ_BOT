# Deck platform roadmap

## Shipped in the management overhaul

- Platform accounts can be suspended without deleting their audit record, and
  rig-creation permission is controlled independently.
- Rigs can be suspended/restored; active subscriptions block accidental deletion.
- Per-rig Stripe Checkout, signed webhook processing, billing portal, status,
  renewal/cancellation state, and a 2.5 GB Deck Cloud entitlement.
- Four-stage onboarding: connect Discord, subscribe, configure roles, launch.
- Independent second-screen layouts for booth monitoring, library work, and a
  mixer/FX surface.
- System-health console module for realtime, Discord, playback-host, and local
  cache readiness.
- Transparent now-playing browser source for OBS, backed by the revocable
  timecode key.
- Per-rig Deck Cloud manifest with ETag/size verification, resumable worker
  downloads, adaptive LRU eviction, pinning, device budgets and set preflight.
- SHA-256 per-rig cloud deduplication, cache telemetry, pending-upload expiry,
  and dry-run-first object-storage repair.

## UI overhaul

1. Consolidate colors, spacing, typography, focus styles, and component states
   into design tokens before restyling individual panels.
2. Add a command palette for tracks, modules, rig actions, and navigation.
3. Give every module clear empty/loading/error/offline states and a common panel
   header with help, pop-out, fit, and remove actions.
4. Replace confirm dialogs on destructive admin actions with a review drawer
   that shows impact, billing state, stored bytes, and recovery options.
5. Run keyboard, screen-reader, contrast, reduced-motion, tablet, and touch-target
   passes as release gates.

## Modules

1. Set history and export (played time, transition, DJ, CSV/JSON).
2. Broadcast scene pad (named cues that trigger several safe integration actions).
3. Microphone/talkover control with ducking and a hardware kill indicator.
4. Recording status/control for an external recorder; Deck should not store the
   recording on the web server.
5. Show notes/rundown with timed markers shared by the crew.
6. Health module for packet loss, audio underruns, cache readiness, CPU, and the
   last integration failure.

## Integrations

1. OBS WebSocket through a local bridge: scene switching, source text, recording
   status, and explicit allowlisted actions.
2. Icecast/Shoutcast metadata push with retry and a redacted connection test.
3. Elgato Stream Deck plugin backed by the existing timecode/command protocol.
4. Generic signed outbound webhooks for now-playing and session events, with
   per-destination secrets, delivery logs, retry, and a circuit breaker.
5. Art-Net/DMX and MIDI clock through the local bridge rather than opening public
   UDP ports on the hosted service.
6. Twitch/YouTube chat requests only after rate limits, moderation, and account
   unlinking are designed; chat must never gain direct deck control.

## Delivery sequence

- Release A (implemented): cache manifest, quota cleanup, account/billing production rollout.
- Release B: design tokens, panel state standardization, command palette.
- Release C: history, health, and signed webhook modules.
- Release D: local integration bridge, OBS, Stream Deck, Icecast, and lighting.

Each release needs migration rollback notes, a staging webhook replay test, and a
two-window live-set soak test before production deployment.
