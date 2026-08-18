# Connecting to the Railway Deployment (clidash dashboard)

The Railway deployment (project `nanoclaw` on Deviracode) runs the host with a
read-only web dashboard (**clidash**) baked into the image. The dashboard is
bound to `127.0.0.1` inside the host container — the network is the auth
boundary — so you reach it over an SSH tunnel.

## One-time setup

1. Install the Railway CLI and log in:

   ```bash
   brew install railway
   railway login
   ```

2. Register an SSH key with Railway (needed for the tunnel; imports from
   GitHub don't work for this project):

   ```bash
   ssh-keygen -t ed25519 -f ~/.ssh/railway-nanoclaw -N ""   # if you don't have one
   railway ssh keys add -k ~/.ssh/railway-nanoclaw.pub -n nanoclaw-deploy
   ```

3. Generate the SSH config block for the host service (this pins the current
   deployment instance):

   ```bash
   cd <nanoclaw repo>
   railway ssh config
   ```

   This writes a `Host railway-nanoclaw` block into `~/.ssh/config`.

## Connecting

```bash
ssh -L 4690:127.0.0.1:4690 railway-nanoclaw
```

Leave that terminal running, then open **http://127.0.0.1:4690** in a browser.

## What's in the dashboard

| Panel | Shows |
|---|---|
| Overview | Agent status cards (groups + sessions + messaging groups + wirings) |
| Tabs (groups, sessions, users, roles, …) | Live tables queried via `ncl` over the host's socket |
| Activity | Per-session inbound/outbound message charts (from the session DBs) |
| Files | Group `CLAUDE.md`, skills, profiles — read-only, deny-listed secrets |

Tables are empty until the first bootstrap runs (owner + wiring created from
the `NANOCLAW_*` env vars — see `railway/README.md`).

## Troubleshooting

- **`channel 2: open failed: unknown channel type` / connection closed** —
  the SSH config block points at a stale deployment instance. Re-run
  `railway ssh config`, then retry the tunnel.
- **`Host key verification failed`** — add the host key:
  `ssh-keyscan -H ssh.railway.com >> ~/.ssh/known_hosts` (or run once with
  `-o StrictHostKeyChecking=accept-new`).
- **Dashboard loads but tables error** — the host's ncl socket lives at
  `/data/data/ncl.sock`; check the host is healthy via the Railway dashboard
  (`railway status`) and that `NANOCLAW_RUNTIME=host` is set.
- **Port already in use locally** — pick another local port:
  `ssh -L 14690:127.0.0.1:4690 railway-nanoclaw` → http://127.0.0.1:14690

## Also useful

- **Service logs** (no SSH needed): `railway logs --service nanoclaw`
- **Full ops runbook** (secrets, OneCLI setup, WhatsApp pairing, sync):
  `railway/README.md`
- **OneCLI gateway** (agents + secrets UI): port-forward
  `ssh -L 10254:127.0.0.1:10254 railway-nanoclaw-onecli` → http://127.0.0.1:10254
