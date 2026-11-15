# Install and run VoxCrew

[Back to VoxCrew](../README.md) · **English** · [Türkçe](SETUP.tr.md)

Use the source install if you want to connect an existing Codex CLI or Claude Code installation. Docker is an alternative for API connections, with the networking and tool limits described below. There are no prebuilt installers yet.

## Install from source

You need **Git**, **[uv](https://docs.astral.sh/uv/getting-started/installation/)** and **[Node.js](https://nodejs.org/) 20+** with npm. The backend requires Python 3.11+; uv can download a compatible Python when needed. Internet access is needed to fetch dependencies on the first run.

The start script installs dependencies from the lock files (`uv sync --locked`, `npm ci`), builds the UI and serves it at **http://127.0.0.1:7420**. The initial install and build can take a few minutes.

### Windows (PowerShell)

Install only the tools you do not already have:

```powershell
winget install --id Git.Git -e
winget install --id astral-sh.uv -e
winget install --id OpenJS.NodeJS.LTS -e
```

Open a **new PowerShell window** so the tools are on PATH, then run:

```powershell
git clone https://github.com/Mucaktr/voxcrew.git "$HOME\voxcrew"
powershell -NoProfile -ExecutionPolicy Bypass -File "$HOME\voxcrew\start.ps1" -Open
```

### macOS

If you use [Homebrew](https://brew.sh/), install the prerequisites with the first command. Skip packages already installed.

```sh
brew install git uv node
git clone https://github.com/Mucaktr/voxcrew.git ~/voxcrew
sh ~/voxcrew/start.sh --open
```

### Linux

Install Git with your distribution's package manager and install **Node.js 20+** with npm. Check `node --version`; some distributions provide an older version. See [Node.js downloads](https://nodejs.org/en/download) for installation options.

Install uv using its [official instructions](https://docs.astral.sh/uv/getting-started/installation/), or its installer:

```sh
curl -LsSf https://astral.sh/uv/install.sh | sh
```

Open a new terminal, then run:

```sh
git clone https://github.com/Mucaktr/voxcrew.git ~/voxcrew
sh ~/voxcrew/start.sh --open
```

## First launch

1. Confirm that you are 18 or older. The confirmation is stored on your computer.
2. Follow the setup wizard to see available connections and choose a scene. The starter crew contains a developer and a researcher; their default display names follow the interface language.
3. Open **Connections** if no usable brain is available. Connect a local Ollama model, a compatible API endpoint, or an installed CLI. See the [provider overview](../README.md#brains-you-can-use) for differences and costs.
4. Select a brain for your agent, press **Ctrl+K**, and give it a small first task.

The interface can open without a connected brain, but agents cannot complete tasks until one is configured. Hosted providers can receive your prompts and charge for usage. A local Ollama model keeps model inference on your computer; tools you enable may still contact external services.

## Stop, update and change the port

Press **Ctrl+C** in the terminal to stop VoxCrew. The scripts do not install a service or configure automatic startup.

| Action | Windows (from the repository root) | macOS / Linux (from the repository root) |
|---|---|---|
| Start | `powershell -NoProfile -ExecutionPolicy Bypass -File .\start.ps1 -Open` | `sh ./start.sh --open` |
| Use another port | `powershell -NoProfile -ExecutionPolicy Bypass -File .\start.ps1 -Port 7430` | `sh ./start.sh --port 7430` |
| Rebuild the UI | `powershell -NoProfile -ExecutionPolicy Bypass -File .\start.ps1 -Rebuild` | `sh ./start.sh --rebuild` |

To update, stop the app, run `git pull` in the repository, then start it with **`-Rebuild` / `--rebuild`**. Without that flag, an existing UI build is not rebuilt automatically; the launcher warns when it detects stale output.

If a step fails, the launcher prints an `ERROR:` message. A missing-tool error usually needs the prerequisite installed and a new terminal opened. A busy-port error can be resolved by stopping the other instance or choosing another port. The normal launch scripts accept no remote host option.

Set `VOXCREW_LANG=en` or `VOXCREW_LANG=tr` to choose the launcher's message language; unset, it prints both. This setting controls launcher messages, not the app's interface language.

<a name="docker"></a>
## Run with Docker

You need **Git**, Docker and Docker Compose:

```sh
git clone https://github.com/Mucaktr/voxcrew.git
cd voxcrew
docker compose up --build
```

After the build, open **http://localhost:7420**. Stop it with **Ctrl+C**. If you used `docker compose up -d --build`, stop it with `docker compose down`.

Data is stored in the named volume `voxcrew-data`, mounted at `/data`. **`docker compose down -v` deletes that volume and its data.** There is no restart policy; start the app manually after a reboot.

### Keep the host port local

Keep the supplied mapping **`127.0.0.1:7420:7420`**. VoxCrew has no multi-user login and is intended for access from your own computer. A bare `7420:7420` or `0.0.0.0` host binding would expose it to other machines. Listening on all interfaces *inside* the container is part of the supplied Docker configuration; Host and Origin checks still apply.

### Connect to Ollama on the host

This Docker-to-host Ollama path has **not been validated end to end**. For a simpler local Ollama setup, use the source installation above.

The container's `127.0.0.1` is the container itself. On Docker Desktop (Windows/macOS), the provided Compose file includes a commented setting you can enable:

```yaml
environment:
  OLLAMA_HOST: "http://host.docker.internal:11434"
```

On Linux Docker Engine, also enable the supplied `extra_hosts` entry for `host.docker.internal:host-gateway`. This address alone does not make a loopback-only Ollama server reachable: Ollama must accept connections from the container. Broadening its bind address can expose the model server to your local network. Restrict access with a firewall and understand the network boundary before changing it. Do not expose either service to the public internet.

You can also configure a reachable OpenAI-compatible endpoint in **Connections**, subject to that endpoint's authentication and data-handling rules.

### Container limitations

- The image does not include Claude Code, Codex, Gemini CLI or Hermes. It cannot invoke CLI programs installed on your host. Use a source install for host CLI connections.
- The setup wizard cannot start or install Ollama on the host from inside the container.
- Webhook and ingest requests from your host may appear non-local inside Docker. Endpoints that require local callers without an access key need a configured access key for that path.

<a name="data-and-environment-variables"></a>
## Data locations and environment variables

For a fresh source installation, the default data directory is:

| System | Directory |
|---|---|
| Windows | `%LOCALAPPDATA%\VoxCrew` |
| macOS | `~/Library/Application Support/VoxCrew` |
| Linux | `$XDG_DATA_HOME/voxcrew`, or `~/.local/share/voxcrew` when unset |

`STUDIO_DATA_DIR` overrides the default. For compatibility, an existing repository-root `data/` directory is used before the platform default when no override is set. The app does not migrate that directory automatically.

| Variable | Default | Purpose |
|---|---|---|
| `STUDIO_PORT` | `7420` | Server port; explicit launcher port takes precedence |
| `STUDIO_DATA_DIR` | Data directory described above | Graph database, settings, user workflows and workspace |
| `STUDIO_WORKDIR` | `<data dir>/workspace` | Folder where agents read and write files |
| `STUDIO_STATE_DIR` | Platform state directory | Graph audit state kept separately from the data directory |
| `HERMES_HOME` | `~/.hermes` | Optional Hermes Agent home |
| `OLLAMA_HOST` | `http://127.0.0.1:11434` | Ollama address |
| `STUDIO_ALLOWED_HOSTS` | Empty | Additional trusted local Host names, comma separated; keep empty unless needed |
| `STUDIO_MAX_BODY_BYTES` | `4194304` | Request body size limit in bytes |
| `VOXCREW_LANG` | Both languages | Launcher messages: `en` or `tr` |

Set environment variables in the terminal before launching. Prefer an absolute path for data-directory overrides. For a separate development installation, use separate data and state directories so it cannot modify your regular installation's records.

For development commands, see [CONTRIBUTING.md](../CONTRIBUTING.md). For the local-only security model and private vulnerability reporting, see [SECURITY.md](../SECURITY.md).
