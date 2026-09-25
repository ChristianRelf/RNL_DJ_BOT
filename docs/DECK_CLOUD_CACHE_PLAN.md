# Deck Cloud cache implementation

The Deck Cloud cache is a per-rig, browser-managed source and playback cache.
This document records the implemented architecture and the operational checks
needed to keep it healthy.

## Correctness and visibility

- IndexedDB stores one manifest entry per rig and cloud-media ID: ETag, expected
  and downloaded byte lengths, last access, verification time, state, retry
  count, local filename, decoded track ID and pin state.
- OPFS source directories are namespaced by Discord guild ID. A cache scan sees
  only files whose manifest state is `ready`, preventing crashed or partial
  downloads from being advertised to the playback host.
- A ready entry is revalidated against the server ETag and object length. A
  mismatched ready file is removed, marked as an integrity failure and fetched
  again on retry.
- The Deck Cloud panel shows local/cloud usage and cloud-only, downloading,
  ready, pinned, stale and retry states. Operators can cache, cancel, retry,
  pin, remove only the local copy, or delete the cloud object.
- The browser persistence result is visible and can be requested explicitly.
  Declining persistence does not disable Deck.
- Pending uploads expire after 24 hours. The platform portal includes a
  dry-run-first object/database reconciler for expired rows, orphan objects,
  missing objects and size mismatches.

## Bounded smart cache

- The automatic device budget is the smaller of 10 GB or 60% of the browser's
  reported storage quota, with a minimum working allowance and a per-rig
  operator override.
- At 85% of budget Deck evicts least-recently-used sources until projected use
  is below 70%. Pinned, loaded, queued and last-hour tracks are protected.
- Budget calculations include source objects and the decoded PCM cache. An
  evicted source also drops its decoded copy.
- A dedicated worker streams downloads to OPFS, reports progress, supports
  cancellation, resumes with `Range`/`If-Range`, and retries with exponential
  backoff. The final byte length and exposed ETag must match before commit.
- **Preflight set** verifies and caches every cloud track loaded on a deck or in
  the queue before going live.

## Storage and privacy

- SHA-256 is calculated in a worker before upload. Objects use
  `rigs/<guild>/source/<sha256>.<extension>` and are deduplicated only inside
  that rig. Repeated bytes do not consume additional allowance.
- Waveform peaks, beat grids and loudness remain separate small rig metadata;
  they are broadcast before decoded audio is requested and are not duplicated
  in the source object.
- Compatible sources are kept unchanged. The playback cache uses the browser's
  decoder and generates the existing 48 kHz stereo PCM derivative only when a
  track is first loaded, avoiding a server-side proxy for compatible media.
- Private object ACLs are the default. New private download authorizations use
  ten-minute signed URLs; public CDN mode remains an explicit opt-in for owners
  who accept bearer-link access.

## Operations

- Per-rig counters record cache hits, misses, resumed bytes, downloads,
  downloaded bytes, evictions and corruptions without logging signed URLs.
- The management portal displays hit rate and eviction totals. Repeated cache
  integrity failures and reconciliation drift emit server warnings.
- The Infrastructure repair control always produces a report before enabling
  the destructive apply action.
- `deploy/spaces-cors.xml` exposes the ETag and range headers required for
  integrity verification and resumable transfers.

## Acceptance checks

1. Preflight a queue, disconnect WAN access and confirm the loaded/queued tracks
   remain present and playable from the browser host.
2. Upload the same source twice and confirm cloud usage and the object count do
   not increase on the second upload.
3. Cancel a download, retry it and confirm progress resumes above zero while the
   entry never reports `ready` before its full byte length is present.
4. Lower the cache budget and add unpinned, old tracks until eviction occurs;
   confirm loaded, queued and pinned tracks remain.
5. Run Cloud repair in dry-run mode, review the counts, then test Apply against
   disposable orphan data before using it in production.
6. Revoke a user's rig access and confirm the signed-URL endpoint immediately
   rejects new authorizations. Existing private links expire within ten minutes.
