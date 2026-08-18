---
name: gh-cli
description: Work with GitHub via the gh CLI — PRs, issues, reviews, releases. Use when asked to create, review, or manage GitHub pull requests, issues, or releases.
---

# GitHub CLI

You can work with GitHub using the `gh` CLI: pull requests, issues, code
reviews, releases, and more.

## Auth

Auth is handled by OneCLI — the HTTPS_PROXY injects the real token into
`api.github.com` requests automatically. The `gh` CLI needs a token present to
skip its local credential check, so the placeholder env var `GH_TOKEN` is
already set — never replace it, never ask for a real token.

Before any GitHub operation, verify auth:

```bash
gh auth status
```

If this fails with an auth error, ask the user to add a GitHub token to OneCLI
(host pattern `api.github.com`, header `Authorization`, format `Bearer {value}`)
and grant it to the agent. Once added, retry `gh auth status`.

## Core workflows

```bash
# Repos & PRs
gh repo view deviracode/nanoclaw
gh pr list --repo deviracode/nanoclaw --state open
gh pr view <number> --repo deviracode/nanoclaw
gh pr create --repo <owner>/<repo> --base main --head <branch> --title "..." --body "..."
gh pr review <number> --repo <owner>/<repo> --approve
gh pr comment <number> --repo <owner>/<repo> --body "..."

# Issues
gh issue list --repo <owner>/<repo> --state open
gh issue view <number> --repo <owner>/<repo>

# Releases
gh release list --repo <owner>/<repo>
```

## Notes

- Always pass `--repo owner/repo` explicitly when the working directory isn't a
  git repo (it usually isn't — you're not in a checkout).
- `gh auth status` output shows the placeholder — that's expected; the proxy
  swaps in the real token per request.
- Never print or echo the token value; treat `GH_TOKEN` as opaque.
