"""GPT Codex CLI bağlayıcısı: `codex exec --json` olaylarını normalize eder.

Varsayılan sandbox salt okunur; ajan izni "write" ise yalnızca çalışma klasörüne yazabilir.
PROC-FIX varsayılan olarak kullanıcının Codex kurulumundan yalıtılır ve web araması kapalıdır
(`connectors/codex_isolation.py`, kaynaklar).
"""

from __future__ import annotations

import json
from typing import Any, AsyncIterator

from studio.connectors.base import CEvent, Connector, Invocation, child_env, compose_prompt, ev, preview, stream_process, usage_int
from studio.connectors.discovery import find_codex


class CodexConnector(Connector):
    kind = "codex"

    async def run(self, inv: Invocation) -> AsyncIterator[CEvent]:
        exe = find_codex()
        if not exe:
            yield ev("error", message="codex CLI bulunamadı")
            return
        # npm `codex.cmd` kabuğu hedefine (`node codex.js`) çözülür ve doğrudan başlatılır;
        # argv hiçbir zaman cmd.exe'den geçmez. Çözülemezse yalnız tarayıcının güvenli bulduğu satır kabuktan geçer.
        from studio.connectors import codex_isolation as iso
        from studio.i18n import agent_lang
        try:
            lang = agent_lang(self.settings)
        except Exception:  # noqa: BLE001 - dil okunamazsa TR
            lang = "tr"
        launch = iso.launch_for(exe)
        cx = (inv.extra or {}).get("codex") or {}  # booster: akıl yürütme çabası
        # kartla (`iso.skills_state`) aynı kurucu → kartın skill sayıları koşununkilerle birebir aynı
        argv = iso.exec_argv(launch.prefix, sandbox=iso.sandbox_for(inv.permissions), workdir=inv.workdir,
                             model=inv.route.model, reasoning_effort=cx.get("reasoning_effort"))
        # PROC-FIX kullanıcının Codex kurulumundan yalıtım (varsayılan) ve web araması (varsayılan kapalı)
        props = inv.agent or {}
        instance = inv.agent_instance or iso.instance_of(props)
        try:
            extra_argv, iso_meta = iso.apply(self.settings, props.get("slug"), instance, inv.workdir, inv.extra,
                                             base_argv=list(argv), budget=launch.budget)
        except iso.IncompleteIsolation as exc:  # skill listesi sığmıyor, izin yok → koşu başlamaz
            yield ev("meta", invocation={**exc.meta, "launch": launch.mode})
            yield ev("error", message=iso.incomplete_message(exc.meta, lang), fatal=True)
            return
        argv += extra_argv
        argv.append("-")
        iso_meta = {**iso_meta, "launch": launch.mode}
        if launch.mode == "cmd" and iso.cmd_refusal(argv):  # cmd.exe'ye bölünecek satır hiç verilmez
            yield ev("meta", invocation={**iso_meta, "refused": "cmd_shim"})
            yield ev("error", message=iso.cmd_refusal_message(lang), fatal=True)
            return
        hide = iso.skill_paths_in(argv)  # 6: hata satırında kişisel skill adı görünmez
        system = inv.system
        if iso_meta.get("codex_config") == "isolated":
            note = iso.prompt_note(lang)
            system = f"{note}\n\n{system}" if system else note
        yield ev("meta", invocation=iso_meta)
        notice = self.tool_policy_notice(inv)
        if notice:  # Codex CLI'nin araç başına bayrağı yok: politika UYGULANMAZ, bunu adım kaydında açıkça göster
            yield ev("meta", invocation={"tool_policy": notice})
        messages: list[str] = []
        state: dict[str, Any] = {}  # eski biçimde çağrı sınırı (son token_count'tan beri komut var mı)
        stderr_tail: list[str] = []
        tail: list[tuple[str, str]] | None = [] if inv.kill_tail is not None else None
        sp_kw: dict[str, Any] = {"cwd": inv.workdir, "env": child_env(),
                                 "stdin_text": compose_prompt(system, inv.prompt), "timeout_s": inv.timeout_s}
        try:
            proc = stream_process(argv, **sp_kw, **({"tail": tail} if tail is not None else {}))
        except TypeError:  # `tail` bilmeyen (eski / sahte) akış: kuyruk okunmaz
            proc, tail = stream_process(argv, **sp_kw), None
        try:
            async for tag, line in proc:
                if tag == "out":
                    try:
                        obj = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    for e in self._map(obj, messages, state):
                        yield e
                elif tag == "err" and line.strip():
                    stderr_tail = (stderr_tail + [iso.redact(line, hide)])[-15:]
                elif tag == "timeout":
                    yield ev("error", message=f"Zaman aşımı ({inv.timeout_s // 60} dk)", transient=True)
                elif tag == "exit" and line != "0" and not messages:
                    yield ev("error", message=f"codex {line} koduyla çıktı: " + " | ".join(stderr_tail[-5:]),
                                 transient=any("Süreç başlatılamadı" in s for s in stderr_tail))
        finally:
            await proc.aclose()  # süreç öldürülür (iptalde); ölmeden önce bastığı satırlar `tail`e
            if tail and inv.kill_tail is not None:
                for _tag, line in tail:
                    try:
                        inv.kill_tail.extend(self._map(json.loads(line), list(messages), dict(state)))
                    except (json.JSONDecodeError, TypeError, AttributeError):
                        continue
        yield ev("final", text=(messages[-1] if messages else "").strip())

    def tool_policy_notice(self, inv: Invocation) -> dict[str, Any] | None:
        """Ajanın araç allow/deny listesi varsa "uygulanmıyor" özeti (S27). Codex'e güvensiz bir şey geçirilmez;
        sandbox (read-only / workspace-write) tek gerçek sınırdır."""
        try:
            from studio.tools.policy import effective
            ts = self.settings.get("tools", None) if self.settings is not None else None
            pol = effective(ts if isinstance(ts, dict) else {}, inv.agent)
        except Exception:  # noqa: BLE001
            return None
        if not pol.restricted:
            return None
        return {"enforced": False, "reason": "codex_no_per_tool_flags", "allow": list(pol.allow)[:20],
                "deny": list(pol.deny)[:20]}

    @staticmethod
    def _map(obj: dict[str, Any], messages: list[str], state: dict[str, Any] | None = None) -> list[CEvent]:
        """`state` (isteğe bağlı, koşu başına bir sözlük): eski `msg` biçiminde model çağrısı sınırını izler."""
        out: list[CEvent] = []
        t = obj.get("type")
        if t == "thread.started":
            out.append(ev("meta", model=None, session_id=obj.get("thread_id")))
        elif t in ("item.started", "item.completed"):
            item = obj.get("item") or {}
            it = item.get("type") or item.get("item_type")
            done = t == "item.completed"
            if it in ("agent_message", "assistant_message") and done:
                text = item.get("text", "")
                messages.append(text)
                out.append(ev("text", text=text + "\n"))
            elif it == "reasoning" and done:
                out.append(ev("thought", text=item.get("text", "")))
            elif it == "command_execution":
                tid = {"id": str(item["id"])} if item.get("id") else {}  # PROC-FIX P2: araç sonucu kimlikle eşleşir
                if done:
                    out.append(ev("tool_result", name="shell", ok=item.get("exit_code") in (0, None),
                                  output=preview(item.get("aggregated_output", "")), **tid))
                else:
                    out.append(ev("tool", name="shell", input=preview(item.get("command", "")), **tid))
            elif it == "mcp_tool_call":
                tid = {"id": str(item["id"])} if item.get("id") else {}
                name = f"{item.get('server', 'mcp')}.{item.get('tool', '?')}"
                out.append(ev("tool_result", name=name, ok=item.get("status") != "failed",
                              output=preview(item.get("result", "")), **tid) if done
                           else ev("tool", name=name, input=preview(item.get("arguments", "")), **tid))
            elif it == "web_search" and not done:
                out.append(ev("tool", name="web_search", input=preview(item.get("query", ""))))
            elif it == "file_change" and done:
                out.append(ev("tool", name="dosya değişikliği", input=preview(item.get("changes", ""))))
            elif it == "error":
                out.append(ev("error", message=item.get("message", "codex hatası")))
        elif t == "turn.completed":
            u = obj.get("usage") or {}
            pin, pout = (None if u.get(k) is None else usage_int(u.get(k)) for k in ("input_tokens", "output_tokens"))
            # önbellekten okunan giriş ayrıca kaydedilir (input zaten içerir; fiyat: workflow.pricing
            # önbellek çarpanları). alan bildirildiyse 0 da yazılır (isabet oranı "ölçüldü, 0").
            cached = u.get("cached_input_tokens")
            known = isinstance(cached, int) and not isinstance(cached, bool) and cached >= 0
            out.append(ev("usage", input=pin, output=pout, total=(pin or 0) + (pout or 0),
                          **({"cache_read_tokens": int(cached)} if known else {})))
        elif t == "token_count" or (t == "event_msg" and (obj.get("payload") or {}).get("type") == "token_count"):
            out.extend(CodexConnector._token_count(obj if t == "token_count" else obj.get("payload") or {}, state))
        elif t == "turn.failed":
            out.append(ev("error", message=(obj.get("error") or {}).get("message", "codex turu başarısız")))
        elif t == "error":
            out.append(ev("error", message=obj.get("message", "codex hatası")))
        elif "msg" in obj:  # eski olay biçimi
            m = obj["msg"] or {}
            mt = m.get("type")
            if mt == "agent_message":
                messages.append(m.get("message", ""))
                out.append(ev("text", text=m.get("message", "") + "\n"))
            elif mt == "agent_reasoning":
                out.append(ev("thought", text=m.get("text", "")))
            elif mt == "exec_command_begin":
                # bu komutu isteyen model çağrısının jetonu SONRAKİ token_count'ta gelir; durma orada (çağrı
                # sınırında, jetonu raporlanmış olarak) yapılır. Durum izlenmiyorsa (state yok) eski davranış.
                if state is not None:
                    state["calls_tool"] = True
                out.append(ev("tool", name="shell", input=preview(m.get("command", "")),
                              **({"turn_open": True} if state is not None else {})))
            elif mt == "exec_command_end":
                out.append(ev("tool_result", name="shell", ok=m.get("exit_code") == 0, output=preview(m.get("stdout", ""))))
            elif mt == "error":
                out.append(ev("error", message=m.get("message", "codex hatası")))
            elif mt == "token_count":
                out.extend(CodexConnector._token_count(m, state))
        return out

    @staticmethod
    def _token_count(m: dict[str, Any], state: dict[str, Any] | None = None) -> list[CEvent]:
        """PROC2-FIX P1: Codex'in model çağrısı başına `token_count` olayı (`info.total_token_usage`, KÜMÜLATİF; aynı
        alanı `external/normalize.py` oturum dosyalarından okur). Bu olay geldiğinde adım tavanı adım sürerken uygulanır.
        `codex exec --json`un yeni biçimi yalnız `turn.completed` verir: o durumda kullanım tur sonunda bilinir.

        `state` izleniyorsa olay bir çağrı sınırıdır (`turn_end`): `next_turn` = bu çağrı komut çalıştırdı (sıradaki
        model çağrısı gelecek); `next_min` = son çağrının boyutu (`last_token_usage`). Motor tavanı geçen çağrının
        token_count'unda durur; o çağrının jetonu kartta ve günlükte sayılır."""
        info = m.get("info") if isinstance(m.get("info"), dict) else {}
        u = info.get("total_token_usage") if isinstance(info.get("total_token_usage"), dict) else None
        if not u:
            return []
        pin, pout = usage_int(u.get("input_tokens")), usage_int(u.get("output_tokens"))
        cached = u.get("cached_input_tokens")
        known = isinstance(cached, int) and not isinstance(cached, bool) and cached >= 0
        extra: dict[str, Any] = {}
        if state is not None:
            last = info.get("last_token_usage") if isinstance(info.get("last_token_usage"), dict) else {}
            extra = {"turn_end": True, "next_turn": bool(state.pop("calls_tool", False)),
                     "next_min": max(usage_int(last.get("total_tokens")),
                                     usage_int(last.get("input_tokens")) + usage_int(last.get("output_tokens")))}
        return [ev("usage", input=pin, output=pout, total=max(pin + pout, usage_int(u.get("total_tokens"))),
                   partial=True, **({"cache_read_tokens": int(cached)} if known else {}), **extra)]
