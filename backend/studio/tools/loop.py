"""Bağlayıcıdan bağımsız araç döngüsü (S27 — hazırlığı).

Her bağlayıcı (Ollama, OpenAI uyumlu, Anthropic API…) kendi sağlayıcı isteğini atar; araç sunma, araç çağrısını
onaydan geçirip MCP köprüsünde çalıştırma, guard taraması ve iz olayları burada ortaktır.

Arayüz
------
- `ApprovalDesk`: bağlayıcı başına tek örnek. Motor (`Engine._tool_approval`) bağlayıcının `respond(run_id,
  request_id, choice)` metodunu çağırır; bağlayıcı bunu `desk.respond(...)`a devreder.
- `ToolLoop.open(settings, inv, desk)` → `ToolLoop | None` (ajana MCP sunucusu atanmamışsa None: araçsız yol).
- `async for e in loop.start: yield e` → araç listesini hazırlar; `meta {invocation.tools}` ve sunucu hatalarını verir.
  Ardından `loop.offered` (sunulan araç var mı), `loop.max_rounds`.
- Şemalar: `loop.openai_tools` (`{"type":"function","function":{name, description, parameters}}` — Ollama da bu
  biçimi kullanır), `loop.anthropic_tools` (`{name, description, input_schema}`).
- `async for e in loop.execute(call_id, fn_name, arguments): yield e` → gerekiyorsa `approval` olayı (karar gelmezse
  RET — kendiliğinden onay yok), sonra `tool` → MCP çağrısı → guard taraması (`guard.flagged`) → `tool_result`.
  Sonuç `loop.results[call_id]` (`ToolCallResult{ok, text, denied, unknown, tool}`) — `text` HER durumda modele
  geri gönderilecek araç sonucu metnidir (ret/bilinmeyen araç dahil; OpenAI her tool_call_id için yanıt ister).
- `loop.round_limit_message` → son tur (araçsız) için kullanıcı iletisi.
- `await loop.close` → adım bitti/iptal: stdio sunucuları öldürülür (bağlayıcı `finally` içinde çağırır).

Sağlayıcı yardımcıları (saf): `parse_arguments`, `OpenAIToolCallAccumulator` (akıştaki `delta.tool_calls` parçaları,
indeks başına birleşir), `openai_assistant_message`, `openai_tool_message`, `AnthropicToolUseAccumulator` (akış
olayları: content_block_start/delta(input_json_delta)/stop), `anthropic_tool_uses` (akışsız yanıt içeriği),
`anthropic_tool_result_message`, `ollama_tool_message`.

Bağlayıcı nasıl bağlanır — OpenAI uyumlu (akışlı chat/completions)
------------------------------------------------------------------
    class OpenAICompatConnector(Connector):
        def __init__(self, settings,...):
            self.desk = ApprovalDesk

        async def respond(self, run_id, request_id, choice): # motorun onay yolu
            return await self.desk.respond(run_id, request_id, choice)

        async def run(self, inv):
            loop = ToolLoop.open(self.settings, inv, self.desk)
            if loop is None:
...araçsız akış...; return
            try:
                async for e in loop.start:
                    yield e
                messages = [{"role": "system",...}, {"role": "user",...}]
                for rnd in range(loop.max_rounds + 1):
                    last = rnd == loop.max_rounds or not loop.offered
                    body = {"model":..., "messages": messages + ([{"role": "user",
                            "content": loop.round_limit_message}] if last and rnd else []), "stream": True}
                    if not last:
                        body["tools"] = loop.openai_tools
                    acc, text = OpenAIToolCallAccumulator, []
                    async for chunk in stream(body): # SSE "data: {...}"
                        delta = chunk["choices"][0].get("delta") or {}
                        if delta.get("content"):
                            text.append(delta["content"]); yield ev("text", text=delta["content"])
                        acc.feed(delta.get("tool_calls"))
                    calls = acc.calls
                    if last or not calls:
                        yield ev("final", text="".join(text)); break
                    messages.append(openai_assistant_message("".join(text), calls))
                    for c in calls:
                        async for e in loop.execute(c["id"], c["name"], c["arguments"]):
                            yield e
                        messages.append(openai_tool_message(c["id"], loop.results[c["id"]].text))
            finally:
                await loop.close

Anthropic Messages API
----------------------
    body["tools"] = loop.anthropic_tools
    # akışlı: acc = AnthropicToolUseAccumulator; her SSE olayı için acc.feed(event) (metin ayrıca işlenir)
    # akışsız: uses = anthropic_tool_uses(resp["content"])
    messages.append({"role": "assistant", "content": resp_content_blocks}) # tool_use blokları aynen geri gider
    results = []
    for u in uses: # {id, name, input}
        async for e in loop.execute(u["id"], u["name"], u["input"]):
            yield e
        r = loop.results[u["id"]]
        results.append((u["id"], r.text, not r.ok))
    messages.append(anthropic_tool_result_message(results)) # role:user + tool_result blokları
"""

from __future__ import annotations

import asyncio
import json
import uuid
from dataclasses import dataclass
from typing import Any, AsyncIterator, Iterable

from studio.connectors.base import CEvent, Invocation, ev, preview

APPROVAL_CHOICES = ["once", "session", "deny"]
APPROVED = ("once", "session", "always")
DESCRIPTION_MAX = 1000
# araç yürütme defteri. Yürütülen her dış araç çağrısının sonucu adımın kalıcı defterine yazılır.
# (lider kararı): defter yan etkiyi korur ama meşru tekrarı dondurmaz.
# - Anahtar çağrı kimliği VE argüman özetidir: aynı kimlik farklı argümanla yeni bir çağrıdır.
# - Aynı denemenin GERÇEK devamında (API araç döngüsü tur sınırından sürer) yalnız kesilen turun bekleyen çağrıları
#   (aynı kimlik + aynı argüman + aynı tur ve sıra) ve her biri en çok bir kez yeniden oynatılır; modelin
#   devamdaki yeni yanıtları yeni çağrıdır (uç nokta kimliği her yanıtta yeniden kullansa da).
# - BAŞTAN yeniden çalıştırmada (kullanıcı yeniden denemesi, revize turu, devamı kaybolan deneme) yalnız YAN ETKİLİ
#   araçların önceki BAŞARILI yürütmeleri ad + argümanla yeniden oynatılır (her önceki yürütme deneme başına bir kez).
# - Salt okunur / idempotent araçlar (MCP `readOnlyHint` / `idempotentHint`, stüdyonun yerleşik araçları ya da
#   kullanıcının araçlar sayfasındaki işareti) her zaman yeniden yürür: yazdıktan sonra okuma, durum yoklama, 503
#   sonrası yeniden deneme doğru kalır. Sınıfı bilinmeyen araç yan etkili sayılır (güvenli varsayılan).
# - Hatayla biten çağrı başarı gibi yeniden oynatılmaz: yeniden yürür. Etkisi belirsiz olan (sonucu kaydedilmeden
#   kesilen) çağrı için motorun "belirsiz etki" kartı sorar.
# - Kapsam: yalnız stüdyonun kendi API araç döngüsü. Claude Code, Codex ve Hermes araçlarını kendileri çalıştırır;
#   baştan çalışan denemede onların araçları yeniden çalışabilir (kartta ve belgede söylenir).
LEDGER_MARK = "önceden çalıştırıldı (tekrar edilmedi)"
# (lider kararı): devretme / orkestratör yeniden denendiğinde ya da yeniden planlandığında önceki denemenin TÜM
# alt ağacındaki başarılı yan etkili yürütmeler TEK havuzda toplanır (araç adı + argüman özeti, adet). Yeni denemenin
# herhangi bir çocuğu eşleşen yan etkili çağrı isterse bir havuz kaydını tüketir ve kayıtlı sonucu alır (yürütülmez);
# her önceki yürütme en çok bir kez tüketilir. Ajan, başlık, noktalama, istem farkı ve eş alt görevler önemsizdir. Salt
# okunur / idempotent çağrılar havuza girmez. Her tekrar kullanım izde (`step.tool_reused`) ve araç sonucunda görünür.
POOL_MARK = "önceki denemeden tekrar kullanıldı"
LEDGER_TEXT_MAX = 8000
# (lider kararı): adımın defteri ASIL başarılı yan etkili yürütmeleri (yeniden oynatma değil, salt okunur /
# idempotent değil) hiçbir zaman budamaz: budanan yürütme yeniden denemede ikinci kez yürürdü. Yalnız yeniden oynatma
# sırasında hiç kullanılmayan kayıtlar budanır: salt okunur / idempotent çağrılar, hatalı çağrılar, "baştan çalıştır" ile
# geçersiz kılınanlar (`void`) ve iki denemeden eski yeniden oynatma kayıtları (`LEDGER_MAX` = bu kayıtların penceresi; asıl
# yürütmeler bu sayıya girmez). Adım başına asıl yan etkili yürütme `LEDGER_EFFECT_MAX`a ulaşırsa o adımın yeni yan etkili
# çağrıları YÜRÜTÜLMEZ: görünür hata olayıyla reddedilir (kayıtsız yürütme ya da sessizce düşen geçmiş yok).
LEDGER_MAX = 400
LEDGER_EFFECT_MAX = 20000
LEDGER_FULL = ("Araç yürütme defteri dolu ({} yan etkili yürütme): bu adımın yeni yan etkili araç çağrıları güvenlik için "
               "çalıştırılmıyor (yeniden denemede ikinci kez yürümesinler diye). Adımı daha küçük işlere böl.")
POOL_FULL_REFUSED = ("Araç yürütme havuzu dolu: önceki denemelerin bütün yürütmeleri izlenemediği için bu alt ağaçtaki yan "
                     "etkili araç çağrıları güvenlik için çalıştırılmıyor (ikinci kez yürümesinler diye).")
# devretme düzeyi havuz sessizce budanmaz. POOL_MAX tam kayıttan sonra kayıtlar sonuç metni olmadan ("ince")
# saklanır (yürütme yine sayılır, tekrar kullanılır); POOL_HARD'dan sonra eklenemez. İkisi de görünür uyarıdır.
POOL_MAX = 5000
POOL_HARD = 50000
POOL_SLIM = "sonuç metni saklanmadı: havuz çok büyük"
TOOL_CLASSES = ("read", "idempotent", "effect")  # kullanıcı ayarı `tools.tool_classes {"sunucu:araç": sınıf}`


def args_hash(args: Any) -> str:
    """Argümanların kararlı özeti (anahtar sırası önemsiz)."""
    import hashlib
    raw = json.dumps(args if args is not None else {}, ensure_ascii=False, sort_keys=True, default=str)
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:16]


def tool_class(settings: Any, name: str, annotations: Any = None) -> str:
    """aracın yan etki sınıfı — `read` (salt okunur), `idempotent` ya da `effect` (yan etkili).
    Sıra: kullanıcının araçlar sayfasındaki işareti → MCP araç açıklamaları (`readOnlyHint`, `idempotentHint`) →
    bilinmiyorsa `effect` (güvenli varsayılan: yeniden yürütülmez, kayıtlı sonuç kullanılır)."""
    try:
        ts = settings.get("tools", None) if settings is not None else None
        user = (ts or {}).get("tool_classes") if isinstance(ts, dict) else None
        cls = user.get(name) if isinstance(user, dict) else None
        if cls in TOOL_CLASSES:
            return str(cls)
    except Exception:  # noqa: BLE001 - ayar okunamazsa açıklamalara bakılır
        pass
    ann = annotations if isinstance(annotations, dict) else {}
    # öncelik kullanıcı işareti > `destructiveHint` > `idempotentHint` / `readOnlyHint` > yan etkili.
    # `destructiveHint: true` her iki beyanı da geçersiz kılar (çelişki güvenli tarafa: yan etkili). Yalan söyleyen bir
    # beyan sunucunun sorumluluğundadır; kullanıcının araçlar sayfasındaki işareti (yukarıda) her zaman önce gelir.
    if ann.get("destructiveHint") is True:
        return "effect"
    if ann.get("readOnlyHint") is True:
        return "read"
    if ann.get("idempotentHint") is True:
        return "idempotent"
    return "effect"


def declared_by_server(annotations: Any) -> bool:
    """sunucu sınıf için bir şey beyan etti mi (`readOnlyHint` / `idempotentHint` / `destructiveHint`)."""
    ann = annotations if isinstance(annotations, dict) else {}
    return any(isinstance(ann.get(k), bool) for k in ("readOnlyHint", "idempotentHint", "destructiveHint"))


def _executed(e: Any) -> bool:
    """Gerçek yürütme kaydı (yeniden oynatma kaydı değil)."""
    return isinstance(e, dict) and not e.get("replay_of")


def ledger_original(e: Any) -> bool:
    """asıl başarılı yan etkili yürütme (havuzdan devralınan dahil): yeniden oynatmanın kanıtı, asla budanmaz."""
    return (isinstance(e, dict) and not e.get("replay_of") and not e.get("void") and bool(e.get("ok"))
            and (e.get("class") or "effect") == "effect")


def ledger_trim(ledger: Any, attempt: int) -> None:
    """defteri yerinde budar; asıl yan etkili yürütmeler ve yeniden oynatma kayıtları korunur (devam ve "bu
    denemede zaten oynatıldı" sayımı bunları okur); kalan kayıtlardan yalnız en yeni `LEDGER_MAX` tutulur.
    yeniden oynatma kaydından yalnız son iki denemeninki DEĞİL, her asıl yürütmenin EN SON yeniden oynatması da
    korunur: `ledger_find(origin=…)` "bu konuşmada (deneme ≥ origin) oynatıldı mı" sorusunu `replay_of` kayıtlarından
    yanıtlar; en son oynatma `origin`'den eskiyse hiçbiri ≥ origin değildir, değilse o kayıt yeter (zincir ne kadar uzarsa
    uzasın origin denemesinin tüketim kaydı budanmaz; kayıt sayısı asıl yürütme sayısıyla sınırlı kalır)."""
    if not isinstance(ledger, list) or len(ledger) <= LEDGER_MAX:
        return
    cur = int(attempt or 0)
    latest: dict[str, int] = {}  # asıl yürütme anahtarı -> en yüksek denemeli yeniden oynatma kaydının sırası
    for i, e in enumerate(ledger):
        if isinstance(e, dict) and e.get("replay_of"):
            k = str(e["replay_of"])
            j = latest.get(k)
            if j is None or int(e.get("attempt") or 0) >= int(ledger[j].get("attempt") or 0):
                latest[k] = i

    def keep(i: int, e: Any) -> bool:
        if ledger_original(e):
            return True
        if not (isinstance(e, dict) and e.get("replay_of")):
            return False
        return int(e.get("attempt") or 0) >= cur - 1 or latest.get(str(e["replay_of"])) == i
    rest = [i for i, e in enumerate(ledger) if not keep(i, e)]
    drop = set(rest[: max(0, len(rest) - LEDGER_MAX)])
    if drop:
        ledger[:] = [e for i, e in enumerate(ledger) if i not in drop]


def ledger_find(ledger: Any, attempt: int, call_id: str | None, name: str, ahash: str, *,
                pending: Any = None, turn: tuple[Any, Any] | None = None,
                origin: int | None = None) -> dict[str, Any] | None:
    """Yan etkili bir çağrının yeniden oynatılacak önceki yürütmesi (yoksa None). Yalnız önceki denemelerin BAŞARILI
    yürütmeleri eşleşir (hatalı çağrı yeniden yürür; aynı denemedeki kayıtlar eşleşmez: kesintisiz denemede modelin aynı
    çağrıyı yinelemesi gerçekten yeni bir çağrıdır).

    - `pending` verilirse (gerçek devam): yalnız kesilen turun bekleyen çağrıları; eşleşme aynı çağrı kimliği VE aynı
      argüman özetiyle (yeniden oynatılmış kayıt da sayılır: devam edilen deneme onu görmüştü). `turn` (tur,
      sıra) verilirse kayıt da AYNI turun AYNI sırasındaki çağrı olmalı: kimliği her yanıtta yeniden kullanan uç nokta
      (`0`, yanıt başına `call_0`) önceki turlardaki aynı argümanlı çağrıyla eşleşmez.
    - Aksi halde (baştan çalışma): aynı ad + argüman özeti; her önceki yürütme bu denemede bir kez oynatılır (bu denemenin
      yeniden oynatma kayıtları tüketilmiş sayılır).
    - `origin` (sürdürülen konuşmanın başladığı deneme) verilirse devamda yuva eşleşmesi olmayan çağrı, o
      denemeden ÖNCEKİ (bırakılmış konuşmaların) başarılı yan etkili yürütmeleriyle ad + argümanla eşleşir; her biri bu
      konuşmada en çok bir kez (konuşmanın `origin` ve sonraki denemelerdeki yeniden oynatmaları tüketilmiş sayılır).
      Konuşmanın kendi yürütmeleri (deneme ≥ origin) bu yolla eşleşmez: aynı konuşmada yinelenen çağrı yenidir."""
    if not isinstance(ledger, list):
        return None
    cur = int(attempt or 0)
    prior = [e for e in ledger if isinstance(e, dict) and int(e.get("attempt") or 0) < cur and e.get("name") == name
             and e.get("ok") and e.get("args_hash") == ahash and not e.get("void")]  # `void` = baştan çalıştır
    if pending is not None:
        if (not call_id or call_id not in pending) and origin is None:
            return None
        rnd, pos = turn if turn is not None else (None, None)

        def same_turn(e: dict[str, Any]) -> bool:
            if rnd is None or e.get("rnd") is None:  # eski kayıt / tur bilgisi vermeyen bağlayıcı: yalnız kimlik
                return True
            return int(e["rnd"]) == int(rnd) and (pos is None or e.get("pos") is None or int(e["pos"]) == int(pos))
        hit = (next((e for e in reversed(prior) if e.get("call_id") == call_id and same_turn(e)), None)
               if call_id and call_id in pending else None)
        if hit is not None or origin is None:
            return hit
        org = int(origin)
        used = {str(e.get("replay_of")) for e in ledger if isinstance(e, dict) and e.get("replay_of")
                and int(e.get("attempt") or 0) >= org}
        return next((e for e in prior if int(e.get("attempt") or 0) < org and _executed(e)
                     and str(e.get("key")) not in used), None)
    used = {str(e.get("replay_of")) for e in ledger if isinstance(e, dict) and e.get("replay_of")
            and int(e.get("attempt") or 0) == cur}
    return next((e for e in prior if _executed(e) and str(e.get("key")) not in used), None)


def subtask_identity(agent: Any, title: Any, instructions: Any) -> str:
    """devretme/orkestratör çocuğunun KİMLİĞİ (adım kimliği ya da sırası değil): atanan ajan + normalleştirilmiş
    alt görev (başlık + talimat; büyük/küçük harf ve boşluk farkı yok sayılır). Yeniden planda sıra değişse ya da araya
    yeni iş girse de aynı alt görev aynı kimliği alır; aynı adım kimliğini yeniden kullanan FARKLI bir alt görev almaz."""
    import hashlib
    import re

    def norm(v: Any) -> str:
        return re.sub(r"\s+", " ", str(v or "")).strip().casefold()
    raw = "|".join((norm(agent), norm(title), norm(instructions)))
    return "subtask:" + hashlib.sha1(raw.encode("utf-8")).hexdigest()[:20]


def pool_entries(ledger: Any, src: str) -> list[dict[str, Any]]:
    """düşen / yeniden planlanan adımın havuza giren kayıtları: yalnız GERÇEK, başarılı, yan etkili yürütmeler
    (kendi yeniden oynatmaları `replay_of`, havuzdan aldıkları `pooled_from` ve daha önce havuza girmiş olanlar hariç:
    aynı yürütme havuzda iki kez sayılmaz). Salt okunur / idempotent çağrılar havuza girmez."""
    if not isinstance(ledger, list):
        return []
    out = []
    for e in ledger:
        if not isinstance(e, dict) or e.get("replay_of") or e.get("pooled_from") or e.get("pooled") or e.get("void"):
            continue
        if not e.get("ok") or (e.get("class") or "effect") != "effect":
            continue
        out.append({"key": f"{src}|{e.get('key')}", "name": e.get("name"), "fn": e.get("fn"),
                    "args_hash": e.get("args_hash"), "ok": True, "text": str(e.get("text") or "")[:LEDGER_TEXT_MAX],
                    "src": src, "claimed_by": None})
    return out


class PoolView:
    """bir adımın gördüğü devretme düzeyi havuzları (en yakın yönetici önce). `take` eşleşen (araç adı + argüman
    özeti), sahiplenilmemiş bir önceki yürütmeyi bu adım adına sahiplenir (en çok bir kez) ve döndürür; yoksa None.
    Havuzlar motorun kalıcı `run.ledger_pool` sözlüğüdür (başvuruyla paylaşılır; aynı olay döngüsünde atomik)."""

    def __init__(self, pools: dict[str, list[dict[str, Any]]], owners: list[str], claimant: str,
                 full: Any = ()):
        self.pools, self.owners, self.claimant = pools, list(owners), str(claimant)
        # önceki denemelerin yürütmelerinin bir kısmı havuza sığmadı (`POOL_HARD`): bu alt ağaçta eşleşmeyen yan
        # etkili çağrı önceki bir yürütmenin tekrarı olabilir → yürütülmez, reddedilir (sessiz çift yürütme yok)
        self.full = bool(set(full or ()) & set(self.owners))

    def take(self, name: str, ahash: str) -> dict[str, Any] | None:
        for owner in self.owners:
            for e in self.pools.get(owner) or []:
                if (isinstance(e, dict) and e.get("name") == name and e.get("args_hash") == ahash and e.get("ok")
                        and not e.get("claimed_by")):
                    e["claimed_by"] = self.claimant
                    return {**e, "owner": owner}
        return None


def stash_entries(ledger: Any) -> list[dict[str, Any]]:
    """düşürülen (yeniden açılan) adımın defteri: yalnız gerçek yürütmeler, deneme 0 olarak (yeniden kurulan aynı
    kimlikli adımın ilk denemesinden önce sayılır)."""
    if not isinstance(ledger, list):
        return []
    ex = [e for e in ledger if _executed(e)]
    rest = [i for i, e in enumerate(ex) if not ledger_original(e)]
    drop = set(rest[: max(0, len(rest) - LEDGER_MAX)])  # asıl yan etkili yürütmeler hiç düşmez
    return [{**e, "attempt": 0} for i, e in enumerate(ex) if i not in drop]


# ---------------------------------------------------------------- onay masası
class ApprovalDesk:
    """Onay kimliği → kullanıcı kararı. Motor kararı `respond` ile yazar; döngü `approval` olayından hemen sonra okur
    (motor, bağlayıcının üretecini kararı `respond`a ilettikten SONRA sürdürür). Karar yoksa ret."""

    def __init__(self) -> None:
        self._decisions: dict[str, str] = {}

    async def respond(self, run_id: str | None, request_id: str | None, choice: str) -> dict[str, Any]:
        if request_id:
            self._decisions[str(request_id)] = str(choice)
        return {"ok": True}

    def take(self, request_id: str, default: str = "deny") -> str:
        return self._decisions.pop(request_id, default)


# ---------------------------------------------------------------- argüman ve ileti yardımcıları (saf)
def parse_arguments(raw: Any) -> dict[str, Any]:
    """Araç argümanları: nesne ya da JSON dizgisi → sözlük (geçersizse boş sözlük)."""
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str) and raw.strip():
        try:
            val = json.loads(raw)
            return val if isinstance(val, dict) else {}
        except json.JSONDecodeError:
            return {}
    return {}


class OpenAIToolCallAccumulator:
    """OpenAI akışında `choices[0].delta.tool_calls` parçalarını indeks başına birleştirir.

    İlk parça genellikle `{index, id, type, function:{name, arguments:""}}`, sonrakiler `{index, function:{arguments:
    "<json parçası>"}}` taşır. Paralel çağrılar farklı indekslerle iç içe gelebilir."""

    def __init__(self) -> None:
        self._calls: dict[int, dict[str, Any]] = {}

    def feed(self, tool_calls: Iterable[dict[str, Any]] | None) -> None:
        for part in tool_calls or []:
            if not isinstance(part, dict):
                continue
            idx = part.get("index")
            idx = int(idx) if isinstance(idx, int) else len(self._calls)
            cur = self._calls.setdefault(idx, {"id": "", "name": "", "arguments": ""})
            if part.get("id"):
                cur["id"] = str(part["id"])
            fn = part.get("function") or {}
            if fn.get("name"):
                # ad bütün gelir; bazı sunucular parçalar — tekrar eden tam adı iki kez eklememek için kontrol
                name = str(fn["name"])
                cur["name"] = name if not cur["name"] or name.startswith(cur["name"]) else cur["name"] + name
            if isinstance(fn.get("arguments"), str):
                cur["arguments"] += fn["arguments"]
            elif isinstance(fn.get("arguments"), dict):  # bazı uyumlu sunucular nesne gönderir
                cur["arguments"] = json.dumps(fn["arguments"], ensure_ascii=False)

    def calls(self) -> list[dict[str, Any]]:
        """Tamamlanmış çağrılar (indeks sırasıyla): `{id, name, arguments: dict, raw_arguments: str}`."""
        out = []
        for idx in sorted(self._calls):
            c = self._calls[idx]
            if not c["name"]:
                continue
            out.append({"id": c["id"] or f"call_{idx}_{uuid.uuid4().hex[:8]}", "name": c["name"],
                        "arguments": parse_arguments(c["arguments"]), "raw_arguments": c["arguments"] or "{}"})
        return out


def openai_assistant_message(content: str | None, calls: list[dict[str, Any]]) -> dict[str, Any]:
    """Araç çağrılarını içeren asistan iletisi (bir sonraki isteğin `messages` listesine eklenir)."""
    return {"role": "assistant", "content": content or None,
            "tool_calls": [{"id": c["id"], "type": "function",
                            "function": {"name": c["name"],
                                         "arguments": c.get("raw_arguments") or json.dumps(c.get("arguments") or {},
                                                                                           ensure_ascii=False)}}
                           for c in calls]}


def openai_tool_message(call_id: str, text: str) -> dict[str, Any]:
    return {"role": "tool", "tool_call_id": call_id, "content": text or "(boş)"}


def ollama_tool_message(fn_name: str, text: str) -> dict[str, Any]:
    return {"role": "tool", "tool_name": fn_name, "content": text or "(boş)"}


def anthropic_tool_uses(content: Iterable[dict[str, Any]] | None) -> list[dict[str, Any]]:
    """Akışsız Messages yanıtının `content` bloklarından `tool_use` çağrıları: `{id, name, input}`."""
    out = []
    for block in content or []:
        if isinstance(block, dict) and block.get("type") == "tool_use" and block.get("name"):
            out.append({"id": str(block.get("id") or f"toolu_{uuid.uuid4().hex[:12]}"), "name": str(block["name"]),
                        "input": parse_arguments(block.get("input"))})
    return out


class AnthropicToolUseAccumulator:
    """Messages akışı: `content_block_start` (tool_use: id, name) + `content_block_delta` (`input_json_delta.partial_json`)
    + `content_block_stop`. Metin blokları bağlayıcıda işlenir; burada yok sayılır."""

    def __init__(self) -> None:
        self._blocks: dict[int, dict[str, Any]] = {}

    def feed(self, event: dict[str, Any]) -> None:
        t = event.get("type")
        idx = event.get("index")
        if not isinstance(idx, int):
            return
        if t == "content_block_start":
            block = event.get("content_block") or {}
            if block.get("type") == "tool_use":
                initial = block.get("input")
                self._blocks[idx] = {"id": str(block.get("id") or ""), "name": str(block.get("name") or ""),
                                     "json": "", "input": initial if isinstance(initial, dict) else {}}
        elif t == "content_block_delta" and idx in self._blocks:
            delta = event.get("delta") or {}
            if delta.get("type") == "input_json_delta":
                self._blocks[idx]["json"] += str(delta.get("partial_json") or "")

    def tool_uses(self) -> list[dict[str, Any]]:
        out = []
        for idx in sorted(self._blocks):
            b = self._blocks[idx]
            if not b["name"]:
                continue
            args = parse_arguments(b["json"]) if b["json"] else b["input"]
            out.append({"id": b["id"] or f"toolu_{idx}_{uuid.uuid4().hex[:8]}", "name": b["name"], "input": args})
        return out

    def content_blocks(self) -> list[dict[str, Any]]:
        """Asistan iletisine geri eklenecek tool_use blokları."""
        return [{"type": "tool_use", "id": u["id"], "name": u["name"], "input": u["input"]} for u in self.tool_uses()]


def anthropic_tool_result_message(results: Iterable[tuple[str, str, bool]]) -> dict[str, Any]:
    """`(tool_use_id, metin, hata_mı)` listesi → tek `role:user` iletisi (`tool_result` blokları)."""
    return {"role": "user", "content": [{"type": "tool_result", "tool_use_id": tid, "content": text or "(boş)",
                                         **({"is_error": True} if is_error else {})}
                                        for tid, text, is_error in results]}


# ---------------------------------------------------------------- döngü
@dataclass
class ToolCallResult:
    call_id: str
    fn_name: str
    tool: str | None = None      # `sunucu:araç` (bilinmeyen araçta None)
    ok: bool = False
    text: str = ""               # modele dönecek araç sonucu metni
    denied: bool = False
    unknown: bool = False
    choice: str | None = None
    artifact: dict[str, Any] | None = None   # büyük çıktı artefakt oldu {id, sha, size, inline_chars}


class ToolLoop:
    """Bir adımın (Invocation) araç döngüsü durumu: oturum, adım boyu onaylar, sonuçlar."""

    def __init__(self, bridge: Any, session: Any, settings: Any, inv: Invocation, desk: ApprovalDesk):
        from studio.tools.texts import lang_of

        self.bridge, self.session, self.settings, self.inv, self.desk = bridge, session, settings, inv, desk
        self.lang = lang_of(settings)
        self.approved_for_step: set[str] = set()
        self.results: dict[str, ToolCallResult] = {}
        self.artifacts: list[dict[str, Any]] = []  # bu adımda saklanan büyük araç çıktıları
        self.skills: dict[str, dict[str, Any]] = {}  # `studio__skill_load` ile yüklenebilir bağlı skill'ler
        self.skills_loaded: list[dict[str, Any]] = []
        # gerçek devamda kesilen turun bekleyen çağrıları — TÜKETİLEN yuvalar {id, ahash, rnd, pos}.
        # None = devam değil (baştan çalışma kuralı); boş liste = devam sürüyor ama bekleyen çağrı kalmadı (her çağrı yeni).
        self.pending: list[dict[str, Any]] | None = None
        self._pending_rnd: int | None = None
        self._turn: tuple[int, int] | None = None
        self._next_turn: tuple[int, int] | None = None
        self._closed = False

    def mark_continuation(self, calls: Iterable[Any], rnd: Any = None) -> None:
        """bağlayıcı konuşmayı tur sınırından sürdürüyor (gerçek devam). Defter yalnız kesilen turun
        bekleyen çağrılarını (aynı kimlik + aynı argüman + aynı sıra) ve her birini EN ÇOK BİR KEZ yeniden oynatır;
        yuva tüketilince ya da devamın ilk yeni yanıtı işlenince (`end_continuation`, daha sonraki tur) her çağrı normal
        yürür — uç nokta kimliği (`0`, `call_0`) her yanıtta yeniden kullansa ve argümanlar tekrar etse bile.
        `calls`: `{id, name, arguments|input}` sözlükleri (sıra = turdaki sıra) ya da yalnız kimlikler (eski biçim)."""
        slots: list[dict[str, Any]] = []
        for pos, c in enumerate(calls):
            if isinstance(c, dict):
                cid = c.get("id")
                args = c.get("arguments") if "arguments" in c else c.get("input")
                ah = args_hash(parse_arguments(args)) if args is not None else None
            else:
                cid, ah = c, None
            if cid:
                slots.append({"id": str(cid), "ahash": ah, "rnd": None if rnd is None else int(rnd), "pos": pos})
        self.pending = slots
        self._pending_rnd = None if rnd is None else int(rnd)

    def set_turn(self, rnd: int, pos: int) -> None:
        """sıradaki `execute` çağrısının (tur, turdaki sıra) bilgisi (bağlayıcılar çağrıdan hemen önce verir)."""
        self._next_turn = (int(rnd), int(pos))

    def end_continuation(self) -> None:
        """kesilen turun bekleyen çağrıları işlendi; bundan sonraki her çağrı yenidir (defterden oynatılmaz)."""
        if self.pending is not None:
            self.pending = []

    def _take_slot(self, call_id: str, ahash: str, turn: tuple[Any, Any] | None) -> dict[str, Any] | None:
        """bu çağrının doldurduğu bekleyen yuva (tüketilir) ya da None. Devamın sonraki bir turu başladıysa
        bekleyen evre biter (bağlayıcı `end_continuation` çağırmasa da)."""
        if not self.pending:
            return None
        rnd, pos = turn if turn is not None else (None, None)
        if rnd is not None and self._pending_rnd is not None and int(rnd) > self._pending_rnd:
            self.pending = []
            return None
        for i, p in enumerate(self.pending):
            if p["id"] != str(call_id) or (p["ahash"] is not None and p["ahash"] != ahash):
                continue
            if pos is not None and p["pos"] is not None and int(pos) != int(p["pos"]):
                continue
            return self.pending.pop(i)
        return None

    @classmethod
    def open(cls, settings: Any, inv: Invocation, desk: ApprovalDesk) -> "ToolLoop | None":
        """Ajanın etkin MCP sunucusu ya da `catalog` kipinde bağlı skill'i varsa döngü (henüz süreç
        başlatmaz); ikisi de yoksa None (araçsız yol)."""
        from studio.tools import builtin_skill as BS
        from studio.tools.bridge import get_bridge

        bridge = get_bridge(settings)
        try:
            skills = BS.loadable(settings, inv.agent)
        except Exception as exc:  # noqa: BLE001 - skill kaydı okunamazsa araç sunulmaz (adım kırılmaz)
            import logging
            logging.getLogger("studio.tools.loop").warning("skill_load hazırlanamadı: %s", exc)
            skills = {}
        if not bridge.policy_for(inv.agent).servers and not BS.offered(skills):
            return None
        loop = cls(bridge, bridge.open_session(inv.agent, run_id=inv.run_id, step_id=inv.step_id), settings, inv, desk)
        loop.skills = skills if BS.offered(skills) else {}
        return loop

    def tt(self, template: str, *args: Any) -> str:
        from studio.tools.texts import tt
        return tt(self.lang, template, *args)

    @property
    def policy(self) -> Any:
        return self.session.policy

    @property
    def max_rounds(self) -> int:
        return self.bridge.max_rounds()

    @property
    def skill_offered(self) -> bool:
        return bool(getattr(self, "skills", None))

    @property
    def offered(self) -> bool:
        return bool(self.session.tools) or self.skill_offered

    async def start(self) -> AsyncIterator[CEvent]:
        """Araç listesini hazırlar (önbellek yoksa sunucuyu başlatıp listeler) ve özet/hata olaylarını verir."""
        try:
            await self.session.prepare()
        except Exception as exc:  # noqa: BLE001 - araç hazırlığı başarısızsa araçsız devam (adım kırılmaz)
            self.session.errors.append(str(exc)[:300])
        yield ev("meta", invocation={"tools": {"servers": list(self.policy.servers), "offered": len(self.session.tools),
                                               "max_rounds": self.max_rounds,
                                               **({"errors": self.session.errors[:5]} if self.session.errors else {})}})
        for msg in self.session.errors[:5]:
            yield ev("error", message=self.tt("MCP sunucusu kullanılamadı: {}", msg))

    # -------- şemalar
    def _sorted_tools(self) -> list[Any]:
        """ (AUDIT C-6): araç tanımları önbellek önekinin başında; sıra sunucu keşif sırasına değil ada bağlı."""
        from studio.tools.bridge import RESERVED_FNS, spec_collides  # yerleşik ada bürünen yok
        return sorted((t for t in self.session.tools if t.fn not in RESERVED_FNS and not spec_collides(t)),
                      key=lambda t: t.fn)

    def _builtin_tools(self) -> list[tuple[str, str, dict[str, Any]]]:
        """`studio__artifact_read` yalnız bu adımda bir artefakt oluştuktan sonra sunulur (önceki turların
        önbellek öneki bozulmaz; artefaktsız adım ek araç tanımı için jeton ödemez)."""
        from studio.tools import builtin_skill as BS
        from studio.tools import outputs as O
        out: list[tuple[str, str, dict[str, Any]]] = []
        if self.skill_offered:  # ajana göre sabit; artefakt okuma aracından önce (önek sırası kararlı)
            out.append((BS.SKILL_FN, BS.DESCRIPTION[BS._lang(self.lang)], BS.schema()))
        if getattr(self, "artifacts", None):
            out.append((O.READ_FN, O.READ_DESCRIPTION[O._lang(self.lang)], O.read_tool_schema()))
        return out

    def openai_tools(self) -> list[dict[str, Any]]:
        out = [{"type": "function", "function": {"name": t.fn, "description": t.description[:DESCRIPTION_MAX] or t.name,
                                                 "parameters": _object_schema(t.schema)}} for t in self._sorted_tools()]
        out += [{"type": "function", "function": {"name": fn, "description": desc, "parameters": _canonical(schema)}}
                for fn, desc, schema in self._builtin_tools()]
        return out

    ollama_tools = openai_tools  # Ollama /api/chat aynı biçimi kullanır

    def anthropic_tools(self) -> list[dict[str, Any]]:
        out = [{"name": t.fn, "description": t.description[:DESCRIPTION_MAX] or t.name,
                "input_schema": _object_schema(t.schema)} for t in self._sorted_tools()]
        out += [{"name": fn, "description": desc, "input_schema": _canonical(schema)}
                for fn, desc, schema in self._builtin_tools()]
        return out

    def round_limit_message(self) -> str:
        return self.tt("Araç turu sınırına ulaşıldı ({}). Artık araç çağırma; elindeki bilgilerle son yanıtı yaz.",
                       self.max_rounds)

    # -------- yürütme
    async def execute(self, call_id: str, fn_name: str, arguments: Any, *,
                      turn: tuple[int, int] | None = None) -> AsyncIterator[CEvent]:
        """Tek araç çağrısı: onay → çağrı → guard → olaylar. Sonuç `self.results[call_id]`. `turn` = (tur,
        turdaki sıra); defter kaydına yazılır ve gerçek devamda bekleyen çağrının kimliğini tamamlar."""
        from studio.guard.injection import guard_tool_output

        from studio.tools import builtin_skill as BS
        from studio.tools import outputs as O

        args = parse_arguments(arguments)
        res = ToolCallResult(call_id=call_id, fn_name=fn_name)
        self.results[call_id] = res
        if fn_name == O.READ_FN and getattr(self, "artifacts", None):
            # yerleşik salt okunur dilim okuma (onay gerekmez; yalnız bu koşunun artefaktları)
            res.tool = O.READ_TOOL
            yield ev("tool", name=O.READ_TOOL, input=preview(json.dumps(args, ensure_ascii=False)))
            res.ok, res.text = O.read_for_model(self.settings, self.inv.run_id, args, self.lang)
            yield ev("tool_result", name=O.READ_TOOL, ok=res.ok, output=preview(res.text))
            return
        if fn_name == BS.SKILL_FN and self.skill_offered:
            async for e in self._skill_load(res, args):
                yield e
            return
        from studio.tools.bridge import RESERVED_FNS
        # yerleşik ad (sunulmadığı adımda bile) hiçbir dış araca çözülmez (derinlemesine savunma)
        spec = None if fn_name in RESERVED_FNS else self.session.resolve(fn_name)
        if spec is None:
            res.unknown, res.text = True, self.tt("Bilinmeyen ya da izin verilmeyen araç: {}", fn_name)
            return
        res.tool = spec.name
        args_text = json.dumps(args, ensure_ascii=False)
        ahash = args_hash(args)
        cls = tool_class(self.settings, spec.name, getattr(spec, "annotations", None))
        attempt = int(getattr(self.inv, "attempt", 0) or 0)
        if turn is None:
            turn, self._next_turn = getattr(self, "_next_turn", None), None
        self._turn = turn
        # gerçek devamda bekleyen yuva bu çağrıyla tüketilir (sınıfı ne olursa olsun; en çok bir kez). Devamda
        # yuvası olmayan çağrı yenidir: defterden oynatılmaz.
        pend: set[str] | None = None
        if self.pending is not None:
            pend = {str(call_id)} if self._take_slot(call_id, ahash, turn) is not None else set()
        # salt okunur / idempotent araç her zaman yeniden yürür; yan etkili (ya da bilinmeyen) araç defterden
        prior = (ledger_find(getattr(self.inv, "tool_ledger", None), attempt, call_id, spec.name, ahash,
                             pending=pend, turn=turn, origin=getattr(self.inv, "ledger_origin", None))
                 if cls == "effect" else None)
        if prior is not None:
            # bu yan etkili çağrı önceki bir denemede yürütüldü → yeniden yürütülmez (onay da sorulmaz);
            # model kayıtlı sonucu işaretle alır. İz için `tool`/`tool_result` olayları `replayed` bayrağıyla verilir.
            res.ok, res.text = bool(prior.get("ok")), f"[{self.tt(LEDGER_MARK)}] {prior.get('text') or ''}"
            rec = self._ledger_record(call_id, spec.name, fn_name, ahash, res.ok, prior.get("text") or "",
                                      replay_of=str(prior.get("key") or ""), cls=cls)
            yield ev("tool", name=spec.name, input=preview(args_text), replayed=True)
            yield ev("tool_result", name=spec.name, ok=res.ok, output=preview(res.text), replayed=True,
                     **({"ledger": True} if rec is not None else {}))
            return
        pool = getattr(self.inv, "tool_pool", None)
        pooled = pool.take(spec.name, ahash) if cls == "effect" and pool is not None else None
        if pooled is not None:
            # aynı yöneticinin önceki denemesinde (alt ağacın herhangi bir yerinde) yürütülmüş yan etkili çağrı:
            # yeniden yürütülmez; kayıtlı sonuç "önceki denemeden tekrar kullanıldı" işaretiyle döner. Kayıt bu adımın
            # defterine yürütme gibi yazılır (`pooled_from`): adımın kendi yeniden denemesi onu yine oynatır.
            body = f"({self.tt(POOL_SLIM)})" if pooled.get("slim") else (pooled.get("text") or "")
            res.ok, res.text = True, f"[{self.tt(POOL_MARK)}] {body}"
            rec = self._ledger_record(call_id, spec.name, fn_name, ahash, True, pooled.get("text") or "",
                                      cls=cls, pooled_from=str(pooled.get("key") or ""), owner=pooled.get("owner"))
            yield ev("tool", name=spec.name, input=preview(args_text), replayed=True, reused=True,
                     owner=pooled.get("owner"))
            yield ev("tool_result", name=spec.name, ok=True, output=preview(res.text), replayed=True, reused=True,
                     **({"ledger": True} if rec is not None else {}))
            return
        refuse = None
        if cls == "effect" and pool is not None and getattr(pool, "full", False):
            refuse = ("pool_full", self.tt(POOL_FULL_REFUSED))
        elif cls == "effect" and self._effect_count() >= LEDGER_EFFECT_MAX:
            refuse = ("ledger_full", self.tt(LEDGER_FULL, LEDGER_EFFECT_MAX))
        if refuse is not None:
            # sınırda yan etkili çağrı yürütülmez (kayıtsız yürütme yok); model ve kullanıcı hatayı görür
            res.ok, res.text = False, refuse[1]
            yield ev("tool", name=spec.name, input=preview(args_text))
            yield ev("tool_result", name=spec.name, ok=False, output=preview(res.text), refused=refuse[0])
            yield ev("warning", code=refuse[0], message=refuse[1], tool=spec.name)
            return
        if self.policy.needs_approval(spec.name) and spec.name not in self.approved_for_step:
            rid = f"mcp_{uuid.uuid4().hex[:12]}"
            yield ev("approval", run_id=self.inv.run_id, request_id=rid, tool=spec.name, command=args_text[:4000],
                     description=self.tt("MCP aracı {} çağrılmak isteniyor", spec.name)
                     + (f" — {spec.description[:300]}" if spec.description else ""),
                     choices=list(APPROVAL_CHOICES), allow_session=True, allow_permanent=False)
            choice = self.desk.take(rid)  # karar yoksa reddet (kendiliğinden onay yok)
            res.choice = choice
            if choice == "session":
                self.approved_for_step.add(spec.name)
            if choice not in APPROVED:
                res.denied, res.text = True, self.tt("Kullanıcı bu araç çağrısını reddetti: {}", spec.name)
                return
        yield ev("tool", name=spec.name, input=preview(args_text))
        ok, text = await self.session.call(spec, args)
        entry = self._ledger_record(call_id, spec.name, fn_name, ahash, ok, text, cls=cls)
        text, flagged = guard_tool_output(text, self.settings, self.lang)
        if flagged:
            self.bridge.publish("guard.flagged", run_id=self.inv.run_id, step=self.inv.step_id, section="tool_output",
                                patterns=flagged, tool=spec.name,
                                mode=str(self.settings.get("guard.injection", "warn")))
        # büyük çıktı sessizce kesilmez; maskelenmiş tam metin artefakt olur, modele kesit + referans gider
        text, art = O.offload(self.settings, text, run_id=self.inv.run_id, step_id=self.inv.step_id, tool=spec.name,
                              lang=self.lang)
        res.ok, res.text = ok, text
        if entry is not None:  # model ne gördüyse yeniden oynatmada o döner (guard/artefakt sonrası metin)
            entry["text"] = str(text or "")[:LEDGER_TEXT_MAX]
        extra: dict[str, Any] = {}
        if art is not None:
            res.artifact = {k: art[k] for k in ("id", "sha", "size", "inline_chars")}
            self.__dict__.setdefault("artifacts", []).append(res.artifact)
            extra["artifact"] = {**res.artifact, "ref": O.ref(art["id"])}
        yield ev("tool_result", name=spec.name, ok=ok, output=preview(text), **extra,
                 **({"ledger": True} if entry is not None else {}))

    def _ledger_record(self, call_id: str, name: str, fn_name: str, ahash: str, ok: bool,
                       text: Any, *, replay_of: str | None = None, cls: str = "effect",
                       pooled_from: str | None = None, owner: Any = None) -> dict[str, Any] | None:
        """yürütülen çağrı hemen deftere (motor `tool_result`ta kontrol noktası alır → kalıcı). yeniden
        oynatma da (`replay_of`) kaydedilir: devam onu bulur, baştan çalışma aynı yürütmeyi iki kez oynatmaz."""
        led = getattr(self.inv, "tool_ledger", None)
        if not isinstance(led, list):
            return None
        attempt = int(getattr(self.inv, "attempt", 0) or 0)
        n = sum(1 for e in led if isinstance(e, dict) and e.get("attempt") == attempt and e.get("call_id") == call_id)
        turn = self._turn  # (tur, sıra) — gerçek devamda bekleyen çağrının tam kimliği
        entry = {"key": f"{attempt}:{call_id}:{ahash}" + (f"#{n}" if n else ""), "attempt": attempt, "call_id": call_id,
                 "name": name, "fn": fn_name, "args_hash": ahash, "ok": bool(ok), "class": cls,
                 "text": str(text or "")[:LEDGER_TEXT_MAX], **({"replay_of": replay_of} if replay_of else {}),
                 **({"pooled_from": pooled_from, "owner": str(owner or "")} if pooled_from else {}),
                 **({"rnd": int(turn[0]), "pos": int(turn[1])} if turn is not None and turn[0] is not None else {})}
        n0 = self._effect_count()  # önce say (yeni kayıt hariç)
        led.append(entry)
        if ledger_original(entry):
            self._effects_n = n0 + 1
        # asıl yan etkili yürütmeler budanmaz; budama yalnız yeniden oynatmada kullanılmayan kayıtları atar
        # (amorti: pencere bir kez daha dolunca)
        if len(led) > LEDGER_MAX and len(led) >= int(getattr(self, "_trim_at", 0) or 0):
            ledger_trim(led, attempt)
            self._trim_at = len(led) + LEDGER_MAX
        return entry

    def _effect_count(self) -> int:
        """bu adımın defterindeki asıl başarılı yan etkili yürütme sayısı (ilk kullanımda sayılır)."""
        n = getattr(self, "_effects_n", None)
        if n is None:
            led = getattr(self.inv, "tool_ledger", None)
            n = sum(1 for e in led if ledger_original(e)) if isinstance(led, list) else 0
            self._effects_n = n
        return int(n)

    async def _skill_load(self, res: ToolCallResult, args: dict[str, Any]) -> AsyncIterator[CEvent]:
        """bağlı, sabitlenmiş skill gövdesi (onaysız, salt okunur). Büyük gövde artefakt yoluna gider;
        başarılı yükleme `meta.invocation.skills_loaded` ile motora bildirilir (USED_SKILL how=tool)."""
        from studio.tools import builtin_skill as BS
        from studio.tools import outputs as O

        res.tool = BS.SKILL_TOOL
        yield ev("tool", name=BS.SKILL_TOOL, input=preview(json.dumps(args, ensure_ascii=False)))
        # yüklenebilir küme HER çağrıda yeniden hesaplanır (ucuz): adım sırasında kullanıcının verdiği
        # "never" ya da atamayı kaldırma bir sonraki çağrıda geçerlidir
        try:
            current = await asyncio.to_thread(BS.current_loadable, self.settings, self.inv.agent)
        except Exception:  # noqa: BLE001 - kayıt okunamazsa hiçbir skill yüklenmez
            current = {}
        # sunulan araç listesi (önbellek öneki) adım boyunca sabit kalır; yükleme yalnız güncel kümeden yapılır
        ok, text, use = await asyncio.to_thread(BS.load_for_model, current, args, self.lang)
        extra: dict[str, Any] = {}
        if ok:
            text, art = O.offload(self.settings, text, run_id=self.inv.run_id, step_id=self.inv.step_id,
                                  tool=BS.SKILL_TOOL, lang=self.lang)
            if art is not None:
                res.artifact = {k: art[k] for k in ("id", "sha", "size", "inline_chars")}
                self.__dict__.setdefault("artifacts", []).append(res.artifact)
                extra["artifact"] = {**res.artifact, "ref": O.ref(art["id"])}
        res.ok, res.text = ok, text
        yield ev("tool_result", name=BS.SKILL_TOOL, ok=ok, output=preview(text), **extra)
        if use is not None:
            loaded = self.__dict__.setdefault("skills_loaded", [])
            if not any(u["key"] == use["key"] for u in loaded):
                loaded.append(use)
            yield ev("meta", invocation={"skills_loaded": [dict(u) for u in loaded]})

    async def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        await self.session.close()


def _canonical(value: Any) -> Any:
    """Sözlük anahtarları sıralı kopya (JSON `sort_keys` eşdeğeri; listelerin sırası korunur) — önek belirlenimi."""
    if isinstance(value, dict):
        return {k: _canonical(value[k]) for k in sorted(value, key=str)}
    if isinstance(value, list):
        return [_canonical(v) for v in value]
    return value


def _object_schema(schema: Any) -> dict[str, Any]:
    """Sağlayıcılar (özellikle Anthropic) üst düzeyde `type: object` ister. Anahtarlar sıralı."""
    if not isinstance(schema, dict):
        return {"properties": {}, "type": "object"}
    if schema.get("type") != "object":
        return _canonical({**schema, "type": "object", "properties": schema.get("properties") or {}})
    return _canonical(schema)
