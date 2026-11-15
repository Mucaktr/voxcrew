#!/usr/bin/env python3
"""Smoke-test the built app over HTTP, without models, secrets or existing data.

Run after `npm ci && npm run build` in frontend and `uv sync --locked` in
backend: `uv run --project backend --no-sync python scripts/ci_smoke.py`.
Only the child process gets an isolated environment. Failed runs keep their
temporary directory and server log for diagnosis; successful runs remove it.
"""

from __future__ import annotations

import argparse
from html.parser import HTMLParser
import json
import os
from pathlib import Path
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import time
import tomllib
from urllib.error import HTTPError, URLError
from urllib.parse import unquote, urlsplit
from urllib.request import HTTPRedirectHandler, ProxyHandler, build_opener


ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
DIST = ROOT / "frontend" / "dist"


class ScriptSources(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.sources: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "script":
            src = dict(attrs).get("src")
            if src:
                self.sources.append(src)


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise RuntimeError(f"Unexpected HTTP redirect ({code})")


def child_environment(directory: Path, ollama_port: int) -> dict[str, str]:
    # Do not forward API keys, provider configuration or proxy credentials.
    keep = {"SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT", "LANG", "LC_ALL"}
    env = {k.upper(): v for k, v in os.environ.items() if k.upper() in keep}
    paths = {name: directory / name for name in (
        "home", "data", "state", "workspace", "hermes", "tmp", "cache", "config", "appdata", "localappdata"
    )}
    for path in paths.values():
        path.mkdir()
    # These are child-only standard profile locations, not changes to the user's
    # environment. Discovery cannot read the real ~/.codex or ~/.claude profiles.
    env.update({
        "HOME": str(paths["home"]),
        "USERPROFILE": str(paths["home"]),
        "APPDATA": str(paths["appdata"]),
        "LOCALAPPDATA": str(paths["localappdata"]),
        "XDG_CONFIG_HOME": str(paths["config"]),
        "XDG_DATA_HOME": str(paths["data"]),
        "XDG_STATE_HOME": str(paths["state"]),
        "XDG_CACHE_HOME": str(paths["cache"]),
        "TEMP": str(paths["tmp"]),
        "TMP": str(paths["tmp"]),
        "TMPDIR": str(paths["tmp"]),
        "STUDIO_DATA_DIR": str(paths["data"]),
        "STUDIO_STATE_DIR": str(paths["state"]),
        "STUDIO_WORKDIR": str(paths["workspace"]),
        "HERMES_HOME": str(paths["hermes"]),
        "OLLAMA_HOST": f"http://127.0.0.1:{ollama_port}",
        "UV_OFFLINE": "1",
        "UV_NO_CONFIG": "1",
        "UV_PYTHON_DOWNLOADS": "never",
        "PYTHONUNBUFFERED": "1",
        "PYTHONUTF8": "1",
    })
    # uv is launched by absolute path. Keep user-installed agent CLIs out of PATH.
    venv_bin = BACKEND / ".venv" / ("Scripts" if os.name == "nt" else "bin")
    system_path = str(Path(env["SYSTEMROOT"]) / "System32") if os.name == "nt" else os.defpath
    env["PATH"] = os.pathsep.join((str(venv_bin), system_path))
    return env


def stop_process_tree(process: subprocess.Popen) -> None:
    """Stop only the process tree/session created by this smoke run."""
    if os.name == "nt":
        if process.poll() is None:
            taskkill = Path(os.environ["SYSTEMROOT"]) / "System32" / "taskkill.exe"
            result = subprocess.run(
                [str(taskkill), "/PID", str(process.pid), "/T", "/F"],
                capture_output=True, timeout=15, check=False,
            )
            if result.returncode and process.poll() is None:
                raise RuntimeError(f"Could not stop smoke process tree (taskkill {result.returncode})")
        process.wait(timeout=10)
        return
    # start_new_session gives this child a private process group, including uv's
    # server child. Signal the group even if its leader exited during startup.
    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        pass
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        pass
    finally:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
    process.wait(timeout=5)


def read_http(opener, url: str, limit: int, timeout: float = 3) -> tuple[bytes, str]:
    with opener.open(url, timeout=timeout) as response:
        if response.status != 200:
            raise RuntimeError(f"Unexpected HTTP status {response.status}: {url}")
        body = response.read(limit + 1)
        if not body or len(body) > limit:
            raise RuntimeError(f"Empty or unexpectedly large HTTP response: {url}")
        return body, response.headers.get_content_type()


def check_app(process: subprocess.Popen, base: str, timeout: float, expected_version: str) -> None:
    # Ignore proxy settings in the parent environment, including local developer
    # proxies. Redirects are not followed; all checks stay on this loopback port.
    opener = build_opener(ProxyHandler({}), NoRedirect())
    deadline = time.monotonic() + timeout
    last_error = "server not ready"
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError(f"Server exited before readiness (code {process.returncode})")
        try:
            body, content_type = read_http(opener, base + "/api/health", 4096, timeout=2)
        except (URLError, HTTPError, TimeoutError, ConnectionError) as exc:
            last_error = str(exc)
            time.sleep(0.25)
            continue
        if content_type != "application/json":
            raise RuntimeError("Health endpoint did not return JSON")
        health = json.loads(body)
        if health.get("ok") is not True or health.get("version") != expected_version:
            raise RuntimeError(f"Unexpected health payload: {health!r}")
        break
    else:
        raise RuntimeError(f"Server not ready after {timeout:g}s: {last_error}")
    print(f"PASS health: ok=true, version={expected_version}", flush=True)

    expected_html = (DIST / "index.html").read_bytes()
    body, content_type = read_http(opener, base + "/", len(expected_html))
    if content_type != "text/html" or body != expected_html:
        raise RuntimeError("Root response does not match the built frontend index.html")
    parser = ScriptSources()
    parser.feed(body.decode("utf-8"))
    candidates = []
    for src in parser.sources:
        url = urlsplit(src)
        if not url.scheme and not url.netloc and url.path.startswith("/assets/") and url.path.endswith(".js"):
            path = (DIST / unquote(url.path).lstrip("/")).resolve()
            if path.is_relative_to(DIST.resolve()) and path.is_file():
                candidates.append((src, path))
    if not candidates:
        raise RuntimeError("Built HTML has no existing same-origin /assets/*.js script")
    src, path = candidates[0]
    expected_js = path.read_bytes()
    body, content_type = read_http(opener, base + src, len(expected_js))
    if "javascript" not in content_type or body != expected_js:
        raise RuntimeError("JavaScript response does not match the referenced build asset")
    if process.poll() is not None:
        raise RuntimeError("Server exited during HTTP checks")
    print(f"PASS frontend: index.html and {src} ({len(body)} bytes)", flush=True)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--timeout", type=float, default=60, help="Startup timeout in seconds (default: 60)")
    args = parser.parse_args()
    if args.timeout <= 0:
        parser.error("--timeout must be positive")
    uv = shutil.which("uv")
    if not uv or not (DIST / "index.html").is_file():
        print("FAIL: install uv and build frontend first (see script docstring)", file=sys.stderr)
        return 1
    with (BACKEND / "pyproject.toml").open("rb") as stream:
        expected_version = tomllib.load(stream)["project"]["version"]

    temp_parent = Path(tempfile.gettempdir()).resolve()
    directory = Path(tempfile.mkdtemp(prefix="voxcrew-ci-smoke-", dir=temp_parent)).resolve()
    log_path = directory / "server.log"
    try:
        # Keep a non-listening socket bound, so discovery cannot reach a real
        # Ollama service, including one already running on the developer machine.
        with socket.socket() as model_guard:
            model_guard.bind(("127.0.0.1", 0))
            env = child_environment(directory, model_guard.getsockname()[1])
            with socket.socket() as port_probe:
                port_probe.bind(("127.0.0.1", 0))
                port = port_probe.getsockname()[1]
            if port == 7420:
                raise RuntimeError("Refusing to use the app's default port for a smoke run")
            env["STUDIO_PORT"] = str(port)
            command = [uv, "run", "--no-sync", "voxcrew", "--port", str(port)]
            options = {"creationflags": subprocess.CREATE_NEW_PROCESS_GROUP} if os.name == "nt" else {"start_new_session": True}
            print(f"Starting isolated smoke server on 127.0.0.1:{port}", flush=True)
            with log_path.open("wb") as log:
                process = subprocess.Popen(command, cwd=BACKEND, env=env, stdout=log, stderr=subprocess.STDOUT, **options)
                try:
                    check_app(process, f"http://127.0.0.1:{port}", args.timeout, expected_version)
                finally:
                    original_error = sys.exc_info()[1]
                    try:
                        stop_process_tree(process)
                    except Exception as cleanup_error:
                        if original_error is None:
                            raise
                        # Keep the first failure; report cleanup as a separate
                        # problem instead of replacing the startup/HTTP evidence.
                        print(f"Additional cleanup failure: {cleanup_error}", file=sys.stderr)
        # This directory was created by us directly under the resolved temp root.
        # Check its exact boundary before recursive cleanup, including on Windows.
        if directory.parent != temp_parent or not directory.name.startswith("voxcrew-ci-smoke-"):
            raise RuntimeError("Refusing cleanup outside the smoke temporary directory")
        shutil.rmtree(directory)
    except (Exception, KeyboardInterrupt) as exc:
        print(f"FAIL: {exc or 'interrupted'}", file=sys.stderr)
        print(f"Preserved smoke evidence: {directory}", file=sys.stderr)
        if log_path.is_file():
            print(log_path.read_text(encoding="utf-8", errors="replace")[-16000:], file=sys.stderr)
        return 1
    print("PASS: isolated smoke server stopped and temporary data removed", flush=True)
    return 0


if __name__ == "__main__":
    # Let CI cancellation take the same finally/cleanup path as Ctrl+C.
    def interrupted(_signum, _frame):
        raise KeyboardInterrupt

    signal.signal(signal.SIGTERM, interrupted)
    raise SystemExit(main())
