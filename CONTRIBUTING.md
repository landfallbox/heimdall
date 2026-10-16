# Contributing

Thanks for helping maintain Heimdall.

## Development Setup

```powershell
git clone https://github.com/landfallbox/heimdall.git
cd heimdall
npm ci
npm run check
npm test
npm run test:electron
npm run gui:build
```

Use `npm run gui` for the desktop development app.

## Architecture Rules

The binding architecture rules (config normalization, atomic config writes, Router process ownership, failover boundary, IPC contracts) live in [`AGENTS.md`](./AGENTS.md). Read it before changing behavior; agent sessions load it automatically.

## Pull Requests

- Keep changes focused and reviewable.
- Do not commit `config.json`, logs, build output, release artifacts, API keys, or local vendor endpoints.
- Add or update tests when behavior changes.
- Keep Router behavior tests in the fast Node test files. Put tests that launch Electron or exercise desktop lifecycle behavior in `test/electron-lifecycle.test.ts`.
- Run `npm run check`, `npm test`, `npm run test:electron`, and `npm run gui:build` before opening a PR.
- Before merging any agent-written PR, run a code review in a fresh context (e.g. `/code-review`, or a new agent session reviewing the diff against `REVIEW.md`). Answer every finding: fix it, or reply in the PR with a reason to dismiss it.
- For tagged releases, verify the GitHub Release includes the Windows installer `.exe`, `.exe.blockmap`, and `latest.yml` so packaged apps can detect updates.

## Configuration And Secrets

Copy `config.example.json` to `config.json` for local development. Replace all placeholder tokens and keep the file private.

If a key is committed, treat it as leaked: revoke it, rotate it, and remove it from history before publishing.