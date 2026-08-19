#!/usr/bin/env bash
# Post-deploy check. Run after any docker compose command:
#
#   ./deploy/verify.sh
#
# Catches the failure modes that otherwise show up as a bare 502 in the browser.

set -u

CONTAINER="${CONTAINER:-rnl-dj-bot}"
NETWORK="${CADDY_NETWORK:-edge}"
PORT="${PORT:-7403}"
PUBLIC="${PUBLIC:-https://deck.ronation.live}"
PORTAL="${PORTAL:-https://portal.deck.ronation.live}"

pass=0
fail=0

ok() {
	printf '  ok    %s\n' "$1"
	pass=$((pass + 1))
}

bad() {
	printf '  FAIL  %s\n' "$1"
	[ $# -gt 1 ] && printf '        -> %s\n' "$2"
	fail=$((fail + 1))
}

echo "checking ${CONTAINER}"

# 1. Container running at all.
status=$(docker inspect -f '{{.State.Status}}' "$CONTAINER" 2>/dev/null)
if [ "$status" = "running" ]; then
	ok "container is running"
else
	bad "container is not running (status: ${status:-absent})" "docker compose logs --tail 50 dj"
	echo "${pass} passed, ${fail} failed"
	exit 1
fi

# 2. Attached to the proxy network. This is the one that breaks on a recreate
#    and produces a 502 with everything else looking healthy.
if docker inspect -f '{{range $n, $c := .NetworkSettings.Networks}}{{$n}} {{end}}' "$CONTAINER" |
	tr ' ' '\n' | grep -qx "$NETWORK"; then
	ok "attached to the '${NETWORK}' network"
else
	bad "not attached to '${NETWORK}' - Caddy cannot resolve it" \
		"docker compose up -d   (the network is declared in docker-compose.yml)"
fi

# 3. The app is actually serving on the host loopback binding.
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "http://127.0.0.1:${PORT}/api/health")
if [ "$code" = "200" ]; then
	ok "responds on 127.0.0.1:${PORT}"
else
	bad "no healthy response on 127.0.0.1:${PORT} (got ${code})" "docker compose logs --tail 50 dj"
fi

# 4. End to end through the reverse proxy.
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "${PUBLIC}/api/health")
case "$code" in
502) bad "${PUBLIC} returns 502" "proxy cannot reach the container - check step 2" ;;
200) ok "reachable at ${PUBLIC}" ;;
000) bad "${PUBLIC} did not respond" "DNS, TLS or Caddy itself - docker logs ro-nationlive-caddy-1" ;;
*) bad "${PUBLIC} returned ${code}" ;;
esac

# 5. The portal is a second site block on the same backend, so it has its own
#    certificate and its own way to be misconfigured. It answers with a redirect
#    to /portal for anyone without a session, which is a fine sign of life.
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "${PORTAL}/api/health")
case "$code" in
200) ok "portal reachable at ${PORTAL}" ;;
000) bad "${PORTAL} did not respond" "DNS or TLS for the portal host - is the A record there?" ;;
502) bad "${PORTAL} returns 502" "same backend as ${PUBLIC} - check step 2" ;;
*) bad "${PORTAL} returned ${code}" ;;
esac

# 6. How many rigs came up. Zero when some are configured means every one of
#    them failed to log in, which looks identical to a healthy empty install.
rigs=$(curl -s --max-time 5 "http://127.0.0.1:${PORT}/api/health" |
	grep -o '"rigs":[0-9]*' | cut -d: -f2)
if [ -n "${rigs:-}" ]; then
	ok "${rigs} rig(s) running"
	[ "$rigs" = "0" ] && printf '        -> if that is not expected: docker compose logs dj | grep rigs
'
fi

echo "${pass} passed, ${fail} failed"
[ "$fail" -eq 0 ] || exit 1
