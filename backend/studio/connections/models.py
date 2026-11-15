"""Model hazırlığı — Modelfile YOK.

- Donanım özetine göre önerilen Ollama modelleri (kaynaklı/temkinli: boyut ve lisans yaklaşık, Ollama kütüphanesinden).
- Hermes için geniş bağlam: `/api/create` ile `from` + `parameters.num_ctx` (donanıma göre 16K/32K/64K; 64K zorlanmaz).
- `ollama pull` / `create` akışı: yalnızca açık kullanıcı tıklamasıyla (confirm=True), ilerleme olaylarıyla.
"""

from __future__ import annotations

import asyncio
import json
import re
import time
import uuid
from typing import Any, Awaitable, Callable

import httpx

from studio.connectors.ollama import HERMES_MIN_CTX

GB = 1024 ** 3

# Yaklaşık değerler (Ollama kütüphanesi, varsayılan quantization). "approx": arayüzde "yaklaşık" etiketi.
CATALOG: list[dict[str, Any]] = [
    {"name": "qwen3:1.7b", "family": "Qwen 3", "vendor": "Alibaba", "params_b": 1.7, "size_gb": 1.4, "tools": True, "context_max": 40_960,
     "license": "Apache-2.0", "tier": 4, "good_for": "Çok zayıf makineler; hızlı, basit görevler"},
    {"name": "qwen3:4b", "family": "Qwen 3", "vendor": "Alibaba", "params_b": 4, "size_gb": 2.6, "tools": True, "context_max": 40_960,
     "license": "Apache-2.0", "tier": 8, "good_for": "8 GB RAM: dengeli, araç kullanır"},
    {"name": "llama3.2:3b", "family": "Llama 3.2", "vendor": "Meta", "params_b": 3, "size_gb": 2.0, "tools": True, "context_max": 131_072,
     "license": "Llama 3.2 Community", "tier": 8, "good_for": "8 GB RAM: hızlı, uzun bağlam"},
    {"name": "qwen3:8b", "family": "Qwen 3", "vendor": "Alibaba", "params_b": 8, "size_gb": 5.2, "tools": True, "context_max": 40_960,
     "license": "Apache-2.0", "tier": 16, "good_for": "16 GB RAM: ajan görevleri için önerilen"},
    {"name": "mistral:7b", "family": "Mistral", "vendor": "Mistral AI", "params_b": 7, "size_gb": 4.4, "tools": True, "context_max": 32_768,
     "license": "Apache-2.0", "tier": 16, "good_for": "16 GB RAM: hızlı, Avrupa menşeli"},
    {"name": "ministral-3", "family": "Ministral 3", "vendor": "Mistral AI", "params_b": 8, "size_gb": 6.0, "tools": True, "context_max": 262_144,
     "license": "Apache-2.0", "tier": 16, "good_for": "16 GB RAM: küçük, hızlı, görsel destekli Mistral"},
    {"name": "mistral-nemo", "family": "Mistral NeMo", "vendor": "Mistral AI", "params_b": 12, "size_gb": 7.1, "tools": True, "context_max": 131_072,
     "license": "Apache-2.0", "tier": 16, "good_for": "16 GB RAM: uzun bağlamlı, çok dilli Mistral"},
    {"name": "llama3.1:8b", "family": "Llama 3.1", "vendor": "Meta", "params_b": 8, "size_gb": 4.9, "tools": True, "context_max": 131_072,
     "license": "Llama 3.1 Community", "tier": 16, "good_for": "16 GB RAM: uzun bağlam, araç kullanır"},
    {"name": "qwen2.5-coder:7b", "family": "Qwen 2.5 Coder", "vendor": "Alibaba", "params_b": 7, "size_gb": 4.7, "tools": True, "context_max": 32_768,
     "license": "Apache-2.0", "tier": 16, "good_for": "Kod ağırlıklı görevler"},
    {"name": "qwen3:14b", "family": "Qwen 3", "vendor": "Alibaba", "params_b": 14, "size_gb": 9.3, "tools": True, "context_max": 40_960,
     "license": "Apache-2.0", "tier": 32, "good_for": "32 GB RAM / 12 GB+ VRAM: daha isabetli"},
    {"name": "mistral-small3.2", "family": "Mistral Small 3.2", "vendor": "Mistral AI", "params_b": 24, "size_gb": 15, "tools": True, "context_max": 131_072,
     "license": "Apache-2.0", "tier": 32, "good_for": "32 GB RAM: güçlü, görsel destekli"},
    {"name": "devstral", "family": "Devstral", "vendor": "Mistral AI", "params_b": 24, "size_gb": 14, "tools": True, "context_max": 131_072,
     "license": "Apache-2.0", "tier": 32, "good_for": "Yazılım ajanı görevleri"},
    {"name": "magistral", "family": "Magistral", "vendor": "Mistral AI", "params_b": 24, "size_gb": 14, "tools": True, "context_max": 39_936,
     "license": "Apache-2.0", "tier": 32, "good_for": "Adım adım akıl yürüten Mistral modeli"},
    {"name": "devstral-small-2", "family": "Devstral Small 2", "vendor": "Mistral AI", "params_b": 24, "size_gb": 15, "tools": True,
     "context_max": 393_216, "license": "Apache-2.0", "tier": 32, "good_for": "Yazılım ajanı görevleri; çok uzun bağlam"},
    {"name": "codestral", "family": "Codestral", "vendor": "Mistral AI", "params_b": 22, "size_gb": 13, "tools": False, "context_max": 32_768,
     "license": "Mistral AI Non-Production", "tier": 32, "good_for": "Kod tamamlama (araç kullanmaz; ticari olmayan lisans)"},
    {"name": "gpt-oss:20b", "family": "gpt-oss", "vendor": "OpenAI", "params_b": 21, "size_gb": 14, "tools": True, "context_max": 131_072,
     "license": "Apache-2.0", "tier": 32, "good_for": "32 GB RAM: akıl yürütme, araç kullanır"},
    {"name": "qwen3:32b", "family": "Qwen 3", "vendor": "Alibaba", "params_b": 32, "size_gb": 20, "tools": True, "context_max": 40_960,
     "license": "Apache-2.0", "tier": 64, "good_for": "64 GB RAM / 24 GB VRAM"},
]
CATALOG_SOURCE = "Ollama kütüphanesi (ollama.com/library) — boyut ve bağlam yaklaşık; lisans model kartından"
# S37: Mistral AI modelleri arayüzde ayrı ve öne çıkan bir bölümde (adlar ollama.com/library'den 2026-10-17)
FEATURED_VENDOR = "Mistral AI"

# Ollama model adı: [kayıt/][ad alanı/]ad[:etiket] — ör. mistral, mistral-small3.2, hf.co/kullanici/model:Q4_K_M
MODEL_NAME_RE = re.compile(
    r"(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9-]{1,63})+/)?"   # isteğe bağlı kayıt ana makinesi (hf.co)
    r"(?:[a-z0-9][a-z0-9._-]{0,63}/){0,2}"                               # ad alanı
    r"[a-z0-9][a-z0-9._-]{0,79}"                                          # ad
    r"(?::[a-z0-9][a-z0-9._-]{0,63})?", re.IGNORECASE)


def is_cloud_model(name: str) -> bool:
    """Ollama bulut modeli mi (`gpt-oss:120b-cloud`, `devstral-2:123b-cloud`, `gemma4:cloud`)? İstemler bu bilgisayardan
    çıkar ve `ollama signin` gerekir."""
    n = str(name or "").strip().lower()
    tag = n.rsplit(":", 1)[1] if ":" in n.rsplit("/", 1)[-1] else ""
    return n.endswith("-cloud") or tag == "cloud" or tag.endswith("-cloud")


def validate_model_name(name: str) -> str:
    """Serbest metinle indirme: adı doğrular; geçersizse ValueError."""
    n = str(name or "").strip()
    if not n or len(n) > 160 or ".." in n or n.startswith(("-", ".", "/")) or not MODEL_NAME_RE.fullmatch(n):
        raise ValueError("Geçersiz model adı")
    return n


def ram_tier(hw: dict[str, Any]) -> int | None:
    ram = hw.get("ram_gb")
    vram = hw.get("vram_gb")
    budget = max(ram or 0, (vram or 0) * 1.5) if (ram or vram) else None  # VRAM varsa daha büyük model sığar
    if budget is None:
        return None
    if budget < 6:
        return 4
    if budget < 12:
        return 8
    if budget < 24:
        return 16
    if budget < 48:
        return 32
    return 64


def kv_cache_gb(params_b: float, num_ctx: int) -> float:
    """Çok kaba KV önbellek tahmini (f16; GQA'lı modern modeller): ~0.016 GB × √(parametre) per 1K bağlam."""
    return round(0.016 * (params_b ** 0.5) * (num_ctx / 1024), 1)


def recommend_context(params_b: float, hw: dict[str, Any], model_max: int | None = None) -> dict[str, Any]:
    """Donanıma göre güvenli bağlam önerisi: 64K yalnızca sığıyorsa; aksi hâlde 32K / 16K. OOM riski açıklanır."""
    ram = hw.get("ram_gb") or 0
    vram = hw.get("vram_gb") or 0
    weights = next((c["size_gb"] for c in CATALOG if abs(c["params_b"] - params_b) < 0.5), params_b * 0.65)
    budget = (vram if vram >= weights + 2 else ram * 0.6) if (ram or vram) else 0
    options = []
    for ctx in (16_384, 32_768, 65_536):
        if model_max and ctx > model_max:
            continue
        need = weights + kv_cache_gb(params_b, ctx)
        fits = bool(budget) and need <= budget
        options.append({"num_ctx": ctx, "label": f"{ctx // 1024}K", "est_gb": round(need, 1), "fits": fits,
                        "hermes_ready": ctx >= HERMES_MIN_CTX})
    fitting = [o for o in options if o["fits"]]
    chosen = fitting[-1] if fitting else (options[0] if options else None)
    return {"options": options, "recommended": chosen["num_ctx"] if chosen else None, "budget_gb": round(budget, 1) if budget else None,
            "known": bool(ram or vram),
            "note": None if fitting else "Donanım bilgisi eksik ya da bellek dar; en küçük seçenek önerildi, deneyip geri alabilirsin."}


def recommend_models(hw: dict[str, Any], installed: list[str], lang: str = "tr") -> dict[str, Any]:
    tier = ram_tier(hw)
    have = {re.sub(r":latest$", "", n) for n in installed}
    items = []
    for c in CATALOG:
        fits = tier is None or c["tier"] <= tier
        rec = tier is not None and c["tier"] == tier and c["tools"]  # araçsız model ajan için önerilmez
        items.append({**c, "featured": c["vendor"] == FEATURED_VENDOR, "fits": fits, "recommended": rec, "installed": c["name"] in have or c["name"].split(":")[0] in have,
                      "approx": True, "context": recommend_context(c["params_b"], hw, c["context_max"])})
    items.sort(key=lambda x: (not x["recommended"], not x["fits"], x["tier"], x["size_gb"]))
    hint = ("Donanım bilinmiyor: küçük bir modelle başla." if tier is None else
            f"Yaklaşık {tier} GB sınıfı: {next((i['name'] for i in items if i['recommended']), 'qwen3:4b')} önerilir.")
    if lang == "en":  # S19: açıklama metinleri istek dilinde (katalog: studio/locales/en.py); TR birebir aynı kalır
        from studio.i18n import translate
        items = [{**i, "good_for": translate(i["good_for"], lang)} for i in items]
        if isinstance(hw, dict) and isinstance(hw.get("note"), str):
            hw = {**hw, "note": translate(hw["note"], lang)}
        return {"tier": tier, "hardware": hw, "source": translate(CATALOG_SOURCE, lang), "items": items,
                "hint": translate(hint, lang)}
    return {"tier": tier, "hardware": hw, "source": CATALOG_SOURCE, "items": items, "hint": hint}


# ---------------------------------------------------------------------- pull / create işleri
class OllamaJobs:
    """`/api/pull` ve `/api/create` akışlı işleri. Yalnızca açık çağrıyla başlar; ilerleme `connection.job` olayıyla."""

    def __init__(self, url_getter: Callable[[], str], *, transport: httpx.AsyncBaseTransport | None = None,
                 on_done: Callable[[], Awaitable[None]] | None = None, bus: Any = None):
        self.url_getter = url_getter
        self.transport = transport
        self.on_done = on_done
        self.bus = bus
        self.jobs: dict[str, dict[str, Any]] = {}
        self._tasks: dict[str, asyncio.Task[None]] = {}
        self._last_emit: dict[str, float] = {}

    def _new(self, kind: str, model: str, **extra: Any) -> dict[str, Any]:
        job = {"id": f"job_{uuid.uuid4().hex[:8]}", "kind": kind, "model": model, "status": "running", "progress": 0.0,
               "completed": 0, "total": 0, "message": "", "error": None, "started": time.time(), "finished": None, **extra}
        self.jobs[job["id"]] = job
        if len(self.jobs) > 30:  # eski işleri kırp
            for jid in sorted(self.jobs, key=lambda j: self.jobs[j]["started"])[:-30]:
                self.jobs.pop(jid, None)
        return job

    def _emit(self, job: dict[str, Any], force: bool = False) -> None:
        now = time.monotonic()
        if not force and now - self._last_emit.get(job["id"], 0) < 0.5:
            return
        self._last_emit[job["id"]] = now
        if self.bus is not None:
            try:
                self.bus.publish("connection.job", job=dict(job))
            except Exception:  # noqa: BLE001
                pass

    def start_pull(self, model: str) -> dict[str, Any]:
        model = validate_model_name(model)
        job = self._new("pull", model, cloud=is_cloud_model(model))
        self._tasks[job["id"]] = asyncio.create_task(self._stream(job, "/api/pull", {"model": model, "stream": True}))
        return dict(job)

    def start_create(self, name: str, source: str, num_ctx: int) -> dict[str, Any]:
        name, source = name.strip(), source.strip()
        if not re.fullmatch(r"[A-Za-z0-9_.:/-]{1,120}", name) or not re.fullmatch(r"[A-Za-z0-9_.:/-]{1,120}", source):
            raise ValueError("Geçersiz model adı")
        num_ctx = int(num_ctx)
        if not 2048 <= num_ctx <= 1_048_576:
            raise ValueError("num_ctx 2K–1M arasında olmalı")
        job = self._new("create", name, source=source, num_ctx=num_ctx)
        body = {"model": name, "from": source, "parameters": {"num_ctx": num_ctx}, "stream": True}
        self._tasks[job["id"]] = asyncio.create_task(self._stream(job, "/api/create", body))
        return dict(job)

    def cancel(self, job_id: str) -> bool:
        t = self._tasks.get(job_id)
        if t and not t.done():
            t.cancel()
            return True
        return False

    async def _stream(self, job: dict[str, Any], path: str, body: dict[str, Any]) -> None:
        url = self.url_getter().rstrip("/") + path
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(None, connect=10), trust_env=False, transport=self.transport) as client:
                async with client.stream("POST", url, json=body) as resp:
                    if resp.status_code != 200:
                        raw = (await resp.aread()).decode("utf-8", "replace")
                        raise RuntimeError(f"Ollama {resp.status_code}: {raw[:200]}")
                    async for line in resp.aiter_lines():
                        if not line.strip():
                            continue
                        try:
                            obj = json.loads(line)
                        except json.JSONDecodeError:
                            continue
                        if obj.get("error"):
                            raise RuntimeError(str(obj["error"]))
                        job["message"] = str(obj.get("status") or "")
                        if obj.get("total"):
                            job["total"], job["completed"] = int(obj["total"]), int(obj.get("completed") or 0)
                            job["progress"] = round(job["completed"] / job["total"], 3) if job["total"] else 0.0
                        self._emit(job)
            job["status"], job["progress"] = "done", 1.0
        except asyncio.CancelledError:
            job["status"], job["error"] = "cancelled", "İptal edildi"
            self._emit(job, force=True)
            raise
        except (httpx.HTTPError, RuntimeError, ValueError) as exc:
            job["status"], job["error"] = "failed", str(exc)[:300]
        finally:
            job["finished"] = time.time()
            self._emit(job, force=True)
            if job["status"] == "done" and self.on_done is not None:
                try:
                    await self.on_done()
                except Exception:  # noqa: BLE001
                    pass
