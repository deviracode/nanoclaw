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

# Stamp the upgrade marker so the host's boot gate passes: on Railway every
# deploy ships code+marker as one image, so the marker reflects the image.
DATA_DIR_PATH="$DATA_ROOT/data"
mkdir -p "$DATA_DIR_PATH"
node -e "const fs=require('fs'),p='/app/package.json',v=JSON.parse(fs.readFileSync(p,'utf8')).version;fs.writeFileSync(process.argv[1],JSON.stringify({version:v,updatedAt:new Date().toISOString(),via:'railway'},null,2)+'\n')" "$DATA_DIR_PATH/upgrade-state.json"

# clidash — read-only ncl-derived dashboard, localhost-bound (reach it via
# `ssh -L 4690:127.0.0.1:4690 railway-nanoclaw`). Started before the host so it
# is already listening by the time the ncl socket exists.
CLIDASH_CONFIG=/opt/clidash/clidash.config.railway.json node /opt/clidash/server.js >/dev/null 2>&1 &

exec "$@"
