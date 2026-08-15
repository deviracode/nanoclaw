#!/bin/sh
# Railway host entrypoint — ensure volume dirs, then start the host.
#
# NANOCLAW_HOME defaults to /data (the Railway volume mount). The host expects
# data/, groups/, store/ under it; onecli-certs is created by the host code on
# demand — the mkdir here is harmless and helps permissions.
set -e

DATA_ROOT="${NANOCLAW_HOME:-/data}"
mkdir -p "$DATA_ROOT/data" "$DATA_ROOT/groups" "$DATA_ROOT/store" "$DATA_ROOT/onecli-certs"
chmod -R u+rwX "$DATA_ROOT" 2>/dev/null || true

exec "$@"
