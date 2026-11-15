"""Süreç içi olay veri yolu. Motor ve bağlayıcılar yayınlar; SSE uç noktası abonelere akıtır.

publish yalnızca olay döngüsü iş parçacığından çağrılmalıdır (kalıcılık sırası ve SSE replay geçişi buna dayanır).

Ölçek (S15, 300 ajan):
- `agent.state` olayları ajan başına en çok `state_rate_hz`/sn yayınlanır; aradakiler birleştirilir, son durum
  kazanır (ertelenen olay en geç bir aralık sonra tek başına çıkar). Diğer olay türleri birleştirilmez.
- Her abonelik sınırlı bir kuyruktur (`maxsize`): taşmada önce kuyruktaki en eski ATILABİLİR olay (durum, akış
  parçası) düşer; atılamaz olaylar sert tavana (`hard_cap` = 2×maxsize) kadar tutulur. Yavaş bir SSE istemcisi
  yalnızca kendi kuyruğunu doldurur; yayıncıyı ve diğer istemcileri bloklamaz. Bağlantı başına bellek `hard_cap`
  olayla sınırlıdır.
- Kuyruk yarıdan fazla doluysa aynı ajanın kuyrukta bekleyen eski `agent.state` olayı yenisiyle değiştirilir.

Kayıpsız kritik olaylar:
- Olay sınıfları: ATILABİLİR (`DROPPABLE`: anlık durum/akış), KRİTİK (`is_critical`: koşu/adım yaşam döngüsü,
  onaylar, kararlar, bütçe, hedef, orkestratör, Faz 6 mesaj/zamanlama/kabul/eval/guard olayları) ve diğerleri (ayar/ofis/oyun
  bildirimleri: atılmaz ama kalıcı da değildir). Sınıflandırma YALNIZCA bu modüldedir.
- Her olay tekil, monoton bir `seq` alır. Kritik olay, abonelere konmadan ÖNCE kalıcı günlüğe (`eventlog.EventLog`)
  yazılır ve "kalıcı" (`Event.durable`) işaretlenir; SSE çerçevesi yalnızca kalıcı olaylarda `id: <seq>` taşır, bu
  yüzden istemcinin imleci (Last-Event-ID) yalnızca kalıcı olaylarda ilerler.
- Sert tavanda atılamaz bir olay kuyruktan çıkarılırsa bu SESSİZ değildir: abonelik "boşluklu" (`gapped`) işaretlenir.
  SSE akışı (`sse_stream`) boşluğu günlükten imleçten sonrasını yeniden göndererek kapatır; kaybolan olay kalıcı
  değilse ya da yeniden gönderim `replay_limit`'i aşarsa açık `resync_required` olayı + yeni `hello` gönderir.
- `seq` teslim anında artar; yeniden başlatmada günlükteki son seq'ten devam eder.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from collections import deque
from typing import Any, AsyncIterator, Awaitable, Callable

from studio.eventlog import EventLog

logger = logging.getLogger("studio.events")

# Sınıflandırma kümeleri tek kayıttan gelir (Faz B-1: studio/event_types.py); burada yalnız yeniden dışa verilir.
from studio import event_types as _event_types  # noqa: E402
from studio.event_types import CRITICAL_PREFIXES, CRITICAL_TYPES, DROPPABLE  # noqa: E402,F401

DEFAULT_MAXSIZE = 2000
DEFAULT_STATE_RATE_HZ = 4.0
DEFAULT_REPLAY_LIMIT = 2000
JSON_CACHE = 4096  # encode() önbelleğindeki en çok olay
REPLAY_PAGE = 256  # yeniden gönderimde tek okumada/yazımda en çok olay
PING_S = 15.0
SSE_BATCH = 64

_critical_cache: dict[str, bool] = {}


def is_critical(type_: str | None) -> bool:
    """Kalıcı günlüğe yazılan, imleçle yeniden gönderilen olay türü mü? (Tek sınıflandırma noktası.)"""
    if not type_:
        return False
    hit = _critical_cache.get(type_)
    if hit is None:
        hit = type_ not in DROPPABLE and (type_ in CRITICAL_TYPES or type_.startswith(CRITICAL_PREFIXES))
        if len(_critical_cache) < 4096:
            _critical_cache[type_] = hit
    return hit


def is_droppable(type_: str | None) -> bool:
    return type_ in DROPPABLE


class Event(dict):
    """Olay sözlüğü + JSON'a girmeyen `durable` işareti (kalıcı günlüğe yazıldı mı)."""

    __slots__ = ("durable",)


class Subscription:
    """Tek tüketicili, sınırlı olay kuyruğu; asyncio.Queue'nun kullanılan alt kümesiyle uyumlu
    (get, get_nowait, put_nowait, empty, qsize, full, maxsize)."""

    __slots__ = ("_items", "maxsize", "hard_cap", "_coalesce_from", "_waiter", "dropped", "coalesced", "lost",
                 "gapped", "gap_nondurable")

    def __init__(self, maxsize: int = DEFAULT_MAXSIZE):
        self._items: deque[dict[str, Any]] = deque()
        self.maxsize = max(16, int(maxsize))
        self.hard_cap = self.maxsize * 2
        self._coalesce_from = self.maxsize // 2
        self._waiter: asyncio.Future[None] | None = None
        self.dropped = 0      # taşmada atılan olay sayısı (atılabilir + sert tavanda çıkarılan)
        self.coalesced = 0    # kuyrukta yenisiyle değiştirilen durum olayı sayısı
        self.lost = 0         # sert tavanda çıkarılan atılamaz olay sayısı (boşluk oluşturur)
        self.gapped = False   # atılamaz bir olay kuyruktan çıkarıldı: tüketici günlükten telafi etmeli
        self.gap_nondurable = False  # çıkarılanlardan biri kalıcı değildi: telafi = resync_required

    def put_nowait(self, event: dict[str, Any]) -> None:
        items = self._items
        type_ = event.get("type")
        if len(items) >= self.maxsize:
            for i, old in enumerate(items):
                if old.get("type") in DROPPABLE:
                    del items[i]
                    self.dropped += 1
                    break
            else:
                if type_ in DROPPABLE:
                    self.dropped += 1
                    return
                if len(items) >= self.hard_cap:  # yalnızca atılamaz olaylarla dolu: en eskisi çıkar, boşluk işaretlenir
                    old = items.popleft()
                    self.dropped += 1
                    self.lost += 1
                    self.gapped = True
                    if not getattr(old, "durable", False):
                        self.gap_nondurable = True
        elif type_ == "agent.state" and len(items) >= self._coalesce_from:
            agent = event.get("agent")
            for i, old in enumerate(items):
                if old.get("type") == "agent.state" and old.get("agent") == agent:
                    del items[i]
                    self.coalesced += 1
                    break
        items.append(event)
        waiter = self._waiter
        if waiter is not None and not waiter.done():
            waiter.set_result(None)

    async def get(self) -> dict[str, Any]:
        while not self._items:
            if self._waiter is None or self._waiter.done():
                self._waiter = asyncio.get_running_loop().create_future()
            try:
                await self._waiter
            finally:
                if self._waiter is not None and self._waiter.done():
                    self._waiter = None
        return self._items.popleft()

    def get_nowait(self) -> dict[str, Any]:
        if not self._items:
            raise asyncio.QueueEmpty
        return self._items.popleft()

    def empty(self) -> bool:
        return not self._items

    def qsize(self) -> int:
        return len(self._items)

    def full(self) -> bool:
        return len(self._items) >= self.maxsize

    def clear(self) -> int:
        """Kuyruğu boşaltır ve boşluk işaretini siler (resync sonrası). Atılan olay sayısını döner."""
        n = len(self._items)
        self._items.clear()
        self.gapped = self.gap_nondurable = False
        return n


class RateCounter:
    """Dakika kovalı yayın sayacı (son 24 saat; Sistem sağlığı). Yalnız olay döngüsünden çağrılır."""

    __slots__ = ("_buckets", "_clock")

    def __init__(self, clock: Callable[[], float] = time.time) -> None:
        self._buckets: deque[list[int]] = deque()  # [dakika, sayı], eskiden yeniye
        self._clock = clock

    def tick(self) -> None:
        minute = int(self._clock() // 60)
        b = self._buckets
        if b and b[-1][0] == minute:
            b[-1][1] += 1
            return
        b.append([minute, 1])
        while b and b[0][0] <= minute - 1440:
            b.popleft()

    def count(self, seconds: float) -> int:
        lo = int(self._clock() // 60) - int(seconds // 60)
        return sum(n for m, n in self._buckets if m > lo)


class EventBus:
    def __init__(self, *, maxsize: int = DEFAULT_MAXSIZE, state_rate_hz: float = DEFAULT_STATE_RATE_HZ,
                 log: EventLog | None = None) -> None:
        self._subs: set[Subscription] = set()
        self.log = log
        # yeniden başlatmada günlükteki son seq'ten devam: eski imleçler geçerli kalır, seq tekrar kullanılmaz
        self._seq = log.high_water if log is not None else 0
        self.maxsize = max(16, int(maxsize))
        self._interval = (1.0 / float(state_rate_hz)) if state_rate_hz and state_rate_hz > 0 else 0.0
        self._last_state: dict[str, float] = {}          # ajan → son yayın (monotonic)
        self._pending_state: dict[str, dict[str, Any]] = {}  # ajan → ertelenen son durum olayı
        self._flush_handles: dict[str, asyncio.TimerHandle] = {}
        self._json: dict[int, str] = {}  # seq → SSE JSON (encode)
        self.coalesced = 0  # birleştirilen (yerine yenisi geçen) durum olayı sayısı
        self.persist_errors = 0  # günlüğe yazılamayan kritik olay sayısı (olay yine teslim edilir, kalıcı değildir)
        self.replayed = 0   # SSE'de günlükten yeniden gönderilen olay sayısı
        self.resyncs = 0    # gönderilen resync_required sayısı
        self.rate = RateCounter()  # Faz B-1: son 1 sa / 24 sa yayın hızı

    def subscribe(self, maxsize: int | None = None) -> Subscription:
        sub = Subscription(self.maxsize if maxsize is None else maxsize)
        self._subs.add(sub)
        return sub

    def unsubscribe(self, q: Subscription) -> None:
        self._subs.discard(q)

    @property
    def seq(self) -> int:
        """Son verilen sıra numarası (kritik olsun olmasın)."""
        return self._seq

    @property
    def durable_seq(self) -> int:
        """Son kalıcı kritik olayın seq'i: istemci imleçleri yalnızca bu değerlerden oluşur."""
        return self.log.last_seq if self.log is not None else 0

    def publish(self, type_: str, **data: Any) -> dict[str, Any]:
        event = Event({"seq": 0, "type": type_, "ts": time.time(), **data})
        agent = data.get("agent")
        if type_ == "agent.state" and self._interval and isinstance(agent, str) and agent:
            now = time.monotonic()
            last = self._last_state.get(agent, 0.0)
            if agent not in self._pending_state and now - last >= self._interval:
                self._last_state[agent] = now
                self._deliver(event)
                return event
            try:
                loop = asyncio.get_running_loop()
            except RuntimeError:  # olay döngüsü yok (eşzamanlı test/betik): hemen yayınla
                self._last_state[agent] = now
                self._deliver(event)
                return event
            if agent in self._pending_state:
                self.coalesced += 1
            self._pending_state[agent] = event  # son durum kazanır
            if agent not in self._flush_handles:
                delay = max(0.0, self._interval - (now - last))
                self._flush_handles[agent] = loop.call_later(delay, self._flush_state, agent)
            return event
        self._deliver(event)
        return event

    def _flush_state(self, agent: str) -> None:
        self._flush_handles.pop(agent, None)
        event = self._pending_state.pop(agent, None)
        if event is None:
            return
        self._last_state[agent] = time.monotonic()
        self._deliver(event)

    def flush(self) -> None:
        """Ertelenen tüm durum olaylarını hemen yayınlar (kapanış ve testler için)."""
        for agent in list(self._pending_state):
            handle = self._flush_handles.pop(agent, None)
            if handle is not None:
                handle.cancel()
            self._flush_state(agent)

    def _deliver(self, event: dict[str, Any]) -> None:
        self._seq += 1
        seq = event["seq"] = self._seq
        _event_types.note(event.get("type"))  # Faz B-1: kayıtsız tür Sistem sağlığında görünür
        self.rate.tick()
        log = self.log
        if log is not None and is_critical(event.get("type")):
            try:
                raw = log.append(event)  # teslimden ÖNCE kalıcı (bkz. eventlog modül belgesi)
            except Exception:  # noqa: BLE001 - disk/kilit hatası olay yolunu durdurmaz; olay kalıcı olmadan gider
                self.persist_errors += 1
                if self.persist_errors <= 3 or self.persist_errors % 1000 == 0:
                    logger.exception("kritik olay günlüğe yazılamadı (seq=%s, type=%s)", seq, event.get("type"))
            else:
                if isinstance(event, Event):
                    event.durable = True
                self._cache_json(seq, raw)  # tam JSON: SSE yeniden serileştirmez
        for q in list(self._subs):
            q.put_nowait(event)

    def _cache_json(self, seq: int, raw: str) -> None:
        self._json[seq] = raw
        while len(self._json) > JSON_CACHE:
            self._json.pop(next(iter(self._json)))

    def encode(self, event: dict[str, Any]) -> str:
        """SSE için JSON: aynı olay birden çok istemciye gidince bir kez serileştirilir (olay döngüsü CPU'su).
        Önbellek sıra numarasıyla anahtarlı ve sınırlıdır."""
        seq = event.get("seq")
        if not isinstance(seq, int) or seq <= 0:
            return json.dumps(event, ensure_ascii=False, default=str)
        cached = self._json.get(seq)
        if cached is None:
            cached = json.dumps(event, ensure_ascii=False, default=str)
            self._cache_json(seq, cached)
        return cached

    def frame(self, event: dict[str, Any]) -> str:
        """Tek SSE çerçevesi; kalıcı olaylarda `id: <seq>` (istemci imleci yalnızca bunlarda ilerler)."""
        body = self.encode(event)
        if getattr(event, "durable", False):
            return f"id: {event['seq']}\ndata: {body}\n\n"
        return f"data: {body}\n\n"

    def close(self) -> None:
        """Günlüğü kapatır; son seq tavanını yazar (yeniden başlatmada seq'ler tekrar kullanılmaz)."""
        if self.log is not None:
            self.log.close(high_water=self._seq)

    def stats(self) -> dict[str, Any]:
        return {"seq": self._seq, "durable_seq": self.durable_seq, "subscribers": len(self._subs),
                "persist_errors": self.persist_errors, "replayed": self.replayed, "resyncs": self.resyncs,
                "dropped": sum(s.dropped for s in self._subs), "lost": sum(s.lost for s in self._subs),
                "gapped": sum(1 for s in self._subs if s.gapped)}

    @property
    def subscribers(self) -> int:
        return len(self._subs)

    @property
    def pending_states(self) -> int:
        return len(self._pending_state)


# ---------------------------------------------------------------------- SSE akışı
def parse_cursor(raw: str | int | None) -> tuple[bool, int | None]:
    """(imleç verildi mi, değer). Verildi ama geçersizse değer None (→ resync_required)."""
    if raw is None:
        return False, None
    if isinstance(raw, int):
        return True, raw if raw >= 0 else None
    text = str(raw).strip()
    if not text:
        return False, None
    try:
        value = int(text)
    except ValueError:
        return True, None
    return True, value if value >= 0 else None


def _data_frame(payload: dict[str, Any], event_id: int | None = None) -> str:
    body = json.dumps(payload, ensure_ascii=False, default=str)
    return f"id: {event_id}\ndata: {body}\n\n" if event_id is not None else f"data: {body}\n\n"


async def sse_stream(bus: EventBus, *, cursor: str | int | None = None,
                     hello: Callable[[], dict[str, Any]] | None = None,
                     is_disconnected: Callable[[], Awaitable[bool]] | None = None,
                     replay_limit: int = DEFAULT_REPLAY_LIMIT, ping_s: float = PING_S,
                     batch: int = SSE_BATCH) -> AsyncIterator[str]:
    """`/api/events` akışı: hello (+ imleçten sonrası replay ya da resync_required) → canlı olaylar.

    Geçişte boşluk/çift yok: önce abone olunur (aynı eşzamanlı blokta son kalıcı seq okunur), sonra günlük okunur,
    kuyruktan gelen kalıcı olaylar gönderilen son seq'e göre ayıklanır. Kalıcı bir olay yayıncıda abonelere
    konmadan önce commit edildiğinden, abonelikten önce yayınlanan her kritik olay günlük okumasında görünür;
    sonrakiler kuyruktadır.
    """
    q = bus.subscribe()  # ÖNCE abone ol (bu noktayla aşağıdaki seq okuması arasında await yok)
    log = bus.log
    replay_limit = max(1, int(replay_limit))
    given, value = parse_cursor(cursor)
    sent = bus.durable_seq  # bu istemciye teslim edilmiş sayılan son kalıcı seq (kuyruk ayıklaması)

    def make_hello(event_id: int | None = None) -> str:
        payload = hello() if hello is not None else {"type": "hello", "ts": time.time()}
        payload = {**payload, "latest": bus.durable_seq}
        return _data_frame(payload, event_id)

    def resync(reason: str, from_seq: int | None) -> str:
        """Açık telafi: kuyruk boşaltılır, imleç en son kalıcı seq'e taşınır, ardından yeni hello."""
        nonlocal sent
        q.clear()
        latest = bus.durable_seq
        sent = latest
        bus.resyncs += 1
        oldest = log.oldest_seq() if log is not None else 0
        payload = {"type": "resync_required", "seq": 0, "ts": time.time(), "reason": reason, "from": from_seq,
                   "oldest": oldest, "latest": latest, "persistent": bool(log is not None and log.persistent)}
        return _data_frame(payload, latest if log is not None else None) + make_hello()

    async def replay_from(start: int) -> tuple[list[str], str | None]:
        """start'tan sonraki kalıcı olaylar (sayfa sayfa) ya da sınır aşıldıysa resync nedeni."""
        nonlocal sent
        if log is None:
            return [], "no_log"
        if start < log.pruned_through:
            return [], "cursor_expired"
        if start > log.last_seq:
            return [], "cursor_ahead"
        if await asyncio.to_thread(log.count_after, start, replay_limit + 1) > replay_limit:
            return [], "replay_limit"
        chunks: list[str] = []
        pos, total = start, 0
        while True:
            rows = await asyncio.to_thread(log.read_after, pos, REPLAY_PAGE, strict=True)
            if rows is None:  # okuma sürerken budama okunmamış satırlara ulaştı: sessiz atlama yok
                return [], "cursor_expired"
            if rows:
                chunks.append("".join(f"id: {s}\ndata: {d}\n\n" for s, d in rows))
                pos = rows[-1][0]
                total += len(rows)
            if len(rows) < REPLAY_PAGE or total > replay_limit * 2:
                break
        sent = max(sent, pos)
        bus.replayed += total
        return chunks, None

    try:
        if not given:
            # ilk bağlantı: hello'nun id'si istemcinin başlangıç imleci olur (kopmada bu noktadan replay)
            yield make_hello(sent if log is not None else None)
        elif value is None:
            yield resync("cursor_invalid", None)
        else:
            chunks, reason = await replay_from(value)
            if reason is not None:
                yield resync(reason, value)
            else:
                yield make_hello()
                for chunk in chunks:
                    yield chunk
        carry: list[dict[str, Any]] = []
        while True:
            if not q.gapped and not carry and q.empty():
                if is_disconnected is not None and await is_disconnected():
                    break
                try:
                    carry.append(await asyncio.wait_for(q.get(), timeout=ping_s))
                except asyncio.TimeoutError:
                    yield ": ping\n\n"
                    continue
            if q.gapped:
                # yavaş istemci: atılamaz olay kuyruktan çıktı → günlükten telafi ya da açık resync
                nondurable = q.gap_nondurable
                q.gapped = q.gap_nondurable = False
                if nondurable:
                    carry = []
                    yield resync("overflow", sent)
                    continue
                chunks, reason = await replay_from(sent)
                if reason is not None:
                    carry = []
                    yield resync("overflow" if reason == "replay_limit" else reason, sent)
                    continue
                for chunk in chunks:
                    yield chunk
                continue  # yeni boşluk oluştuysa önce o kapatılır; elde kalanlar ayıklanarak sonra gider
            frames: list[str] = []
            items, carry = carry, []
            while len(items) < batch and not q.empty():
                items.append(q.get_nowait())
            for ev in items:
                if getattr(ev, "durable", False):
                    s = ev["seq"]
                    if s <= sent:
                        continue  # replay'de zaten gönderildi
                    sent = s
                frames.append(bus.frame(ev))
            if frames:
                yield "".join(frames)
    finally:
        bus.unsubscribe(q)
