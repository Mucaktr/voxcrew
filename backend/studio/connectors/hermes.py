"""Hermes Agent bağlayıcısı: profili tek atış çalıştırır, stream-json olaylarını normalize eder.

Sağlayıcı değişimi profil dosyasına dokunmadan çalıştırma başına yapılır:
  Ollama → --provider custom --model <m> + CUSTOM_BASE_URL=<ollama>/v1
  Codex  → --provider openai-codex --model <m>   (profilde Codex oturumu gerekir)

Ajanın Hermes yetenekleri de çalıştırma başına bayraktır (profil dosyası değişmez):
  skills → -s a,b · toolsets → -t x,y · reasoning → --reasoning <düzey>
Gerçekte gönderilenler `meta` olayında `invocation` olarak bildirilir (istem metni ve gizli değer içermez).

HERMES-SKILL-EDGE: `-s` ile gönderilen her skill `invocation.skill_refs` = [{key, load_name, sha}] olarak bildirilir
(sha: Hermes'in okuyacağı canlı SKILL.md + references/ içeriğinin, sabitleme ile aynı algoritmayla özeti; yalnız okunur).
Hermes stream-json hangi skill'lerin yüklendiğini bildirmez; ajan bir skill'i `skill_view` aracıyla açarsa bu, koşu
sonunda `invocation.skills_reported` olarak bildirilir. Motor bunlardan Step -USED_SKILL-> Skill kenarı yazar
(`workflow/step_gate.link_flag_skills`).
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any, AsyncIterator

from studio.connectors.base import (
    CEvent, Connector, Invocation, Route, child_env, compose_prompt, ev, preview, stream_process,
)
from studio.connectors.discovery import find_hermes
from studio.hermes.caps import REASONING_LEVELS, HermesCaps, caps_for, clean_name_list
from studio.skills.snapshot import SnapshotError, collect, digest

SKILL_VIEW_TOOLS = frozenset({"skill_view"})  # Hermes `skills` araç setinin skill gövdesini açan aracı


def _live_sha(path: Any) -> str | None:
    """Hermes'in yükleyeceği skill içeriğinin sha256'sı (snapshot.digest ile aynı; yalnız okur). Okunamazsa None."""
    if not path:
        return None
    try:
        md = Path(str(path))
        return digest(collect(md.parent, md))
    except (SnapshotError, OSError, ValueError):
        return None


def _viewed_skill_names(raw: Any) -> list[str]:
    """`skill_view` aracının girdisinden skill adını çıkarır (dict ya da JSON metni; bilinmeyen biçim → [])."""
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except ValueError:
            return [raw.strip()] if raw.strip() and len(raw) <= 200 else []
    if not isinstance(raw, dict):
        return []
    return [str(raw[k]).strip() for k in ("name", "skill", "skill_name") if isinstance(raw.get(k), str) and raw[k].strip()]


def match_reported(refs: list[dict[str, Any]], names: list[str]) -> list[str]:
    """Hermes'in açtığı skill adları → `skill_refs` içindeki yükleme adları (ad, anahtar ya da göreli yolun son parçası)."""
    out: list[str] = []
    wanted = {n.strip().lower() for n in names if n}
    for r in refs:
        load = str(r.get("load_name") or "")
        cands = {load.lower(), str(r.get("key") or "").lower(), load.rsplit("/", 1)[-1].lower()}
        if wanted & cands and load not in out:
            out.append(load)
    return out


def build_cli_flags(agent: dict[str, Any], route: Route, caps: HermesCaps | None = None) -> tuple[list[str], dict[str, Any]]:
    """Ajan alanlarından `hermes chat` bayraklarını ve `invocation` özetini kurar.

    Profilde kurulu olmayan / devre dışı / platform dışı skill'ler gönderilmez (Hermes, istenen skill'lerin
    hepsi bulunamazsa oturumu başlatmaz) ve `skipped_skills` + `warnings` ile bildirilir.
    """
    skills = clean_name_list(agent.get("skills"))
    toolsets = clean_name_list(agent.get("toolsets"))
    reasoning = agent.get("reasoning") or None
    warnings: list[str] = []
    skipped: list[str] = []
    refs: list[dict[str, Any]] = []
    if skills and caps is not None:
        try:
            index: dict[str, dict[str, Any]] | None = caps.skill_index(route.profile or "default")
        except KeyError:
            index = None
        if index is not None:
            keep: list[str] = []
            for name in skills:
                entry = index.get(name)
                reason = caps.skill_reason(entry) if entry else "profilde kurulu değil"
                if entry and not reason:
                    if entry["load_name"] not in keep:
                        keep.append(entry["load_name"])
                        refs.append({"key": name, "load_name": entry["load_name"], "sha": _live_sha(entry.get("path"))})
                else:
                    skipped.append(name)
                    warnings.append(f"'{name}' skill'i gönderilmedi: {reason}")
            skills = keep
    if skills and not refs:  # profil dizini okunamadı: adlar olduğu gibi gider, içerik özeti bilinmez
        refs = [{"key": n, "load_name": n, "sha": None} for n in skills]
    flags: list[str] = []
    if skills:
        flags += ["-s", ",".join(skills)]
    if toolsets:
        flags += ["-t", ",".join(toolsets)]
    if reasoning in REASONING_LEVELS:
        flags += ["--reasoning", str(reasoning)]
    elif reasoning:
        warnings.append(f"Bilinmeyen akıl yürütme düzeyi gönderilmedi: {reasoning}")
        reasoning = None
    invocation: dict[str, Any] = {
        "transport": "cli", "profile": route.profile or "default", "provider": route.provider, "model": route.model,
        "skills": skills, "toolsets": toolsets, "reasoning": reasoning, "argv_flags": list(flags),
    }
    if refs:
        invocation["skill_refs"] = refs
    if skipped:
        invocation["skipped_skills"] = skipped
    if warnings:
        invocation["warnings"] = warnings
    return flags, invocation


def _short_str(value: Any, limit: int) -> str | None:
    """akıştan gelen kimlik/ad alanı yalnız kısa metin olarak tutulur (sözlük, liste, dev metin düşer)."""
    if isinstance(value, str) and value and len(value) <= limit:
        return value
    return None


def _agent_with_extra(agent: dict[str, Any], inv: Invocation) -> dict[str, Any]:
    """Booster'ın (ctx.extra["hermes"]["reasoning"]) önerdiği akıl yürütme düzeyi ajan alanının yerine geçer."""
    hx = (inv.extra or {}).get("hermes") or {}
    return {**agent, "reasoning": hx["reasoning"]} if hx.get("reasoning") else agent


class HermesConnector(Connector):
    kind = "hermes"

    async def run(self, inv: Invocation) -> AsyncIterator[CEvent]:
        home = Path(self.settings.get("hermes_home"))
        exe = find_hermes(home)
        if not exe:
            yield ev("error", message=f"hermes.exe bulunamadı ({home})")
            return
        route = inv.route
        argv = [str(exe), "-p", route.profile or "default", "chat", "--oneshot", "-Q",
                "--format", "stream-json", "--query-file", "-", "--max-turns",
                str(max(1, int(((inv.extra or {}).get("hermes") or {}).get("max_turns") or inv.max_turns)))]
        extra_env = {"HERMES_HOME": str(home)}
        if route.provider:
            argv += ["--provider", route.provider]
        if route.model:
            argv += ["-m", route.model]
        if route.provider == "custom":
            extra_env["CUSTOM_BASE_URL"] = self.settings.get("ollama_url").rstrip("/") + "/v1"
        flags, invocation = await asyncio.to_thread(build_cli_flags, _agent_with_extra(inv.agent or {}, inv), route,
                                                   caps_for(self.settings))
        argv += flags
        yield ev("meta", model=route.model, session_id=None, invocation=invocation)

        final_text: str | None = None
        reported: list[str] = []
        streamed: list[str] = []
        stderr_tail: list[str] = []
        async for tag, line in stream_process(argv, cwd=inv.workdir, env=child_env(extra_env),
                                              stdin_text=compose_prompt(inv.system, inv.prompt),
                                              timeout_s=inv.timeout_s):
            if tag == "out":
                try:
                    obj = json.loads(line)
                except json.JSONDecodeError:
                    continue
                t = obj.get("type")
                if t == "system":
                    # akıştan gelen oturum kimliği ve model adı sınırlı kısa metindir (sözlük/dev değer düşer)
                    sid = _short_str(obj.get("session_id"), 128)
                    invocation["session_id"] = sid
                    yield ev("meta", model=_short_str(obj.get("model"), 200), session_id=sid,
                             invocation=dict(invocation))
                elif t == "text":
                    chunk = obj.get("text", "")
                    streamed.append(chunk)
                    yield ev("text", text=chunk)
                elif t in ("reasoning", "thinking"):
                    yield ev("thought", text=obj.get("text", ""))
                elif t == "tool_use":
                    if obj.get("name") in SKILL_VIEW_TOOLS and invocation.get("skill_refs"):
                        for load in match_reported(invocation["skill_refs"], _viewed_skill_names(obj.get("input"))):
                            if load not in reported:
                                reported.append(load)
                    yield ev("tool", name=obj.get("name", "?"), input=preview(obj.get("input", "")))
                elif t == "tool_result":
                    yield ev("tool_result", name=obj.get("name", "?"), ok=not obj.get("is_error"),
                             output=preview(obj.get("output", "")))
                elif t == "result":
                    tok = obj.get("tokens") or {}
                    yield ev("usage", input=tok.get("input"), output=tok.get("output"), total=tok.get("total"))
                    final_text = obj.get("text")
                    if obj.get("exit_code", 0) != 0:
                        yield ev("error", message=f"Hermes çıkış kodu {obj.get('exit_code')}")
                elif t == "error":
                    yield ev("error", message=obj.get("message") or preview(obj))
            elif tag == "err":
                if line.strip():
                    stderr_tail = (stderr_tail + [line])[-15:]
            elif tag == "timeout":
                yield ev("error", message=f"Zaman aşımı ({inv.timeout_s // 60} dk)", transient=True)
            elif tag == "exit":
                if line != "0" and final_text is None:
                    yield ev("error", message=f"Hermes {line} koduyla çıktı: " + " | ".join(stderr_tail[-5:]),
                             transient=any("Süreç başlatılamadı" in s for s in stderr_tail))
        if reported:  # Hermes'in kendisinin açtığı (kullandığı) -s skill'leri → USED_SKILL status=used
            invocation["skills_reported"] = reported
            yield ev("meta", invocation={"skills_reported": list(reported)})
        text = final_text if final_text is not None else "".join(streamed)
        yield ev("final", text=text.strip())
