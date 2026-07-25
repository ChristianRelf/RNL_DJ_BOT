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

echo "${pass} passed, ${fail} failed"
[ "$fail" -eq 0 ] || exit 1
