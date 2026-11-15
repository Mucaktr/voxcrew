"""Codex CLI, Claude Code CLI, Gemini CLI: kurulum (resmî yollar) + oturum İPUCU (dosya) + son gerçek kullanım.

D-03: oturum = dosya varlığı DEĞİL. `session_hint` (file | api_key | keychain | none) dosya ipucudur; `session_valid`
yalnızca gerçek bir çalıştırma/test sonucuyla True/False olur, aksi hâlde None (bilinmiyor). Giriş resmî CLI ile
kullanıcının terminalinde yapılır (`login` eylemi bir terminal penceresi açar); kimlik bilgisi arayüzden geçmez.
"""

from __future__ import annotations

import asyncio
from typing import Any

from studio.connectors import discovery as disc
from studio.connections.providers.base import (
    Provider, ProviderContext, finder_kwargs, fix_button, fix_command, fix_link, problem,
)

AUTH_HINTS = ("authenticate", "oauth", "login", "unauthorized", "401", "not logged in", "sign in", "expired")


def looks_like_auth_error(text: str | None) -> bool:
    t = (text or "").lower()
    return any(h in t for h in AUTH_HINTS)


class _CliProvider(Provider):
    install_url = ""
    install_cmd = ""            # macOS / Linux (resmî yükleyici; kaynaklar:)
    install_cmd_windows = ""    # Windows PowerShell
    login_cmd = ""
    bin_name = ""
    version_timeout = 15.0

    def find(self, ctx: ProviderContext) -> Any:  # pragma: no cover - alt sınıf
        return None

    def session(self, ctx: ProviderContext) -> dict[str, Any]:
        return {}

    def fast(self, ctx: ProviderContext) -> dict[str, Any]:
        exe = self.find(ctx)
        sess = self.session(ctx) if exe else {}
        last = ctx.last_use or {}
        valid: bool | None = None
        if last:
            valid = bool(last.get("ok")) if (last.get("ok") or looks_like_auth_error(last.get("error"))) else None
        # PATH dışında bulunan çalıştırıcı (ör. Codex masaüstü uygulamasının paketlediği CLI): stüdyo tam yolu kullanır,
        # kart yine de "PATH'te değil" bilgisini ve kopyalanabilir yolu gösterir
        path_ok = disc.on_path(self.bin_name or self.kind, ctx.which) if exe else None
        return {"installed": bool(exe), "install_path": str(exe) if exe else None, "runner_running": None,
                "service_reachable": None, "session_valid": valid,
                "extra": {"session_hint": sess.get("session_hint"), "logged_in": sess.get("logged_in"),
                          "default_model": sess.get("default_model"), "session_detail": sess.get("detail"),
                          "login_cmd": self.login_cmd, "on_path": path_ok}}

    def install_command(self, ctx: ProviderContext) -> str:
        return (self.install_cmd_windows or self.install_cmd) if ctx.platform == "win32" else self.install_cmd

    def not_installed(self, state: dict[str, Any], ctx: ProviderContext) -> dict[str, Any]:
        return problem(f"{self.kind}_not_installed", fix_link("fix_install_guide", self.install_url, guide=self.kind),
                       command=self.install_command(ctx))

    async def slow(self, ctx: ProviderContext, fast: dict[str, Any]) -> dict[str, Any]:
        exe = fast.get("install_path")
        if not exe:
            return {}
        if (ctx.previous or {}).get("version") and ctx.previous.get("install_path") == exe:
            return {"version": ctx.previous["version"]}  # sürüm değişmez; her taramada --version çalıştırma
        if ctx.run_quick is not None:  # testlerin sahte yoklayıcısı
            rc, out = await asyncio.to_thread(ctx.run_quick, [exe, "--version"], self.version_timeout)
        else:
            rc, out = await asyncio.to_thread(disc.run_quick, [exe, "--version"], self.version_timeout,
                                              self.version_env())
        if rc == -1 and "timed out" in out.lower():
            return {"timeout": True}
        return {"version": self.parse_version(out) if rc == 0 and out else None}

    def version_env(self) -> dict[str, str] | None:
        """Sürüm yoklamasının ortamı (None = ana makine ortamı). Claude: en küçük ortam."""
        return None

    def parse_version(self, out: str) -> str | None:
        return out.split()[0] if out else None

    def problems(self, state: dict[str, Any], ctx: ProviderContext) -> list[dict[str, Any]]:
        x = state.get("extra") or {}
        if not state.get("installed"):
            return [self.not_installed(state, ctx)]
        out: list[dict[str, Any]] = []
        login = fix_button("fix_login", f"{self.kind}.login")
        if state.get("session_valid") is False:
            out.append(problem(f"{self.kind}_session_expired", login))
        elif x.get("logged_in") is False:
            out.append(problem(f"{self.kind}_login_needed", login))
        elif state.get("session_valid") is None and x.get("logged_in") is None:
            out.append(problem(f"{self.kind}_session_unknown", fix_button("fix_test", f"{self.kind}.test"), severity="info"))
        if x.get("on_path") is False and state.get("install_path"):
            # bilgi: çalışmayı engellemez (stüdyo tam yolu kullanır); terminalde kullanmak için yol kopyalanabilir
            out.append(problem("cli_not_on_path", fix_command("fix_copy_path", state["install_path"]), severity="info",
                               name=self.name, cmd=self.bin_name or self.kind, path=state["install_path"]))
        return out

    def legacy(self, state: dict[str, Any]) -> dict[str, Any]:
        x = state.get("extra") or {}
        return {"available": bool(state.get("installed")), "path": state.get("install_path"),
                "logged_in": x.get("logged_in"), "default_model": x.get("default_model")}


class CodexProvider(_CliProvider):
    kind = "codex"
    name = "GPT Codex"
    subtitle_key = "sub_codex"
    order = 30
    install_url = "https://github.com/openai/codex"
    install_cmd = "curl -fsSL https://chatgpt.com/codex/install.sh | sh"
    install_cmd_windows = 'powershell -ExecutionPolicy ByPass -c "irm https://chatgpt.com/codex/install.ps1 | iex"'
    npm_cmd = "npm i -g @openai/codex"
    login_cmd = "codex login"
    bin_name = "codex"

    def find(self, ctx: ProviderContext) -> Any:
        return disc.find_codex(**finder_kwargs(ctx))

    def session(self, ctx: ProviderContext) -> dict[str, Any]:
        return disc.codex_session_state(ctx.env, ctx.home)

    def not_installed(self, state: dict[str, Any], ctx: ProviderContext) -> dict[str, Any]:
        # Codex masaüstü uygulaması / oturum klasörü var ama CLI yok: "kurulu değil" yerine ne yapılacağını söyle
        kw = finder_kwargs(ctx)
        if disc.codex_app_present(**{k: v for k, v in kw.items() if k in ("env", "home", "platform")}):
            # uygulama zaten var: yalnız CLI eksik — her platformda aynı resmî npm yolu (Node.js gerekir)
            return problem("codex_app_no_cli", fix_link("fix_install_guide", self.install_url, guide=self.kind),
                           command=self.npm_cmd)
        return super().not_installed(state, ctx)

    def parse_version(self, out: str) -> str | None:
        return out.splitlines()[0].replace("codex-cli", "").strip() or None


class ClaudeProvider(_CliProvider):
    kind = "claude"
    name = "Claude Code"
    subtitle_key = "sub_claude"
    order = 40
    install_url = "https://code.claude.com/docs/en/setup"
    install_cmd = "curl -fsSL https://claude.ai/install.sh | bash"
    install_cmd_windows = "irm https://claude.ai/install.ps1 | iex"
    login_cmd = "claude  →  /login"
    bin_name = "claude"

    def find(self, ctx: ProviderContext) -> Any:
        return disc.find_claude(**finder_kwargs(ctx))

    def version_env(self) -> dict[str, str] | None:
        return disc.minimal_env()  # ana makinenin CLAUDE_*/oturum değişkenleri `claude --version`'a geçmez

    def session(self, ctx: ProviderContext) -> dict[str, Any]:
        return disc.claude_login_state(ctx.home, ctx.platform, dict(ctx.env) if ctx.env is not None else None)


class GeminiProvider(Provider):
    """Yalnızca algılama: bağlayıcı henüz yok ('yakında')."""
    kind = "gemini"
    name = "Gemini CLI"
    subtitle_key = "sub_gemini"
    optional = True
    order = 70

    def fast(self, ctx: ProviderContext) -> dict[str, Any]:
        exe = disc.find_gemini(**finder_kwargs(ctx))
        return {"installed": bool(exe), "install_path": str(exe) if exe else None, "runner_running": None,
                "service_reachable": None, "session_valid": None, "extra": {"coming_soon": True}}

    def problems(self, state: dict[str, Any], ctx: ProviderContext) -> list[dict[str, Any]]:
        return [problem("gemini_soon" if state.get("installed") else "gemini_soon_absent", None, severity="info")]

    def legacy(self, state: dict[str, Any]) -> dict[str, Any]:
        return {"available": False, "path": state.get("install_path"), "optional": True}
