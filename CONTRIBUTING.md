# Contributing to VoxCrew

**English** · [Türkçe](CONTRIBUTING.tr.md)

Thanks for helping! This guide covers the dev setup, the house rules and what a good PR looks like. Issues and PRs can be written in English or Turkish.

## Good first contributions

- **Bug reports** with exact steps, your OS and which brains are installed (use the issue form).
- **Worlds and scenes** built with the world builder and exported as `.voxcrew-world.json`.
- **Translations**: English strings that read awkwardly or server messages that remain Turkish-only. Starter labels and bundled workflows already have English versions; corrections to either language are welcome.
- **Docs**: anything in the README that didn't work exactly as written on your machine.

For larger changes, please open an issue first so we can agree on the approach.

## Dev setup

You need Python 3.11+ with [uv](https://docs.astral.sh/uv/), and Node.js 20+ with npm. You don't need a brain (Ollama, Codex CLI or Claude Code) to build or browse the app.

Run these from the repository root:

```sh
(cd backend && uv sync --locked)
(cd frontend && npm ci && npm run typecheck && npm run build)
```

To run it while developing, start the backend with `cd backend && uv run voxcrew --port 7431` and the UI with `cd frontend && npm run dev` (http://localhost:5173). Set `STUDIO_PORT=7431` for both so the Vite proxy sends `/api` to your dev backend and not to an instance you may already run on 7420. Keep your real data safe with a separate data directory outside the repository, for example `STUDIO_DATA_DIR=~/voxcrew-dev-data` (PowerShell: `$env:STUDIO_DATA_DIR = "$HOME\voxcrew-dev-data"`). A relative path is resolved from the folder you start the server in.

The [build and smoke workflow](.github/workflows/ci.yml) installs locked dependencies, builds the frontend, and starts an isolated local server on Windows and Ubuntu. It checks the health response, the built HTML and a referenced JavaScript asset. It does not run a model or establish end-to-end provider compatibility. Run the same smoke check after building: `uv run --project backend --no-sync python scripts/ci_smoke.py`.

This repository does not ship the project's full application test suite. Please say in your PR how you checked the change (type check, build, what you clicked through).

## Repository layout

| Path | Contents |
|---|---|
| `backend/studio/` | FastAPI app: `api.py` (core routes), `workflow/` (engine, checkpoints, budgets, policy), `connectors/` (hermes, ollama, codex, claude, openai_compat), `connections/` (discovery and setup wizard), `graph/` (SQLite graph and memory), `office/`, `goals/`, `game/`, `skills/`, `worlds/`, `trace/`, `clients/`, `security.py`, `config.py`, `brand.py`, `locales/` |
| `backend/ontology/` | Graph ontology (YAML) |
| `frontend/src/` | React UI: `pages/`, `components/` (shared primitives in `components/ui.tsx`), `lib/` (API, zustand stores, `i18n.ts`, `brand.ts`), `locales/` (TR + EN message catalogs), `voxel/` (three.js world) |
| `workflows/` | Example workflows (user workflows are saved in the data directory) |

## House rules

- **No secrets or personal data.** Code and docs never contain API keys, tokens, real session IDs, personal paths, user names or email addresses. Use placeholders such as `~`, `%USERPROFILE%`, `<HERMES_HOME>` and `<WORKDIR>`.
- **Two languages.** UI text lives in the message catalogs under `frontend/src/locales/`. Turkish is the source language, and every new key needs an English entry too. Server messages that reach the user go in `backend/studio/locales/en.py`. Code identifiers are in English.
- **Never write user config directly.** Any feature that changes Hermes, Claude or Codex files goes through the change service (`studio.changes`: plan → explicit confirm → backup → atomic write → undo). Endpoints return a plan first, and existing settings lines are never overwritten.
- **Hermes is optional.** New features must work, or switch themselves off cleanly, when Hermes isn't installed.
- **Local only, no autostart.** The server binds to `127.0.0.1`. External processes start only when the user clicks.
- **Backend:** routes that publish events are `async def`, and long or blocking file work goes through `asyncio.to_thread`. Start and stop processes with the helpers in `connectors/base.py` (`group_popen_kwargs`, `mark_group`, `kill_tree`). Windows, macOS and Linux are all supported, so don't assume `.exe`.
- **UI:** use the `components/ui.tsx` primitives and the `@theme` tokens in `index.css`. Don't use `text-[Npx]` or `font-extrabold/black`. Headings use Bricolage (`font-display`) and body text uses Inter; Pixelify is only for the logo and world labels. Check AA contrast in light and dark themes, no horizontal overflow at 375 px, `prefers-reduced-motion`, keyboard access and `aria` labels. zustand selectors must not return a new array or object on every call.
- **Brand:** the product name lives only in `backend/studio/brand.py` and `frontend/src/lib/brand.ts`, so don't copy it into UI code as text.
- **Dependencies:** open an issue before adding a package. Its license must be compatible with the project license ([PolyForm Shield License 1.0.0](https://polyformproject.org/licenses/shield/1.0.0)), and you need to update `THIRD_PARTY_NOTICES.md`. Commit lock files (`uv.lock`, `package-lock.json`) together with the change.

## Commits and pull requests

- Keep PRs small and focused. Describe what changed and how you tested it; the PR template asks for both.
- Commit messages: a short summary line in English or Turkish, with the reasoning in the body if needed.
- Commit emails are permanent in a public repository, so consider using your GitHub `noreply` address.

## Security

Please don't report vulnerabilities in public issues. Use the private process in [SECURITY.md](SECURITY.md). Other questions: mustafa.ucak@gmail.com.

## Code of conduct

Everyone taking part in this project follows the [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
