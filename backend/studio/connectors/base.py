"""Bağlayıcı sözleşmesi ve alt süreç akıtma yardımcıları.

Her bağlayıcı (hermes, ollama, codex, claude) aynı normalize olayları üretir:
  meta {model, session_id} · text {text} · thought {text} · tool {name, input}
  · tool_result {name, ok, output} · usage {input, output, total} · final {text}
  · error {message, transient?} — `transient: True` geçici hata (zaman aşımı, süreç başlatılamadı, HTTP 5xx/429,
    bağlantı kopması, boş çıktı); motor yalnızca bunları adım politikasına göre yeniden dener.
    İşaret verilmezse motor `transient_hint(message)` ile ileti kalıbına bakar.
"""

from __future__ import annotations

import asyncio
import json
import math
import os
import subprocess
import sys
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, AsyncIterator


@dataclass
class Route:
    """Bir ajanın bu adımda hangi bağlayıcı/sağlayıcı/model ile çalışacağı."""
    connector: str                 # hermes | ollama | codex | claude
    connection: str                # profile | ollama | codex | claude
    model: str | None = None
    provider: str | None = None    # hermes: custom | openai-codex | None (profil ayarı); openai_compat: uç nokta id'si
    profile: str | None = None     # yalnız hermes
    # Görünen sağlayıcı adı (ör. çoklu OpenAI uyumlu uç noktada "Mistral AI"); rotayı kuran doldurur, yoksa bağlantı adı
    endpoint_label: str | None = None

    @property
    def resource(self) -> str:
        """Eşzamanlılık kilidi anahtarı — Ollama işleri (Hermes üzerinden olsa da) CPU'yu paylaşır."""
        return "ollama" if self.connection == "ollama" else self.connection

    def describe(self) -> str:
        brain = self.endpoint_label or {"ollama": "Ollama", "codex": "GPT Codex", "claude": "Claude Code",
                                        "openai_compat": "OpenAI uyumlu",
                                        "profile": "profil ayarı"}.get(self.connection, self.connection)
        via = f"Hermes/{self.profile} › " if self.connector == "hermes" else ""
        return f"{via}{brain}" + (f" · {self.model}" if self.model else "")

    def to_dict(self) -> dict[str, Any]:
        return {"connector": self.connector, "connection": self.connection, "model": self.model,
                "provider": self.provider, "profile": self.profile, "label": self.describe(),
                **({"endpoint_label": self.endpoint_label} if self.endpoint_label else {})}


@dataclass
class Invocation:
    run_id: str
    step_id: str
    agent: dict[str, Any]
    system: str
    prompt: str
    route: Route
    workdir: Path
    timeout_s: int = 1800
    max_turns: int = 30
    permissions: str = "read"
    extra: dict[str, Any] = field(default_factory=dict)
    # ajanın değişmez örneği {id, created_at} (motor doldurur; sistem çağrısında None → Claude yalıtılmış)
    agent_instance: dict[str, str] | None = None
    # gerçek devam (yalnız API araç döngüleri: OpenAI uyumlu, Anthropic). `checkpoint` = bağlayıcının tur
    # sınırında (sıradaki model turundan önce) yazdığı konuşma durumu kutusu; motor orada durursa durumu saklar.
    # `resume` = motorun sakladığı durum: bağlayıcı baştan değil, kaldığı turdan sürdürür (iletiler + araç sonuçları).
    checkpoint: dict[str, Any] | None = None
    resume: dict[str, Any] | None = None
    # adımın araç yürütme defteri (motorun kalıcı listesi, başvuruyla paylaşılır) ve bu denemenin numarası.
    # Araç döngüsü (`tools.loop.ToolLoop`) daha önce yürütülmüş bir çağrıyı (aynı çağrı kimliği ya da aynı ad +
    # argümanlar, önceki denemelerde) YENİDEN ÇALIŞTIRMAZ: kayıtlı sonucu "önceden çalıştırıldı" işaretiyle döndürür.
    tool_ledger: list[dict[str, Any]] | None = None
    attempt: int = 0
    # sürdürülen konuşmanın BAŞLADIĞI deneme (baştan çalışmada bu deneme). Devamda yeni çağrı, bu denemeden
    # ÖNCEKİ (bırakılmış konuşmaların) yan etkili yürütmeleriyle ad + argümanla eşleşir; None = eski kural
    ledger_origin: int | None = None
    # devretme düzeyi havuz görünümü (`tools.loop.PoolView`; motor doldurur). Yöneticinin önceki denemesinin alt
    # ağacında yürütülmüş yan etkili çağrılar (ad + argüman) bu adımın ilk kez istediği eşleşen çağrıya oynatılır.
    tool_pool: Any = None
    # motorun öldürdüğü CLI sürecinin ÖLMEDEN ÖNCE bastığı ama tüketilmemiş satırlar (bağlayıcı eşlediği olayları
    # buraya ekler; motor doldurmaz, okur). Tur sınırında durdurulan Claude Code / Codex'in öldürme gecikmesinde sıradaki
    # isteği gönderip göndermediğini (turun bütün araç sonuçları basıldı mı) dürüstçe gösterir; tahmin buna göre yazılır.
    kill_tail: list[Any] | None = None


@dataclass
class CEvent:
    kind: str
    data: dict[str, Any] = field(default_factory=dict)


# sağlayıcı kullanım sayaçları güvenilmez girdidir (özel/hatalı Anthropic uyumlu uç nokta negatif, NaN ya da
# metin döndürebilir). Alımda sonlu, negatif olmayan tam sayıya indirgenir; çözülemeyen değer 0 sayılır.
USAGE_INT_KEYS = ("input", "output", "total", "cache_read_tokens", "cache_write_tokens", "cache_write_1h_tokens")
# sonlu ama devasa sayaç (10**400, 1e308) aritmetikte taşar; tavana kırpılır, tur kullanımı kaybolmaz
USAGE_MAX = 10 ** 12
COST_MAX = 1e9


def usage_int(value: Any, default: int = 0) -> int:
    """Kullanım sayacı → sonlu, 0 ≤ x ≤ `USAGE_MAX` tam sayı. bool, NaN/inf, çözülemeyen metin → `default`."""
    if isinstance(value, bool) or value is None:
        return default
    if isinstance(value, str):
        try:
            value = float(value.strip())
        except ValueError:
            return default
    if isinstance(value, (int, float)):
        if isinstance(value, float) and not math.isfinite(value):
            return default
        return min(USAGE_MAX, max(0, int(value)))
    return default


def clean_usage(data: dict[str, Any]) -> dict[str, Any]:
    """`usage` olayı yükünü temizler: sayaçlar sonlu ≥ 0 tam sayı (None = ölçülmedi, korunur); önbellek alanları girdiyi
    aşamaz (okuma ≤ girdi, yazma ≤ girdi − okuma, 1 sa yazma ≤ yazma); `total` giriş+çıkıştan küçük olamaz; maliyet
    sonlu ≥ 0 değilse atılır."""
    out = dict(data)
    for k in USAGE_INT_KEYS:
        if k in out and out[k] is not None:
            out[k] = usage_int(out[k])
    inp = out.get("input")
    if isinstance(inp, int):
        if out.get("cache_read_tokens") is not None:
            out["cache_read_tokens"] = min(out["cache_read_tokens"], inp)
        if out.get("cache_write_tokens") is not None:
            out["cache_write_tokens"] = min(out["cache_write_tokens"], inp - int(out.get("cache_read_tokens") or 0))
    if out.get("cache_write_1h_tokens") is not None:
        out["cache_write_1h_tokens"] = min(out["cache_write_1h_tokens"], int(out.get("cache_write_tokens") or 0))
    if out.get("total") is not None:
        out["total"] = min(USAGE_MAX, max(out["total"], int(out.get("input") or 0) + int(out.get("output") or 0)))
    if "cost_usd" in out and out["cost_usd"] is not None:
        c = out["cost_usd"]
        ok = isinstance(c, (int, float)) and not isinstance(c, bool) and math.isfinite(float(c)) and c >= 0
        if ok:
            out["cost_usd"] = min(COST_MAX, float(c))
        else:
            out.pop("cost_usd")
    return out


def ev(kind: str, **data: Any) -> CEvent:
    if kind == "usage":
        data = clean_usage(data)  # her bağlayıcının kullanım olayı alımda sınırlanır
    return CEvent(kind, data)


def err(message: str, *, transient: bool = False, **data: Any) -> CEvent:
    """Hata olayı; `transient=True` geçici (yeniden denenebilir) hatayı işaretler."""
    return CEvent("error", {"message": message, "transient": bool(transient), **data})


# Geçici hata ileti kalıpları (küçük harf): işaretlenmemiş hata olaylarında motorun yedek sınıflandırması.
TRANSIENT_HINTS: tuple[str, ...] = (
    "zaman aşımı", "timeout", "timed out", "süreç başlatılamadı", "bağlantı hatası", "connection error",
    "connection refused", "connection reset", "boş çıktı", "empty output", "rate limit", "too many requests",
    "overloaded", "temporarily unavailable", "service unavailable", "bad gateway", "gateway timeout",
    " 429", " 500", " 502", " 503", " 504", "econnreset", "econnrefused", "etimedout",
)


def transient_hint(message: str) -> bool:
    """İleti geçici bir hatayı andırıyor mu (bağlayıcı `transient` vermediğinde kullanılır)."""
    low = f" {str(message or '').lower()} "
    return any(h in low for h in TRANSIENT_HINTS)


def http_transient(status_code: int) -> bool:
    """HTTP 429 ve 5xx geçici sayılır."""
    return status_code == 429 or 500 <= int(status_code) < 600


def preview(value: Any, limit: int = 400) -> str:
    if not isinstance(value, str):
        try:
            value = json.dumps(value, ensure_ascii=False)
        except (TypeError, ValueError):
            value = str(value)
    value = value.strip()
    return value[:limit] + ("…" if len(value) > limit else "")


KILL_GRACE_S = 3.0


def group_popen_kwargs() -> dict[str, Any]:
    """Alt süreci kendi süreç grubunda başlatan Popen argümanları.

    Windows: konsol penceresi açılmaz (ağaç `taskkill /T` ile öldürülür). POSIX: yeni oturum/süreç grubu; böylece
    iptal ve zaman aşımında torun süreçler (araç kabukları, sandbox) da `killpg` ile kapanır. Bu argümanlarla
    başlatılan süreci `mark_group(proc)` ile işaretle ki `kill_tree` grubu hedeflesin."""
    if sys.platform == "win32":
        return {"creationflags": subprocess.CREATE_NO_WINDOW}
    return {"start_new_session": True}


def mark_group(proc: Any) -> Any:
    """`group_popen_kwargs()` ile başlatılmış süreci grup lideri olarak işaretler (POSIX'te killpg için).

    start_new_session=True ile başlayan çocuğun grup kimliği kendi PID'idir; lider çıkıp biçilse bile grupta süreç
    kaldıkça bu kimlik başka bir sürece verilmez, bu yüzden torunlara sonradan da ulaşılabilir."""
    if sys.platform != "win32":
        try:
            proc._studio_pgid = proc.pid
        except AttributeError:
            pass
    return proc


def _posix_group(proc: Any) -> int | None:
    """İşaretli grup kimliği; işaretsizse ya da stüdyonun kendi grubuysa None (kendi grubumuzu asla öldürme)."""
    pgid = getattr(proc, "_studio_pgid", None)
    if not isinstance(pgid, int) or pgid <= 1:
        return None
    try:
        if pgid == os.getpgid(0):
            return None
    except OSError:
        return None
    return pgid


def kill_tree(proc: subprocess.Popen[bytes], grace: float = KILL_GRACE_S) -> None:
    """Süreci ve alt süreçlerini sonlandırır. Engellemez: POSIX'te önce SIGTERM, `grace` sn sonra arka planda SIGKILL."""
    if sys.platform == "win32":
        if proc.poll() is not None:
            return
        subprocess.run(["taskkill", "/PID", str(proc.pid), "/T", "/F"],
                       capture_output=True, creationflags=subprocess.CREATE_NO_WINDOW)
        return
    import signal

    pgid = _posix_group(proc)
    if pgid is None:
        if proc.poll() is None:
            proc.kill()
        return
    # Lider çıkmış olsa bile gruptaki torunlar yaşıyor olabilir: gruba sinyal gönder.
    try:
        os.killpg(pgid, signal.SIGTERM)
    except (ProcessLookupError, PermissionError):
        return

    def finish() -> None:
        try:
            proc.wait(timeout=grace)
        except subprocess.TimeoutExpired:
            pass
        try:
            os.killpg(pgid, 0)  # grupta hâlâ süreç var mı
            os.killpg(pgid, signal.SIGKILL)
        except (ProcessLookupError, PermissionError):
            pass

    if grace <= 0:
        finish()
    else:
        threading.Thread(target=finish, daemon=True).start()


async def stream_process(argv: list[str], *, cwd: Path, env: dict[str, str] | None = None,
                         stdin_text: str | None = None, timeout_s: float = 1800,
                         tail: list[tuple[str, str]] | None = None) -> AsyncIterator[tuple[str, str]]:
    """Alt süreci iş parçacıklarıyla okur (olay döngüsü türünden bağımsız) ve satır satır verir.

    Etiketler: 'out' / 'err' satırları, 'timeout', son olarak 'exit' (dönüş kodu).
    İptal edilirse süreç ağacı öldürülür. `tail` verilmişse öldürmeden SONRA sürecin ölmeden önce bastığı ama
    henüz verilmemiş 'out' satırları oraya eklenir (en çok `TAIL_WAIT_S`; süreç öldüğü için akış kısa sürede kapanır).
"""
    loop = asyncio.get_running_loop()
    queue: asyncio.Queue[tuple[str, str]] = asyncio.Queue()
    try:
        proc = subprocess.Popen(argv, cwd=str(cwd), env=env, stdin=subprocess.PIPE,
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE, **group_popen_kwargs())
    except OSError as exc:
        yield ("err", f"Süreç başlatılamadı: {exc}")
        yield ("exit", "127")
        return
    mark_group(proc)

    def pump(stream: Any, tag: str) -> None:
        try:
            for raw in iter(stream.readline, b""):
                line = raw.decode("utf-8", "replace").rstrip("\r\n")
                loop.call_soon_threadsafe(queue.put_nowait, (tag, line))
        finally:
            loop.call_soon_threadsafe(queue.put_nowait, (f"{tag}_eof", ""))

    def feed() -> None:
        try:
            if stdin_text is not None and proc.stdin:
                proc.stdin.write(stdin_text.encode("utf-8"))
            if proc.stdin:
                proc.stdin.close()
        except OSError:
            pass

    for target, args in ((pump, (proc.stdout, "out")), (pump, (proc.stderr, "err")), (feed, ())):
        threading.Thread(target=target, args=args, daemon=True).start()

    deadline = time.monotonic() + timeout_s
    open_streams = 2
    try:
        while open_streams:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                kill_tree(proc)
                yield ("timeout", "")
                break
            try:
                tag, line = await asyncio.wait_for(queue.get(), timeout=remaining)
            except asyncio.TimeoutError:
                continue
            if tag.endswith("_eof"):
                open_streams -= 1
                continue
            yield (tag, line)
        rc = await loop.run_in_executor(None, proc.wait)
        yield ("exit", str(rc))
    except (asyncio.CancelledError, GeneratorExit):
        kill_tree(proc)
        if tail is not None:
            await _collect_tail(queue, tail, open_streams)
        raise


TAIL_WAIT_S = 0.5


async def _collect_tail(queue: "asyncio.Queue[tuple[str, str]]", tail: list[tuple[str, str]],
                        open_streams: int) -> None:
    """öldürülen sürecin kuyruktaki ve borudaki son 'out' satırları. Süreç öldüğü için okuma iş parçacıkları
    kısa sürede EOF verir; en çok `TAIL_WAIT_S` beklenir (ölmeyen ağaçta bile)."""
    loop = asyncio.get_running_loop()
    end = loop.time() + TAIL_WAIT_S
    while open_streams > 0:
        left = end - loop.time()
        if left <= 0:
            return
        try:
            tag, line = await asyncio.wait_for(queue.get(), timeout=left)
        except (asyncio.TimeoutError, asyncio.CancelledError):
            return
        if tag.endswith("_eof"):
            open_streams -= 1
        elif tag == "out":
            tail.append((tag, line))


def child_env(extra: dict[str, str] | None = None, drop: tuple[str, ...] = ()) -> dict[str, str]:
    env = {k: v for k, v in os.environ.items() if k not in drop}
    env["PYTHONIOENCODING"] = "utf-8"
    env["PYTHONUTF8"] = "1"
    env.update(extra or {})
    return env


class Connector:
    kind = "base"

    def __init__(self, settings: Any):
        self.settings = settings

    async def run(self, inv: Invocation) -> AsyncIterator[CEvent]:  # pragma: no cover - arayüz
        raise NotImplementedError
        yield  # noqa


def compose_prompt(system: str, prompt: str) -> str:
    """Sistem istemi ayrı verilemeyen çalışma zamanları (Hermes, Codex) için tek metin."""
    return f"{system.strip()}\n\n---\n\n{prompt.strip()}" if system.strip() else prompt
