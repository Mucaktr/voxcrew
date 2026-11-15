"""Claude Code CLI bağlayıcısı: `claude -p --output-format stream-json` olaylarını normalize eder.

Ajan kişiliği --append-system-prompt ile verilir. İzinler araç listesiyle sınırlanır; kabuk (Bash)
hiçbir izin düzeyinde açılmaz.

 (karar 3): ajan varsayılan olarak kullanıcının `~/.claude` kurulumunu (CLAUDE.md, skill, komut, alt ajan,
ayar/hook/eklenti, otomatik bellek) devralmaz — `--setting-sources project,local`, `--no-session-persistence`,
`--settings <stüdyo ayar dosyası>` (`claudeMdExcludes` + AGENTS.md için `managed-only`),
`CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`, `CLAUDE_CODE_DISABLE_CLAUDE_MDS=1` (`connectors/claude_isolation.py`; kaynaklar
).
Ajan başına açılabilir; kip `meta.invocation.claude_config` (`isolated` | `inherited`) ile izde görünür.
"""

from __future__ import annotations

import asyncio
import json
import os
import threading
from typing import Any, AsyncIterator

from studio.connectors.base import CEvent, Connector, Invocation, child_env, ev, preview, stream_process, usage_int
from studio.connectors.discovery import find_claude

READ_TOOLS = "Read,Glob,Grep,WebSearch,WebFetch,TodoWrite"
WRITE_TOOLS = READ_TOOLS + ",Edit,Write,MultiEdit"


def _drop_env() -> tuple[str, ...]:
    """Stüdyo bir Claude Code oturumunun içinden başlatıldıysa, o oturumun değişkenleri (ana makine
    proxy'si, oturum kimlikleri) alt `claude` sürecine sızmasın; CLI kendi kayıtlı oturumunu kullansın."""
    drop = [k for k in os.environ
            if k in ("CLAUDECODE", "CLAUDE_PID") or k.startswith("CLAUDE_AGENT_SDK")
            or (k.startswith("CLAUDE_CODE_") and k != "CLAUDE_CODE_GIT_BASH_PATH")]
    if "CLAUDECODE" in os.environ or "CLAUDE_CODE_SESSION_ID" in os.environ:
        drop.append("ANTHROPIC_BASE_URL")
    return tuple(drop)


class ClaudeConnector(Connector):
    kind = "claude"

    async def run(self, inv: Invocation) -> AsyncIterator[CEvent]:
        exe = find_claude()
        if not exe:
            yield ev("error", message="claude CLI bulunamadı")
            return
        # yalıtılmış koşu stüdyo veri dizinine küçük bir `--settings` dosyası yazar → olay döngüsü dışında
        from studio.connectors.claude_isolation import IsolationError, release_all
        # koşuya özel eklenti kökü ve istem dosyası OLUŞTURULMADAN önce `cleanup`'a yazılır. Koşu `launch` iş
        # parçacığındayken iptal edilirse liste kaybolmaz: iş parçacığı dönünce (ya da dönmüşse hemen) silinir.
        cleanup: list[str] = []
        gate = threading.Lock()
        state = {"done": False, "abandoned": False}

        def work() -> Any:
            try:
                return self.launch(str(exe), inv, cleanup)
            finally:
                with gate:
                    state["done"] = True
                    abandoned = state["abandoned"]
                if abandoned:
                    release_all(cleanup)

        try:
            argv, env_extra, tool_policy, config_mode, _ = await asyncio.to_thread(work)
        except IsolationError as exc:  # cmd.exe'nin böleceği satır hiç başlatılmaz (koşu açık hatayla düşer)
            yield ev("error", message=exc.message, fatal=True)
            return
        except BaseException:          # iptal (CancelledError) ya da beklenmeyen hata: artık bırakma
            with gate:
                state["abandoned"] = True
                done = state["done"]
            if done:
                release_all(cleanup)
            raise
        try:
            async for e in self._stream(argv, env_extra, tool_policy, config_mode, inv):
                yield e
        finally:
            try:                       # koşuya özel boş eklenti kökü ve istem dosyası silinir
                await asyncio.to_thread(release_all, cleanup)
            except BaseException:
                release_all(cleanup)
                raise

    async def _stream(self, argv: list[str], env_extra: dict[str, str], tool_policy: dict[str, Any] | None,
                      config_mode: str, inv: Invocation) -> AsyncIterator[CEvent]:
        warn = None
        if config_mode == "isolated":  # `--settings` ile dışlanan ama canlı doğrulanmamış üst dizin dosyaları
            from studio.connectors.claude_isolation import ancestor_files
            found = await asyncio.to_thread(ancestor_files, inv.workdir)
            if found:
                warn = len(found)
        yield ev("meta", invocation={"claude_config": config_mode,
                                     **({"claude_isolation_unverified_files": warn} if warn else {}),
                                     **({"tool_policy": tool_policy} if tool_policy else {})})
        state: dict[str, Any] = {"delta": False, "final": None, "tools": {}}
        stderr_tail: list[str] = []
        tail: list[tuple[str, str]] | None = [] if inv.kill_tail is not None else None
        sp_kw: dict[str, Any] = {"cwd": inv.workdir, "env": child_env(env_extra, drop=_drop_env()),
                                 "stdin_text": inv.prompt, "timeout_s": inv.timeout_s}
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
                    for e in self._map(obj, state):
                        yield e
                elif tag == "err" and line.strip():
                    stderr_tail = (stderr_tail + [line])[-15:]
                elif tag == "timeout":
                    yield ev("error", message=f"Zaman aşımı ({inv.timeout_s // 60} dk)", transient=True)
                elif tag == "exit" and line != "0" and state["final"] is None:
                    yield ev("error", message=f"claude {line} koduyla çıktı: " + " | ".join(stderr_tail[-5:]),
                                 transient=any("Süreç başlatılamadı" in s for s in stderr_tail))
        finally:
            await proc.aclose()  # süreç öldürülür (iptalde); ölmeden önce bastığı satırlar `tail`e
            if tail and inv.kill_tail is not None:
                for _tag, line in tail:
                    try:
                        inv.kill_tail.extend(self._map(json.loads(line), state))
                    except (json.JSONDecodeError, TypeError, AttributeError):
                        continue
        yield ev("final", text=(state["final"] or "").strip())

    def launch(self, exe: str, inv: Invocation, cleanup: list[str] | None = None
               ) -> tuple[list[str], dict[str, str], dict[str, Any] | None, str, list[str]]:
        """(argv, ek ortam, araç politikası özeti, `~/.claude` kipi, koşu sonunda silinecek yollar). (karar 3): ajan
        varsayılan olarak kullanıcının `~/.claude` kurulumunu devralmaz (`claude_isolation.apply`); ajan başına açılmışsa
        argv/ortam eskisiyle aynı. `claude` npm `.cmd` kabuğuysa cmd.exe'nin bölebileceği istem dosyaya taşınır,
        başka güvensiz argüman varsa IsolationError (koşu başlatılmaz). `cleanup` verilirse her geçici yol
        oluşturulmadan ÖNCE oraya eklenir; hata yolunda burada oluşturulan her şey silinir."""
        from studio.connectors import claude_isolation

        cleanup = [] if cleanup is None else cleanup
        try:
            argv, tool_policy = self.build_argv(exe, inv)
            agent = inv.agent or {}
            props = agent.get("props", agent)
            # devralma ajanın DEĞİŞMEZ örneğine (düğüm kimliği + oluşturma damgası) bağlıdır; örnek bilinmeyen
            # çağrı (sistem çağrısı, bağlantı testi) her zaman yalıtılmıştır
            instance = inv.agent_instance or claude_isolation.instance_of(agent)
            argv, env_extra, config_mode = claude_isolation.apply(self.settings, props.get("slug"), argv, instance,
                                                                  workdir=inv.workdir, register=cleanup)
            if claude_isolation.is_cmd_shim(exe):
                argv, _ = claude_isolation.shim_safe(argv, register=cleanup, settings=self.settings)
        except BaseException:
            claude_isolation.release_all(cleanup)
            raise
        return argv, env_extra, tool_policy, config_mode, cleanup

    def build_argv(self, exe: str, inv: Invocation) -> tuple[list[str], dict[str, Any] | None]:
        """CLI argümanları + (varsa) uygulanan araç politikası özeti.

        Araç politikası (S27, `studio.tools.policy`): deny kalıpları `--disallowedTools` olur (yerleşik araç adları ve
        `mcp__sunucu__araç`); allow kalıplarından yalnızca `mcp__…` kuralları izinli listeye eklenir — kabuk (Bash) ve
        yazma araçları her zaman ajanın izin düzeyinden gelir, allow ile genişletilemez."""
        allowed = (WRITE_TOOLS if inv.permissions == "write" else READ_TOOLS).split(",")
        flags = {"disallowed": [], "allowed_mcp": [], "unmapped": []}
        try:
            from studio.tools.policy import claude_flags, effective
            tools_settings = self.settings.get("tools", None) if self.settings is not None else None
            flags = claude_flags(effective(tools_settings if isinstance(tools_settings, dict) else {}, inv.agent))
        except Exception:  # noqa: BLE001 - politika okunamazsa varsayılan (dar) izinlerle devam
            pass
        allowed = [t for t in allowed if t not in flags["disallowed"]] + flags["allowed_mcp"]
        argv = [exe, "-p", "--output-format", "stream-json", "--verbose", "--include-partial-messages",
                "--allowedTools", ",".join(allowed)]
        if flags["disallowed"]:
            argv += ["--disallowedTools", ",".join(flags["disallowed"])]
        if inv.system.strip():
            argv += ["--append-system-prompt", inv.system]
        if inv.route.model and inv.route.model != "default":
            argv += ["--model", inv.route.model]
        cl = (inv.extra or {}).get("claude") or {}  # booster: tur sınırı ve çaba
        if cl.get("max_turns"):
            argv += ["--max-turns", str(max(1, int(cl["max_turns"])))]
        if cl.get("effort") in ("low", "medium", "high", "max"):
            argv += ["--effort", str(cl["effort"])]
        summary = ({"disallowed": flags["disallowed"], "allowed_mcp": flags["allowed_mcp"],
                    **({"unmapped": flags["unmapped"]} if flags["unmapped"] else {})}
                   if flags["disallowed"] or flags["allowed_mcp"] or flags["unmapped"] else None)
        return argv, summary

    @staticmethod
    def _turn_usage(state: dict[str, Any], mid: str, u: Any) -> bool:
        """PROC2-FIX P1: tur (ileti kimliği) başına kullanım; sayaç başına en yüksek değer. Değiştiyse True."""
        if not isinstance(u, dict) or not u:
            return False
        turns = state.setdefault("turns", {})
        row = turns.setdefault(mid, {"input": 0, "cache_read": 0, "cache_write": 0, "output": 0})
        new = {"input": usage_int(u.get("input_tokens")), "cache_read": usage_int(u.get("cache_read_input_tokens")),
               "cache_write": usage_int(u.get("cache_creation_input_tokens")),
               "output": usage_int(u.get("output_tokens"))}
        changed = False
        for k, v in new.items():
            if v > row[k]:
                row[k], changed = v, True
        return changed

    @staticmethod
    def _rekey(state: dict[str, Any], old: str, new: str) -> None:
        """kimliksiz `message_start` geçici anahtarla açılan tur, aynı turun kimlikli ilk olayı gelince o
        kimliğe taşınır (sayaç başına en yüksek değer); aynı tur iki ayrı anahtarla iki kez sayılmaz."""
        turns = state.setdefault("turns", {})
        row = turns.pop(old, None)
        if row is None:
            return
        dst = turns.setdefault(new, {"input": 0, "cache_read": 0, "cache_write": 0, "output": 0})
        for k, v in row.items():
            dst[k] = max(dst.get(k, 0), v)

    @staticmethod
    def _turn_key(state: dict[str, Any], mid: Any) -> str:
        """`assistant` olayının tur anahtarı: ileti kimliği; yoksa açık akış turu; o da yoksa tur sırası (araç sonucundan
        sonra yeni tur başlar)."""
        if mid:
            if state.get("anon") and state.get("cur"):
                ClaudeConnector._rekey(state, str(state["cur"]), str(mid))
                state["cur"], state["anon"] = str(mid), False
            return str(mid)
        if state.get("cur"):
            return str(state["cur"])
        if state.pop("after_result", False):
            state["turn_idx"] = int(state.get("turn_idx") or 0) + 1
        return f"turn-{int(state.get('turn_idx') or 0)}"

    @staticmethod
    def _running_usage(state: dict[str, Any], **extra: Any) -> CEvent:
        """Şimdiye kadarki turların toplamı (`result` ile aynı anlam: giriş = önbellek okuma + yazma dahil). Ara olay
        `partial: True` taşır; kesin toplam `result` olayıdır (motor sayaç başına en yükseği tutar)."""
        rows = list((state.get("turns") or {}).values())
        c_read = sum(r["cache_read"] for r in rows)
        c_write = sum(r["cache_write"] for r in rows)
        pin = sum(r["input"] for r in rows) + c_read + c_write
        pout = sum(r["output"] for r in rows)
        return ev("usage", input=pin, output=pout, total=pin + pout, cache_read_tokens=c_read,
                  cache_write_tokens=c_write, partial=True, turns=len(rows), **extra)

    @staticmethod
    def _turn_size(state: dict[str, Any]) -> int:
        """Biten turun boyutu (giriş + önbellek + çıkış): sıradaki tur bu bağlamı en az bir kez yeniden okur."""
        row = (state.get("turns") or {}).get(str(state.get("cur") or ""))
        return int(sum(row.values())) if row else 0

    @staticmethod
    def _map(obj: dict[str, Any], state: dict[str, Any]) -> list[CEvent]:
        out: list[CEvent] = []
        t = obj.get("type")
        if t == "system" and obj.get("subtype") == "init":
            out.append(ev("meta", model=obj.get("model"), session_id=obj.get("session_id")))
        elif t == "stream_event":
            e = obj.get("event") or {}
            if e.get("type") == "message_start":  # PROC2-FIX P1: tur başı (giriş + önbellek bilinir)
                msg = e.get("message") or {}
                # önceki tur bitti (message_delta stop_reason geldi) ama `message_stop` hiç gelmedi ve araç
                # istemişti → tur sınırı kaçtı. Yeni tur zaten gönderildi (ödendi); motor en geç burada, ondan SONRAKİ
                # turdan önce durabilir (`late`: dürüst ifade — bir tur daha ödenmiş olabilir)
                late = bool(state.get("turn_open") and state.get("turn_done") and state.get("turn_tool"))
                state["turn_idx"] = int(state.get("turn_idx") or 0) + 1
                # kimliksiz tur geçici anahtar alır; kimlik gelince o anahtara taşınır (iki kez sayılmaz)
                state["cur"] = str(msg.get("id") or f"turn-{state['turn_idx']}")
                state["anon"] = not msg.get("id")
                state["turn_open"], state["turn_tool"], state["turn_done"] = True, False, False
                if ClaudeConnector._turn_usage(state, state["cur"], msg.get("usage")):
                    out.append(ClaudeConnector._running_usage(state))
                if late:
                    out.append(ClaudeConnector._running_usage(state, turn_end=True, next_turn=True, late=True,
                                                              next_min=ClaudeConnector._turn_size(state)))
            elif e.get("type") == "message_delta" and state.get("cur"):  # tur sonu: çıkış jetonu (kümülatif)
                if (e.get("delta") or {}).get("stop_reason") == "tool_use":
                    state["turn_tool"] = True
                if (e.get("delta") or {}).get("stop_reason"):
                    state["turn_done"] = True
                if ClaudeConnector._turn_usage(state, state["cur"], e.get("usage")):
                    out.append(ClaudeConnector._running_usage(state))
            elif e.get("type") == "message_stop" and state.get("turn_open"):
                # gerçek CLI sırasında araç olayı (`assistant` tool_use) turun SON çıkış jetonundan (message_delta)
                # ÖNCE gelir. Tur sınırı burasıdır: kullanım tamdır; `next_turn` = bu tur araç istedi (sıradaki model turu
                # gelecek); `next_min` = sıradaki turun en az yeniden okuyacağı bağlam (bu turun boyutu). Motor tavanı
                # burada, sıradaki model turundan ÖNCE uygular.
                state["turn_open"] = False
                out.append(ClaudeConnector._running_usage(state, turn_end=True, next_turn=bool(state.get("turn_tool")),
                                                          next_min=ClaudeConnector._turn_size(state)))
            elif e.get("type") == "content_block_delta":
                d = e.get("delta") or {}
                if d.get("type") == "text_delta":
                    state["delta"] = True
                    out.append(ev("text", text=d.get("text", "")))
                elif d.get("type") == "thinking_delta":
                    out.append(ev("thought", text=d.get("thinking", "")))
        elif t == "assistant":
            msg = obj.get("message") or {}
            # PROC2-FIX P1: her model turunun kullanımı tur biter bitmez bildirilir (araç çağrısından ÖNCE): motor adım
            # tavanını adım sürerken uygular ve sıradaki model turundan önce durur. Aynı ileti kimliği birden çok kez
            # gelebilir (içerik bloğu başına): sayaç başına en yüksek değer, kimlik başına bir kez toplanır.
            if ClaudeConnector._turn_usage(state, ClaudeConnector._turn_key(state, msg.get("id")), msg.get("usage")):
                out.append(ClaudeConnector._running_usage(state))
            for block in msg.get("content", []):
                bt = block.get("type")
                if bt == "text" and not state["delta"]:
                    out.append(ev("text", text=block.get("text", "")))
                elif bt == "tool_use":
                    state["tools"][block.get("id")] = block.get("name", "?")
                    state["turn_tool"] = True
                    # tur hâlâ açık (son çıkış jetonu ve message_stop gelmedi) → motor durmayı tur sonuna bırakır
                    out.append(ev("tool", name=block.get("name", "?"), input=preview(block.get("input", {})),
                                  **({"id": str(block["id"])} if block.get("id") else {}),  # PROC-FIX P2: eşleşme
                                  **({"turn_open": True} if state.get("turn_open") else {})))
            state["delta"] = False
        elif t == "user":
            for block in (obj.get("message") or {}).get("content", []) or []:
                if isinstance(block, dict) and block.get("type") == "tool_result":
                    state["after_result"] = True
                    name = state["tools"].get(block.get("tool_use_id"), "araç")
                    out.append(ev("tool_result", name=name, ok=not block.get("is_error"),
                                  output=preview(block.get("content", "")),
                                  **({"id": str(block["tool_use_id"])} if block.get("tool_use_id") else {})))
        elif t == "result":
            u = obj.get("usage") or {}
            # `input` = tüm girdi token'ları (önbellekten okunan + önbelleğe yazılan dahil; Anthropic API ile aynı
            # anlam). Önbellek alanları ayrıca `cache_read_tokens` / `cache_write_tokens` olarak kaydedilir (C-5);
            # önbelleğe yazma (cache_creation) artık atılmaz.
            c_read = usage_int(u.get("cache_read_input_tokens"))
            c_write = usage_int(u.get("cache_creation_input_tokens"))
            pin = usage_int(u.get("input_tokens")) + c_read + c_write
            pout = None if u.get("output_tokens") is None else usage_int(u.get("output_tokens"))
            # sağlayıcı alanı bildirdiyse 0 da yazılır ("ölçüldü, isabet yok" ≠ "ölçülmedi")
            known = "cache_read_input_tokens" in u or "cache_creation_input_tokens" in u
            cache = ({"cache_read_tokens": c_read, "cache_write_tokens": c_write} if known or c_read or c_write
                     else {})
            out.append(ev("usage", input=pin, output=pout, total=pin + (pout or 0), **cache,
                          cost_usd=obj.get("total_cost_usd")))
            state["final"] = obj.get("result") or ""
            if obj.get("is_error") or (obj.get("subtype") or "success") != "success":
                state["final"] = ""
                reason = preview(obj.get("result") or obj.get("subtype") or "bilinmeyen hata", 300)
                if "authenticate" in reason or "OAuth" in reason or "login" in reason.lower():
                    reason += " — terminalde `claude` açıp /login ile oturumu yenileyin."
                # fatal: CLI sonucu hata (oturum süresi doldu, kota vb.) — akışta gelen metin hata metnidir, yanıt değil;
                # motor adımı `done` saymaz (değerlendirme ve kabul yanlış başarı görmesin)
                out.append(ev("error", message=f"Claude Code: {reason}", fatal=True))
        return out
