"""Unutma planı (AW-R17, R34; AW-T06; Rehber 1 §7.4).

Normal eskime, `invalid`/`superseded` ve arşiv bir bilgiyi grafta TUTAR (geçmiş korunur). Kullanıcı "unut" dediğinde ise
bütün türevleri kapsayan ayrı bir süreç işler. Değişiklik servisi deseni (`studio.changes`) izlenir:

    plan (yazmaz; önizleme) → açık onay → yedek → uygula → mezar kaydı → (pencere içinde) geri al

Hedefler (`scope`):
- `fact`: bilgi + aynı ad alanındaki terfi kopyaları (R-1 `DERIVED_FROM` / `promoted_to` / `promoted_from` bileşeni).
  Başka ad alanındaki aynı önerme ayrı bir kayıttır, dokunulmaz.
- `episode`: anı + yalnız bu anıdan (ve birlikte silinenlerden) kanıtlanan bilgiler (+ terfi kopyaları) + artık hiçbir
  şeye bağlı olmayan kavramlar. Başka anıyla da kanıtlanmış bilgi kalır.
- `project`: `project:<k>` ad alanındaki bütün anı ve bilgiler, ad alanına anahtarlı kavramlar; ortak kavramların ad alanı
  listesinden bu proje çıkarılır. Global bellek bütün hâlinde unutulamaz.

Önizleme şunları sayar ve örnekler: silinecek düğümler, onlara dokunan kenarlar, FTS satırları, içeriği alıntılayan
kontrol noktaları (`Run.checkpoint`), etkilenen koşuların olay yükleri (`run_events` ve kalıcı `events.db`), türetilmiş
özetler (teslim `Deliverable.summary/excerpt`, anı özetleri), diğer türev düğümler (adım çıktısı/istemi, görev metni,
gelen kutusu), booster defteri ve ölçüm defteri satırları, içeriği bağlamında taşıyan canlı koşular.

Uygula:
- Türev metinlerde unutulan içerik `MARK` ile karartılır; teslim özeti karartılmış metinden yeniden üretilir, geriye
  yalnız işaret kalırsa kaldırılıp işaretlenir (`deliverables.service.regenerate_summary`, `forgotten_at`).
- Booster defteri satırları içeriksizdir (yalnız sayılar): korunur, önizlemede "korunur" diye listelenir (§7.4
  "içeriksiz işlem kayıtları korunabilir"). Ölçüm defterinde girdiden türeyen `input_sig` özeti silinir.
- Canlı koşu: bellekteki adım çıktıları, istemler, girdiler karartılır (sonraki adımlar içeriği almaz), koşuya
  `memory.forgotten` notu düşer, kontrol noktası yeniden yazılır. Koşu bitince kanca onu bir kez daha süpürür.
- Mezar kaydı (`<veri>/forget/tombstones.json`, `studio.db` DIŞINDA) içerik taşımaz: yalnız anahtar ve cümle
  özetleri (sha256), etkilenen koşu kimlikleri, ad alanı ve zaman. Yeniden uygulanır:
  - açılışta (`reapply`): `studio.db` ya da `events.db` yedekten geri yüklendiyse içlerinde mezar işareti yoktur → süpürme,
  - yazma kapısında (`GraphStore.write_guard`): unutma anından ÖNCE oluşmuş (ya da o koşulardan gelen) bir bilgi/anının
    içe aktarılan/geri yüklenen kopyası `ForgottenError` ile reddedilir; bu koşulardan gelen anı özeti karartılır.
  Unutma anından sonra başka bir koşudan yeniden öğrenilen bilgi yeni bir kayıttır (yeniden unutulabilir).
- Geri al: `UNDO_WINDOW_S` içinde, yedekten. Uygulamadan sonra değişmiş türev kayıtlar ezilmez (atlanır ve sayılır);
  başka etkin bir mezar kaydının kapsadığı düğüm geri getirilmez. Pencere dolunca yedek silinir: unutma kalıcı olur.

Sınırlar (açıkça): çalışma klasöründeki kullanıcı dosyaları değiştirilmez; daha önce dışa aktarılmış/teslim edilmiş bir
kopyanın geri alınabildiği iddia edilmez. Yazma işlemleri yalnız kullanıcıdan (`USER_ONLY_RE`, MCP 403).

jeton kipi (cümle eşlemesinin üstünde):
- Plan, unutulan bilgilerden "ayırt edici jetonlar" çıkarır (`extract_tokens`): harf+rakam kodlar/kimlikler, ≥ 6 haneli
  sayılar, yüksek entropili dizgiler, e-posta/kullanıcı adları (varsayılan SEÇİLİ) ve yaygın kelime listesinde olmayan
  özel adlar (varsayılan seçili DEĞİL; aşırı silmeyi önlemek için kullanıcı işaretler). Kullanıcı jetonların işaretini
  kaldırabilir ve kendi terimlerini ekleyebilir; seçim plana bağlıdır (seçim değişince plan yeniden hesaplanır).
- Uygulamada her seçili jeton, kanonik normalleştirmeden sonra tek başına bir iğne olarak unutma ad alanının BÜTÜN
  kayıtlarında karartılır (etkilenen koşular + ad alanındaki diğer koşular, anılar, olaylar, araç çıktıları); jetonu
  taşıyan bilgiler (aynı ad alanı) silinir. Mezar kaydı jetonların tuzlu özetlerini taşır (kayıt başına rastgele tuz):
  geri al, yeniden uygula, koşu sonu kancası ve yazma kapısı jetonları da yakalar.
- Normalleştirme: NFKC uyumluluk biçimleri (daire/parantez içi, üst simge, tam genişlik, bitişik harfler, bölgesel
  gösterge ve tuş başlığı), quoted-printable, yüzde/varlık/JSON/YAML kaçışlarının sabit noktaya kadar (en çok
  `DECODE_ROUNDS` tur) çözülmesi, Latin Genişletilmiş ve küçük büyük harflerin ayrıştırma tabanlı katlanması (NFKD +
  birleşik işaret atma + Unicode adı "LATIN … LETTER X WITH …" → x) ve benzer harf tablosu.
- Süren koşular: plan kapsamdaki süren koşuları listeler; uç (`POST …/apply`) süren koşu varken 409 ile reddeder,
  kullanıcı "bu koşuları durdur ve unut" (`stop_runs: true`) seçebilir. Yazma kapısı, unutulmuş bir cümleyi ya da
  jetonu İÇEREN (yalnız tam özet eşleşmesi değil) bilgi/kavram/iddia yazımını da reddeder.
- Türetilmiş adlar: değeri unutulan içerik taşıyan `name`/`slug` alanları (teslim adı, mesaj artefakt adları, kontrol
  noktası, `message.sent`) nötr ve deterministik bir ada (`unutuldu-<özet>.<uzantı>`) çevrilir; başvurular tutarlı kalır.
- Kabul edilen sınır: KENDİ İÇİNDEN bölünmüş bir jeton (iki ayrı kayıtta ya da ardışık olmayan parçalarda
  "QA10NDL7F" ‖ "3BD2E9C1") yakalanmaz; yalnız aynı adımın ardışık parça olaylarında birleşik pencere jetonu bulur.
- Kabul edilen sınır: düşük entropili jetonlar (ör. 6 haneli sayı) veri dizinine erişebilen biri tarafından mezar
  kaydındaki tuzlu özetten kaba kuvvetle bulunabilir (tuz kaydın yanında saklanır).


- Jeton eşleme ayraçtan bağımsızdır (`canon_stream`, `Matcher._canon_hit`): harf/rakam dizileri arasındaki boşluk/NBSP
  ve diğer Zs, tire ailesi, nokta, eğik çizgi, alt çizgi (≤ 3 karakter, satır sonu değil) yok sayılır ve karartma
  ayraçları da kapsar ("RX52L M8VQ3", "AB-12-CD", "4111 1111 1111 1111" ↔ "4111111111111111"). Eşleşme jeton sınırında
  başlar ve biter. Yeni mezar kayıtları kanonik özetleri ve uzunlukları (`clens`, `v: 2`) taşır; eski kayıtlarda tek
  jetonlu özet kanonik birleşimle de eşlenir.
- Çıkarıcı gruplanmış biçimleri önerir (kart, telefon, IBAN, plaka, "AB 12 CD", anahtar sözcüklü 4–5 haneli PIN).
  Varsayılan seçim temkinlidir (`extract_tokens`). Yazıyla yazılmış sayılar ve kelime parolalar TAHMİN EDİLMEZ:
  kullanıcı terimi olarak eklenir (en az `MIN_USER_TERM` karakter; `SHORT_TERM` altı uyarılı ve etki sayılı).
- Kabul edilen sınırlar (yerel öncelikli): (1) mezar kaydındaki tuzlu özetler, veri dizinini okuyabilen biri için düşük
  entropili jetonlarda kaba kuvvete açıktır (4–6 haneli PIN/sayı saniyeler, 5–6 karakterli kod dakikalar–saatler; tuz
  kaydın yanındadır). Zincir (shingle) özetleri beri kayıt başına rastgele tuzludur (`shingle_salt`; eski
  kayıtlar sabit tuzla okunur), bu yalnız kayıtlar arası/önceden hesaplanmış tablo saldırısını önler. (2) Geri alma
  yedeğinin anahtarı (`<veri>/forget/.key`) yedeklerin yanındadır: pencere (24 saat) boyunca veri dizinini okuyabilen
  biri unutulan içeriği okuyabilir. Bir IBAN'ın yalnız son grupları gibi kısmi parçalar eşlenmez.


- Etki kapılı varsayılan seçim (`_select_tokens`, `token_impact`): bir aday yalnız (1) mevcut kurallarla yüksek güvenli
  sır VE (2) unutulan kayıtların dışında etkisi SIFIR ise önceden işaretlenir. İçeride: jeton genişlemesinden önceki
  hedef bileşeni (`Scope.base`), hedefin KAYNAK koşularının (`Scope.source_runs`) ürettiği bilgi/teslim/mesajlar
  (aynı koşunun aynı sırrı başka biçimde yazdığı kopyalar) ve hedef cümleyi zaten taşıyan teslim/mesajlar; dışarıda:
  başka koşulardan ya da kullanıcıdan gelen her bilgi, teslim ve mesaj. Dışarıya dokunan jeton işaretsiz gelir (`held`), önizleme "Bu terim başka N kaydı da etkiler" uyarısını ve
  bağlam parçalarını gösterir; kullanıcı bilerek işaretleyebilir. Anahtar sözcüklü ≤ 5 haneli saf sayı, yıl/tarih ve
  telefon biçimli değer yalnız öneridir. Bağlam parçasında başka bir aday jeton bütünüyle `IMPACT_MASK` olur.
- Ayraç Unicode sınıfıyla tanımlanır (`_sep_gap`): Z*, P*, S*, sekme ve en çok bir satır sonu; en çok `SEP_MAX` (4)
  karakter. Boş satır ayraç değildir. Çok jetonlu terim de jetonları arasında ayraç ister. Yazma kapısı aynı eşleyiciyi
  kullanır. Kabul edilen sınırlar: kısmi kod (ilk/son grup, eksik karakter), 4 karakterden uzun ayraç, boş satır,
  başka sözcüğe/sayıya bitişik yazım, kendi içinden iki kayda bölünmüş kod.
- Başlatma kapısı `resume`/`retry_step` yollarını da kapsar; `memory.isolation` kapalıyken bütün ad alanlarını kapatır.


- İçeride kapsamlı karartma (`Scope.scoped`): işaretsiz (tutulan, öneri ya da kullanıcının kaldırdığı) terim, özel ad
  önerileri dışında, "içeride" yine de karartılır — hedef bilgiler ve hedefin KAYNAK koşularının bilgi, teslim, adım,
  mesaj, olay, anı ve araç çıktıları (bilgi silinmez, yalnız terim karartılır). Dışarıdaki kayıtlara terim
  işaretlenmedikçe dokunulmaz. Kullanıcı terimi `unscoped` ile içeride de dokunulmaz yapabilir. Mezar kaydı bu
  terimleri ayrı (`scoped` + `scoped_runs`) taşır: yazma kapısı, yeniden uygulama ve koşu sonu kancası yalnız o
  koşulara uygular.
- Okunur kalanlar (`remains`): önizleme, uygulama yanıtı ve sonuç metni (`remains_text`, TR/EN) terimi hâlâ taşıyan
  kayıtları (kullanıcı bilgisi, başka koşunun bilgisi, teslim, mesaj, anı) sayar ve listeler; yanıtta etiket yoktur,
  günlük içeriksizdir. Başka ad alanlarındaki kopyalar yalnız SAYI olarak (`other_copies`).
- Eşleme (`LOOSE_MIN` = 6): daha kısa terim yalnız TAM yazımıyla eşleşir (`term_exact`, `_gap_key`); ayraç cümle
  sınırını (`.`/`!`/`?`/`…` + boşluk) aşamaz. Uzun terimin ayraçla birleşik (tam yazım dışı) geçişi bilgiyi silmez,
  karartır (`patch_facts`; mezar kaydında `pkeys`) ve önizlemede ayrı başlıkta listelenir (`separator_matches`).
  Bilgiden geriye `RESIDUAL_MIN` sözcükten azı kalıyorsa kopya sayılır ve silinir.
- Kaynak koşu = bilgiyi ÜRETEN koşu; kullanıcının yazdığı (ya da koşudan önce var olan) bilgi, bir koşu onu aynen
  tekrarlasa da dışarıdadır (`_user_origin`, `_creating_runs`).
- Anahtar sözcüklü PIN/telefon/yıl (`gate4`) dışarıda hiç geçmiyorsa önceden seçilir; kısa sayılar (`kwonly`) içeride
  yalnız anahtar sözcükten sonra eşlenir ("PIN 4417" evet, "4417 adet" hayır) ve korunanlar sonuçta söylenir.


- Dürüst sonuç: uygulama yanıtındaki `remains` ve sonuç metni PLANDAN değil, uygulamadan SONRAKİ
  doğrulama taramasından (`_Verifier`, `verify_remains`) gelir. Tarama depoları okur: bu ad alanının bilgi, anı ve
  kavramları (bağlı ya da ad alanından çıkarılmış paylaşılan kavramlar), koşu düğümleri (adım, teslim, mesaj, koşu
  kaydı ve kontrol noktası, diğer), `run_events`, `events.db`, SSE önbelleği, araç çıktısı artefaktları ve arama
  dizini (FTS); hepsi `REMAIN_KEYS` olarak sayılır ("kavram adı", "adım", "koşu olayı" …). "Okunur kopya kalmadı"
  (`CLEAN_TR`/`CLEAN_EN`) yalnız tarama hiçbir şey bulmadıysa (anahtar sözcüksüz sayı geçişi dahil) söylenir; tarama
  tamamlanamazsa `verified: false` ve "doğrulanamadı / couldn't be verified" yazılır, temiz denmez. Terim ve içerik
  günlüğe, olaya ya da geçmişe yazılmaz (yalnız sayılar); yanıt etiket taşımaz.
- Kavramlar: kavramın adı anahtardır ve ASLA değiştirilmez/karartılmaz. Yalnız bu ad alanının kayıtlarına
  bağlı (ya da bu ad alanına anahtarlı) kavram silinir; başka ad alanından da kullanılan kavram kalır, `namespaces`
  listesinden bu ad alanı çıkar, bu ad alanındaki kayıtlarla kenarları (`unlink_edges`) yedeklenip kaldırılır ve sonuçta
  "kavram adı" olarak listelenir. Mezar kaydı (`ckeys`) yeniden uygulamada aynı çıkarmayı yapar; geri alma kenarları ve
  ad alanını geri getirir.
- Kullanıcı kökeni: bir bilgi yalnız kullanıcıya ait bilgi uçlarının sunucu tarafında yazdığı işaretle
  (`created_by.origin == "user"`, eski kayıtlarda `origin == "user_stated"`) "kullanıcının yazdığı" sayılır
  (`_user_origin`). Ajan kısa adı/yazar adı (`agent`, `created_by.agent`) asla köken sayılmaz; MCP bu işareti yazamaz
  (bilgi uçları MCP'ye 403). `user`/`kullanici`/`system`/`studio` (ve benzer yazımlar) ajan kısa adı olarak ayrılmıştır.
- Ayraçlı eşleşmede sonuç: önizlemedeki her ayraçlı kayıt uygulamanın kendi kararını taşır (`outcome`:
  "redact" = yalnız aralık karartılır, "delete" = karartmadan sonra `RESIDUAL_MIN` sözcükten az kalır, kayıt silinir;
  `fact_outcome`).
- Tutarlar: sayısal terim binlik ayraçlı tutar/miktar biçimiyle ("900.000 TL", "583,104 adet") varsayılan
  olarak EŞLEŞMEZ; önizleme bu geçişleri `amount_matches` olarak listeler, kullanıcı terim başına açıkça izin verirse
  (`amounts`) karartılır. Mezar kaydı izni (`amt`) taşır; öncesi kayıtlar eski kuralla okunur.


- Önizleme = uygulama: plan yanıtındaki `remains` aynı doğrulama taramasının (`_Verifier`) KURU
  çalıştırmasıdır: uygulamanın yazacağı durum (`_Overlay`: silinecek düğümler, yamalar, koşu olayı / olay günlüğü / araç
  çıktısı yeni metinleri, SSE önbelleğinden düşecek satırlar) depoların üstüne bindirilir. Tutulan, işaretsiz ve
  `unscoped` terimler, kavram adları, adımlar ve olaylar için önizleme sayıları uygulamanın bıraktığına eşittir; kayıtlar
  yalnız bu (kullanıcıya ait) yanıtta maskeli etiket taşır. Kuru çalıştırma tamamlanamazsa `remains_predicted: false`.
- Köken: yalnız geçerlilik tarihlerini değiştiren düzenleme (aynı metinle supersede/correct) kökeni
  değiştirmez; koşunun ürettiği bilgi "kullanıcının yazdığı" olmaz. ayrılmış adlar görünen ada da (oluşturma ve
  yeniden adlandırma) uygulanır; `sistem` ve `stüdyo`/`studyo` da ayrılmıştır.
- Birlikte geçme kenarları: ad alanından çıkarılan paylaşılan kavramın başka kavramlarla `RELATED_TO`
  kenarları, başka bir ad alanında iki kavramı birlikte anan bir kayıt yoksa (birlikte geçme yalnız bu alandan
  gelmişse) yedeklenip kaldırılır (`_cooccur_edges`); geri alma geri getirir, yeniden uygulama yeniden kaldırır.
"""

from __future__ import annotations

import base64
import contextlib
from functools import lru_cache
import bisect
import hashlib
import hmac
import html as _html
import io
import json
import logging
import os
import re
import sqlite3
import threading
import time
import unicodedata
import uuid
import zipfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable, Iterator
from urllib.parse import quote, unquote

from studio.changes import PLAN_TTL_S
from studio.graph import namespace as nsm
from studio.graph.namespace import NamespaceError
from studio.graph.store import IN_CHUNK, GraphStore, now_iso
from studio.ontology import normalize_key

log = logging.getLogger("studio.forget")

SCOPES = ("fact", "episode", "project")
RUN_FINAL = frozenset({"done", "failed", "cancelled"})
MARK = "[unutuldu]"
CLIP_MIN_TOKENS = 4          # kırpılmış özet uçlarında en az bu kadar jetonluk parça eşleşmeli
JSON_SCAN_MAX = 4 * 1024 * 1024  # JSON görünümlü metin bu boyuta kadar çözülüp ayrıca taranır
CHUNK_WINDOW = 8             # aynı adımın ardışık parça olaylarında birleşik pencere (en çok bu kadar parça)
WAL_RETRY_S = (0.05, 0.15, 0.4)   # uygulama içinde kısa geri çekilmeli yeniden deneme (her biri ≤ 0,5 sn bekler)
WAL_IDLE_RETRY_S = (2.0, 10.0, 30.0, 120.0, 600.0, 1800.0)  # sonra arka planda (boşta); en son açılışta
MIN_NEEDLE = 12            # bundan kısa metin (normalize) aranmaz: "Tamam." gibi parçalar her yerde karartılmasın
UNDO_WINDOW_S = 24 * 3600    # geri alma penceresi; dolunca yedek silinir
SAMPLES = 5
SUBDIR = "forget"
SCRUB_TYPES = ("Run", "Step", "Task", "Deliverable", "Delivery", "Message", "Acceptance", "QualityReport", "Lesson",
               "SystemCall", "Episode", "Fact", "Concept")
# kimlik niteliğindeki alanlar karartılmaz (anahtar/ilişki bozulmasın)
KEEP_KEYS = frozenset({"id", "run_id", "step_id", "hash", "key", "slug", "agent", "workflow", "project", "namespace",
                       "namespaces", "origin", "goal", "status", "kind", "type", "parent_run", "forked_from", "source",
                       "visibility", "lifecycle", "trust", "epistemic_status", "promoted_to", "promoted_from",
                       "created_at", "updated_at", "recorded_from", "recorded_to", "path", "name", "model",
                       "connector", "connection", "to_agent", "from_agent", "message_id", "approval_id"})
# `run_id` özelliğiyle koşuya bağlı türev türleri (kenarı olmasa da bulunur)
RUN_SCOPED = ("Message", "Deliverable", "Delivery", "Episode", "Step", "QualityReport", "Acceptance", "SystemCall",
              "Lesson")
VAULT_SCAN_MAX = 16 * 1024 * 1024  # kasa blob'u bu boyuta kadar taranır (üstü "taranamadı")
VAULT_TEXT_EXT = (".xml", ".rels", ".txt", ".html", ".htm", ".md", ".json", ".csv", ".js", ".css", ".svg", ".rtf", ".yaml",
                  ".yml")
STAMPED = ("Deliverable", "Episode")  # ontolojide `forgotten_at` alanı olan türler

ERR_SCOPE = "Unutma kapsamı fact, episode ya da project olmalı"
ERR_TARGET = "Unutulacak kayıt yok: {}"
ERR_TYPE = "Bu kayıt {} değil; unutma kapsamı uyuşmuyor"
ERR_GLOBAL = "Genel bellek bütün hâlinde unutulamaz; bir proje seç ya da tek tek unut"
ERR_CONFIRM = "Uygulamak için açık onay (confirm: true) gerekli"
ERR_UNDO_CONFIRM = "Geri almak için açık onay (confirm: true) gerekli"
ERR_PLAN = "Plan bulunamadı veya süresi doldu; önizlemeyi yenile"
ERR_DRIFT = "Bellek önizlemeden sonra değişti; önizlemeyi yenile"
ERR_EMPTY = "Unutulacak bir şey bulunamadı"
ERR_NO_CHANGE = "Unutma kaydı yok"
ERR_UNDONE = "Bu unutma zaten geri alındı"
ERR_EXPIRED = "Geri alma süresi doldu; yedek silindi, unutma kalıcı"
ERR_USER_ONLY = "Unutma işlemini yalnız kullanıcı yapabilir"
ERR_FORGOTTEN = "Bu kayıt kullanıcı tarafından unutuldu; geri yüklenmez"
ERR_BACKUP = "Geri alma yedeği doğrulanamadı (değiştirilmiş ya da bozuk); geri alma yapılmadı"
ERR_ACTIVE = "Unutma kapsamında süren koşular var; önce onları durdur (ya da 'durdur ve unut' seç)"
ERR_STILL_ACTIVE = "Koşular durdurulamadı; biraz sonra yeniden dene"
RESTORE_TYPES = frozenset({"Fact", "Episode", "Concept"})  # yedekten yalnız bu türler geri gelir
DECODE_ROUNDS = 8            # iç içe kodlama (yüzde/varlık/JSON/YAML/QP) en çok bu kadar tur çözülür
MIN_TERM = 4                 # çıkarılan jeton (katlanmış) en az bu kadar karakter
MIN_USER_TERM = 2            # kullanıcı terimi en az bu kadar karakter (kısa terim reddedilmez, uyarılır)
SHORT_TERM = 4               # bundan kısa terim/jeton önizlemede aşırı silme uyarısı taşır
MAX_TOKENS = 30              # plan başına en çok bu kadar jeton (çıkarılan + eklenen)
TOKEN_TAG = "forget-tok/v1"
# kimlik alanlarından yalnız bunlar (ad/slug) unutulan içerik taşırsa nötr bir ada çevrilir
RENAME_KEYS = frozenset({"name", "slug"})

NOTE = {"tr": "Bu koşunun bağlamındaki bazı bellek içeriği kullanıcı tarafından unutuldu; sonraki adımlar onu almaz.",
        "en": "Some memory content in this run's context was forgotten by the user; later steps won't receive it."}


class ForgetError(ValueError):
    pass


class ForgetDenied(PermissionError):
    pass


class ForgottenError(ValueError):
    """Yazma kapısı: unutulmuş kaydın geri yüklenen/içe aktarılan kopyası."""


class ForgetBusy(ForgetError):
    """kapsamda süren koşu var (uç 409 döner; `runs` = koşu kimlikleri)."""

    def __init__(self, msg: str, runs: list[str]):
        super().__init__(msg)
        self.runs = runs


# ------------------------------------------------------------------ metin eşleme
# bilgi cümlesi `clean_markdown` ile saklanır, ham çıktı ise `**…**`, liste, başlık, kod işaretleri taşır. Eşleme
# biçimden bağımsızdır: iki taraf AYNI biçimde jetonlara ayrılır (yalnız harf/rakam dizileri; NFKD + birleşik işaretler
# atılır + casefold + Türkçe ı/İ → i). Markdown işaretleri, noktalama, satır sonları, bağlantı hedefleri, çıplak URL'ler ve
# çitli kod blokları jeton üretmez; bu yüzden "**gizli** erişim\n- kodu" ile "gizli erişim kodu" aynı jeton dizisidir.
# Karartma özgün metinde ilk jetonun başından son jetonun sonuna kadardır (+ bitişik vurgu işaretleri).
_SPLIT_RE = re.compile(r"((?<=[.!?…])\s+|\n+)")
_LEAD_RE = re.compile(r"^\s*(?:[-*+>#]+|\d+[.)])\s*")
_TOKEN_RE = re.compile(r"(?:[^\W_]|[̀-ͯ])+")
_NL_RE = re.compile(r"\n")
_IGNORE_RE = re.compile(r"```.*?```|\]\([^)\s]*\)|https?://\S+", re.S)
_WRAP = "*_~`"


def norm(text: str) -> str:
    """Eski ( ilk sürüm) cümle normu; var olan mezar kayıtlarıyla uyum için korunur."""
    return normalize_key(_LEAD_RE.sub("", str(text or "")))


# ortak jeton hattı (iğne ve samanlık AYNI yoldan geçer) markdown dışındaki biçimleri de normalleştirir:
# - JSON kaçışları (`\n`, `\t`, `\"`, `\uXXXX`, vekil çiftler) çözülür: araç girdisi/çıktısındaki kaçışlı metin,
# - HTML karakter varlıkları (`&uuml;`, `&#351;`, `&nbsp;`) çözülür; etiketler atılır (satır içi etiket hiçbir şey, blok
#   etiketi boşluk olur; `<strong>` jeton üretmez),
# - tireli satır sonu birleşir ("eri-\nşim" → "erişim"; yumuşak tire ile de),
# - görünmez biçim karakterleri (sıfır genişlikli boşluk/birleştirici, BOM, yumuşak tire, yön işaretleri, varyant
#   seçiciler) atılır,
# - jeton katlamada (`fold`) yaygın Kiril/Yunan benzer harfler Latin karşılığına çevrilir (Unicode confusables alt kümesi,
#   yerleşik tablo); tam genişlikli Latin NFKD ile zaten katlanır.
# Normalleştirilmiş metindeki her karakter özgün metindeki bir aralığa eşlenir: karartma ÖZGÜN aralığa uygulanır.
# Yeni bağımlılık yok (`html` standart kütüphane). Bilinen ödünleşim: Yunan Η/η, Ν/ν, Υ/υ büyük-küçük harfte farklı
# Latin harfe gider (büyük harf görünüşü ≠ küçük harf görünüşü); yalnız bu üç harfte büyük/küçük harf duyarlılığı oluşur.
# görünmez karakterler sabit bir listeyle değil kuralla atılır: Unicode genel kategorisi `Cf` (biçim: sıfır
# genişlikli boşluk/birleştirici, BOM, yumuşak tire, yön işaretleri, satır arası açıklama U+FFF9–FFFB, etiket karakterleri
# U+E0000–E007F …) + varyant seçiciler (U+FE00–FE0F, U+E0100–E01EF; kategori Mn) + görünür glifi olmayan dolgu/uzatma
# harfleri (Arapça tatvil U+0640, NKo U+07FA, Hangul dolguları, Moğol serbest varyant seçicileri, CGJ). Tablo açılışta
# Python'un Unicode veritabanından bir kez kurulur (yeni bağımlılık yok).
_FILLER_CPS = (0x034F, 0x0640, 0x07FA, 0x115F, 0x1160, 0x17B4, 0x17B5, 0x180B, 0x180C, 0x180D, 0x180F, 0x3164, 0xFFA0)


def _ranges(cps: Iterable[int]) -> list[tuple[int, int]]:
    out: list[tuple[int, int]] = []
    for c in sorted(cps):
        if out and c == out[-1][1] + 1:
            out[-1] = (out[-1][0], c)
        else:
            out.append((c, c))
    return out


def _class(ranges: list[tuple[int, int]]) -> str:
    return "[" + "".join(re.escape(chr(a)) if a == b else f"{re.escape(chr(a))}-{re.escape(chr(b))}"
                         for a, b in ranges) + "]"


def _scan_categories() -> tuple[set[int], set[int], set[int], set[int]]:
    """Tek tarama: (görünmez/çevreleyen işaretler, simge/emoji, ayraçlar). çevreleyen işaretler (Me:
    tuş başlığı U+20E3, daire U+20DD …) atılır; simge kategorileri (So, Sk) yalnız jeton kipinde harf/rakam arasında
    yapıştırılır. boşluk (Zs: boşluk, NBSP, ince boşluk …) ve tire ailesi (Pd) jeton kipinde ayraçtır."""
    drop: set[int] = set()
    glue: set[int] = set()
    sep: set[int] = set()
    zps: set[int] = set()  # Z*, P*, S* (jeton ayracı sınıfı, `_sep_gap`)
    for c in range(0x110000):
        if 0xD800 <= c <= 0xDFFF:
            continue
        cat = unicodedata.category(chr(c))
        if cat[0] in "ZPS":
            zps.add(c)
        if cat in ("Cf", "Me"):
            drop.add(c)
        elif cat in ("So", "Sk"):
            glue.add(c)
        elif cat in ("Zs", "Pd"):
            sep.add(c)
    return drop, glue, sep, zps


_CAT_DROP, _CAT_GLUE, _CAT_SEP, _CAT_ZPS = _scan_categories()


def _drop_ranges() -> list[tuple[int, int]]:
    cps = set(_CAT_DROP)
    cps |= {*range(0xFE00, 0xFE10), *range(0xE0100, 0xE01F0), *range(0xE0000, 0xE0080), 0xFFF9, 0xFFFA, 0xFFFB,
            *_FILLER_CPS}
    return _ranges(cps)


_DROP_RANGES = _drop_ranges()
_INVIS_CLASS = _class(_DROP_RANGES)

# harf/rakam OLMAYAN uyumluluk biçimleri (daire/parantez içi, kare, negatif kare/daire harf ve rakamlar,
# bölgesel gösterge harfleri, dingbat rakamlar) → düz harf/rakam. Önce NFKC (parantez, nokta atılır), NFKC yoksa Unicode
# adındaki "LATIN … LETTER X" / "DIGIT|NUMBER N" okunur. Harf/rakam olan biçimler (tam genişlik, matematik, üst simge,
# bitişik harf) zaten jetondur ve `fold` (NFKD) onları katlar.
_NUM_WORDS = {w: str(i) for i, w in enumerate(
    "ZERO ONE TWO THREE FOUR FIVE SIX SEVEN EIGHT NINE TEN ELEVEN TWELVE THIRTEEN FOURTEEN FIFTEEN SIXTEEN "
    "SEVENTEEN EIGHTEEN NINETEEN TWENTY".split())}
_ENCLOSED_BLOCKS = ((0x2460, 0x24FF), (0x2776, 0x2793), (0x3248, 0x32BF), (0x1F100, 0x1F1FF))
_NAME_LETTER_RE = re.compile(r"\b(?:LATIN (?:CAPITAL|SMALL) LETTER|REGIONAL INDICATOR SYMBOL LETTER) ([A-Z])$")
_NAME_NUM_RE = re.compile(r"\b(?:DIGIT|NUMBER) ([A-Z]+)$")
_WORD_CH_RE = re.compile(r"[^\W_]")


def _compat_table() -> dict[int, str]:
    out: dict[int, str] = {}
    for lo, hi in _ENCLOSED_BLOCKS:
        for cp in range(lo, hi + 1):
            ch = chr(cp)
            if _WORD_CH_RE.match(ch):
                continue
            try:
                name = unicodedata.name(ch)
            except ValueError:
                continue
            n = unicodedata.normalize("NFKC", ch).strip("() .,")
            if n and n != ch and all(c.isalnum() for c in n):
                out[cp] = n
                continue
            m = _NAME_LETTER_RE.search(name)
            if m:
                out[cp] = m.group(1)
                continue
            m = _NAME_NUM_RE.search(name)
            if m and m.group(1) in _NUM_WORDS:
                out[cp] = _NUM_WORDS[m.group(1)]
    return out


_COMPAT = _compat_table()
_COMPAT_RE = re.compile(_class(_ranges(_COMPAT)))

# ayrışması olmayan Latin Genişletilmiş harfler ve küçük büyük harfler (ł, đ, ø, Ƚ, Ƀ, ᴅ, ʙ, ꞯ …) Unicode
# adından katlanır: "LATIN [CAPITAL|SMALL] LETTER [SMALL CAPITAL] X [WITH …]" → x. Ayrışması olan harfler (ç, ğ, ş, ü,
# İ) NFKD ile zaten katlanır; tek harfe inmeyen adlar (DOTLESS I, SHARP S, AE, TURNED A …) dokunulmaz. Ð/ð (ETH) D'ye
# benzer harf olarak eklenir.
_LATIN_NAME_RE = re.compile(r"^LATIN (?:CAPITAL |SMALL )?LETTER (?:SMALL CAPITAL |SMALL |CAPITAL )?([A-Z])(?: WITH .+)?$")
_LATIN_BLOCKS = ((0x80, 0x24F), (0x250, 0x2AF), (0x1D00, 0x1DBF), (0x2C60, 0x2C7F), (0xA720, 0xA7FF), (0xAB30, 0xAB6F))


def _latin_fold() -> dict[int, str]:
    out = {0xD0: "d", 0xF0: "d"}
    for lo, hi in _LATIN_BLOCKS:
        for cp in range(lo, hi + 1):
            ch = chr(cp)
            if cp in out or unicodedata.decomposition(ch):
                continue
            try:
                name = unicodedata.name(ch)
            except ValueError:
                continue
            m = _LATIN_NAME_RE.match(name)
            if m:
                out[cp] = m.group(1).lower()
    return out


_LATIN_FOLD = _latin_fold()
# (jeton kipi): harf/rakam arasındaki simge/emoji dizisi (🔐, 🗝, cilt tonu) yapıştırılır: "QA10N🔐DL7" → tek jeton
_GLUE_RE = re.compile(r"(?<=[^\W_])" + _class(_ranges(_CAT_GLUE)) + r"+(?=[^\W_])")
# → jeton kipinde harf/rakam dizileri arasındaki ayraç öbeği liste değil Unicode SINIFIYLA tanımlanır:
# en çok `SEP_MAX` karakter; her karakter Z* (boşluklar; U+2028/2029 satır sonu sayılır), P* (noktalama: `|` tablo
# kenarı, madde imleri, tireler, `,` `:` …), S* (simgeler: `+`, `•` işleçleri, `` ` ``, `~` …) ya da sekme; markdown
# vurgu/kod işaretleri (`*`, `_`, `` ` ``, `~`) bu sınıflardadır. Öbekte EN ÇOK BİR satır sonu (LF, CRLF, CR, U+2028,
# U+2029, U+0085, VT, FF; CRLF tek sayılır) olabilir: boş satır (paragraf arası) ayraç DEĞİLDİR.
# "RX52L M8VQ3", "RX52L, M8VQ3", "| RX52L | M8VQ3 |", "**RX52L**M8VQ3", "RX52L<LF>M8VQ3" → tek kanonik dizi.
SEP_MAX = 4
_LB_CHARS = frozenset("\n\r\x0b\x0c\x85  ")
_SEP_CHARS = frozenset(map(chr, _CAT_ZPS)) | {"\t"}


_SENT_END = frozenset(".!?…")


def _sep_gap(s: str, a: int, b: int) -> bool:
    """s[a:b] bir jeton ayracı mı (bkz. `SEP_MAX`). cümle sınırını (`.`, `!`, `?`, `…` ve
    ardından boşluk/satır sonu) aşan öbek ayraç DEĞİLDİR ("AB. 12 Kasım" iki ayrı cümle)."""
    n = b - a
    if n <= 0 or n > SEP_MAX + 1:
        return False
    if n == 1:
        return s[a] in _SEP_CHARS or s[a] in _LB_CHARS
    g = s[a:b].replace("\r\n", "\n")
    if len(g) > SEP_MAX:
        return False
    lb = 0
    for k, ch in enumerate(g):
        if ch in _LB_CHARS:
            lb += 1
            if lb > 1:
                return False
        elif ch not in _SEP_CHARS:
            return False
        if ch in _SENT_END and k + 1 < len(g) and (g[k + 1].isspace() or g[k + 1] in _LB_CHARS):
            return False  # cümle sonu + boşluk
    return True


LOOSE_MIN = 6  # ayraçla birleşik (tam yazım dışı) eşleşme için kanonik terimin en az harf/rakam sayısı
AMOUNT_SEPS = frozenset({".", ","})  # binlik ayracı
AMT_TAG = "=amt"  # mezar kaydında tutar eşleşmesine izin verilen sayısal terimlerin özet alanı


def _amount_shape(words: Any, gaps: Any, i: int, j: int) -> bool:
    """words[i..j] sayı biçimli bir tutar mı ("900.000", "1,940,000"; ardından birim/para birimi gelebilir):
    yalnız rakam grupları, ilk grup 1–3 hane, sonrakiler tam 3 hane, aralarında hep aynı `.` ya da `,` ayracı. Sayısal
    bir kod ("900000") bu biçimle kullanıcı terimi açıkça işaretlemedikçe eşleşmez."""
    if j <= i:
        return False
    seg = [str(w) for w in words[i:j + 1]]
    if not all(w.isascii() and w.isdigit() for w in seg) or not 1 <= len(seg[0]) <= 3             or any(len(w) != 3 for w in seg[1:]):
        return False
    g = {gaps[k] for k in range(i, j)}
    return len(g) == 1 and next(iter(g)) in AMOUNT_SEPS


@lru_cache(maxsize=4096)
def _gap_key(g: str) -> str:
    """tam yazım karşılaştırması için ayraç biçimi — boşluk sınıfı (Zs, sekme, satır sonu) tek boşluk, tire
    sınıfı (Pd, yumuşak tire) "-"; diğer karakterler olduğu gibi ("" = "KT‐11", "KT 11" ≠ "")."""
    out: list[str] = []
    for ch in g:
        if ch in _LB_CHARS or ch == "\t" or unicodedata.category(ch) == "Zs":
            c = " "
        elif ch in _HYPHENS_SET or unicodedata.category(ch) == "Pd":
            c = "-"
        else:
            c = ch
        if c == " " and out and out[-1] == " ":
            continue
        out.append(c)
    return "".join(out)
CANON_OLD_MAX = 40   # eski (sürüm 1) jeton kayıtlarında kanonik birleşim en çok bu kadar karakter denenir
_HYPHENS = "".join(map(chr, (0x2D, 0xAD, 0x2010, 0x2011)))
_HYPHENS_SET = frozenset(_HYPHENS)
_JSON_ESC_RE = re.compile(r'\\u([dD][89abAB][0-9a-fA-F]{2})\\u([dD][c-fC-F][0-9a-fA-F]{2})'
                          r'|\\u([0-9a-fA-F]{4})|\\([ntrbf"\\/])|\\x([0-9a-fA-F]{2})|\\U([0-9a-fA-F]{8})')
# YAML çift tırnaklı dizgide kaçışlı satır sonu (satır devamı) ve quoted-printable (yumuşak satır sonu, `=C3=BC`)
_YCONT_RE = re.compile(r"\\\r?\n[ \t]*")
_QP_SOFT_RE = re.compile(r"=\r?\n")
_QP_HEX_RE = re.compile(r"=[89A-F][0-9A-F](?:=[0-9A-F]{2})*")
_ENTITY_RE = re.compile(r"&(?:#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6}|[A-Za-z][A-Za-z0-9]{1,31});?")
# URL yüzde kodlaması (`Z%C3%BCmr%C3%BCt`, çift kodlama dahil) çözülür; `+` zaten jeton ayırıcıdır
_PCT_RE = re.compile(r"(?:%[0-9A-Fa-f]{2})+")
_INLINE_TAGS = frozenset("a abbr b bdi bdo big cite code data del dfn em font i ins kbd mark q s samp small span strike "
                         "strong sub sup time tt u var wbr".split())
_BLOCK_TAGS = frozenset("p div br hr h1 h2 h3 h4 h5 h6 li ul ol dl dt dd table thead tbody tr td th pre blockquote "
                        "section article header footer figure figcaption img".split())
# tam etiket | kapanış `>` işareti temizlenmiş artık etiket (`<p Metin`, `</b QA…`; markdown temizliğinden geçmiş bilgi
# cümlesi böyle saklanabilir) — artık biçim yalnız bilinen HTML öğe adlarında tanınır.
# tırnaklı nitelik değeri içindeki `>` etiketi bitirmez (`<span data-x="a>b">`).
_TAG_RE = re.compile(r"<!--.*?-->|</?([A-Za-z][A-Za-z0-9:-]{0,40})(?:\s(?:[^<>\"']|\"[^\"]*\"|'[^']*'){0,1000})?/?>"
                     r"|</?(" + "|".join(sorted(_INLINE_TAGS | _BLOCK_TAGS, key=len, reverse=True)) + r")(?=[\s<]|$)",
                     re.S | re.I)
# nitelik değerleri (alt, title, href, data-* …) atılmaz; metnin sonuna ayrı satır olarak eklenip taranır
_ATTR_RE = re.compile(r"[A-Za-z_:][-A-Za-z0-9_:.]*\s*=\s*(?:\"([^\"]*)\"|'([^']*)'|([^\s\"'=<>`]+))")
_HWRAP_RE = re.compile(r"(?<=[^\W\d_])[" + re.escape(_HYPHENS) + r"][ \t]*\r?\n[ \t]*(?=[^\W\d_])")
_INVIS_RE = re.compile(_INVIS_CLASS)
_NEEDS_RE = re.compile(r"[<&\\]|%[0-9A-Fa-f]{2}|=\r?\n|=[89A-F][0-9A-F]|[" + re.escape(_HYPHENS) + r"][ \t]*\r?\n|"
                       + _INVIS_CLASS + "|" + _COMPAT_RE.pattern)
_JSON_SIMPLE = {"n": "\n", "t": "\t", "r": "\r", "b": " ", "f": " "}

# benzer harf → Latin (Unicode confusables alt kümesi). Büyük harf tablosu casefold'dan ÖNCE, küçük harf SONRA uygulanır.
_CONF_UPPER = {cp: ch for cp, ch in (
    (0x0410, "a"), (0x0412, "b"), (0x0415, "e"), (0x041A, "k"), (0x041C, "m"), (0x041D, "h"), (0x041E, "o"),
    (0x0420, "p"), (0x0421, "c"), (0x0422, "t"), (0x0423, "y"), (0x0425, "x"), (0x0405, "s"), (0x0406, "i"),
    (0x0408, "j"), (0x04AE, "y"), (0x04C0, "l"), (0x051A, "q"), (0x051C, "w"),
    (0x0391, "a"), (0x0392, "b"), (0x0395, "e"), (0x0396, "z"), (0x0397, "h"), (0x0399, "i"), (0x039A, "k"),
    (0x039C, "m"), (0x039D, "n"), (0x039F, "o"), (0x03A1, "p"), (0x03A4, "t"), (0x03A5, "y"), (0x03A7, "x"),
    (0x03F9, "c"), (0x037F, "j"),
    # Ermeni büyük harfleri (casefold onları benzemeyen küçük harfe çevirir; önce eşlenir)
    (0x0555, "o"), (0x054D, "u"), (0x054F, "s"), (0x053C, "l"), (0x0548, "n"))}
_CONF_LOWER = {cp: ch for cp, ch in (
    (0x0430, "a"), (0x0432, "b"), (0x0435, "e"), (0x043A, "k"), (0x043C, "m"), (0x043D, "h"), (0x043E, "o"),
    (0x0440, "p"), (0x0441, "c"), (0x0442, "t"), (0x0443, "y"), (0x0445, "x"), (0x0455, "s"), (0x0456, "i"),
    (0x0458, "j"), (0x04AF, "y"), (0x04BB, "h"), (0x04CF, "l"), (0x0501, "d"), (0x051B, "q"), (0x051D, "w"),
    (0x0454, "e"), (0x0457, "i"), (0x0491, "r"), (0x04BD, "e"), (0x050D, "g"),
    (0x03B1, "a"), (0x03B2, "b"), (0x03B5, "e"), (0x03B6, "z"), (0x03B7, "n"), (0x03B9, "i"), (0x03BA, "k"),
    (0x03BC, "m"), (0x03BD, "v"), (0x03BF, "o"), (0x03C1, "p"), (0x03C4, "t"), (0x03C5, "u"), (0x03C7, "x"),
    (0x03F2, "c"), (0x03F3, "j"), (0x03C3, "o"),
    (0x0251, "a"), (0x0261, "g"), (0x0131, "i"), (0x0269, "i"), (0x028B, "u"), (0x0263, "y"),
    # Ermeni küçük harfleri (Unicode confusables alt kümesi)
    (0x0585, "o"), (0x057D, "u"), (0x0570, "h"), (0x0578, "n"), (0x057C, "n"), (0x0581, "g"), (0x0566, "q"),
    (0x0563, "q"), (0x0575, "j"), (0x0561, "w"), (0x0584, "f"), (0x056C, "l"),
    # Çeroki (büyük harfler; küçük Çeroki harfleri casefold ile büyük harfe gider, sonra bu tablo uygulanır)
    (0x13A0, "d"), (0x13A1, "r"), (0x13A2, "t"), (0x13A5, "i"), (0x13A9, "y"), (0x13AA, "a"), (0x13AB, "j"),
    (0x13AC, "e"), (0x13B3, "w"), (0x13B7, "m"), (0x13BB, "h"), (0x13BD, "y"), (0x13C0, "g"), (0x13C2, "h"),
    (0x13C3, "z"), (0x13CF, "b"), (0x13D2, "r"), (0x13D4, "w"), (0x13D5, "s"), (0x13D9, "v"), (0x13DA, "s"),
    (0x13DE, "l"), (0x13DF, "c"), (0x13E2, "p"), (0x13E6, "k"), (0x13F4, "b"))}


@lru_cache(maxsize=131072)
def fold(tok: str) -> str:
    s = unicodedata.normalize("NFKD", tok.replace("İ", "i").replace("I", "i").replace("ı", "i"))
    s = "".join(c for c in s if not unicodedata.combining(c))
    return s.translate(_CONF_UPPER).translate(_LATIN_FOLD).casefold().translate(_CONF_LOWER)


def _json_esc(m: re.Match[str]) -> str:
    if m.group(1):
        hi, lo = int(m.group(1), 16), int(m.group(2), 16)
        return chr(0x10000 + ((hi - 0xD800) << 10) + (lo - 0xDC00))
    if m.group(3):
        cp = int(m.group(3), 16)
        return " " if 0xD800 <= cp <= 0xDFFF else chr(cp)
    if m.group(5):
        return chr(int(m.group(5), 16))
    if m.group(6):
        cp = int(m.group(6), 16)
        return chr(cp) if cp <= 0x10FFFF and not 0xD800 <= cp <= 0xDFFF else " "
    e = m.group(4)
    return _JSON_SIMPLE.get(e, e)


def _qp(m: re.Match[str]) -> str | None:
    """quoted-printable `=C3=BC` → `ü` (yalnız ASCII dışı bayt dizileri; çözülemezse olduğu gibi)."""
    try:
        return bytes.fromhex(m.group().replace("=", "")).decode("utf-8")
    except (ValueError, UnicodeDecodeError):
        return None


def _entity(m: re.Match[str]) -> str | None:
    out = _html.unescape(m.group())
    return None if out == m.group() else out


def _pct(m: re.Match[str]) -> str | None:
    """`%C3%BC` → `ü` (UTF-8; çözülemeyen bayt dizisi olduğu gibi kalır)."""
    raw = m.group()
    try:
        out = bytes.fromhex(raw.replace("%", "")).decode("utf-8")
    except (ValueError, UnicodeDecodeError):
        return None
    return out if out != raw else None


def _tag(m: re.Match[str]) -> str:
    return "" if (m.group(1) or m.group(2) or "").lower() in _INLINE_TAGS else " "


_PRE_PASSES = ((_JSON_ESC_RE, _json_esc), (_ENTITY_RE, _entity), (_ENTITY_RE, _entity), (_PCT_RE, _pct),
               (_PCT_RE, _pct), (_ENTITY_RE, _entity))  # düzeni (geriye uyum); `_DECODE_PASSES` sabit nokta
_DECODE_PASSES = ((_YCONT_RE, lambda _m: ""), (_JSON_ESC_RE, _json_esc), (_ENTITY_RE, _entity), (_PCT_RE, _pct))
_POST_PASSES = ((_HWRAP_RE, lambda _m: ""), (_INVIS_RE, lambda _m: ""))
_PASSES = (*_PRE_PASSES, (_TAG_RE, _tag), *_POST_PASSES)  # geriye uyum (dışarıdan okunursa)


def _attr_values(s: str, st: list[int], en: list[int]) -> list[tuple[str, list[int], list[int]]]:
    """tam etiketlerin nitelik değerleri (özgün konum eşlemeleriyle). Etiket metinden atılır; değerleri ayrı
    satırlar olarak taranır (alt/title/href içindeki cümle; varlıklar ve yüzde kodlaması önceden çözülmüş)."""
    out: list[tuple[str, list[int], list[int]]] = []
    for m in _TAG_RE.finditer(s):
        if not m.group(1) or "=" not in m.group():
            continue
        base = m.start()
        for a in _ATTR_RE.finditer(m.group()):
            g = next(i for i in (1, 2, 3) if a.group(i) is not None)
            v = a.group(g)
            if len(v) < 4:
                continue
            x, y = base + a.start(g), base + a.end(g)
            out.append((s[x:y], st[x:y], en[x:y]))
    return out


def _resub(s: str, st: list[int], en: list[int], rx: re.Pattern[str], fn: Any) -> tuple[str, list[int], list[int]]:
    """Konum eşlemeli değiştirme: yeni metnin her karakteri özgün aralığa [st, en) eşlenir."""
    out: list[str] = []
    ns: list[int] = []
    ne: list[int] = []
    pos = 0
    for m in rx.finditer(s):
        r = fn(m)
        if r is None:
            continue
        a, b = m.span()
        out.append(s[pos:a])
        ns += st[pos:a]
        ne += en[pos:a]
        if r:
            out.append(r)
            ns += [st[a]] * len(r)
            ne += [en[b - 1]] * len(r)
        pos = b
    if not out:
        return s, st, en
    out.append(s[pos:])
    ns += st[pos:]
    ne += en[pos:]
    return "".join(out), ns, ne


def normalise(text: str) -> tuple[str, list[int] | None, list[int] | None]:
    """(normal metin, başlangıç eşlemesi, bitiş eşlemesi). Değişiklik gerekmiyorsa eşleme None (kimlik)."""
    s = str(text or "")
    if not _NEEDS_RE.search(s):
        return s, None, None
    st, en = list(range(len(s))), list(range(1, len(s) + 1))
    # kaçışlar sabit noktaya kadar çözülür (üçlü yüzde, `\\u` çift kaçış, varlık içinde JSON kaçışı …)
    for _round in range(DECODE_ROUNDS):
        before = s
        for rx, fn in _DECODE_PASSES:
            s, st, en = _resub(s, st, en, rx, fn)
        if _QP_HEX_RE.search(s) or len(_QP_SOFT_RE.findall(s)) >= 2:
            s, st, en = _resub(s, st, en, _QP_SOFT_RE, lambda _m: "")
            s, st, en = _resub(s, st, en, _QP_HEX_RE, _qp)
        if s == before:
            break
    s, st, en = _resub(s, st, en, _COMPAT_RE, lambda m: _COMPAT.get(ord(m.group()), m.group()))
    attrs = _attr_values(s, st, en) if "=" in s and "<" in s else []
    s, st, en = _resub(s, st, en, _TAG_RE, _tag)
    for rx, fn in _POST_PASSES:
        s, st, en = _resub(s, st, en, rx, fn)
    for v, vst, ven in attrs:  # nitelik değerleri ayrı satırlarda (özgün konumlarına eşli)
        for rx, fn in _POST_PASSES:
            v, vst, ven = _resub(v, vst, ven, rx, fn)
        if v:
            s += "\n" + v
            st += [vst[0], *vst]
            en += [ven[0], *ven]
    return s, st, en


def _tokenize(s: str, st: list[int] | None, en: list[int] | None,
              ignored: list[tuple[int, int]]) -> tuple[list[tuple[str, int, int]], list[tuple[str, int, int]]]:
    """Tek geçiş → (atlanan aralıklar dışındaki jetonlar, bütün jetonlar)."""
    kept: list[tuple[str, int, int]] = []
    full: list[tuple[str, int, int]] = []
    j = 0
    for m in _TOKEN_RE.finditer(s):
        t = fold(m.group())
        if not t:
            continue
        a = m.start()
        tok = (t, a, m.end()) if st is None or en is None else (t, st[a], en[m.end() - 1])
        full.append(tok)
        while j < len(ignored) and ignored[j][1] <= a:
            j += 1
        if not (j < len(ignored) and ignored[j][0] <= a < ignored[j][1]):
            kept.append(tok)
    return kept, full


CACHE_TEXT_MAX = 64 * 1024  # bu boyuta kadar metnin jeton akışları önbelleğe alınır (kayıt başına yeniden yok)


def token_streams(text: str) -> list[list[tuple[str, int, int]]]:
    """bir ya da iki jeton akışı. Birincisi bağlantı hedeflerini, çıplak URL'leri ve çitli kodu atlar (bilgi
    cümlesi `clean_markdown` ile böyle saklanır: "[Zümrüt](https://…) Enerji" ↔ "Zümrüt Enerji"). Metinde bunlardan biri
    varsa ikinci akış hiçbir şeyi atlamaz: URL yolu/sorgusu, bağlantı hedefi ve kod içindeki cümle de bulunur.
    kısa metinlerde sonuç önbellekten gelir (aynı metin her mezar kaydı için yeniden jetonlanmaz)."""
    text = str(text or "")
    if len(text) <= CACHE_TEXT_MAX:
        return [list(x) for x in _token_streams_cached(text)]
    return _token_streams(text)


@lru_cache(maxsize=1024)
def _token_streams_cached(text: str) -> tuple[tuple[tuple[str, int, int], ...], ...]:
    return tuple(tuple(x) for x in _token_streams(text))


def _token_streams(text: str) -> list[list[tuple[str, int, int]]]:
    s, st, en = normalise(text)
    ignored = [(m.start(), m.end()) for m in _IGNORE_RE.finditer(s)] if ("`" in s or "http" in s or "](" in s) else []
    kept, full = _tokenize(s, st, en, ignored)
    return [kept, full] if len(kept) != len(full) else [full]


def tokens_with_spans(text: str) -> list[tuple[str, int, int]]:
    """Biçimden bağımsız jetonlar: [(normal jeton, başlangıç, bitiş)] (özgün metindeki konum)."""
    return token_streams(text)[0]


def tokens(text: str) -> tuple[str, ...]:
    return tuple(t for t, _a, _b in tokens_with_spans(text))


# ------------------------------------------------------------------ jeton kipi
def canon_stream(text: str) -> tuple[list[tuple[str, int, int]], list[bool]]:
    """jeton kipi akışı + birleşebilirlik. (jetonlar, birleşir) — `birleşir[i]` True ise jeton i ile i+1
    arasında yalnız ayraç vardır (`_sep_gap`); kanonik eşleme bu jetonları ayraçsız birleştirir."""
    toks, join, _gaps = canon_gaps(text)
    return list(toks), list(join)


def canon_gaps(text: str) -> tuple[tuple[tuple[str, int, int], ...], tuple[bool, ...], tuple[str, ...]]:
    """`canon_stream` + jetonlar arası ayraç biçimleri (`_gap_key`; tam yazım karşılaştırması için).
    Salt okunur demetler döner (önbellekten)."""
    text = str(text or "")
    if len(text) <= CACHE_TEXT_MAX:
        return _canon_cached(text)
    toks, join, gaps = _canon_stream(text)
    return tuple(toks), tuple(join), tuple(gaps)


@lru_cache(maxsize=1024)
def _canon_cached(text: str) -> tuple[tuple[tuple[str, int, int], ...], tuple[bool, ...], tuple[str, ...]]:
    toks, join, gaps = _canon_stream(text)
    return tuple(toks), tuple(join), tuple(gaps)


def _canon_stream(text: str) -> tuple[list[tuple[str, int, int]], list[bool], list[str]]:
    s, st, en = normalise(text)
    if _GLUE_RE.search(s):
        if st is None or en is None:
            st, en = list(range(len(s))), list(range(1, len(s) + 1))
        s, st, en = _resub(s, st, en, _GLUE_RE, lambda _m: "")
    toks: list[tuple[str, int, int]] = []
    join: list[bool] = []
    gaps: list[str] = []
    prev: int | None = None
    for m in _TOKEN_RE.finditer(s):
        t = fold(m.group())
        if not t:
            prev = None
            continue
        a, b = m.start(), m.end()
        if toks:
            ok = prev is not None and _sep_gap(s, prev, a)
            join.append(ok)
            gaps.append(_gap_key(s[prev:a]) if ok and prev is not None else "\x00")
        toks.append((t, a, b) if st is None or en is None else (t, st[a], en[b - 1]))
        prev = b
    return toks, join, gaps


def exact_key(words: Any, gaps: Any, i: int, j: int) -> str:
    """words[i..j] tam yazımı (katlanmış jetonlar + ayraç biçimleri)."""
    return words[i] + "".join(gaps[k] + words[k + 1] for k in range(i, j))


def term_exact(term: str) -> str:
    """terimin tam yazım anahtarı ("" → "kt-11", "AB12" → "ab12")."""
    toks, _join, gaps = canon_gaps(str(term or ""))
    words = [t for t, _a, _b in toks]
    return exact_key(words, gaps, 0, len(words) - 1) if words else ""


def token_glue_stream(text: str) -> list[tuple[str, int, int]]:
    """Jeton kipi akışı: normalleştirilmiş metin + harf/rakam arasındaki simge/emoji yapıştırılmış, hiçbir bölge (URL,
    kod) atlanmaz. [(katlanmış jeton, başlangıç, bitiş)] (özgün metindeki konum)."""
    return canon_stream(text)[0]


def _raw_seq(term: str) -> tuple[str, ...]:
    return tuple(t for t, _a, _b in token_glue_stream(str(term or "")))


def term_seq(term: str) -> tuple[str, ...]:
    """Jeton → katlanmış jeton dizisi (çıkarıcının eşleme birimi; en az `MIN_TERM`). Kullanıcı terimi: `user_seq`."""
    seq = _raw_seq(term)
    return seq if len("".join(seq)) >= MIN_TERM else ()


def user_seq(term: str) -> tuple[str, ...]:
    """kullanıcı terimi → jeton dizisi; en az `MIN_USER_TERM` (2) karakter kabul edilir. `SHORT_TERM`
    altındaki terimler önizlemede aşırı silme uyarısı ve etki sayısıyla gösterilir (sessizce düşürülmez)."""
    seq = _raw_seq(term)
    return seq if len("".join(seq)) >= MIN_USER_TERM else ()


def term_canon(term: str) -> str:
    """kanonik biçim — jetonlar ayraçsız birleşik ("AB 12 CD" = "AB-12-CD" = "ab12cd")."""
    return "".join(user_seq(term))


def token_hash(salt: str, seq: Iterable[str]) -> str:
    return _token_hash_t(salt, tuple(seq))


@lru_cache(maxsize=65536)
def _token_hash_t(salt: str, seq: tuple[str, ...]) -> str:
    return hashlib.sha256(f"{salt}\x1f{TOKEN_TAG}\x1f{' '.join(seq)}".encode("utf-8")).hexdigest()[:24]


X_TAG = "=x"  # tam yazım özetlerinin alan ayırıcısı (kanonik terim yalnız harf/rakamdır; çakışmaz)


def token_record(terms: Iterable[str], salt: str | None = None,
                 kw_terms: Iterable[str] = (), amount_ok: Iterable[str] = ()) -> dict[str, Any] | None:
    """Mezar kaydının jeton bölümü: {v, salt, hashes, lens, clens, xh, kwh?} (içerik yok; tuz kayıt başına rastgele).
    `hashes` = jeton dizisi özetleri (eski eşleme) + kanonik birleşim özetleri (tek jetonlu dizinin özeti
    kanonik özetle aynıdır). `lens` jeton sayıları, `clens` kanonik karakter uzunlukları.
    `xh` tam yazım özetleri (bu alan varsa yeni kural: `LOOSE_MIN` altındaki terim yalnız tam yazımıyla
    eşleşir); `kwh` yalnız anahtar sözcükten sonra eşlenen (PIN/yıl gibi kısa sayı) terimlerin kanonik özetleri."""
    terms = [t for t in terms if user_seq(t)]
    seqs = {user_seq(t) for t in terms}
    kws = {c for c in (term_canon(t) for t in kw_terms) if c}
    if not seqs and not kws:
        return None
    salt = salt or os.urandom(16).hex()
    canon = {"".join(q) for q in seqs}
    hashes = {token_hash(salt, q) for q in seqs} | {token_hash(salt, (c,)) for c in canon}
    rec: dict[str, Any] = {"v": 2, "salt": salt, "hashes": sorted(hashes), "lens": sorted({len(q) for q in seqs}),
                           "clens": sorted({len(c) for c in canon}),
                           "xh": sorted({token_hash(salt, (X_TAG, term_exact(t))) for t in terms})}
    if kws:
        rec["kwh"] = sorted(token_hash(salt, (c,)) for c in kws)
    # bu alan varsa yeni kural — sayısal terim tutar biçimiyle ("900.000 TL") yalnız burada listelenen
    # (kullanıcının açıkça izin verdiği) terimlerde eşleşir
    rec["amt"] = sorted({token_hash(salt, (AMT_TAG, c)) for c in (term_canon(t) for t in amount_ok) if c.isdigit()})
    return rec


# Yaygın kelimeler (katlanmış): büyük harfle başlasa da özel ad sayılmaz. Bilinçli olarak kısa; özel ad önerileri zaten
# varsayılan olarak SEÇİLİ değildir (kullanıcı işaretler).
_COMMON = frozenset(fold(w) for w in """
bu şu o bir ve ile için ama fakat veya ya da de da ki mi mı çok daha en her hiç gibi kadar sonra önce şimdi bugün yarın
dün proje projesi toplantı rapor raporu özet not notu notlar kayıt kayıtı kaydı ek ekte bilgi görev adım sonuç durum
haftalık aylık yıllık müşteri şirket ekip firma enerji santral santrali tarih tarihi teslim plan planı risk bütçe
merhaba sayın lütfen teşekkürler saygılarımla iyi günler önemli gizli kod kodu numara numarası şifre parola anahtar
ocak şubat mart nisan mayıs haziran temmuz ağustos eylül ekim kasım aralık pazartesi salı çarşamba perşembe cuma
cumartesi pazar türkiye istanbul ankara izmir genel yeni eski son ilk diğer başka aynı tüm bütün
the a an and or but for with from this that these those to of in on at by is are was were be been not no yes
project report summary note meeting team company customer task step result status date plan budget risk hello
dear please thanks regards important secret code number password key january february march april may june july
august september october november december monday tuesday wednesday thursday friday saturday sunday new old first
last other same all general
""".split())
_EMAIL_RE = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
_HANDLE_RE = re.compile(r"(?<![\w@.])@[A-Za-z0-9_]{3,40}\b")
# gruplanmış biçimler (ayraç: boşluk/NBSP/tire/nokta/eğik çizgi/alt çizgi). Büyük/küçük harf duyarlı.
_G = "[    \\-‐‑‒–./_]"
_IBAN_RE = re.compile(r"(?<![\w])[A-Z]{2}\d{2}(?:" + _G + r"?[A-Z0-9]{4}){2,7}(?:" + _G + r"?[A-Z0-9]{1,3})?(?![\w])")
_CARD_RE = re.compile(r"(?<![\w])\d{4}(?:" + _G + r"?\d{4}){2}" + _G + r"?\d{1,7}(?![\w])")
_PHONE_RE = re.compile(r"(?<![\w+])(?:\+\d{1,3}" + _G + r"?)?\(?0?\d{3}\)?" + _G + r"?\d{3}" + _G + r"?\d{2}" + _G
                       + r"?\d{2}(?![\w])")
_PLATE_RE = re.compile(r"(?<![\w])(?:0[1-9]|[1-7]\d|8[01])" + _G + r"?[A-Z]{1,3}" + _G + r"?\d{2,4}(?![\w])")
_GROUPED_RE = re.compile(r"(?<![\w])[A-Z0-9]{1,6}(?:" + _G + r"[A-Z0-9]{1,6}){1,5}(?![\w])")
# anahtar sözcükten (PIN, şifre, kod, parola, password, code …) sonra gelen değer — 4–5 haneli PIN dahil
_KW_RE = re.compile(r"(?i)(?<![\w])(?:pin|şifre(?:si|m|yi|sini|niz|miz)?|sifre(?:si)?|parola(?:sı|m|yı|sını|nız)?|"
                    r"kod(?:u|um|unu|un|umuz|unuz)?|password|passcode|passwd|pass\s?code|code|pin\s?code)(?![\w])")
_KW_CONN_RE = re.compile(r"(?i)[\s:=]*(?:(?:is|was|ise|olarak)(?![\w])[\s:=]*)?")
_KW_FIRST_RE = re.compile(r"[\"'«(\[]?([^\s,;\"'»)\]]{1,64})")
_KW_GROUP_RE = re.compile(_G + r"([A-Z0-9]{1,8}|[A-Za-z0-9]*\d[A-Za-z0-9]*)(?=$|[\s,;:.!?)'\"»\]])")
_TRAIL = ".,;:!?)'\"»]"
# standart/model adı, birim, çeyrek, sürüm gibi rastgele görünmeyen harf+rakam karışımları
_STD_RE = re.compile(r"\d{4}[qh][1-4]|[qh][1-4]\d{4}|\d{4}w\d{1,2}|v\d+|\d+[a-z]{1,4}|[a-z]{1,5}\d+")
_RUNS_RE = re.compile(r"\d+|[^\W\d_]+")


def _entropy(s: str) -> float:
    import math  # noqa: PLC0415
    n = len(s)
    return -sum(c / n * math.log2(c / n) for c in (s.count(x) for x in set(s))) if n else 0.0


def _random_code(c: str) -> bool:
    """rastgele görünen harf+rakam kodu (varsayılan seçili): ≥ 6 karakter, harf ve rakam, en az 3 harf/rakam
    öbeği (ISO9001, H264, 250kW, IPv6, 2026Q3 gibi standart/birim/çeyrek kalıpları değil) ve Shannon ≥ 2,5 bit."""
    c = c.lower()
    if len(c) < 6 or not any(ch.isdigit() for ch in c) or not any(ch.isalpha() for ch in c):
        return False
    if _STD_RE.fullmatch(c):
        return False
    return len(_RUNS_RE.findall(c)) >= 3 and _entropy(c) >= 2.5


_DATE_DIGITS_RE = re.compile(r"(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])?")


def _plain_number_value(raw: str, canon: str) -> bool:
    """anahtar sözcüklü değer yalnız rakamsa ve ≤ 5 hane, yıl/tarih (YYYYMM[DD]) ya da telefon biçimliyse
    (`_PHONE_RE` ya da 0/90 ile başlayan 10–13 hane) öneridir."""
    if not canon.isdigit():
        return False
    if len(canon) <= 5 or _DATE_DIGITS_RE.fullmatch(canon):
        return True
    return bool(_PHONE_RE.fullmatch(raw.strip())) or (10 <= len(canon) <= 13 and canon.startswith(("0", "90")))


def _short_number(canon: str) -> bool:
    """PIN/yıl gibi kısa saf sayı (≤ 5 hane ya da YYYYMM[DD]): ad alanında başka anlamlarla da geçer."""
    return canon.isdigit() and (len(canon) <= 5 or bool(_DATE_DIGITS_RE.fullmatch(canon)))


def _luhn(digits: str) -> bool:
    total = 0
    for i, ch in enumerate(reversed(digits)):
        d = int(ch)
        if i % 2:
            d = d * 2 - 9 if d > 4 else d * 2
        total += d
    return total % 10 == 0


def _token_kind(raw: str, tok: str, first: bool) -> str | None:
    """Ayırt edici jeton sezgileri (belgeli, basit): kod/kimlik (harf+rakam, ≥ 4), uzun sayı (≥ 6 hane), yüksek entropi
    (≥ 12 karakter, karışık büyük/küçük harf ve rakam/harf geçişleri, Shannon ≥ 3,5 bit/karakter), özel ad (büyük harfle
    başlayan ya da tümü büyük ≥ 3 harf, yaygın kelime değil, cümle başı değil ya da tümü büyük)."""
    if _distinct(tok):
        return "number" if tok.isdigit() else "code"
    letters = [c for c in raw if c.isalpha()]
    if len(raw) >= 12 and sum(c.isupper() for c in raw[1:]) >= 2 and any(c.islower() for c in raw) \
            and _entropy(raw) >= 3.5:
        return "random"
    if tok in _COMMON or len(tok) < 3 or not letters:
        return None
    acronym = len(letters) >= 3 and all(c.isupper() for c in letters)
    if acronym or (raw[:1].isupper() and not first):
        return "name"
    return None


def _keyword_values(st: str) -> list[tuple[int, int, str]]:
    """anahtar sözcükten sonraki değer → [(başlangıç, bitiş, ham metin)]. Değer rakam ya da iç simge taşımalı
    (kelime parolalar ve yazıyla yazılmış sayılar tahmin edilmez: kullanıcı terimi olarak eklenir)."""
    out: list[tuple[int, int, str]] = []
    for m in _KW_RE.finditer(st):
        pos = m.end()
        for _ in range(3):
            pos = _KW_CONN_RE.match(st, pos).end()  # type: ignore[union-attr]
            k2 = _KW_RE.match(st, pos)
            if not k2:
                break
            pos = k2.end()
        f = _KW_FIRST_RE.match(st, pos)
        if not f:
            continue
        a = f.start(1)
        raw = f.group(1).rstrip(_TRAIL)
        b = a + len(raw)
        while raw and len(raw) < 64:
            g = _KW_GROUP_RE.match(st, b)
            if not g:
                break
            b = g.end(1)
            raw = st[a:b]
        raw = raw.rstrip(_TRAIL)
        if not raw:
            continue
        canon = term_canon(raw)
        inner_sym = any(not ch.isalnum() and not ch.isspace() for ch in raw.strip("-._/"))
        if canon and (any(ch.isdigit() for ch in canon) or (inner_sym and len(canon) >= 4)):
            out.append((a, a + len(raw), raw))
    return out


def extract_tokens(statements: Iterable[str]) -> list[dict[str, Any]]:
    """unutulan bilgilerin ayırt edici jetonları → [{text, kind, selected}] (görünüm sırası;
    kanonik biçimde tekrarsız). Varsayılan SEÇİLİ (yüksek güven): rastgele görünen harf+rakam kodları (`_random_code`),
    yüksek entropili dizgiler, e-postalar, anahtar sözcüklü değerler (PIN/şifre/kod/parola/password/code …, 4–5 haneli
    PIN dahil), Luhn'u tutan kart ve IBAN grupları. ÖNERİ (seçili değil): standart/model adları, birimler, çeyrekler,
    anahtar sözcüksüz sayılar ve telefonlar, plakalar, kullanıcı adları, özel adlar. Kelime parolalar ve yazıyla
    yazılmış sayılar tahmin edilmez (kullanıcı terimi)."""
    found: list[tuple[int, dict[str, Any]]] = []
    seen: set[str] = set()
    for idx, st in enumerate(statements):
        st = str(st or "")
        base = idx * 10_000_000
        covered: list[tuple[int, int]] = []

        def add(a: int, b: int, text: str, kind: str, selected: bool, cover: bool = True, **flags: Any) -> None:
            if cover:
                covered.append((a, b))
            canon = term_canon(text)
            if not canon or canon in seen:
                return
            seen.add(canon)
            found.append((base + a, {"text": text, "kind": kind, "selected": bool(selected), **flags}))

        def free(a: int, b: int) -> bool:
            return not any(x < b and a < y for x, y in covered)

        for m in _EMAIL_RE.finditer(st):
            add(m.start(), m.end(), m.group(), "email", True)
        for a, b, raw in _keyword_values(st):
            if not free(a, b):
                continue
            canon = term_canon(raw)
            kind = ("pin" if 4 <= len(canon) <= 5 else "number") if canon.isdigit() else "code"
            # ≤ 5 haneli saf sayı, yıl/tarih ya da telefon biçimli değer ÖNERİDİR: aynı sayı ad alanında yıl,
            # standart, tutar, telefon olarak geçer. unutulanların dışında etkisi SIFIRSA önceden seçilebilir
            # (`gate4`, `_select_tokens`); kısa sayı/yıl yalnız anahtar sözcükten sonra eşlenir (`kwonly`)
            plain = _plain_number_value(raw, canon)
            flags = {"gate4": True, **({"kwonly": True} if _short_number(canon) else {})} if plain else {}
            add(a, b, raw, kind, len(canon) >= 3 and not plain, **flags)
        for m in _IBAN_RE.finditer(st):
            if free(*m.span()) and len(term_canon(m.group())) >= 15:
                add(m.start(), m.end(), m.group(), "iban", True)
        for m in _CARD_RE.finditer(st):
            digits = term_canon(m.group())
            if free(*m.span()) and 13 <= len(digits) <= 19 and _luhn(digits):
                add(m.start(), m.end(), m.group(), "card", True)
        for m in _PHONE_RE.finditer(st):
            if free(*m.span()):
                add(m.start(), m.end(), m.group(), "phone", False)
        for m in _PLATE_RE.finditer(st):
            if free(*m.span()):
                add(m.start(), m.end(), m.group(), "plate", False)
        for m in _GROUPED_RE.finditer(st):
            canon = term_canon(m.group())
            if not free(*m.span()) or len(canon) < 5 or canon.isdigit() or canon.isalpha():
                continue
            groups = re.split(_G, m.group())
            if groups[-1].isalpha() and all(g.isdigit() for g in groups[:-1]):
                continue  # "1.500.000 TL", "250 kW": tutar/birim
            short =all(len(g) <= 3 for g in groups) or any(len(_RUNS_RE.findall(g)) > 1 for g in groups)
            add(m.start(), m.end(), m.group(), "code", _random_code(canon) and short)
        for m in _HANDLE_RE.finditer(st):
            if free(*m.span()):
                add(m.start(), m.end(), m.group(), "handle", False)
        prev_end = 0
        for i, (tok, a, b) in enumerate(token_glue_stream(st)):
            raw = st[a:b]
            gap = st[prev_end:a]
            first = i == 0 or bool(re.search(r"[.!?:\n]\s*$", gap))
            prev_end = b
            if not free(a, b):
                continue
            kind = _token_kind(raw, tok, first)
            if kind:
                sel = kind == "random" or (kind == "code" and _random_code(tok))
                add(a, b, raw, kind, sel, cover=False)
    found.sort(key=lambda x: x[0])
    return [e for _a, e in found][:MAX_TOKENS]


def _tok_hash(toks: Iterable[str]) -> str | None:
    return _tok_hash_t(tuple(toks))


@lru_cache(maxsize=65536)
def _tok_hash_t(toks: tuple[str, ...]) -> str | None:
    joined = " ".join(toks)
    if len(joined) < MIN_NEEDLE:
        return None
    return hashlib.sha256(("forget2\x1f" + joined).encode("utf-8")).hexdigest()[:32]


def chash(text: str) -> str | None:
    """Eski cümle özeti (mezar kaydı içerik taşımaz). Kısa parçalar özetlenmez."""
    n = norm(text)
    if len(n) < MIN_NEEDLE:
        return None
    return hashlib.sha256(("forget\x1f" + n).encode("utf-8")).hexdigest()[:32]


def chashes(text: str) -> frozenset[str]:
    """Cümlenin iki özeti: eski norm + biçimden bağımsız jeton özeti. kısa metinde önbellekli."""
    text = str(text or "")
    return _chashes_cached(text) if len(text) <= CACHE_TEXT_MAX else _chashes(text)


@lru_cache(maxsize=4096)
def _chashes_cached(text: str) -> frozenset[str]:
    return _chashes(text)


def _chashes(text: str) -> frozenset[str]:
    return frozenset(h for h in (chash(text), _tok_hash(tokens(text))) if h)


def key_hash(type_name: str, key: str) -> str:
    return hashlib.sha256(f"{type_name}\x1f{key}".encode("utf-8")).hexdigest()[:32]


def _parts(n: str) -> list[str]:
    return [n, *_SPLIT_RE.split(str(n or ""))[::2]]


def content_hashes(needles: Iterable[str], salt: str | None = None) -> set[str]:
    """Mezar kaydı özetleri: cümle/parça özetleri + tuzlu jeton zinciri özetleri. `salt` kayıt başına
    rastgele zincir tuzu (yoksa eski sabit `SHINGLE_SALT`)."""
    needles = list(needles)
    out: set[str] = set()
    for n in needles:
        for part in _parts(n):
            out |= chashes(part)
    return out | content_shingles(needles, salt)


def content_lens(needles: Iterable[str]) -> list[int]:
    """İğnelerin jeton uzunlukları (mezar kaydında kayan pencere eşlemesi için; içerik taşımaz)."""
    out: set[int] = set()
    for n in needles:
        for part in _parts(n):
            toks = tokens(part)
            if _tok_hash(toks):
                out.add(len(toks))
    return sorted(out)


def _widen(s: str, a: int, b: int) -> tuple[int, int]:
    """Karartma aralığını bitişik vurgu işaretleriyle genişletir (`**gizli**` → işaret artığı kalmasın)."""
    while a > 0 and s[a - 1] in _WRAP:
        a -= 1
    while b < len(s) and s[b] in _WRAP:
        b += 1
    return a, b


PARTIAL_MIN_TOKENS = 6       # metnin ORTASINDAKİ parça (kenar değil) en az bu kadar jetonla eşleşmeli
SHINGLE = PARTIAL_MIN_TOKENS  # mezar kaydındaki tuzlu jeton zinciri özetlerinin uzunluğu


SHINGLE_SALT = "forget-sh/v1"  # alan ayırıcı tuz (cümle özetleriyle aynı model; özet yalnız içerikle eşleşir)


def _shingle_hash(toks: Iterable[str], tag: str = "", salt: str | None = None) -> str:
    """yeni mezar kayıtlarında `salt` kayıt başına rastgeledir (`shingle_salt`); eski kayıtlar sabit tuzla
    okunmaya devam eder. önbellekli (ön süzgeç ve tam eşleme aynı pencereyi bir kez özetler)."""
    return _shingle_hash_t(tuple(toks), tag, salt)


@lru_cache(maxsize=65536)
def _shingle_hash_t(toks: tuple[str, ...], tag: str, salt: str | None) -> str:
    head = (salt or SHINGLE_SALT) + ("\x1f" + tag if tag else "")
    return hashlib.sha256((head + "\x1f" + " ".join(toks)).encode("utf-8")).hexdigest()[:24]


@lru_cache(maxsize=4096)
def anchor_sentinel(salt: str | None = None) -> str:
    return _shingle_hash(("\x00anchored-v1",), salt=salt)


# yeni mezar kayıtları iğnenin BAŞ ("^") ve SON ("$") pencerelerini ayrıca etiketli özetler; bu işaret özeti
# varsa eşleyici "kesik" kuralını uygular (eski kayıtlarda kural yok: geriye uyum).
ANCHOR_SENTINEL = _shingle_hash(("\x00anchored-v1",))


@lru_cache(maxsize=65536)
def _distinct(tok: str) -> bool:
    """Ayırt edici jeton: harf + rakam karışımı (kod, kimlik) ya da en az 6 haneli sayı (hesap/telefon). Böyle bir jeton
    taşıyan kısa (≥ `CLIP_MIN_TOKENS`) parça rastlantıyla başka metinde geçmez; metnin ortasında da karartılır."""
    has_digit = any(c.isdigit() for c in tok)
    return has_digit and (len(tok) >= 6 if tok.isdigit() else len(tok) >= 4 and any(c.isalpha() for c in tok))


def _short_ok(win: Iterable[str]) -> bool:
    return any(_distinct(w) for w in win)


def content_shingles(needles: Iterable[str], salt: str | None = None) -> set[str]:
    """iğnelerin `SHINGLE` jetonluk bütün kayan pencerelerinin (ve ayırt edici jeton taşıyan `CLIP_MIN_TOKENS`
    jetonluk pencerelerinin) tuzlu özetleri (içerik taşımaz; mezar kaydının `hashes` listesine girer). Yalnız mezar
    kaydıyla çalışan eşleyici (geri al, yeniden uygula, yazma kapısı, koşu sonu kancası) kırpılmış/yarım tek parçayı da
    bunlarla bulur."""
    out: set[str] = set()
    for n in needles:
        for part in _parts(n):
            for toks in token_streams(part):
                words = [t for t, _a, _b in toks]
                for size in (SHINGLE, CLIP_MIN_TOKENS):
                    for i in range(len(words) - size + 1):
                        win = words[i:i + size]
                        if len(" ".join(win)) >= MIN_NEEDLE and (size == SHINGLE or _short_ok(win)):
                            out.add(_shingle_hash(win, salt=salt))
                            if size == SHINGLE and i == 0:
                                out.add(_shingle_hash(win, "^", salt))
                            if size == SHINGLE and i == len(words) - size:
                                out.add(_shingle_hash(win, "$", salt))
    if out:
        out.add(anchor_sentinel(salt))
    return out


def _tspan(toks: list[tuple[str, int, int]], i: int, j: int) -> tuple[int, int]:
    """toks[i..j] (dahil) özgün metin aralığı (nitelik satırı eşlemesi sırayı bozabilir: min/maks)."""
    seg = toks[i:j + 1]
    return min(a for _t, a, _b in seg), max(b for _t, _a, b in seg)


class Matcher:
    """Unutulan içeriği bulur ve karartır (biçimden bağımsız):
    - düz metin iğneleri (uygulama anında): ham alt dize + normal jeton dizisi, metin/satır kenarında kırpılmış uç,
      metnin ortasında en az `PARTIAL_MIN_TOKENS` jetonluk ardışık dilim,
    - cümle özetleri (mezar kaydı): cümle parçaları, (uzunluklar verildiyse) kayan jeton pencereleri ve tuzlu
      jeton zinciri özetleri,
    - jeton kipi: `terms` düz terimler (uygulama anı) ve `token_recs` mezar kaydı jeton özetleri
      ({salt, hashes, lens}); her terim metnin her yerinde tek başına bir iğnedir.
 "kesik" kuralı: ayırt edici jeton taşımayan KISMİ eşleşme yalnız iğnenin devam ettiği yönde bir kesik
    (metin/satır/parça kenarı ya da üç nokta) varsa karartılır; satır kenarında kırpılmış uç ayrıca en az
    `PARTIAL_MIN_TOKENS` jeton, yarım kelime ya da üç nokta ister. Başka cümlenin ortak bir öbeği karartılmaz."""

    def __init__(self, needles: Iterable[str] = (), hashes: Iterable[str] = (), lens: Iterable[int] = (), *,
                 terms: Iterable[str] = (), token_recs: Iterable[dict[str, Any]] = (),
                 shingle_salt: str | None = None, kw_terms: Iterable[str] = (), amount_ok: Iterable[str] = ()):
        self.ssalt = shingle_salt or None  # kayıt başına zincir tuzu (None = eski sabit tuz)
        needles = [str(n) for n in needles if len(norm(n)) >= MIN_NEEDLE]
        uniq = sorted({" ".join(n.split()) for n in needles}, key=len, reverse=True)
        parts = [r"\s+".join(re.escape(w) for w in n.split()) for n in uniq]
        self.rx = re.compile("|".join(parts), re.I) if parts else None
        self.seqs: dict[str, list[tuple[str, ...]]] = {}
        for n in needles:
            for part in _parts(n):
                for stream in token_streams(part):
                    toks = tuple(t for t, _a, _b in stream)
                    if toks and _tok_hash(toks):
                        lst = self.seqs.setdefault(toks[0], [])
                        if toks not in lst:
                            lst.append(toks)
        for lst in self.seqs.values():
            lst.sort(key=len, reverse=True)
        self.hashes = set(hashes)
        self.anchored = anchor_sentinel(self.ssalt) in self.hashes
        self.lens = sorted({int(x) for x in lens if int(x) > 0}, reverse=True)
        self._pindex: dict[str, list[tuple[tuple[str, ...], int]]] | None = None
        self._tindex: dict[tuple[str, ...], list[tuple[tuple[str, ...], int]]] | None = None
        self._maxlen = max((len(q) for lst in self.seqs.values() for q in lst), default=0)
        self.tseqs: dict[str, list[tuple[str, ...]]] = {}
        # kanonik terim → (ayraçla birleşik eşleşmeye izin var mı, tam yazım anahtarları)
        self.tinfo: dict[str, tuple[bool, set[str]]] = {}
        for t in terms:
            q = user_seq(t)
            if not q:
                continue
            if q not in self.tseqs.get(q[0], []):
                self.tseqs.setdefault(q[0], []).append(q)
            c = "".join(q)
            loose, xs = self.tinfo.get(c, (len(c) >= LOOSE_MIN, set()))
            xs.add(term_exact(t))
            self.tinfo[c] = (loose, xs)
        self.tcanon: set[str] = set(self.tinfo)   # kanonik (ayraçsız) terimler
        # tutar biçimiyle ("900.000 TL") eşleşmesine kullanıcının izin verdiği sayısal terimler
        self.amt_ok: set[str] = {c for c in (term_canon(t) for t in amount_ok) if c}
        # yalnız anahtar sözcükten sonra eşlenen kısa sayılar (PIN, yıl …): "PIN 4417" evet, "4417 adet" hayır
        self.kwcanon: set[str] = {c for c in (term_canon(t) for t in kw_terms) if c}
        for lst in self.tseqs.values():
            lst.sort(key=len, reverse=True)
        # (tuz, özetler, jeton sayıları, kanonik uzunluklar | None = eski kayıt, tam yazım özetleri | None =
        # öncesi kayıt, anahtar sözcüklü değer özetleri)
        self.trecs: list[tuple[str, set[str], list[int], set[int] | None, set[str] | None, set[str]]] = []
        for r in token_recs or ():
            if isinstance(r, dict) and r.get("salt") and (r.get("hashes") or r.get("kwh")):
                lens = sorted({int(x) for x in r.get("lens") or (1,) if int(x) > 0}, reverse=True)
                clens = {int(x) for x in r["clens"] if int(x) > 0} if isinstance(r.get("clens"), list) else None
                if clens is None and 1 not in lens:
                    clens = set()  # eski kayıt tek jetonlu özet taşımıyor: kanonik eşleme yapılamaz
                xh = set(r["xh"]) if isinstance(r.get("xh"), list) else None
                amt = set(r["amt"]) if isinstance(r.get("amt"), list) else None  # None = öncesi kayıt
                self.trecs.append((str(r["salt"]), set(r.get("hashes") or ()), lens, clens, xh,
                                   set(r.get("kwh") or ()), amt))
        self._cmax = max([len(c) for c in self.tcanon] + [max(rec[3]) for rec in self.trecs if rec[3]]
                         + [CANON_OLD_MAX for rec in self.trecs if rec[3] is None], default=0)
        self._kw = bool(self.kwcanon) or any(rec[5] for rec in self.trecs)

    def __bool__(self) -> bool:
        return bool(self.rx or self.seqs or self.hashes or self.tseqs or self.trecs or self.kwcanon)

    @property
    def has_tokens(self) -> bool:
        return bool(self.tseqs or self.trecs or self.kwcanon)

    # ---- dizinler (tembel)
    def _part_index(self) -> dict[str, list[tuple[tuple[str, ...], int]]]:
        if self._pindex is None:
            index: dict[str, list[tuple[tuple[str, ...], int]]] = {}
            for lst in self.seqs.values():
                for q in lst:
                    for p, w in enumerate(q):
                        index.setdefault(w, []).append((q, p))
            self._pindex = index
        return self._pindex

    def _tail_index(self) -> dict[tuple[str, ...], list[tuple[tuple[str, ...], int]]]:
        """Metin/satır BAŞINDA kırpılmış son parça: anahtar = parçanın (yarım ilk sözcükten sonraki) ilk 3 jetonu."""
        if self._tindex is None:
            index: dict[tuple[str, ...], list[tuple[tuple[str, ...], int]]] = {}
            for lst in self.seqs.values():
                for q in lst:
                    for k in range(CLIP_MIN_TOKENS, len(q)):
                        key = q[len(q) - k + 1:len(q) - k + CLIP_MIN_TOKENS]
                        index.setdefault(key, []).append((q, k))
            self._tindex = index
        return self._tindex

    # ---- kesik sınırları
    @staticmethod
    def _cut_gap(gap: str) -> bool:
        return "\n" in gap or "…" in gap or "..." in gap

    def _cut_left(self, s: str, toks: list[tuple[str, int, int]], i: int) -> bool:
        return i <= 0 or self._cut_gap(s[toks[i - 1][2]:toks[i][1]])

    def _cut_right(self, s: str, toks: list[tuple[str, int, int]], j: int) -> bool:
        return j >= len(toks) - 1 or self._cut_gap(s[toks[j][2]:toks[j + 1][1]])

    # ---- eşleme
    def _spans(self, s: str) -> list[tuple[int, int]]:
        spans: list[tuple[int, int]] = []
        for toks in token_streams(s):
            if toks:
                spans += self._spans_toks(s, toks)
        spans += self._token_spans(s)
        return spans

    def _token_spans(self, s: str) -> list[tuple[int, int]]:
        """seçili jetonların/terimlerin her bağımsız geçişi (jeton kipi akışında; URL ve kod dahil)."""
        return [(a, b) for a, b, _x in self.term_hits(s)]

    def term_hits(self, s: str) -> list[tuple[int, int, bool]]:
        """seçili terimlerin geçişleri → [(başlangıç, bitiş, tam yazım mı)] (özgün metinde; en uzun eşleşme).
        Kural: harf/rakam dizileri arasında yalnız ayraç (`_sep_gap`, cümle sınırı değil) varsa birleşimleri kanonik
        terimle karşılaştırılır; `LOOSE_MIN` altındaki terim yalnız TAM yazımıyla (aynı jetonlar, aynı ayraç biçimi;
        büyük/küçük harf ve normalleştirme farkı serbest) eşleşir. Anahtar sözcüklü kısa sayılar (`kw_terms`, kayıttaki
        `kwh`) yalnız anahtar sözcükten sonra eşleşir."""
        s = str(s or "")
        out: list[tuple[int, int, bool]] = []
        if not s:
            return out
        if self.tinfo or self.trecs:
            toks, join, gaps = canon_gaps(s)
            words = [t for t, _a, _b in toks]
            n = len(words)
            i = 0
            while i < n:
                best, exact = self._hit_at(words, join, gaps, i)
                if best >= 0:
                    out.append((*_widen(s, *_tspan(list(toks), i, best)), exact))
                    i = best + 1
                else:
                    i += 1
        if self._kw:
            for a, b, raw in _keyword_values(s):
                c = term_canon(raw)
                if c and (c in self.kwcanon or any(kwh and token_hash(rec[0], (c,)) in kwh
                                                   for rec in self.trecs for kwh in (rec[5],))):
                    out.append((*_widen(s, a, b), True))
        return out

    def _hit_at(self, words: list[str], join: Any, gaps: Any, i: int) -> tuple[int, bool]:
        """words[i]'de başlayan en uzun eşleşmenin son jetonu (-1 = yok) ve tam yazım olup olmadığı."""
        n = len(words)
        best, best_x = -1, False
        for salt, hs, lens, _cl, xh, _k, _amt in self.trecs:  # öncesi kayıt: eski jeton dizisi eşlemesi
            if xh is not None:
                continue
            for L in lens:
                if i + L <= n and all(join[i:i + L - 1]) and token_hash(salt, words[i:i + L]) in hs \
                        and i + L - 1 > best:
                    best, best_x = i + L - 1, True
        if not self._cmax:
            return best, best_x
        cat = ""
        j = i
        while j < n:
            cat += words[j]
            if len(cat) > self._cmax:
                break
            ok, x = self._canon_ok(words, gaps, i, j, cat)
            if ok and j >= best:
                best, best_x = j, x or (best_x and j == best)
            if j >= n - 1 or not join[j]:
                break
            j += 1
        return best, best_x

    def _canon_ok(self, words: list[str], gaps: Any, i: int, j: int, cat: str) -> tuple[bool, bool]:
        """words[i..j] (yalnız ayraçlarla ayrılmış; birleşimi `cat`) bir terimle eşleşiyor mu →
        (eşleşme, tam yazım). Eşleşme jeton sınırında başlar ve biter ("a7" ↛ "a7x")."""
        info = self.tinfo.get(cat)
        key: str | None = None
        if info is not None:
            loose, xs = info
            key = exact_key(words, gaps, i, j)
            if key in xs:
                return True, True
            if loose and not (cat.isdigit() and cat not in self.amt_ok and _amount_shape(words, gaps, i, j)):
                return True, False
        L = len(cat)
        for salt, hs, _lens, cl, xh, _k, amt in self.trecs:
            if not (L in cl if cl is not None else L <= CANON_OLD_MAX) or token_hash(salt, (cat,)) not in hs:
                continue
            if xh is None:
                return True, True  # öncesi kayıt: eski kural (ayraçla birleşik de tam sayılır)
            if key is None:
                key = exact_key(words, gaps, i, j)
            if token_hash(salt, (X_TAG, key)) in xh:
                return True, True
            if L >= LOOSE_MIN:
                if amt is not None and cat.isdigit() and token_hash(salt, (AMT_TAG, cat)) not in amt                         and _amount_shape(words, gaps, i, j):
                    continue  # tutar biçimi (izin yoksa)
                return True, False
        return False, False

    def strict_hit(self, s: str) -> bool:
        """metinde tam yazımlı (ya da anahtar sözcüklü) bir terim geçişi var mı."""
        return any(x for _a, _b, x in self.term_hits(s))

    def contains_term(self, s: str) -> bool:
        """metin seçili bir jetonu/terimi içeriyor mu."""
        return bool(self._token_spans(str(s or "")))

    def _spans_toks(self, s: str, toks: list[tuple[str, int, int]]) -> list[tuple[int, int]]:
        words = [t for t, _a, _b in toks]
        spans: list[tuple[int, int]] = []
        if self.seqs:
            i = 0
            while i < len(words):
                hit = 0
                for seq in self.seqs.get(words[i], ()):
                    if tuple(words[i:i + len(seq)]) == seq:
                        hit = len(seq)
                        break
                if hit:
                    spans.append(_widen(s, *_tspan(toks, i, i + hit - 1)))
                    i += hit
                else:
                    i += 1
            spans += self._clipped(s, toks, words, 0, len(s))
            spans += self._line_clips(s, toks)
            spans += self._partial_toks(s, toks, words, PARTIAL_MIN_TOKENS)
        if self.hashes and self.lens:
            for L in self.lens:
                for i in range(0, len(words) - L + 1):
                    if _tok_hash(words[i:i + L]) in self.hashes:
                        spans.append(_widen(s, *_tspan(toks, i, i + L - 1)))
        if self.hashes:
            spans += self._shingle_spans(s, toks, words)
        return spans

    def _shingle_spans(self, s: str, toks: list[tuple[str, int, int]], words: list[str]) -> list[tuple[int, int]]:
        """ardışık tuzlu pencere isabetlerinin kapsadığı jeton dizileri (en az `SHINGLE` jeton). işaretli
        (yeni) mezar kayıtlarında ayırt edici jeton taşımayan bölge, iğnenin baş/son penceresi değilse o yönde kesik
        ister (başka cümlenin ortak öbeği karartılmaz)."""
        n = len(words)
        if n < CLIP_MIN_TOKENS:
            return []
        marked = [False] * n
        short = [False] * n
        hit = False
        for i in range(n - SHINGLE + 1):
            if _shingle_hash(words[i:i + SHINGLE], salt=self.ssalt) in self.hashes:
                hit = True
                for j in range(i, i + SHINGLE):
                    marked[j] = True
        for i in (i for i, w in enumerate(words) if _distinct(w)):  # kısa pencere: yalnız ayırt edici jetonun çevresi
            for a in range(max(0, i - CLIP_MIN_TOKENS + 1), min(i, n - CLIP_MIN_TOKENS) + 1):
                if _shingle_hash(words[a:a + CLIP_MIN_TOKENS], salt=self.ssalt) in self.hashes:
                    hit = True
                    for j in range(a, a + CLIP_MIN_TOKENS):
                        marked[j] = True
                        short[j] = True
        if not hit:
            return []
        out: list[tuple[int, int]] = []
        i = 0
        while i < n:
            if not marked[i]:
                i += 1
                continue
            j = i
            while j + 1 < n and marked[j + 1]:
                j += 1
            if self.anchored and not any(short[i:j + 1]) and not _short_ok(words[i:j + 1]):
                head = j - i + 1 >= SHINGLE and _shingle_hash(words[i:i + SHINGLE], "^", self.ssalt) in self.hashes
                tail = j - i + 1 >= SHINGLE and \
                    _shingle_hash(words[j - SHINGLE + 1:j + 1], "$", self.ssalt) in self.hashes
                if not ((head or self._cut_left(s, toks, i)) and (tail or self._cut_right(s, toks, j))):
                    i = j + 1
                    continue
            out.append(_widen(s, *_tspan(toks, i, j)))
            i = j + 1
        return out

    def _partial_spans(self, s: str) -> list[tuple[int, int]]:
        """iğnenin ardışık bir dilimiyle (en az `CLIP_MIN_TOKENS` jeton ve `MIN_NEEDLE` karakter) aynı jeton dizileri.
        Yalnız parça penceresinde kullanılır (parça sınırını aşan eşleşme): önceki bir unutma cümlenin bir parçasını
        karartmış olsa bile kalan parçalar bulunur."""
        out: list[tuple[int, int]] = []
        for toks in token_streams(s):
            out += self._partial_toks(s, toks, [t for t, _a, _b in toks], CLIP_MIN_TOKENS)
        return out

    def _partial_toks(self, s: str, toks: list[tuple[str, int, int]], words: list[str],
                      min_k: int) -> list[tuple[int, int]]:
        if not self.seqs:
            return []
        index = self._part_index()
        out: list[tuple[int, int]] = []
        i = 0
        while i < len(words):
            best = 0
            for q, p in index.get(words[i], ()):
                k = 0
                while i + k < len(words) and p + k < len(q) and words[i + k] == q[p + k]:
                    k += 1
                distinct = k >= CLIP_MIN_TOKENS and _short_ok(q[p:p + k])
                ok = k >= min_k or distinct  # ayırt edici kısa parça
                if ok and not distinct and k < len(q):
                    # kesik kuralı — iğne solda devam ediyorsa solda, sağda devam ediyorsa sağda kesik olmalı
                    ok = (p == 0 or self._cut_left(s, toks, i)) and \
                        (p + k == len(q) or self._cut_right(s, toks, i + k - 1))
                if ok and len(" ".join(q[p:p + k])) >= MIN_NEEDLE:
                    best = max(best, k)
            if best:
                out.append(_widen(s, *_tspan(toks, i, i + best - 1)))
                i += best
            else:
                i += 1
        return out

    def _line_clips(self, s: str, toks: list[tuple[str, int, int]]) -> list[tuple[int, int]]:
        """satır kenarları da kırpma sınırıdır (yarım cümle bir satırın sonunda ya da başında)."""
        if "\n" not in s or len(toks) < CLIP_MIN_TOKENS:
            return []
        bounds = [m.start() for m in _NL_RE.finditer(s)]
        lines: dict[int, list[tuple[str, int, int]]] = {}
        for t in toks:
            lines.setdefault(bisect.bisect_right(bounds, t[1]), []).append(t)
        if len(lines) < 2:
            return []
        out: list[tuple[int, int]] = []
        for idx, seg in lines.items():
            if len(seg) < CLIP_MIN_TOKENS:
                continue
            lo = bounds[idx - 1] + 1 if idx > 0 else 0
            hi = bounds[idx] if idx < len(bounds) else len(s)
            out += self._clipped(s, seg, [t for t, _a, _b in seg], lo, hi, line=True)
        return out

    def _clipped(self, s: str, toks: list[tuple[str, int, int]], words: list[str], lo: int,
                 hi: int, line: bool = False) -> list[tuple[int, int]]:
        """Kırpılmış özetler (`…` ile biten teslim/mesaj özeti, kesilmiş başlangıç): [lo, hi) aralığının (metin ya da satır)
        SONUNDA bir iğnenin başı ya da BAŞINDA sonu en az `CLIP_MIN_TOKENS` jetonla (son/ilk jeton yarım kelime olabilir)
        eşleşirse o parça karartılır. (`line`): satır kenarında ayrıca en az `PARTIAL_MIN_TOKENS` jeton, ayırt
        edici jeton, yarım kelime ya da kesikte üç nokta gerekir ("- Toplantı yarın saat 10" gibi tam kelimeli kısa
        öbek başka bir cümlenin parçasıdır)."""
        out: list[tuple[int, int]] = []
        n = len(words)
        if n < CLIP_MIN_TOKENS or not self.seqs:
            return out

        def strong(part: tuple[str, ...], partial_word: bool, gap: str) -> bool:
            return not line or len(part) >= PARTIAL_MIN_TOKENS or _short_ok(part) or partial_word or \
                "…" in gap or "..." in gap

        for i in range(max(0, n - self._maxlen), n - CLIP_MIN_TOKENS + 1):
            k = n - i
            for q in self.seqs.get(words[i], ()):
                if k <= len(q) and tuple(words[i:n - 1]) == q[:k - 1] and q[k - 1].startswith(words[n - 1]) \
                        and len(" ".join(q[:k])) >= MIN_NEEDLE \
                        and strong(q[:k], words[n - 1] != q[k - 1], s[toks[n - 1][2]:hi]):
                    a, b = _widen(s, *_tspan(toks, i, n - 1))
                    out.append((a, hi if _EDGE_FILL_RE.fullmatch(s[b:hi]) else b))  # JSON yapısı yutulmaz
                    break
            else:
                continue
            break
        best: dict[tuple[str, ...], int] = {}
        for q, k in self._tail_index().get(tuple(words[1:CLIP_MIN_TOKENS]), ()):
            if k <= n and k > best.get(q, 0) and tuple(words[1:k]) == q[len(q) - k + 1:] \
                    and q[len(q) - k].endswith(words[0]) and len(" ".join(q[len(q) - k:])) >= MIN_NEEDLE \
                    and strong(q[len(q) - k:], words[0] != q[len(q) - k], s[lo:toks[0][1]]):
                best[q] = k
        for k in best.values():
            a, b = _widen(s, *_tspan(toks, 0, k - 1))
            out.append((lo if _EDGE_FILL_RE.fullmatch(s[lo:a]) else a, b))
        return out

    def text(self, s: str) -> tuple[str, int]:
        if not s or not isinstance(s, str):
            return s, 0
        n = 0
        if self.rx is not None:
            s, n = self.rx.subn(MARK, s)
        spans = self._spans(s)
        if spans:
            spans.sort()
            merged: list[list[int]] = []
            for a, b in spans:
                if merged and a <= merged[-1][1]:
                    merged[-1][1] = max(merged[-1][1], b)
                else:
                    merged.append([a, b])
            for a, b in reversed(merged):
                if s[a:b] != MARK:
                    s = s[:a] + MARK + s[b:]
                    n += 1
        if self.hashes:
            pieces = _SPLIT_RE.split(s)
            hit = 0
            for i in range(0, len(pieces), 2):
                if pieces[i] and pieces[i] != MARK and chashes(pieces[i]) & self.hashes:
                    pieces[i] = MARK
                    hit += 1
            if hit:
                s = "".join(pieces)
                n += hit
        if (self.seqs or self.hashes or self.tseqs or self.trecs or self.kwcanon) and s.lstrip()[:1] in ("{", "[") \
                and len(s) <= JSON_SCAN_MAX:
            # JSON metni olarak saklanan araç girdisi/çıktısı çözülmüş biçimiyle de taranır (alan değerleri)
            try:
                obj = json.loads(s)
            except ValueError:
                obj = None
            if isinstance(obj, (dict, list)):
                new, c = self.value(obj)
                if c:
                    s = json.dumps(new, ensure_ascii=False)
                    n += c
        return s, n

    def contains(self, s: str) -> bool:
        """metin bir iğnenin TAM jeton dizisini içeriyor mu (kısmi/kırpılmış eşleşme sayılmaz)."""
        if not self.seqs or not s:
            return False
        for toks in token_streams(s):
            words = [t for t, _a, _b in toks]
            for i, w in enumerate(words):
                for seq in self.seqs.get(w, ()):
                    if tuple(words[i:i + len(seq)]) == seq:
                        return True
        return False

    def value(self, v: Any, skip: frozenset[str] = KEEP_KEYS,
              rename: frozenset[str] = RENAME_KEYS) -> tuple[Any, int]:
        """JSON değerinde derin karartma → (yeni değer, eşleşme sayısı). kimlik alanları korunur; ancak
        `rename` (ad/slug) değeri unutulan içerik taşıyorsa nötr ve deterministik bir ada çevrilir (`neutral_name`)."""
        if isinstance(v, str):
            return self.text(v)
        if isinstance(v, dict):
            total, out = 0, {}
            for k, x in v.items():
                if k in skip and not isinstance(x, (dict, list)):
                    if k in rename and isinstance(x, str) and x and self.text(x)[1]:
                        out[k] = neutral_name(x)
                        total += 1
                    else:
                        out[k] = x
                    continue
                out[k], c = self.value(x, skip, rename)
                total += c
            return (out, total) if total else (v, 0)
        if isinstance(v, list):
            total, items = 0, []
            for x in v:
                y, c = self.value(x, skip, rename)
                items.append(y)
                total += c
            return (items, total) if total else (v, 0)
        return v, 0


class Probe:
    """yazma kapısında bir metnin jetonları BİR KEZ çıkarılır; her mezar kaydı yalnız özet kümesi kesişimine
    bakar (`Matcher.may_hit`). Önbellek: tuzsuz pencere özetleri, cümle parça özetleri, tuz başına zincir ve jeton
    özetleri. Ön süzgeç kesin bir üst kümedir (isabet yoksa tam eşleyici de bulamaz); isabette tam yol çalışır."""

    def __init__(self, text: str):
        self.s = str(text or "")
        self.streams = [[t for t, _a, _b in toks] for toks in token_streams(self.s)]
        ctoks, self.join = canon_stream(self.s)
        self.cwords = [t for t, _a, _b in ctoks]
        self.json = self.s.lstrip()[:1] in ("{", "[")
        self._tok: dict[int, set[str]] = {}
        self._sh: dict[str | None, set[str]] = {}
        self._ch: set[str] | None = None
        self._kwc: set[str] | None = None

    def chashes(self) -> set[str]:
        if self._ch is None:
            self._ch = set()
            for p in _SPLIT_RE.split(self.s)[::2]:
                if p:
                    self._ch |= chashes(p)
        return self._ch

    def tok_hashes(self, L: int) -> set[str]:
        if L not in self._tok:
            out: set[str] = set()
            for w in self.streams:
                for i in range(len(w) - L + 1):
                    h = _tok_hash(w[i:i + L])
                    if h:
                        out.add(h)
            self._tok[L] = out
        return self._tok[L]

    def shingles(self, salt: str | None) -> set[str]:
        if salt not in self._sh:
            out: set[str] = set()
            for w in self.streams:
                n = len(w)
                for i in range(n - SHINGLE + 1):
                    out.add(_shingle_hash(w[i:i + SHINGLE], salt=salt))
                for i in (i for i, x in enumerate(w) if _distinct(x)):  # kısa pencere: eşleyicideki gibi
                    for a in range(max(0, i - CLIP_MIN_TOKENS + 1), min(i, n - CLIP_MIN_TOKENS) + 1):
                        out.add(_shingle_hash(w[a:a + CLIP_MIN_TOKENS], salt=salt))
            self._sh[salt] = out
        return self._sh[salt]

    def token_hit(self, salt: str, hs: set[str], lens: list[int], cl: set[int] | None, _xh: Any = None,
                  kwh: set[str] | None = None, _amt: Any = None) -> bool:
        if kwh:  # anahtar sözcüklü değerler (ön süzgeç: yalnız özet karşılaştırması)
            if self._kwc is None:
                self._kwc = {term_canon(raw) for _a, _b, raw in _keyword_values(self.s)}
            if any(c and token_hash(salt, (c,)) in kwh for c in self._kwc):
                return True
        w, n = self.cwords, len(self.cwords)
        for L in lens:
            for i in range(n - L + 1):
                if token_hash(salt, w[i:i + L]) in hs:
                    return True
        cmax = max(cl) if cl else (CANON_OLD_MAX if cl is None else 0)
        for i in range(n):
            cat = ""
            for j in range(i, n):
                cat += w[j]
                if len(cat) > cmax:
                    break
                if (len(cat) in cl if cl is not None else True) and token_hash(salt, (cat,)) in hs:
                    return True
                if j >= n - 1 or not self.join[j]:
                    break
        return False


def _may_hit(m: Matcher, probe: Probe) -> bool:
    """ön süzgeç (bkz. `Probe`)."""
    if probe.json or m.rx is not None or m.seqs or m.tseqs or m.kwcanon:
        return True
    if m.hashes:
        if probe.chashes() & m.hashes or probe.shingles(m.ssalt) & m.hashes:
            return True
        for L in m.lens:
            if probe.tok_hashes(L) & m.hashes:
                return True
    return any(probe.token_hit(*rec) for rec in m.trecs)


Matcher.may_hit = _may_hit  # type: ignore[attr-defined]


class _Chain:
    """farklı zincir tuzlu mezar kayıtlarının eşleyicileri sırayla (geri al: hâlâ etkin kayıtlar)."""

    def __init__(self, ms: list[Matcher]):
        self.ms = [m for m in ms if m]

    def __bool__(self) -> bool:
        return bool(self.ms)

    def text(self, s: str) -> tuple[str, int]:
        n = 0
        for m in self.ms:
            s, c = m.text(s)
            n += c
        return s, n

    def value(self, v: Any, skip: frozenset[str] = KEEP_KEYS, rename: frozenset[str] = RENAME_KEYS) -> tuple[Any, int]:
        n = 0
        for m in self.ms:
            v, c = m.value(v, skip, rename)
            n += c
        return v, n


_EDGE_FILL_RE = re.compile(r"[\s.…,;:!?*_~`>#+\-–—•·|()\[\]]*")


def neutral_name(value: str) -> str:
    """unutulan içerik taşıyan ad/slug → `unutuldu-<özet>[.<uzantı>]` (deterministik: aynı eski ad her kayıtta
    aynı yeni ada gider, başvurular tutarlı kalır; özet içerik taşımaz)."""
    m = re.match(r"^(.*?)(\.[A-Za-z0-9]{1,8})?$", value, re.S)
    ext = (m.group(2) or "") if m else ""
    return "unutuldu-" + hashlib.sha256(("forget-name/v1\x1f" + value).encode("utf-8")).hexdigest()[:12] + ext


# ------------------------------------------------------------------ parçalara bölünmüş cümle
# Aynı adımın ardışık parça olayları (araç sonucu çıktıları, akış parçaları) birleşik bir pencerede de taranır. Cümle
# birden çok parçaya yayılıyorsa (≥ 2; ortadaki parça tek başına iğne taşısa bile hiçbir uca dokunmayabilir) eşleşmenin
# dokunduğu HER parçanın ilgili bölümü karartılır.
# pencere tür sınırını da aşar — araç çıktısının sonu ile son yanıtın başı (akış parçası ya da adım bitişi
# çıktısı) aynı adımın ardışık parçaları sayılır; cümle araç çıktısı → yanıt sınırında bölünse de bulunur.
CHUNK_FIELDS = {"step.tool_result": "output", "step.delta": "text", "step.finished": "output"}


def _apply_spans(s: str, spans: list[tuple[int, int]]) -> str:
    merged: list[list[int]] = []
    for a, b in sorted(spans):
        if merged and a <= merged[-1][1]:
            merged[-1][1] = max(merged[-1][1], b)
        else:
            merged.append([a, b])
    for a, b in reversed(merged):
        s = s[:a] + MARK + s[b:]
    return s


def _chunk_spans(m: Matcher, texts: list[str]) -> dict[int, list[tuple[int, int]]]:
    """Ardışık parçalarda birden çok parçaya yayılan eşleşmeler → {parça sırası: [yerel aralık]}."""
    out: dict[int, list[tuple[int, int]]] = {}
    n = len(texts)
    if n < 2 or not m:
        return out
    stride = max(1, CHUNK_WINDOW // 2)
    i = 0
    while i < n - 1:
        win = texts[i:i + CHUNK_WINDOW]
        offs, pos = [], 0
        for t in win:
            offs.append(pos)
            pos += len(t) + 1
        joined = "\n".join(win)
        spans = list(m._spans(joined)) + m._partial_spans(joined)  # noqa: SLF001
        if m.rx is not None:
            spans += [x.span() for x in m.rx.finditer(joined)]
        found = [(offs, a, b) for a, b in spans]
        if m.has_tokens:  # akış parçası sınırında bölünmüş jeton ("QA10NDL" ‖ "7F3BD…") ayraçsız birleşimde bulunur
            offs0, pos = [], 0
            for t in win:
                offs0.append(pos)
                pos += len(t)
            found += [(offs0, a, b) for a, b in m._token_spans("".join(win))]  # noqa: SLF001
        for base, a, b in found:
            hit = [k for k in range(len(win)) if base[k] < b and base[k] + len(win[k]) > a]
            if len(hit) < 2:
                continue  # tek parçadaki eşleşmeyi olay başına tarama zaten karartır
            for k in hit:
                la, lb = max(a, base[k]) - base[k], min(b, base[k] + len(win[k])) - base[k]
                if lb > la:
                    out.setdefault(i + k, []).append((la, lb))
        if i + CHUNK_WINDOW >= n:
            break
        i += stride
    return out


def scrub_events(m: Matcher, items: list[tuple[Any, Any, Any, Any]]) -> dict[Any, Any]:
    """Olay yükleri [(anahtar, tür, koşu, veri)] (sıra numarası düzeninde) → {anahtar: karartılmış veri} (değişenler).
    Önce aynı koşu+adım+türün ardışık parçaları birlikte taranır, sonra her olay tek başına."""
    if not m:
        return {}
    groups: dict[tuple[Any, Any], list[tuple[Any, dict[str, Any], str]]] = {}
    for key, typ, run, data in items:
        f = CHUNK_FIELDS.get(str(typ))
        if f and isinstance(data, dict) and isinstance(data.get(f), str):
            groups.setdefault((run, data.get("step")), []).append((key, data, f))
    pre: dict[Any, Any] = {}
    for lst in groups.values():
        for idx, sp in _chunk_spans(m, [d[f] for _k, d, f in lst]).items():
            key, d, f = lst[idx]
            pre[key] = {**d, f: _apply_spans(d[f], sp)}
    out: dict[Any, Any] = {}
    for key, _typ, _run, data in items:
        base = pre.get(key, data)
        new, c = m.value(base)
        if c or key in pre:
            out[key] = new
    return out


def _log_items(rows: Iterable[tuple[int, str]]) -> list[tuple[int, Any, Any, Any]]:
    out = []
    for seq, raw in rows:
        try:
            data = json.loads(raw)
        except (TypeError, ValueError):
            continue
        if isinstance(data, dict):
            out.append((seq, data.get("type"), data.get("run_id"), data))
    return sorted(out, key=lambda x: x[0])


def _run_items(rows: list[dict[str, Any]]) -> list[tuple[int, Any, Any, Any]]:
    rows = sorted(rows, key=lambda r: (str(r["run_id"]), int(r["seq"] or 0), int(r["rowid"])))
    return [(r["rowid"], r["type"], r["run_id"], json.loads(r["data"])) for r in rows]


def _before(a: str, b: str) -> bool:
    """`a` kesin olarak `b`'den önce mi (ISO zamanlar, saat dilimi duyarlı; çözülemezse metin karşılaştırması)."""
    from datetime import datetime, timezone  # noqa: PLC0415

    try:
        da, db = datetime.fromisoformat(a), datetime.fromisoformat(b)
        da = da if da.tzinfo else da.replace(tzinfo=timezone.utc)
        db = db if db.tzinfo else db.replace(tzinfo=timezone.utc)
        return da < db
    except ValueError:
        return a < b


def _keystream(key: bytes, nonce: bytes, n: int) -> bytes:
    """HMAC-SHA256 sayaç kipi anahtar akışı (standart kütüphane; yeni bağımlılık yok)."""
    out = bytearray()
    i = 0
    while len(out) < n:
        out += hmac.new(key, nonce + i.to_bytes(8, "big"), hashlib.sha256).digest()
        i += 1
    return bytes(out[:n])


def _restrict(path: Path) -> None:
    """Yedek ve anahtar dosyası yalnız sahibine açık: POSIX'te 0600; Windows'ta kullanıcı profili altındaki veri
    dizininin miras ACL'si geçerlidir (ek ACL için yeni bağımlılık gerekir; sınırı, önizlemede belirtilir)."""
    if os.name != "nt":
        try:
            os.chmod(path, 0o600)
        except OSError:
            pass


def _mac_input(change_id: str, nonce: bytes, ct: bytes) -> bytes:
    """yedek MAC girdisi = sürüm + değişiklik kimliği (uzunluk önekli) + nonce + şifreli metin."""
    cid = change_id.encode("utf-8")
    return b"forget-backup-v3" + len(cid).to_bytes(2, "big") + cid + nonce + ct


def _sha(obj: Any) -> str:
    raw = obj if isinstance(obj, str) else json.dumps(obj, ensure_ascii=False, sort_keys=True, default=str)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _clip(text: Any, n: int = 90) -> str:
    s = " ".join(str(text or "").split())
    return s if len(s) <= n else s[: n - 1] + "…"


def _iso_from(ts: float) -> str:
    from datetime import datetime, timezone  # noqa: PLC0415

    return datetime.fromtimestamp(ts, timezone.utc).isoformat(timespec="seconds")


# ------------------------------------------------------------------ kapsam toplama
@dataclass
class Scope:
    scope: str
    namespace: str
    target: dict[str, Any]
    delete: dict[str, dict[str, Any]] = field(default_factory=dict)
    concept_ns: dict[str, list[str]] = field(default_factory=dict)   # ortak kavram: yeni ad alanı listesi
    needles: list[str] = field(default_factory=list)
    runs: set[str] = field(default_factory=set)
    siblings: list[str] = field(default_factory=list)  # aynı cümleyi içeren kardeş bilgiler (önizlemede)
    tokens: list[str] = field(default_factory=list)    # seçili jetonlar/terimler (düz metin; yalnız bellekte)
    token_candidates: list[dict[str, Any]] = field(default_factory=list)  # önizlemedeki jeton listesi
    token_facts: list[str] = field(default_factory=list)  # seçili jetonu taşıyan (silinecek) bilgiler
    ns_runs: set[str] = field(default_factory=set)     # ad alanındaki diğer koşular (yalnız jeton taraması)
    rejected: list[str] = field(default_factory=list)  # kabul edilmeyen (çok kısa) kullanıcı terimleri
    base: set[str] = field(default_factory=set)        # jeton genişlemesinden ÖNCEKİ silinecekler ("içeride")
    source_runs: set[str] = field(default_factory=set)  # hedefin kaynak koşuları (ürettikleri "içeride")
    impact: list[dict[str, Any]] | None = None         # varsayılan seçimde hesaplanan jeton etkisi
    # işaretsiz (tutulan/öneri) terimler yalnız "içeride" (hedef + kaynak koşuların kayıtları) karartılır
    scoped: list[str] = field(default_factory=list)     # düz eşleme
    scoped_kw: list[str] = field(default_factory=list)  # yalnız anahtar sözcükten sonra (PIN, yıl …)
    unscoped: list[str] = field(default_factory=list)   # kullanıcının "içeride de karartma" dediği terimler
    sel_kw: list[str] = field(default_factory=list)     # seçili kısa sayılar (bilgi yalnız anahtar sözcükle silinir)
    patch_facts: dict[str, dict[str, Any]] = field(default_factory=dict)   # ayraçla eşleşen → karartılır
    inside_facts: dict[str, dict[str, Any]] = field(default_factory=dict)  # kaynak koşuların bilgileri
    amount_ok: list[str] = field(default_factory=list)  # tutar biçimiyle de eşleşecek sayısal terimler
    unlink_edges: dict[str, dict[str, Any]] = field(default_factory=dict)  # paylaşılan kavramın iç kenarları

    def fingerprint(self) -> str:
        return _sha(sorted((nid, n.get("updated_at"), _sha(n.get("props") or {})) for nid, n in self.delete.items())
                    + sorted((k, v) for k, v in self.concept_ns.items()))


def _runs_of_fact(p: dict[str, Any]) -> set[str]:
    out = {str(p.get("run_id") or "")}
    cb = p.get("created_by")
    if isinstance(cb, dict):
        out.add(str(cb.get("run") or ""))
    for r in p.get("root_evidence_refs") or []:
        if str(r).startswith("run:"):
            out.add(str(r)[4:])
    for s in p.get("source_refs") or []:
        s = str(s)
        if s.startswith("ep:") and s.count(":") >= 3:
            out.add(s[3:].split("#", 1)[0].rsplit(":", 2)[0])
    return {r for r in out if r}


def _user_origin(p: dict[str, Any]) -> bool:
    """kullanıcının yazdığı bilgi (bir koşu onu aynen tekrarlasa da kaynağı kullanıcıdır). YALNIZ
    kullanıcıya ait bilgi uçlarının sunucu tarafında yazdığı köken işaretine bakılır: `created_by.origin == "user"`
 ya da aynı uçların yazdığı `origin == "user_stated"` (eski kayıtlar; bu değeri başka yol yazmaz). Ajan kısa
    adı (`agent`, `created_by.agent`) ya da yazar adı ASLA köken sayılmaz (MCP `user` adlı ajan açsa da)."""
    cb = p.get("created_by") if isinstance(p.get("created_by"), dict) else {}
    return cb.get("origin") == "user" or p.get("origin") == "user_stated"


def _creating_runs(p: dict[str, Any]) -> set[str]:
    """bilgiyi ÜRETEN koşu (`run_id` / `created_by.run`). Sonradan eklenen kanıt başvuruları (aynı önermeyi
    tekrarlayan koşunun terfi/NOOP birleşmesi) kaynak koşu sayılmaz."""
    cb = p.get("created_by") if isinstance(p.get("created_by"), dict) else {}
    return {str(r) for r in (p.get("run_id"), cb.get("run")) if r}


def _fact_component(store: GraphStore, start: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """R-1 terfi bileşeni: aynı ad alanında DERIVED_FROM (iki yön) + promoted_to/promoted_from ile bağlı bilgiler."""
    ns = nsm.of_node(start)
    seen: dict[str, dict[str, Any]] = {start["id"]: start}
    frontier = [start]
    while frontier:
        nxt = []
        for node in frontier:
            linked = [nb for _e, nb, _d in store.neighbors(node["id"], ["DERIVED_FROM"], "both")]
            for pid in (node["props"].get("promoted_to"), node["props"].get("promoted_from")):
                if pid:
                    try:
                        linked.append(store.get_node(str(pid)))
                    except KeyError:
                        pass
            for nb in linked:
                if nb["type"] == "Fact" and nb["id"] not in seen and nsm.of_node(nb) == ns:
                    seen[nb["id"]] = nb
                    nxt.append(nb)
        frontier = nxt
    return seen


def _recall_runs(store: GraphStore, node_ids: Iterable[str]) -> set[str]:
    """Bu düğümleri hatırlayan (istemine almış) adımların koşuları."""
    out: set[str] = set()
    for _nid, items in store.neighbors_many(node_ids, ["RECALLED"], "in").items():
        for _e, step, _d in items:
            if step["type"] == "Step" and step["props"].get("run_id"):
                out.add(str(step["props"]["run_id"]))
    return out


def _orphan_concepts(store: GraphStore, deleted: set[str], candidates: Iterable[str]) -> list[dict[str, Any]]:
    out = []
    for cid, items in store.neighbors_many(candidates, ["ABOUT", "MENTIONS"], "in").items():
        if all(nb["id"] in deleted for _e, nb, _d in items):
            try:
                out.append(store.get_node(cid))
            except KeyError:
                pass
    return out


def _sibling_facts(store: GraphStore, ns: str, statements: list[str], exclude: set[str]) -> list[dict[str, Any]]:
    """aynı ad alanında, unutulan cümlelerden birinin TAM jeton dizisini içeren diğer bilgiler (iddialar dahil;
    biçim farkı — markdown, HTML, varlık, görünmez karakter — eşleşmeyi bozmaz). Kısmi benzerlik sayılmaz."""
    m = Matcher([s for s in statements if s])
    if not m.seqs:
        return []
    from studio.graph.store import _node  # noqa: PLC0415
    with store._read() as conn:  # noqa: SLF001 - graf paketi içi: ad alanına göre toplu okuma
        if nsm.is_global(ns):
            rows = conn.execute("SELECT * FROM nodes WHERE type = 'Fact' AND (json_extract(props, '$.namespace') IS NULL"
                                " OR json_extract(props, '$.namespace') IN ('', ?))", (ns,)).fetchall()
        else:
            rows = conn.execute("SELECT * FROM nodes WHERE type = 'Fact' AND json_extract(props, '$.namespace') = ?",
                                (ns,)).fetchall()
    out = []
    for r in rows:
        if r["id"] in exclude:
            continue
        n = _node(r)
        if nsm.of_node(n) == ns and m.contains(str(n["props"].get("statement") or "")):
            out.append(n)
    return out


def _secret_concepts(store: GraphStore, sc: "Scope", fact_runs: set[str]) -> list[str]:
    """unutulan cümlenin ayırt edici bir kodunu/kimliğini (harf+rakam, uzun sayı) adı olarak taşıyan ve bu
    bilgilerin kaynak koşularındaki anılarca anılan kavramlar (aday; yetimse silinir)."""
    seqs = [tokens(str(f["props"].get("statement") or "")) for f in sc.delete.values() if f["type"] == "Fact"]
    seqs = [q for q in seqs if q]
    if not seqs or not fact_runs:
        return []
    out: list[str] = []
    for rid in sorted(fact_runs):
        for ep in store.nodes("Episode", limit=500, props={"run_id": rid}):
            for _e, nb, _d in store.neighbors(ep["id"], ["MENTIONS"], "out"):
                if nb["type"] != "Concept" or nb["id"] in out:
                    continue
                name = tokens(str(nb["props"].get("display") or nb["label"] or ""))
                if not name or not any(_distinct(t) for t in name):
                    continue
                if any(any(q[i:i + len(name)] == name for i in range(len(q) - len(name) + 1)) for q in seqs):
                    out.append(nb["id"])
    return out


def _ns_runs(store: GraphStore, ns: str) -> set[str]:
    """unutma ad alanındaki koşular (`Run.project` ad alanı biçiminde; genel bellek: proje yok)."""
    out: set[str] = set()
    with store._read() as conn:  # noqa: SLF001
        if nsm.is_global(ns):
            rows = conn.execute("SELECT json_extract(props, '$.id') FROM nodes WHERE type = 'Run' AND "
                                "(json_extract(props, '$.project') IS NULL OR json_extract(props, '$.project') IN "
                                "('', ?))", (ns,)).fetchall()
        else:
            rows = conn.execute("SELECT json_extract(props, '$.id') FROM nodes WHERE type = 'Run' AND "
                                "json_extract(props, '$.project') = ?", (ns,)).fetchall()
    return {str(r[0]) for r in rows if r[0]}


def _select_tokens(sc: Scope, tokens: Iterable[str] | None, extra_terms: Iterable[str],
                   store: GraphStore | None = None, unscoped: Iterable[str] = ()) -> None:
    """aday jetonlar (bilgi cümlelerinden) + kullanıcı terimleri → `sc.tokens` (seçili) ve önizleme listesi.
    `tokens` None ise varsayılan seçim. (etki kapılı varsayılan): bir aday yalnız İKİ koşul birlikte
    tutarsa önceden işaretlenir — (1) mevcut kurallara göre yüksek güvenli sır (`extract_tokens`), (2) unutulan
    kayıtların DIŞINDA etkisi sıfır (`token_impact` → `outside.total == 0`). Tek bir başka bilgiye, teslime ya da
    mesaja dokunacak jeton işaretsiz gelir (`held: true`; önizleme uyarısı "Bu terim başka N … etkiler"); kullanıcı
    bilerek işaretleyebilir (açık `tokens` listesi bu kapıdan geçmez). Kullanıcının eklediği terimler seçili kalır."""
    facts = [str(n["props"].get("statement") or "") for n in sc.delete.values() if n["type"] == "Fact"]
    if sc.scope == "episode":
        facts += [str(n["props"].get("summary") or "") for n in sc.delete.values() if n["type"] == "Episode"]
    cands = extract_tokens(facts)
    # seçim ve tekrar denetimi kanonik biçimde ("AB 12 CD" = "AB-12-CD")
    want = None if tokens is None else {term_canon(str(t)) for t in tokens if term_canon(str(t))}
    for c in cands:
        if want is not None:
            c["selected"] = term_canon(c["text"]) in want
    known = {term_canon(c["text"]) for c in cands}
    for t in extra_terms or ():
        t = " ".join(str(t or "").split())[:120]
        q = term_canon(t)
        if not q:
            if t:
                sc.rejected.append(t)  # çok kısa terim sessizce düşmez; önizleme nedenini söyler
            continue
        if q not in known and len(cands) < MAX_TOKENS:
            known.add(q)
            cands.append({"text": t, "kind": "custom", "selected": True})
    if want is not None:  # önceki planda eklenmiş özel terimler seçim listesiyle geri gelir
        for t in tokens or ():
            q = term_canon(str(t))
            if q and q not in known and len(cands) < MAX_TOKENS:
                known.add(q)
                cands.append({"text": " ".join(str(t).split())[:120], "kind": "custom", "selected": True})
    sc.token_candidates = cands
    if tokens is None and store is not None and any((c["selected"] or c.get("gate4")) and c["kind"] != "custom"
                                                    for c in cands):
        sc.impact = token_impact(store, sc, _base_runs(store, sc))
        for c, imp in zip(cands, sc.impact):
            if c["kind"] == "custom":
                continue
            if c["selected"] and imp["outside"]["total"] > 0:
                c["selected"] = False
                c["held"] = True
            elif c.get("gate4") and not c["selected"] and imp["outside"]["total"] == 0 \
                    and not imp.get("inside_plain"):
                # anahtar sözcüklü PIN/telefon/yıl, unutulanların dışında hiç geçmiyorsa (ve içeride başka
                # anlamda — "4417 adet" — geçmiyorsa) önceden seçilir
                c["selected"] = True
    sc.tokens = [c["text"] for c in cands if c["selected"]]
    # işaretsiz terimler (tutulan, öneri, kullanıcının kaldırdığı) içeride yine de karartılır; özel ad
    # önerileri (yaygın kısaltma/ad: VPN, IBAN …) ve kullanıcının "içeride de dokunma" dediği terimler hariç
    off = {term_canon(str(t)) for t in unscoped or ()}
    for c in cands:
        if c["selected"] or c["kind"] == "name":
            continue
        if term_canon(c["text"]) in off:
            sc.unscoped.append(c["text"])
            continue
        c["scoped"] = True
        (sc.scoped_kw if c.get("kwonly") else sc.scoped).append(c["text"])
    sc.sel_kw = [c["text"] for c in cands if c["selected"] and c.get("kwonly")]


def _source_runs(store: GraphStore, sc: Scope) -> set[str]:
    """ (lead kararı 2): hedef bilgilerin KAYNAK koşuları (bilginin `run_id`/`created_by`/kanıt başvuruları,
    ASSERTED_IN anılarının koşusu, hedef anının koşusu). Bu koşuların ürettiği bilgi, teslim, mesaj ve anılar etki
    kapısında "içeride" sayılır (aynı koşunun aynı sırrı başka biçimde yazdığı kopyalar); hatırlama koşuları değil."""
    out: set[str] = set()
    facts = []
    for n in sc.delete.values():
        p = n.get("props") or {}
        if n["type"] == "Fact":
            # kullanıcının yazdığı bilgiyi aynen tekrarlayan koşu onun kaynağı değildir; koşu bilgisinde
            # yalnız ÜRETEN koşu sayılır (sonradan birleşen kanıt başvuruları değil). Üreten koşusu kayıtlı olmayan
            # eski bilgide kanıt başvuruları ve ASSERTED_IN anıları kullanılır.
            if _user_origin(p):
                continue
            made = _creating_runs(p)
            if made:
                out |= made
            else:
                out |= _runs_of_fact(p)
                facts.append(n["id"])
        elif n["type"] == "Episode" and p.get("run_id"):
            out.add(str(p["run_id"]))
    for _fid, items in store.neighbors_many(facts, ["ASSERTED_IN"], "out").items():
        for _e, ep, _d in items:
            if ep["props"].get("run_id"):
                out.add(str(ep["props"]["run_id"]))
    out.discard("")
    return out


def _base_runs(store: GraphStore, sc: Scope) -> set[str]:
    """hedef bileşeninin koşuları (kaynak + hatırlama) — etki kapısı bu koşuların teslim/mesajlarını da
    tarar (koşu ad alanı dışında olsa bile)."""
    return (sc.source_runs | _recall_runs(store, sc.delete)) - {""}


def _token_expand(store: GraphStore, sc: Scope) -> None:
    """seçili jetonu taşıyan aynı ad alanındaki bilgiler (terfi kopyalarıyla) ve adı/görünen adı jetonu
    taşıyan kavramlar da unutulur (ad alanı dışındaki kayıtlara dokunulmaz)."""
    if not sc.tokens:
        return
    m, strict = _expand_matchers(sc)
    canons = [c for c in (term_canon(t) for t in sc.tokens) if c]

    def fragment(name: str) -> bool:
        """gruplanmış yazımdan ("RX52L M8VQ3") ayrı kavram olarak çıkarılmış ayırt edici parça ("M8VQ3")."""
        for c in [term_canon(name), *(t for t, _a, _b in token_glue_stream(name))]:  # bütün ad ya da ad içindeki jeton
            if c and len(c) >= 4 and _distinct(c) and any(c in k and c != k for k in canons):
                return True
        return False
    from studio.graph.store import _node  # noqa: PLC0415
    with store._read() as conn:  # noqa: SLF001
        if nsm.is_global(sc.namespace):
            rows = conn.execute("SELECT * FROM nodes WHERE type IN ('Fact', 'Concept') AND (json_extract(props, "
                                "'$.namespace') IS NULL OR json_extract(props, '$.namespace') IN ('', ?))",
                                (sc.namespace,)).fetchall()
        else:
            rows = conn.execute("SELECT * FROM nodes WHERE (type = 'Fact' AND json_extract(props, '$.namespace') = ?) "
                                "OR (type = 'Concept' AND (key LIKE ? ESCAPE '\\' OR EXISTS (SELECT 1 FROM "
                                "json_each(nodes.props, '$.namespaces') je WHERE je.value = ?)))",
                                (sc.namespace, sc.namespace.replace("\\", "\\\\").replace("%", "\\%")
                                 .replace("_", "\\_") + "::%", sc.namespace)).fetchall()
    for r in rows:
        if r["id"] in sc.delete:
            continue
        n = _node(r)
        p = n["props"]
        if n["type"] == "Fact":
            stmt = str(p.get("statement") or "")
            outcome = fact_outcome(stmt, m, strict) if nsm.of_node(n) == sc.namespace else None
            if outcome == "delete":
                sc.token_facts.append(n["id"])
                sc.delete.update(_fact_component(store, n))
            elif outcome == "redact":
                sc.patch_facts[n["id"]] = n
        elif m.contains_term(str(p.get("display") or "")) or m.contains_term(str(n.get("label") or "")) \
                or m.contains_term(str(p.get("name") or "")) or fragment(str(p.get("display") or n.get("label") or "")):
            if n["id"] in sc.concept_ns:
                continue
            _place_concept(store, sc, n)
    for fid in [f for f in sc.patch_facts if f in sc.delete]:
        sc.patch_facts.pop(fid, None)


RESIDUAL_MIN = 3  # karartmadan sonra bundan az sözcük kalan bilgi terimin kopyasıdır (bütünüyle silinir)


def _mostly_term(redacted: str) -> bool:
    """ayraçla eşleşen kısım karartıldıktan sonra bilgide anlamlı bir şey kalıyor mu ("Eski not: [unutuldu]."
    → hayır; "Akşam yemeği [unutuldu] Mill Road'da" → evet)."""
    return len(tokens(str(redacted or "").replace(MARK, " "))) < RESIDUAL_MIN


def _expand_matchers(sc: "Scope") -> tuple["Matcher", "Matcher"]:
    """Seçili terimlerin (eşleme, tam yazım) eşleyicileri. bilgi yalnız TAM yazımlı geçişte bütünüyle silinir
    (seçili kısa sayı yalnız anahtar sözcükten sonra: "PIN 4417"); ayraçla birleşik ("Copper Lantern, 58") ya da başka
    anlamdaki ("4417 adet") geçiş karartılır."""
    return (Matcher(terms=sc.tokens, amount_ok=sc.amount_ok),
            Matcher(terms=[t for t in sc.tokens if t not in sc.sel_kw], kw_terms=sc.sel_kw, amount_ok=sc.amount_ok))


def fact_outcome(statement: str, m: "Matcher", strict: "Matcher") -> str | None:
    """seçili terimi taşıyan bilginin uygulamadaki sonucu — "delete" (tam yazım ya da karartmadan sonra
    `RESIDUAL_MIN` sözcükten az kalıyor), "redact" (yalnız eşleşen aralık karartılır) ya da None (eşleşme yok).
    Uygulama (`_token_expand`) ve önizleme (`separator_list`) aynı kararı kullanır."""
    if not m.contains_term(statement):
        return None
    return "delete" if strict.strict_hit(statement) or _mostly_term(m.text(statement)[0]) else "redact"


def _concept_links(store: GraphStore, cid: str, ns: str) -> tuple[list[dict[str, Any]], set[str]]:
    """kavramın kenarları → (bu ad alanındaki bilgi/anılarla kenarlar, kavramı bağlayan BAŞKA ad alanları)."""
    inside: list[dict[str, Any]] = []
    others: set[str] = set()
    with store._read() as conn:  # noqa: SLF001
        rows = conn.execute("SELECT e.id, e.type, e.src, e.dst, e.weight, e.props, e.created_at, n.type AS ntype, "
                            "n.props AS nprops FROM edges e JOIN nodes n ON n.id = CASE WHEN e.src = ? THEN e.dst "
                            "ELSE e.src END WHERE e.src = ? OR e.dst = ?", (cid, cid, cid)).fetchall()
    for r in rows:
        if r["ntype"] not in ("Fact", "Episode"):
            continue
        try:
            other_ns = nsm.of_node({"props": json.loads(r["nprops"] or "{}")})
        except (TypeError, ValueError):
            continue
        if other_ns == ns:
            inside.append({k: r[k] for k in ("id", "type", "src", "dst", "weight", "props", "created_at")})
        else:
            others.add(other_ns)
    return inside, others


def _place_concept(store: GraphStore, sc: "Scope", n: dict[str, Any]) -> None:
    """seçili terimi adında taşıyan kavram. Kavramın adı anahtardır: ASLA değiştirilmez. Yalnız bu ad alanının
    kayıtlarına bağlıysa silinir; başka ad alanından da kullanılıyorsa (bağlantı ya da kayıtlı ad alanı) düğüm kalır,
    bu ad alanındaki kenarları kaldırılır ve ad alanı listesinden çıkar (sonuçta "kavram adı" olarak listelenir)."""
    _inside, others = _concept_links(store, n["id"], sc.namespace)
    rest = sorted({x for x in nsm.concept_namespaces(n) if x != sc.namespace} | others)
    if n["key"].startswith(f"{sc.namespace}::") or not rest:
        sc.delete[n["id"]] = n
    else:
        sc.concept_ns[n["id"]] = rest


def _unlink_edges(store: GraphStore, sc: "Scope") -> None:
    """ad alanından çıkan paylaşılan kavramların bu ad alanındaki (silinmeyen) kayıtlarla kenarları.
    ve yalnız bu ad alanından gelen birlikte geçme (`RELATED_TO`) kenarları (bkz. `_cooccur_edges`)."""
    sc.unlink_edges = {}
    for cid in sc.concept_ns:
        inside, _others = _concept_links(store, cid, sc.namespace)
        for e in inside:
            if e["src"] not in sc.delete and e["dst"] not in sc.delete:
                sc.unlink_edges[e["id"]] = e
        for e in _cooccur_edges(store, cid, sc.namespace, set(sc.delete)):
            sc.unlink_edges.setdefault(e["id"], e)


def _cooccur_edges(store: GraphStore, cid: str, ns: str, dead: set[str]) -> list[dict[str, Any]]:
    """paylaşılan kavramın başka kavramlarla birlikte geçme kenarları (`RELATED_TO`, `memory._co_occur`: aynı
    bilgi ya da anıda geçen kavramlar). Kenar ad alanı taşımaz; BAŞKA bir ad alanında iki kavramı birlikte anan bir
    bilgi/anı (ABOUT/MENTIONS) yoksa birlikte geçme yalnız bu ad alanından gelmiştir → kenar kalkar (yedeklenir; geri
    alma geri getirir). Başka alanda kanıtı olan kenar kalır (ağırlığı yalnız sayıdır, içerik taşımaz)."""
    with store._read() as conn:  # noqa: SLF001
        rel = conn.execute("SELECT * FROM edges WHERE type = 'RELATED_TO' AND (src = ? OR dst = ?)",
                           (cid, cid)).fetchall()
        if not rel:
            return []
        others = {r["dst"] if r["src"] == cid else r["src"] for r in rel}
        ids = sorted(others | {cid})
        links: dict[str, set[str]] = {}
        for chunk in _chunks(ids):
            marks = ",".join("?" * len(chunk))
            for r in conn.execute(f"SELECT e.dst AS c, n.id AS rec, n.props AS props FROM edges e JOIN nodes n ON "
                                  f"n.id = e.src WHERE e.type IN ('ABOUT', 'MENTIONS') AND n.type IN ('Fact', 'Episode') "
                                  f"AND e.dst IN ({marks})", chunk):
                try:
                    rns = nsm.of_node({"props": json.loads(r["props"] or "{}")})
                except (TypeError, ValueError):
                    continue
                if rns != ns and r["rec"] not in dead:
                    links.setdefault(r["c"], set()).add(r["rec"])
    mine = links.get(cid, set())
    out = []
    for r in rel:
        other = r["dst"] if r["src"] == cid else r["src"]
        if other in dead:
            continue  # silinen kavramın kenarı onunla gider
        if not (mine & links.get(other, set())):
            out.append({k: r[k] for k in ("id", "type", "src", "dst", "weight", "props", "created_at")})
    return out


def _inside_facts(store: GraphStore, sc: Scope) -> dict[str, dict[str, Any]]:
    """içerideki (silinmeyen) bilgiler — hedefin kaynak koşularının ÜRETTİĞİ bilgiler (terfi kopyaları dahil).
    Kullanıcının yazdığı ya da koşudan önce var olan bilgi, koşu onu aynen tekrarlasa da dışarıdadır."""
    if not sc.source_runs:
        return {}
    from studio.graph.store import _node  # noqa: PLC0415
    runs = sorted(sc.source_runs)
    out: dict[str, dict[str, Any]] = {}
    with store._read() as conn:  # noqa: SLF001
        rows = []
        for chunk in _chunks(runs):
            marks = ",".join("?" * len(chunk))
            rows += conn.execute(f"SELECT * FROM nodes WHERE type = 'Fact' AND (json_extract(props, '$.run_id') IN "
                                 f"({marks}) OR json_extract(props, '$.created_by.run') IN ({marks}))",
                                 (*chunk, *chunk)).fetchall()
    for r in rows:
        if r["id"] in sc.delete or r["id"] in out:
            continue
        n = _node(r)
        if _same_run_fact(store, n, sc.source_runs):
            out[n["id"]] = n
    return out


def collect(store: GraphStore, scope: str, target: str | None, namespace: str | None,
            tokens: Iterable[str] | None = None, extra_terms: Iterable[str] = (),
            unscoped: Iterable[str] = (), amounts: Iterable[str] = ()) -> Scope:
    if scope not in SCOPES:
        raise ForgetError(ERR_SCOPE)
    if scope == "project":
        ns = nsm.normalize(namespace or target)
        if nsm.is_global(ns):
            raise ForgetError(ERR_GLOBAL)
        sc = Scope(scope, ns, {"id": ns, "type": "Project", "label": nsm.key_of(ns)})
        with store._read() as conn:  # noqa: SLF001 - graf paketi içi: ad alanına göre toplu okuma
            rows = conn.execute("SELECT * FROM nodes WHERE type IN ('Episode', 'Fact') AND "
                                "json_extract(props, '$.namespace') = ?", (ns,)).fetchall()
            concept_rows = conn.execute(
                "SELECT * FROM nodes WHERE type = 'Concept' AND (key LIKE ? ESCAPE '\\' OR EXISTS (SELECT 1 FROM "
                "json_each(nodes.props, '$.namespaces') je WHERE je.value = ?))",
                (ns.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "::%", ns)).fetchall()
        from studio.graph.store import _node  # noqa: PLC0415
        for r in rows:
            n = _node(r)
            sc.delete[n["id"]] = n
        for r in concept_rows:
            _place_concept(store, sc, _node(r))  # kavram adı (anahtar) değiştirilmez
        for run in store.nodes("Run", limit=100000, props={"project": ns}):
            sc.runs.add(str(run["props"].get("id") or ""))
    else:
        if not target:
            raise ForgetError(ERR_TARGET.format("-"))
        try:
            node = store.get_node(target)
        except KeyError:
            raise KeyError(ERR_TARGET.format(target)) from None
        want = "Fact" if scope == "fact" else "Episode"
        if node["type"] != want:
            raise ForgetError(ERR_TYPE.format(want))
        ns = nsm.of_node(node)
        if namespace not in (None, "") and nsm.normalize(namespace) != ns:
            raise NamespaceError("Bu bilgi başka bir bellek ad alanına ait; işlem reddedildi")
        sc = Scope(scope, ns, {"id": node["id"], "type": node["type"], "label": node["label"]})
        if scope == "fact":
            sc.delete.update(_fact_component(store, node))
            # aynı cümleyi (tam jeton dizisi) içeren kardeş bilgiler/iddialar (aynı ya da başka koşudan; aynı ad
            # alanında) da unutulur: "Not: <cümle>", HTML kopyası, kullanıcı beyanı… Yoksa hatırlama cümleyi geri getirir.
            for sib in _sibling_facts(store, ns, [str(f["props"].get("statement") or "") for f in sc.delete.values()],
                                      set(sc.delete)):
                sc.siblings.append(sib["id"])
                sc.delete.update(_fact_component(store, sib))
            # bilginin ABOUT kavramları, başka (silinmeyen) bilgi onlara bağlı değilse ve onları anan anılar
            # yalnız bu bilgilerin kaynak koşularındansa (aynı çıktıdan çıkarılmış) yetim sayılır ve silinir.
            fact_runs: set[str] = set()
            for f in sc.delete.values():
                fact_runs |= _runs_of_fact(f["props"])
            about = [nb["id"] for fid in list(sc.delete) for _e, nb, _d in store.neighbors(fid, ["ABOUT"], "out")
                     if nb["type"] == "Concept"]
            about += _secret_concepts(store, sc, fact_runs)  # cümledeki ayırt edici kod/kimlik kavramı
            for cid, items in store.neighbors_many(dict.fromkeys(about), ["ABOUT", "MENTIONS"], "in").items():
                if all(nb["id"] in sc.delete or (nb["type"] == "Episode"
                                                 and str(nb["props"].get("run_id") or "") in fact_runs)
                       for _e, nb, _d in items):
                    try:
                        sc.delete[cid] = store.get_node(cid)
                    except KeyError:
                        pass
        else:
            sc.delete[node["id"]] = node
            episodes = {node["id"]}
            facts = [nb for _e, nb, _d in store.neighbors(node["id"], ["ASSERTED_IN"], "in") if nb["type"] == "Fact"]
            asserted = store.neighbors_many([f["id"] for f in facts], ["ASSERTED_IN"], "out")
            for f in facts:
                if all(ep["id"] in episodes for _e, ep, _d in asserted.get(f["id"], [])):
                    for cid, comp in _fact_component(store, f).items():
                        others = [ep for _e, ep, _d in store.neighbors(cid, ["ASSERTED_IN"], "out")
                                  if ep["id"] not in episodes]
                        if not others:
                            sc.delete[cid] = comp
            mentioned = [nb["id"] for _e, nb, _d in store.neighbors(node["id"], ["MENTIONS"], "out")
                         if nb["type"] == "Concept"]
            about = [nb["id"] for fid in list(sc.delete) for _e, nb, _d in store.neighbors(fid, ["ABOUT"], "out")
                     if nb["type"] == "Concept"]
            for c in _orphan_concepts(store, set(sc.delete), dict.fromkeys(mentioned + about)):
                sc.delete[c["id"]] = c
    sc.base = set(sc.delete)
    # tutar biçimiyle ("900.000 TL") de eşleşmesine kullanıcının açıkça izin verdiği sayısal terimler
    sc.amount_ok = [str(t) for t in amounts or () if term_canon(str(t)).isdigit()]
    sc.source_runs = _source_runs(store, sc)
    _select_tokens(sc, tokens, extra_terms, store, unscoped)
    _token_expand(store, sc)
    _unlink_edges(store, sc)
    if sc.scoped or sc.scoped_kw:  # işaretsiz terimlerin içerideki kopyaları
        sc.inside_facts = _inside_facts(store, sc)
    # anıdaki kalan (başka kanıtı olan) bilgilerin cümleleri iğne olmaz: özetten yalnız unutulan kısım çıkar
    kept = {norm(nb["props"].get("statement") or "")
            for ep in [n for n in sc.delete.values() if n["type"] == "Episode"]
            for _e, nb, _d in store.neighbors(ep["id"], ["ASSERTED_IN"], "in")
            if nb["type"] == "Fact" and nb["id"] not in sc.delete}
    kept.discard("")
    for n in sc.delete.values():
        p = n["props"]
        if n["type"] == "Fact":
            sc.needles.append(str(p.get("statement") or ""))
            sc.runs |= _runs_of_fact(p)
        elif n["type"] == "Episode":
            summary = str(p.get("summary") or "")
            if kept:
                sc.needles += [x for x in _SPLIT_RE.split(summary)[::2]
                               if norm(x) not in kept and not any(k in norm(x) for k in kept)]
            else:
                sc.needles.append(summary)
            if p.get("run_id"):
                sc.runs.add(str(p["run_id"]))
    eps = [n["id"] for n in sc.delete.values() if n["type"] == "Fact"]
    for _fid, items in store.neighbors_many(eps, ["ASSERTED_IN"], "out").items():
        for _e, ep, _d in items:
            if ep["props"].get("run_id"):
                sc.runs.add(str(ep["props"]["run_id"]))
    sc.runs |= _recall_runs(store, sc.delete)
    sc.runs.discard("")
    sc.needles = [n for n in dict.fromkeys(sc.needles) if len(norm(n)) >= MIN_NEEDLE]
    sc.needles += [r for r in _raw_needles(store, sc) if r not in sc.needles]
    sc.needles += [r for r in _boundary_needles(store, sc) if r not in sc.needles]
    if sc.tokens:  # jetonlar ad alanının diğer koşularında da karartılır (yalnız jeton eşleyicisiyle)
        sc.ns_runs = _ns_runs(store, sc.namespace) - sc.runs
    return sc


def _boundary_needles(store: GraphStore, sc: Scope) -> list[str]:
    """araç çıktısının SONU ile adımın son yanıtının BAŞI arasında bölünmüş cümle. Etkilenen koşuların her adımı
    için [araç çıktıları…, adım çıktısı] parça penceresinde taranır; sınırı aşan eşleşmenin her iki yanındaki ham parça
    (en az `CLIP_MIN_TOKENS` jeton) iğne olur. Böylece yanıtın kopyaları (Step, Run, Deliverable, Message, FTS, olaylar)
    ve araç çıktısının kopyaları (olaylar, artefaktlar) aynı yoldan karartılır."""
    if not sc.needles or not sc.runs:
        return []
    m = Matcher(sc.needles)
    groups: dict[tuple[Any, Any], list[str]] = {}
    finished: dict[tuple[Any, Any], str] = {}
    for _key, typ, run, data in _run_items(store.run_event_rows(sc.runs)):
        if not isinstance(data, dict) or not isinstance(data.get("output"), str):
            continue
        if typ == "step.tool_result":
            groups.setdefault((run, data.get("step")), []).append(data["output"])
        elif typ == "step.finished":
            finished[(run, data.get("step"))] = data["output"]
    out: list[str] = []
    for (run, step), texts in groups.items():
        node = store.find("Step", f"{run}:{step}")
        reply = str((node or {}).get("props", {}).get("output") or finished.get((run, step)) or "")
        if not reply:
            continue
        chunks = [*texts[-(CHUNK_WINDOW - 1):], reply]
        for idx, spans in _chunk_spans(m, chunks).items():
            for a, b in spans:
                raw = chunks[idx][a:b].strip()
                if raw and len(norm(raw)) >= MIN_NEEDLE and len(tokens(raw)) >= CLIP_MIN_TOKENS and raw not in out:
                    out.append(raw)
    return out


def _source_steps(store: GraphStore, sc: Scope) -> list[dict[str, Any]]:
    """Kanıt kaynakları (G2-B provenance): bilgilerin `source_refs` (`ep:<koşu>:<adım>:<tur>#<Step düğümü>`) ile
    gösterdiği adım düğümleri; kaynağı belirsiz koşularda koşunun bütün adımları."""
    out: dict[str, dict[str, Any]] = {}
    pinned_runs: set[str] = set()
    for n in sc.delete.values():
        if n["type"] != "Fact":
            continue
        for ref in n["props"].get("source_refs") or []:
            ref = str(ref)
            if not ref.startswith("ep:"):
                continue
            head, _sep, node_id = ref.partition("#")
            if head.count(":") >= 3:
                pinned_runs.add(head[3:].rsplit(":", 2)[0])
            if node_id:
                try:
                    st = store.get_node(node_id)
                except KeyError:
                    continue
                if st["type"] == "Step":
                    out[st["id"]] = st
    for rid in sorted(sc.runs - pinned_runs):
        for st in store.nodes("Step", limit=2000, props={"run_id": rid}):
            out[st["id"]] = st
    return list(out.values())


def _raw_needles(store: GraphStore, sc: Scope) -> list[str]:
    """kaynak adım çıktılarında bilginin HAM hâli (markdown işaretleriyle) bulunur; ham alt dize de iğne olur.
    Böylece aynı ham metni taşıyan her türev (olay, teslim, mesaj, dışa aktarım) iki yoldan da eşleşir."""
    if not sc.needles or not sc.runs:
        return []
    m = Matcher(sc.needles)
    raws: list[str] = []
    texts: list[str] = []
    for st in _source_steps(store, sc):
        p = st["props"]
        texts += [str(p.get(k) or "") for k in ("output", "summary") if p.get(k)]
    for rid in sorted(sc.runs):
        run = store.find("Run", rid)
        if run and run["props"].get("output"):
            texts.append(str(run["props"]["output"]))
    for t in texts:
        for a, b in m._spans(t):  # noqa: SLF001
            raw = t[a:b].strip()
            if raw and len(norm(raw)) >= MIN_NEEDLE and raw not in raws:
                raws.append(raw)
    return raws


# ------------------------------------------------------------------ türevler
def _skip_for(store: GraphStore, type_name: str) -> frozenset[str]:
    try:
        return KEEP_KEYS | {store.ontology.entity(type_name).key}
    except Exception:  # noqa: BLE001
        return KEEP_KEYS


def derived_nodes(store: GraphStore, sc: Scope) -> dict[str, dict[str, Any]]:
    """Karartılacak aday düğümler: silinenlere komşu türevler + etkilenen koşuların düğümleri. kavramlar
    karartılmaz (adı anahtardır; silinir, ad alanından çıkar ya da olduğu gibi kalıp sonuçta listelenir)."""
    out: dict[str, dict[str, Any]] = {}
    for _nid, items in store.neighbors_many(sc.delete).items():
        for _e, nb, _d in items:
            if nb["type"] in SCRUB_TYPES and nb["id"] not in sc.delete:
                out[nb["id"]] = nb
    run_nodes = []
    for rid in sorted(sc.runs):
        run = store.find("Run", rid)
        if run:
            run_nodes.append(run)
            out[run["id"]] = run
        for t in RUN_SCOPED:
            for n in store.nodes(t, limit=5000, props={"run_id": rid}):
                if n["id"] not in sc.delete:
                    out[n["id"]] = n
    for _rid, items in store.neighbors_many([r["id"] for r in run_nodes]).items():
        for _e, nb, _d in items:
            if nb["type"] in SCRUB_TYPES and nb["id"] not in sc.delete:
                out[nb["id"]] = nb
    return {k: v for k, v in out.items() if v["type"] != "Concept"}


def _scrub_delivery(store: GraphStore, node: dict[str, Any], m: Matcher) -> dict[str, Any]:
    """`Delivery` karartması: `mailto:` bağlantısı HER ZAMAN şemaya iner (alıcı + gövde kayıtta durmaz); başka bağlantıda
    URL kodu çözülmüş hâli eşleşirse sorgu/parça atılır; kalan alanlar olağan karartma."""
    p = node["props"]
    rest = {k: v for k, v in p.items() if k != "link"}
    new, n = m.value(rest, _skip_for(store, "Delivery"))
    patch = {k: v for k, v in new.items() if v != p.get(k)} if n else {}
    link = p.get("link")
    if isinstance(link, str) and link:
        if link[:7].lower() == "mailto:":
            if link != "mailto:":
                patch["link"] = "mailto:"
        elif m.text(link)[1] or (unquote(link) != link and m.text(unquote(link))[1]):
            patch["link"] = link.split("#", 1)[0].split("?", 1)[0]
    return patch


def scrub_patch(store: GraphStore, node: dict[str, Any], m: Matcher, at: str) -> dict[str, Any]:
    """Düğüm için karartma yaması (değişiklik yoksa boş)."""
    p = node["props"]
    if node["type"] == "Deliverable":
        from studio.deliverables.service import regenerate_summary  # noqa: PLC0415

        patch = regenerate_summary(p, m.text, MARK, at)
        rest = {k: v for k, v in p.items() if k not in ("excerpt", "summary", "title", "run_title")}
        new, n = m.value(rest, _skip_for(store, "Deliverable"))
        if n:
            patch.update({k: v for k, v in new.items() if v != p.get(k)})
            patch.setdefault("forgotten_at", at)
        return patch
    if node["type"] == "Delivery":  # bağlantı URL-kodlu içerik taşıyabilir (`mailto:…?body=%20…`)
        return _scrub_delivery(store, node, m)
    new, n = m.value(p, _skip_for(store, node["type"]))
    if not n:
        return {}
    patch = {k: v for k, v in new.items() if v != p.get(k)}
    if patch and node["type"] in STAMPED:
        patch["forgotten_at"] = at
    return patch


VAULT_ZIP_DEPTH = 3
# arşiv içinde "metin taşımaz" sayılan ortam biçimleri (başlık baytlarıyla); bilinmeyen ikili üye = taranamadı
_MEDIA_MAGIC = (b"\x89PNG", b"\xff\xd8\xff", b"GIF8", b"BM", b"RIFF", b"OggS", b"ID3", b"\x1aE\xdf\xa3", b"wOFF",
                b"wOF2", b"\x00\x00\x01\x00", b"II*\x00", b"MM\x00*", b"\x00\x01\x00\x00\x00", b"OTTO")


def _decode_text(raw: bytes) -> str | None:
    """Üye içeriğini metne çevirir; ikiliyse None. Uzantıya BAKILMAZ: UTF-16 BOM'u, sonra NUL baytı sınaması."""
    if raw[:2] in (b"\xff\xfe", b"\xfe\xff"):
        try:
            return raw.decode("utf-16")
        except UnicodeError:
            return None
    if b"\x00" in raw[:8192]:
        return None
    return raw.decode("utf-8", "replace")


def _zip_chunks(raw: bytes, depth: int, budget: list[int], out: list[str]) -> bool:
    """Arşivin metin üyelerini `out`a ekler; tam taranabildiyse True (iç içe arşive `VAULT_ZIP_DEPTH`'e kadar iner,
    toplam okuma `budget` ile sınırlı; bilinmeyen ikili / aşırı büyük / derin üye = False)."""
    complete = True
    try:
        zf = zipfile.ZipFile(io.BytesIO(raw))
        for info in zf.infolist():
            if info.is_dir():
                continue
            if info.file_size > VAULT_SCAN_MAX or budget[0] < info.file_size:
                complete = False
                continue
            budget[0] -= info.file_size
            with zf.open(info) as fh:
                data = fh.read(VAULT_SCAN_MAX + 1)
            if len(data) > VAULT_SCAN_MAX:
                complete = False
            elif data[:4] == b"PK" + bytes([3, 4]):
                if depth >= VAULT_ZIP_DEPTH or not _zip_chunks(data, depth + 1, budget, out):
                    complete = False
            else:
                text = _decode_text(data)
                if text is not None:
                    out.append(text)
                elif not data.startswith(_MEDIA_MAGIC):
                    complete = False
    except (zipfile.BadZipFile, OSError, RuntimeError, NotImplementedError, EOFError, ValueError):
        return False
    return complete


def _vault_chunks(path: Path) -> tuple[list[str], bool]:
    """kasa blob'unun taranabilir metin parçaları ve TAM taranabildi mi. Düz metin → ([metin], True);
    zip/OOXML → üyeler İÇERİĞE göre sınıflanır (uzantı listesi yok), iç içe zip taranır; ikili (PDF, görsel), çok büyük
    dosya ya da taranamayan üye → tam değil (çağıran: eşleşme yoksa "taranamadı" sayar)."""
    try:
        if path.stat().st_size > VAULT_SCAN_MAX:
            return [], False
        raw = path.read_bytes()
    except OSError:
        return [], False
    if raw[:4] == b"PK" + bytes([3, 4]):
        out: list[str] = []
        complete = _zip_chunks(raw, 1, [4 * VAULT_SCAN_MAX], out)
        return out, complete
    text = _decode_text(raw)
    return ([text], True) if text is not None else ([], False)


# ------------------------------------------------------------------ yan defterler (ayrı SQLite dosyaları)
def _open_existing(path: Path) -> sqlite3.Connection | None:
    """Var olan defteri açar; yoksa None (dosya oluşturulmaz)."""
    if not path.is_file():
        return None
    try:
        conn = sqlite3.connect(f"file:{quote(path.as_posix(), safe='/:')}?mode=rw", uri=True, timeout=5)
        conn.row_factory = sqlite3.Row
        return conn
    except sqlite3.Error:
        return None


def _chunks(items: list[str]) -> Iterable[list[str]]:
    for i in range(0, len(items), IN_CHUNK):
        yield items[i:i + IN_CHUNK]


def booster_rows(data_dir: Path, runs: Iterable[str]) -> list[dict[str, Any]]:
    conn = _open_existing(data_dir / "boost.sqlite")
    if conn is None:
        return []
    out: list[dict[str, Any]] = []
    try:
        for chunk in _chunks(sorted(runs)):
            out += [dict(r) for r in conn.execute(
                f"SELECT run_id, step_id, agent FROM steps WHERE run_id IN ({','.join('?' * len(chunk))})", chunk)]
    except sqlite3.Error:
        pass
    finally:
        conn.close()
    return out


def metrics_rows(data_dir: Path, runs: Iterable[str]) -> list[dict[str, Any]]:
    conn = _open_existing(data_dir / "metrics.sqlite")
    if conn is None:
        return []
    out: list[dict[str, Any]] = []
    try:
        for chunk in _chunks(sorted(runs)):
            marks = ",".join("?" * len(chunk))
            out += [dict(r) for r in conn.execute(
                f"SELECT event_id, event_type, run_id, input_sig FROM events WHERE run_id IN ({marks}) "
                f"OR task_root_id IN ({marks})", (*chunk, *chunk))]
    except sqlite3.Error:
        pass
    finally:
        conn.close()
    return out


def set_metrics_sig(data_dir: Path, rows: list[tuple[str, str | None]]) -> int:
    conn = _open_existing(data_dir / "metrics.sqlite")
    if conn is None or not rows:
        return 0
    try:
        with conn:
            return sum(conn.execute("UPDATE events SET input_sig=? WHERE event_id=?", (sig, eid)).rowcount
                       for eid, sig in rows)
    except sqlite3.Error:
        log.exception("ölçüm defteri güncellenemedi")
        return 0
    finally:
        conn.close()


# ------------------------------------------------------------------ olay satırlarının ad alanı kapsamı
def _row_ns(data: Any) -> str | None:
    """Koşusuz olay satırının ad alanı ipucu (namespace / project / node.props.namespace); yoksa None."""
    if not isinstance(data, dict):
        return None
    cands: list[Any] = [data.get("namespace"), data.get("project")]
    node = data.get("node")
    if isinstance(node, dict) and isinstance(node.get("props"), dict):
        cands.append(node["props"].get("namespace"))
    for v in cands:
        if isinstance(v, str) and v:
            try:
                return nsm.normalize(v)
            except Exception:  # noqa: BLE001 - tanınmayan değer: ipucu yok sayılır
                continue
    return None


def foreign_runs(store: GraphStore, ns: str) -> set[str]:
    """BAŞKA ad alanına ait olduğu bilinen koşular (bunların olay/artefakt satırlarına dokunulmaz)."""
    with store._read() as conn:  # noqa: SLF001
        if nsm.is_global(ns):
            rows = conn.execute("SELECT json_extract(props, '$.id') FROM nodes WHERE type = 'Run' AND "
                                "json_extract(props, '$.project') IS NOT NULL AND json_extract(props, '$.project') "
                                "NOT IN ('', ?)", (ns,)).fetchall()
        else:
            rows = conn.execute("SELECT json_extract(props, '$.id') FROM nodes WHERE type = 'Run' AND "
                                "COALESCE(json_extract(props, '$.project'), '') != ?", (ns,)).fetchall()
    return {str(r[0]) for r in rows if r[0]}


def scope_items(items: list[tuple[Any, Any, Any, Any]], foreign: set[str], ns: str,
                keep: set[str] = frozenset()) -> list[tuple[Any, Any, Any, Any]]:
    """olay satırlarından unutma ad alanının kapsamındakiler. Başka ad alanına ait olduğu bilinen koşunun
    satırı taranmaz (etkilenen koşular `keep` her zaman taranır); koşusuz satır, ad alanı ipucu başka bir ad alanını
    göstermiyorsa taranır; koşusu bilinmeyen (silinmiş/içe aktarılmış) satır taranır."""
    out: list[tuple[Any, Any, Any, Any]] = []
    for it in items:
        run = str(it[2] or "")
        if run:
            if run in keep or run not in foreign:
                out.append(it)
            continue
        rns = _row_ns(it[3])
        if rns is None or rns == ns:
            out.append(it)
    return out


IMPACT_SNIPPETS = 3
IMPACT_CTX = 32


def _node_text(n: dict[str, Any]) -> str:
    p = n.get("props") or {}
    if n["type"] == "Fact":
        return str(p.get("statement") or "")
    vals = [str(n.get("label") or "")]
    for k, v in p.items():
        if k not in KEEP_KEYS or k in ("name", "slug"):
            if isinstance(v, str) and v:
                vals.append(v)
    return "\n".join(vals)


IMPACT_MASK = "•••"  # bağlam parçasındaki başka aday jetonun YERİNE (hiçbir karakteri sızmaz)


def _masked(text: str, lo: int, hi: int, spans: list[tuple[int, int]]) -> str:
    """text[lo:hi] — içine (kısmen de olsa) düşen her aday jeton aralığı bütünüyle `IMPACT_MASK` olur."""
    out: list[str] = []
    pos = lo
    for a, b in spans:
        if b <= pos or a >= hi:
            continue
        if a > pos:
            out.append(text[pos:a])
        out.append(IMPACT_MASK)
        pos = max(pos, b)
    if pos < hi:
        out.append(text[pos:hi])
    return " ".join("".join(out).split())


def _inside_matcher(sc: "Scope") -> "Matcher":
    """unutulan kayıtların (jeton genişlemesinden ÖNCEKİ hedef bileşeni) cümleleri; bu cümleyi zaten taşıyan
    teslim/mesaj "içeride" sayılır (cümle eşleyicisi onu zaten karartır)."""
    texts: list[str] = []
    for nid in sc.base or set(sc.delete):
        n = sc.delete.get(nid)
        if n is None:
            continue
        p = n.get("props") or {}
        if n["type"] == "Fact":
            texts.append(str(p.get("statement") or ""))
        elif n["type"] == "Episode":
            texts.append(str(p.get("summary") or ""))
    return Matcher([t for t in texts if t])


def _same_run_fact(store: GraphStore, n: dict[str, Any], source: set[str]) -> bool:
    """bilgi hedefin kaynak koşularından birinde mi üretildi (özellikler ya da ASSERTED_IN anısı)."""
    if not source:
        return False
    p = n.get("props") or {}
    if _user_origin(p):  # kullanıcının yazdığı bilgi her zaman dışarıda
        return False
    made = _creating_runs(p)
    if made:  # yalnız üreten koşu (sonradan birleşen kanıt başvurusu "içeri" almaz)
        return bool(made & source)
    hits = _runs_of_fact(p) & source  # üreten koşusu kayıtlı olmayan eski bilgi
    hits |= {str(ep["props"].get("run_id") or "") for _e, ep, _d in store.neighbors(n["id"], ["ASSERTED_IN"], "out")
             if str(ep["props"].get("run_id") or "") in source}
    created = str(n.get("created_at") or p.get("created_at") or "")
    for rid in hits:  # koşudan ÖNCE var olan bilgi dışarıda
        run = store.find("Run", rid)
        start = str(((run or {}).get("props") or {}).get("started_at") or (run or {}).get("created_at") or "")
        if not created or not start or not _before(created, start):
            return True
    return False


IMPACT_LIST = 12  # kalan kayıt / ayraçlı eşleşme listesinde terim başına en çok bu kadar kayıt


Table = dict[str, tuple[int, bool, set[str], bool]]


def _term_table(texts: list[str], amount_ok: Iterable[str] = ()) -> tuple[Table, int]:
    """kanonik terim → (aday sırası, ayraçla birleşik eşleşme serbest mi, tam yazım anahtarları,
    tutar biçimiyle eşleşmeye izin var mı)."""
    allow = {term_canon(t) for t in amount_ok}
    table: Table = {}
    for k, t in enumerate(texts):
        q = user_seq(t)
        if not q:
            continue
        canon = "".join(q)
        k0, loose, xs, amt = table.get(canon, (k, len(canon) >= LOOSE_MIN, set(), canon in allow))
        xs.add(term_exact(t))
        table[canon] = (k0, loose, xs, amt)
    return table, max((len(x) for x in table), default=0)


def _scan_terms(text: str, table: Table, cmax: int, *, amounts: bool = False) -> list[tuple[int, int, int, bool]]:
    """metindeki bütün aday geçişleri → [(aday sırası, başlangıç, bitiş, tam yazım)] — uygulamayla aynı
    kural (ayraç, cümle sınırı, `LOOSE_MIN` altındaki terim yalnız tam yazım). izinsiz sayısal terimin tutar
    biçimli geçişi ("900.000 TL") eşleşme değildir; `amounts=True` ise bunlar da (-1 - aday sırası) ile döner."""
    if not table or not text:
        return []
    toks, join, gaps = canon_gaps(text)
    words = [t for t, _a, _b in toks]
    n = len(words)
    out: list[tuple[int, int, int, bool]] = []
    for i in range(n):
        cat = ""
        for j in range(i, n):
            cat += words[j]
            if len(cat) > cmax:
                break
            e = table.get(cat)
            if e is not None:
                k, loose, xs, amt = e
                x = exact_key(words, gaps, i, j) in xs
                shaped = not x and loose and cat.isdigit() and _amount_shape(words, gaps, i, j)
                if shaped and amounts:
                    out.append((-1 - k, toks[i][1], toks[j][2], False))  # tutar biçimi işareti (önizleme sayımı)
                if (x or loose) and not (shaped and not amt):
                    out.append((k, toks[i][1], toks[j][2], x))
            if j >= n - 1 or not join[j]:
                break
    return out


def _kw_canons(text: str) -> list[str]:
    """metinde anahtar sözcükten sonra gelen değerlerin kanonik biçimleri ("PIN 4417" → "4417")."""
    return [c for c in (term_canon(raw) for _a, _b, raw in _keyword_values(text)) if c]


def _mask_terms(text: str, table: Table, cmax: int, n: int = 90) -> str:
    """Kayıt etiketi: içindeki her aday geçişi `IMPACT_MASK` olur (önizleme listeleri içerik sızdırmaz)."""
    text = " ".join(str(text or "").split())
    spans = sorted({(a, b) for _k, a, b, _x in _scan_terms(text, table, cmax)})
    return _clip(_masked(text, 0, len(text), spans), n) if spans else _clip(text, n)


def _record(n: dict[str, Any], label: str, origin: str) -> dict[str, Any]:
    p = n.get("props") or {}
    return {"type": n["type"], "id": n["id"], "label": label, "run_id": p.get("run_id"), "origin": origin}


def token_impact(store: GraphStore, sc: "Scope", extra_runs: Iterable[str] = (), *,
                 post: bool = False) -> list[dict[str, Any]]:
    """her aday jeton için etkilenen bilgi, teslim ve mesaj sayısı + en çok `IMPACT_SNIPPETS` kısa bağlam
    parçası (yalnız arayüz önizlemesi; plan ucu kullanıcıya aittir, MCP 403 alır; günlüğe/mezar kaydına girmez).
    Eşleme uygulamayla aynıdır: kanonik (ayraçsız) birleşim, jeton sınırında, `_sep_gap` ayraçlarıyla.
    `outside` = unutulan kayıtların DIŞINDAKİ etki (hedef bileşenindeki bilgiler ve hedef cümleyi zaten taşıyan
    teslim/mesajlar içeride sayılır); varsayılan seçim yalnız `outside.total == 0` olan jetonları işaretler.
    bağlam parçasında başka bir aday jeton görünürse bütünüyle maskelenir (kırpılmış kenarda da).
    `remains` = terim işaretsiz kalırsa OKUNUR kalacak kayıtlar (dışarıdaki bilgi/teslim/mesaj/anı; kısa sayıda
    yalnız anahtar sözcüklü geçiş), `loose` = ayraçla birleşik (tam yazım dışı) eşleşmeler, `inside_plain` = içeride
    anahtar sözcüksüz geçiş ("4417 adet"). `post=True` (uygulamadan sonra): içeride/dışarıda ayrımı yapılmaz, terimi
    hâlâ taşıyan her kayıt `remains`e girer."""
    cands = sc.token_candidates
    if not cands:
        return []
    table, cmax = _term_table([c["text"] for c in cands], sc.amount_ok)
    canon_of = [term_canon(c["text"]) for c in cands]
    out = [{"text": c["text"], "facts": 0, "deliverables": 0, "messages": 0, "snippets": [],
            "amounts": 0, "amount_records": [],  # tutar biçimli geçişler (izin yoksa dokunulmaz)
            "short": len(term_canon(c["text"])) < SHORT_TERM,
            "outside": {"facts": 0, "deliverables": 0, "messages": 0, "total": 0, "episodes": 0},
            "inside_plain": 0, "inside_copies": 0, "plain_records": 0, "loose": [], "loose_total": 0,
            "remains": {"facts_user": 0, "facts_run": 0, "deliverables": 0, "messages": 0, "episodes": 0,
                        "inside": 0, "total": 0, "records": []}} for c in cands]
    from studio.graph.store import _node  # noqa: PLC0415
    ns = sc.namespace
    runs = sorted((_ns_runs(store, ns) | sc.runs | set(extra_runs)) - {""})
    with store._read() as conn:  # noqa: SLF001
        if nsm.is_global(ns):
            rows = conn.execute("SELECT * FROM nodes WHERE type IN ('Fact', 'Episode') AND (json_extract(props, "
                                "'$.namespace') IS NULL OR json_extract(props, '$.namespace') IN ('', ?))",
                                (ns,)).fetchall()
        else:
            rows = conn.execute("SELECT * FROM nodes WHERE type IN ('Fact', 'Episode') AND "
                                "json_extract(props, '$.namespace') = ?", (ns,)).fetchall()
        for chunk in _chunks(runs):
            rows += conn.execute(f"SELECT * FROM nodes WHERE type IN ('Deliverable', 'Message') AND "
                                 f"json_extract(props, '$.run_id') IN ({','.join('?' * len(chunk))})", chunk).fetchall()
    field_of = {"Fact": "facts", "Deliverable": "deliverables", "Message": "messages", "Episode": "episodes"}
    base = sc.base or set(sc.delete)
    inside_m: Matcher | None = None
    seen: set[str] = set()
    for r in rows:
        if r["id"] in seen:
            continue
        seen.add(r["id"])
        n = _node(r)
        text = _node_text(n) if n["type"] != "Episode" else str((n.get("props") or {}).get("summary") or "")
        if not text:
            continue
        found = _scan_terms(text, table, cmax, amounts=True)
        amt = [k for k, _a, _b, _x in found if k < 0]
        found = [f for f in found if f[0] >= 0]
        if amt and r["id"] not in (sc.base or set(sc.delete)):
            for kk in dict.fromkeys(-1 - k for k in amt):
                o = out[kk]
                o["amounts"] += 1
                if len(o["amount_records"]) < IMPACT_LIST:
                    o["amount_records"].append(_record(n, _mask_terms(n.get("label") or text, table, cmax), "run"))
        if not found:
            continue
        hits: dict[int, tuple[int, int]] = {}
        loose: dict[int, bool] = {}
        count: dict[int, int] = {}
        spans: list[tuple[int, int]] = []
        for k, a, b, x in found:
            spans.append((a, b))
            hits.setdefault(k, (a, b))
            count[k] = count.get(k, 0) + 1
            if not x:
                loose[k] = True
        p = n.get("props") or {}
        if n["type"] == "Fact":
            inside = n["id"] in base or _same_run_fact(store, n, sc.source_runs)
        elif str(p.get("run_id") or "") in sc.source_runs:
            inside = True  # (lead kararı 2): aynı kaynak koşunun teslimi/mesajı/anısı
        elif n["type"] == "Episode":
            inside = n["id"] in base
        else:
            if inside_m is None:
                inside_m = _inside_matcher(sc)
            inside = bool(inside_m.seqs) and inside_m.contains(text)
        kwc: list[str] | None = None
        spans.sort()
        label: str | None = None
        origin = "user" if n["type"] == "Fact" and _user_origin(p) else "run"
        for k, (a, b) in hits.items():
            o = out[k]
            fld = field_of[n["type"]]
            kwonly = bool(cands[k].get("kwonly"))
            kw_n = 0
            if kwonly:
                if kwc is None:
                    kwc = _kw_canons(text)
                kw_n = kwc.count(canon_of[k])
            if n["type"] != "Episode":
                o[fld] += 1
                if not inside:
                    o["outside"][fld] += 1
                    o["outside"]["total"] += 1
            elif not inside:
                o["outside"]["episodes"] += 1
            if kwonly and count[k] > kw_n and n["id"] not in base and n["type"] != "Episode":
                o["plain_records"] += 1  # başka anlamda geçiş ("4417 adet") — korunur, sonuçta söylenir
                if inside:
                    o["inside_plain"] += 1
            if inside and n["id"] not in base and (not kwonly or kw_n > 0):
                o["inside_copies"] += 1  # işaretsiz kalırsa içeride karartılacak kopya
            if label is None:
                label = _mask_terms(n.get("label") or text, table, cmax)
            if loose.get(k) and n["id"] not in base:
                o["loose_total"] += 1
                if len(o["loose"]) < IMPACT_LIST:
                    o["loose"].append({**_record(n, label, origin), "inside": bool(inside)})
            if (not inside or post) and (not kwonly or kw_n > 0):
                rem = o["remains"]
                if inside:  # yalnız `post`: hedefin kendi kaydında hâlâ geçiyor (dürüst sonuç; normalde 0)
                    rem["inside"] += 1
                else:
                    rem[("facts_user" if origin == "user" else "facts_run") if n["type"] == "Fact" else fld] += 1
                rem["total"] += 1
                if len(rem["records"]) < IMPACT_LIST:
                    rem["records"].append(_record(n, label, origin))
            if len(o["snippets"]) < IMPACT_SNIPPETS and n["type"] != "Episode":
                lo, hi = max(0, a - IMPACT_CTX), min(len(text), b + IMPACT_CTX)
                o["snippets"].append({"type": n["type"],
                                      "before": ("…" if a > IMPACT_CTX else "") + _masked(text, lo, a, spans),
                                      "match": text[a:b],
                                      "after": _masked(text, b, hi, spans) + ("…" if hi < len(text) else "")})
    return out


def other_copies(store: GraphStore, sc: "Scope") -> dict[str, int]:
    """unutma yalnız bu ad alanının belleğine dokunur. Başka ad alanlarında (projeler, genel bellek) hedef
    cümleyi ya da bir aday terimi (özel ad önerileri hariç; kısa sayı yalnız anahtar sözcükle) taşıyan bilgi, teslim
    ve mesaj SAYISI (içerik yok)."""
    cands = [c for c in sc.token_candidates if c["kind"] != "name"]
    table, cmax = _term_table([c["text"] for c in cands], sc.amount_ok)
    kwonly = {k for k, c in enumerate(cands) if c.get("kwonly")}
    canon_of = [term_canon(c["text"]) for c in cands]
    sent = _inside_matcher(sc)
    out = {"facts": 0, "deliverables": 0, "messages": 0, "total": 0, "projects": 0}
    if not table and not sent.seqs:
        return out
    from studio.graph.store import _node  # noqa: PLC0415
    ns = sc.namespace
    foreign = sorted(foreign_runs(store, ns))
    with store._read() as conn:  # noqa: SLF001
        if nsm.is_global(ns):
            rows = conn.execute("SELECT * FROM nodes WHERE type = 'Fact' AND json_extract(props, '$.namespace') "
                                "IS NOT NULL AND json_extract(props, '$.namespace') NOT IN ('', ?)", (ns,)).fetchall()
        else:
            rows = conn.execute("SELECT * FROM nodes WHERE type = 'Fact' AND COALESCE(json_extract(props, "
                                "'$.namespace'), '') != ?", (ns,)).fetchall()
        for chunk in _chunks(foreign):
            rows += conn.execute(f"SELECT * FROM nodes WHERE type IN ('Deliverable', 'Message') AND "
                                 f"json_extract(props, '$.run_id') IN ({','.join('?' * len(chunk))})", chunk).fetchall()
    run_ns: dict[str, str] = {}
    spaces: set[str] = set()
    field_of = {"Fact": "facts", "Deliverable": "deliverables", "Message": "messages"}
    for r in rows:
        n = _node(r)
        text = _node_text(n)
        if not text:
            continue
        hit = bool(sent.seqs) and sent.contains(text)
        if not hit:
            kwc: list[str] | None = None
            for k, _a, _b, _x in _scan_terms(text, table, cmax):
                if k in kwonly:
                    kwc = _kw_canons(text) if kwc is None else kwc
                    if canon_of[k] not in kwc:
                        continue
                hit = True
                break
        if not hit:
            continue
        out[field_of[n["type"]]] += 1
        out["total"] += 1
        if n["type"] == "Fact":
            spaces.add(nsm.of_node(n))
        else:
            rid = str((n.get("props") or {}).get("run_id") or "")
            if rid not in run_ns:
                run = store.find("Run", rid)
                run_ns[rid] = str(((run or {}).get("props") or {}).get("project") or nsm.GLOBAL)
            spaces.add(run_ns[rid])
    out["projects"] = len(spaces)
    return out


def _ns_episodes(store: GraphStore, ns: str, exclude: set[str]) -> list[dict[str, Any]]:
    from studio.graph.store import _node  # noqa: PLC0415
    with store._read() as conn:  # noqa: SLF001
        if nsm.is_global(ns):
            rows = conn.execute("SELECT * FROM nodes WHERE type = 'Episode' AND (json_extract(props, '$.namespace') "
                                "IS NULL OR json_extract(props, '$.namespace') IN ('', ?))", (ns,)).fetchall()
        else:
            rows = conn.execute("SELECT * FROM nodes WHERE type = 'Episode' AND json_extract(props, '$.namespace') = ?",
                                (ns,)).fetchall()
    return [_node(r) for r in rows if r["id"] not in exclude]


# ------------------------------------------------------------------ dürüst sonuç (ne okunur kalıyor)
REMAIN_KEYS = ("facts_user", "facts_run", "deliverables", "messages", "episodes",
               # uygulamadan sonraki doğrulama taraması bütün kayıt türlerini sayar
               "concepts", "steps", "runs", "other", "run_events", "event_log", "sse", "tool_outputs", "fts",
               "vault")  # çıktı kasası blob'ları


def remains_list(cands: list[dict[str, Any]], impact: list[dict[str, Any]], *,
                 post: bool = False) -> list[dict[str, Any]]:
    """terim başına okunur kalacak (uygulamadan sonra: kalan) kayıtlar. Özel ad önerileri (VPN, IBAN …)
    listelenmez. Uygulamadan önce yalnız işaretsiz terimler (seçili terim ad alanının her yerinde karartılır); içeride de
    dokunulmasın denen terimin içerideki kopyaları da sayılır (`inside`). `post`: uygulamadan sonra her terim."""
    out: list[dict[str, Any]] = []
    for c, imp in zip(cands, impact):
        if c["kind"] == "name" or (c["selected"] and not post):
            continue
        rem = imp.get("remains") or {}
        # içeride de dokunulmasın denen terimin içerideki kopyaları (uygulamadan önce); sonra `post` sayımı
        extra = int(imp.get("inside_copies") or 0) if not post and not c["selected"] and not c.get("scoped") else 0
        inside = int(rem.get("inside") or 0) + extra
        total = int(rem.get("total") or 0) + extra
        plain = int(imp.get("plain_records") or 0) if c.get("kwonly") else 0  # "4417 adet" korunur
        if not total and not plain:
            continue
        out.append({"text": c["text"], "kind": c["kind"], "held": bool(c.get("held")), "selected": bool(c["selected"]),
                    "scoped": bool(c.get("scoped")), "kwonly": bool(c.get("kwonly")),
                    **{k: int(rem.get(k) or 0) for k in REMAIN_KEYS}, "inside": inside, "total": total,
                    "plain": plain, "records": list(rem.get("records") or [])})
    return out


def separator_list(cands: list[dict[str, Any]], impact: list[dict[str, Any]],
                   sc: "Scope | None" = None) -> list[dict[str, Any]]:
    """ayraçla birleşik (tam yazım dışı) eşleşmeler — uygulanacak olanlar: seçili terimde ad alanının her
    yerinde, işaretsiz (içeride karartılan) terimde yalnız içeride. her kaydın uygulamadaki sonucu
    (`outcome`): "redact" (yalnız eşleşen aralık karartılır) ya da "delete" (karartmadan sonra `RESIDUAL_MIN`
    sözcükten az kalıyor: kayıt silinir). Karar uygulamanın kendi kararıdır (`fact_outcome` → `sc.delete`)."""
    out: list[dict[str, Any]] = []
    gone = set(sc.delete) if sc is not None else set()
    for c, imp in zip(cands, impact):
        if c["selected"]:
            recs = imp.get("loose") or []
        elif c.get("scoped"):
            recs = [r for r in imp.get("loose") or [] if r.get("inside")]
        else:
            continue
        out += [{**r, "term": c["text"], "outcome": "delete" if r["id"] in gone else "redact"} for r in recs]
    return out


def amount_list(cands: list[dict[str, Any]], impact: list[dict[str, Any]], sc: "Scope") -> list[dict[str, Any]]:
    """seçili ya da içeride karartılacak sayısal terimin tutar biçimli geçişleri ("900.000 TL"). Kullanıcı
    terimi tutarlar için açıkça işaretlemedikçe (`amounts`) bu kayıtlara dokunulmaz."""
    out: list[dict[str, Any]] = []
    for c, imp in zip(cands, impact):
        if not (c["selected"] or c.get("scoped")) or not imp.get("amounts"):
            continue
        out.append({"term": c["text"], "total": int(imp["amounts"]), "records": list(imp.get("amount_records") or []),
                    "allowed": term_canon(c["text"]) in {term_canon(t) for t in sc.amount_ok}})
    return out


_REM_TR = {"facts_user": "{n} kullanıcı bilgisi", "facts_run": "başka koşulardan {n} bilgi", "deliverables": "{n} teslim",
           "messages": "{n} mesaj", "episodes": "{n} anı", "concepts": "{n} kavram adı", "steps": "{n} adım",
           "runs": "{n} koşu kaydı", "other": "{n} başka kayıt", "run_events": "{n} koşu olayı",
           "event_log": "{n} olay günlüğü satırı", "sse": "{n} canlı akış önbellek satırı",
           "tool_outputs": "{n} araç çıktısı", "fts": "{n} arama dizini satırı", "vault": "{n} çıktı kasası dosyası",
           "inside": "hedef koşunun {n} kaydı"}
_REM_EN = {"facts_user": ("{n} user-written fact", "{n} user-written facts"),
           "facts_run": ("{n} fact from other runs", "{n} facts from other runs"),
           "deliverables": ("{n} output", "{n} outputs"), "messages": ("{n} message", "{n} messages"),
           "episodes": ("{n} episode", "{n} episodes"), "concepts": ("{n} concept name", "{n} concept names"),
           "steps": ("{n} step", "{n} steps"), "runs": ("{n} run record", "{n} run records"),
           "other": ("{n} other record", "{n} other records"), "run_events": ("{n} run event", "{n} run events"),
           "event_log": ("{n} event log row", "{n} event log rows"),
           "sse": ("{n} live stream cache row", "{n} live stream cache rows"),
           "tool_outputs": ("{n} tool output", "{n} tool outputs"),
           "fts": ("{n} search index row", "{n} search index rows"),
           "vault": ("{n} output vault file", "{n} output vault files"),
           "inside": ("{n} record of the target run", "{n} records of the target run")}
SENTENCE = "sentence"  # doğrulama taramasında hedef cümlenin kendisi (terim değil)
CLEAN_TR = "Bu bellek alanında okunur kopya kalmadı."
CLEAN_EN = "No readable copy is left in this memory space."


def _rem_parts(r: dict[str, Any], lang: str) -> str:
    parts = []
    for k in (*REMAIN_KEYS, "inside"):
        n = int(r.get(k) or 0)
        if n:
            parts.append(_REM_TR[k].format(n=n) if lang == "tr" else _REM_EN[k][0 if n == 1 else 1].format(n=n))
    return ", ".join(parts)


def remains_text(remains: list[dict[str, Any]], other: dict[str, Any], lang: str, nodes: int | None = None,
                 unscanned: int = 0) -> str:
    """kullanıcıya dönen sonuç metni (TR/EN, doğru noktalama ve çoğul). Bir şey okunur kaldıysa
    yalnız "N düğüm silindi" demez. uygulamadan sonra `remains` doğrulama taramasından gelir; "okunur kopya
    kalmadı" yalnız tarama hiçbir şey bulmadıysa (anahtar sözcüksüz sayı geçişi dahil) söylenir."""
    tr = lang != "en"
    out: list[str] = []
    if nodes is not None:
        out.append(f"Unutuldu: {nodes} düğüm silindi, türevler karartıldı." if tr else
                   f"Forgotten: {nodes} {'node' if nodes == 1 else 'nodes'} deleted, derived data redacted.")
    readable = 0
    for r in remains:
        parts = _rem_parts(r, "tr" if tr else "en")
        if parts:
            readable += 1
            if r.get("kind") == SENTENCE:
                out.append(f"Unutulan cümle şu kayıtlarda okunur kalır: {parts}. Ajanlar bunları hatırlayabilir." if tr
                           else f"The forgotten sentence stays readable in {parts}. Agents can still recall these.")
            else:
                out.append(f"'{r['text']}' şu kayıtlarda okunur kalır: {parts}. Ajanlar bunları hatırlayabilir." if tr
                           else f"'{r['text']}' stays readable in {parts}. Agents can still recall these.")
        p = int(r.get("plain") or 0)
        if p:  # kısa sayı başka anlamda ("4417 adet") geçtiği kayıtlarda korunur
            readable += 1
            out.append(f"'{r['text']}' sayısı anahtar sözcüksüz (ör. tutar, adet, tarih) geçtiği {p} kayıtta korunur; "
                       f"bunlar gizli değer olarak sayılmadı." if tr else
                       f"The number '{r['text']}' is kept in {p} {'record' if p == 1 else 'records'} where it appears "
                       f"without a keyword (e.g. an amount, a count or a date); those weren't treated as the secret.")
    n = int((other or {}).get("total") or 0)
    if n:
        k = int((other or {}).get("projects") or 0)
        out.append(f"{k} başka bellek alanında {n} kopya var; bu unutma yalnız bu alanın belleğine dokunur." if tr
                   else f"{n} {'copy' if n == 1 else 'copies'} remain in {k} other memory "
                        f"{'space' if k == 1 else 'spaces'}; this forget only touches this space's memory.")
    if unscanned:  # QA34b-01: kasada tam taranamayan dosya varken "okunur kopya kalmadı" denmez
        out.append(f"{unscanned} çıktı kasası dosyası taranamadı (ikili ya da çok büyük); unutulan metin bunların "
                   f"içinde olabilir." if tr else
                   f"{unscanned} output vault {'file' if unscanned == 1 else 'files'} could not be scanned (binary or "
                   f"too large); the forgotten text may be inside {'it' if unscanned == 1 else 'them'}.")
    if nodes is not None and not readable and not n and not unscanned:
        out.append(CLEAN_TR if tr else CLEAN_EN)
    return " ".join(out)


# ------------------------------------------------------------------ uygulamadan sonra doğrulama taraması
_NODE_CAT = {"Deliverable": "deliverables", "Message": "messages", "Episode": "episodes", "Concept": "concepts",
             "Step": "steps", "Run": "runs"}


def _flat_strings(v: Any, out: list[str], depth: int = 0) -> list[str]:
    """Değerdeki bütün metinler (JSON olarak saklanan metin çözülmüş hâliyle de)."""
    if isinstance(v, str):
        if v:
            out.append(v)
            if depth < 4 and len(v) <= JSON_SCAN_MAX and v.lstrip()[:1] in ("{", "["):
                try:
                    j = json.loads(v)
                except ValueError:
                    j = None
                if isinstance(j, (dict, list)):
                    _flat_strings(j, out, depth + 1)
    elif isinstance(v, dict):
        for x in v.values():
            _flat_strings(x, out, depth)
    elif isinstance(v, list):
        for x in v:
            _flat_strings(x, out, depth)
    return out


@dataclass
class _Overlay:
    """önizlemede uygulamanın YAZACAĞI durum (kuru çalıştırma). Uygulamanın kendi planından (`_analyze`)
    gelir: silinecek düğümler, düğüm yamaları (props birleşimi, None = sil, etiket yeniden), koşu olayı / olay günlüğü /
    araç çıktısı yeni metinleri ve SSE önbelleğinden düşecek satırlar. Doğrulayıcı bu katmanla depoları okur; böylece
    önizlemenin "okunur kalır" sayımı uygulamadan sonraki taramayla AYNI işlevden gelir."""

    delete: set[str]
    patches: dict[str, dict[str, Any]]
    run_events: dict[int, str]
    event_log: dict[int, str]
    sse_drop: set[int]
    tools: dict[tuple[str, str], str]


class _Verifier:
    """uygulamadan SONRA, seçili ve tutulan/önerilen her terim (seçilmemiş özel ad önerileri hariç) ve hedef
    cümle için bu bellek alanında hâlâ okunur kopya taşıyan kayıtları DEPOLARDAN okuyarak sayar (plandan tahmin değil):
    bilgiler, kavramlar (ad ve özellikler), anılar, teslimler, adımlar, mesajlar, koşular (kontrol noktası dahil), diğer
    koşu kayıtları, koşu olayları, `events.db`, SSE önbelleği, araç çıktısı artefaktları ve arama dizini. Dışa aktarma
    paketi bu depolardan üretilir. Eşleme önizlemeyle aynı kuraldır (kanonik birleşim, ayraç, kısa terimde tam yazım,
    tutar biçimi; anahtar sözcüklü kısa sayı yalnız anahtar sözcükten sonra, başka anlamdaki geçiş `plain`). Terim ya da
    içerik günlüğe yazılmaz; sonuç yalnız kullanıcının yanıtında döner."""

    def __init__(self, store: GraphStore, sc: "Scope", overlay: _Overlay | None = None):
        self.store, self.sc = store, sc
        self.ov = overlay  # önizleme (kuru çalıştırma); kayıtlar maskeli etiket taşır
        self.cands = [c for c in sc.token_candidates if c["kind"] != "name" or c["selected"]]
        self.table, self.cmax = _term_table([c["text"] for c in self.cands], sc.amount_ok)
        self.kw = {k for k, c in enumerate(self.cands) if c.get("kwonly")}
        self.canon = [term_canon(c["text"]) for c in self.cands]
        self.sent = _inside_matcher(sc)
        self.unscanned: dict[str, int] = {}  # QA34b-01: tam taranamayan kayıtlar (şimdilik yalnız "vault")
        self.S = len(self.cands)  # hedef cümlenin sırası
        blank = {**{k: 0 for k in REMAIN_KEYS}, "inside": 0, "total": 0, "plain": 0}
        self.out = [{"text": c["text"], "kind": c["kind"], "held": bool(c.get("held")),
                     "selected": bool(c["selected"]), "scoped": bool(c.get("scoped")), "kwonly": bool(c.get("kwonly")),
                     **blank, "records": []} for c in self.cands]
        self.out.append({"text": "", "kind": SENTENCE, "held": False, "selected": True, "scoped": False,
                         "kwonly": False, **blank, "records": []})

    def scan(self, strings: Iterable[str]) -> tuple[set[int], set[int]]:
        hit: set[int] = set()
        plain: set[int] = set()
        for s in strings:
            if not s:
                continue
            kwc: list[str] | None = None
            for k, _a, _b, _x in _scan_terms(s, self.table, self.cmax):
                if k in self.kw:
                    kwc = _kw_canons(s) if kwc is None else kwc
                    (hit if self.canon[k] in kwc else plain).add(k)
                else:
                    hit.add(k)
            if self.sent.seqs and self.S not in hit and self.sent.contains(s):
                hit.add(self.S)
        return hit, plain - hit

    def add(self, hit: set[int], plain: set[int], cat: str, rec: dict[str, Any] | None = None) -> None:
        for k in hit:
            o = self.out[k]
            o[cat] += 1
            o["total"] += 1
            if rec is not None and cat != "inside" and len(o["records"]) < IMPACT_LIST:
                o["records"].append(rec)
        for k in plain:
            self.out[k]["plain"] += 1

    # ---- kapsam
    def _runs(self) -> set[str]:
        return (_ns_runs(self.store, self.sc.namespace) | self.sc.runs) - {""}

    def _nodes(self, runs: set[str]) -> dict[str, dict[str, Any]]:
        from studio.graph.store import _node  # noqa: PLC0415
        ns, st, sc = self.sc.namespace, self.store, self.sc
        esc = ns.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "::%"
        with st._read() as conn:  # noqa: SLF001
            if nsm.is_global(ns):
                rows = conn.execute("SELECT * FROM nodes WHERE type IN ('Fact', 'Episode') AND (json_extract(props, "
                                    "'$.namespace') IS NULL OR json_extract(props, '$.namespace') IN ('', ?))",
                                    (ns,)).fetchall()
                rows += conn.execute("SELECT * FROM nodes WHERE type = 'Concept' AND (json_type(props, '$.namespaces')"
                                     " IS NOT 'array' OR json_array_length(props, '$.namespaces') = 0 OR EXISTS (SELECT 1"
                                     " FROM json_each(nodes.props, '$.namespaces') je WHERE je.value = ?))",
                                     (ns,)).fetchall()
            else:
                rows = conn.execute("SELECT * FROM nodes WHERE type IN ('Fact', 'Episode') AND "
                                    "json_extract(props, '$.namespace') = ?", (ns,)).fetchall()
                rows += conn.execute("SELECT * FROM nodes WHERE type = 'Concept' AND (key LIKE ? ESCAPE '\\' OR EXISTS "
                                     "(SELECT 1 FROM json_each(nodes.props, '$.namespaces') je WHERE je.value = ?))",
                                     (esc, ns)).fetchall()
            for chunk in _chunks(sorted(runs)):
                marks = ",".join("?" * len(chunk))
                rows += conn.execute(f"SELECT * FROM nodes WHERE json_extract(props, '$.run_id') IN ({marks}) OR "
                                     f"(type = 'Run' AND json_extract(props, '$.id') IN ({marks}))",
                                     (*chunk, *chunk)).fetchall()
        out = {r["id"]: _node(r) for r in rows}
        if self.ov is not None:
            out = {nid: self._ov_node(n) for nid, n in out.items() if nid not in self.ov.delete}
        mem = [nid for nid, n in out.items() if n["type"] in ("Fact", "Episode")]
        for _nid, items in st.neighbors_many(mem, ["ABOUT", "MENTIONS"], "out").items():  # bağlı kavramlar
            for e, nb, _d in items:
                if nb["type"] == "Concept" and not (self.ov is not None and (
                        nb["id"] in self.ov.delete or e["id"] in sc.unlink_edges)):
                    out.setdefault(nb["id"], self._ov_node(nb))
        for cid, n in st.get_nodes(sc.concept_ns).items():  # ad alanından çıkan paylaşılan kavramlar
            out.setdefault(cid, self._ov_node(n))
        return out

    def _ov_node(self, n: dict[str, Any]) -> dict[str, Any]:
        """Kuru çalıştırmada düğümün uygulamadan sonraki hâli (`GraphStore.patch_node` birleşimi)."""
        patch = self.ov.patches.get(n["id"]) if self.ov is not None else None
        if not patch:
            return n
        merged = {**(n.get("props") or {}), **patch}
        for k, v in patch.items():
            if v is None:
                merged.pop(k, None)
        try:
            label = self.store.ontology.label_of(n["type"], merged)
        except Exception:  # noqa: BLE001
            label = n.get("label")
        return {**n, "props": merged, "label": label}

    def _inside(self, n: dict[str, Any]) -> bool:
        sc = self.sc
        if n["type"] == "Concept":
            return False
        p = n.get("props") or {}
        if n["type"] == "Fact":
            return n["id"] in sc.base or _same_run_fact(self.store, n, sc.source_runs)
        rid = p.get("run_id") or (p.get("id") if n["type"] == "Run" else "")
        return str(rid or "") in sc.source_runs

    def run(self, studio: Any, tool_store: Any) -> list[dict[str, Any]]:
        st, sc = self.store, self.sc
        if not self.cands and not self.sent.seqs:
            return []
        runs = self._runs()
        nodes = self._nodes(runs)
        node_hits: dict[str, set[int]] = {}
        for nid, n in nodes.items():
            strings = [str(n.get("label") or ""), *([str(n.get("key") or "")] if n["type"] == "Concept" else []),
                       *_flat_strings(n.get("props") or {}, [])]
            hit, plain = self.scan(strings)
            if not hit and not plain:
                continue
            node_hits[nid] = hit
            props = n.get("props") or {}
            if self._inside(n):
                cat = "inside"
            elif n["type"] == "Fact":
                cat = "facts_user" if _user_origin(props) else "facts_run"
            else:
                cat = _NODE_CAT.get(n["type"], "other")
            origin = "user" if n["type"] == "Fact" and _user_origin(props) else "run"
            rec = {"type": n["type"], "id": nid, "run_id": props.get("run_id"), "origin": origin}
            if self.ov is not None:  # önizleme: maskeli etiket (yalnız kullanıcıya ait plan yanıtında)
                rec["label"] = _mask_terms(str(n.get("label") or ""), self.table, self.cmax) or nid
            self.add(hit, plain, cat, rec)
        # arama dizini: düğümün kendisi sayılmadıysa (eski ya da yetim dizin satırı)
        ids = sorted(set(nodes) | set(sc.delete))
        if self.ov is not None:  # silinenin satırı kalkar, yamalananınki yeni metinden yeniden dizinlenir
            ids = [i for i in ids if i not in self.ov.delete and i not in self.ov.patches]
        fts = []
        with st._read() as conn:  # noqa: SLF001
            for chunk in _chunks(ids):
                fts += conn.execute(f"SELECT node_id, label, body FROM nodes_fts WHERE node_id IN "
                                    f"({','.join('?' * len(chunk))})", chunk).fetchall()
        for r in fts:
            hit, _plain = self.scan([str(r["label"] or ""), str(r["body"] or "")])
            hit -= node_hits.get(str(r["node_id"]), set())
            if hit:
                self.add(hit, set(), "fts")
        # koşu olayları
        for r in st.run_event_rows(runs):
            if self.ov is not None and r.get("rowid") in self.ov.run_events:
                r = {**r, "data": self.ov.run_events[r["rowid"]]}
            hit, plain = self.scan(_flat_strings(r.get("data"), []))
            self.add(hit, plain, "inside" if str(r.get("run_id") or "") in sc.source_runs else "run_events")
        # kalıcı olay günlüğü (events.db) ve SSE önbelleği: yalnız bu ad alanının satırları
        foreign = foreign_runs(st, sc.namespace) - runs
        sources: list[tuple[str, list[tuple[int, str]]]] = []
        elog = getattr(studio, "events_log", None)
        if elog is not None:
            rows_ = elog.all_rows()
            if self.ov is not None:
                rows_ = [(q, self.ov.event_log.get(q, d)) for q, d in rows_]
            sources.append(("event_log", rows_))
        cache = getattr(getattr(studio, "bus", None), "_json", None)
        if isinstance(cache, dict):
            sources.append(("sse", [(q, d) for q, d in list(cache.items())
                                    if self.ov is None or q not in self.ov.sse_drop]))
        for cat, raw_rows in sources:
            for _seq, _typ, run, data in scope_items(_log_items(raw_rows), foreign, sc.namespace, runs):
                hit, plain = self.scan(_flat_strings(data, []))
                self.add(hit, plain, "inside" if str(run or "") in sc.source_runs else cat)
        # araç çıktısı artefaktları
        if tool_store is not None:
            for row in tool_store.rows(sorted(runs)):
                key = (str(row.get("run_id") or ""), str(row.get("id") or ""))
                text = self.ov.tools[key] if self.ov is not None and key in self.ov.tools else tool_store.text(row)
                if text:
                    hit, plain = self.scan([text])
                    self.add(hit, plain, "inside" if str(row.get("run_id") or "") in sc.source_runs else "tool_outputs")
        if self.ov is None:  # çıktı kasası (önizleme kuru çalıştırmasında uygulama bu blob'ları zaten siler)
            for chunks, complete in self._vault_texts(studio):
                if not complete:  # QA34b-01: tam taranamayan (ikili / büyük / içi okunamayan) blob "temiz" sayılmaz
                    self.unscanned["vault"] = self.unscanned.get("vault", 0) + 1
                if chunks:
                    hit, plain = self.scan(chunks)
                    self.add(hit, plain, "vault")
        return [o for o in self.out if o["total"] or o["plain"]]

    @staticmethod
    def _vault_texts(studio: Any) -> Iterator[tuple[list[str], bool]]:
        try:
            from studio.deliverables.api import get_service  # noqa: PLC0415

            vault = get_service(studio).vault
            blobs = vault.iter_blobs() if vault is not None else []
        except Exception:  # noqa: BLE001 - kasa yoksa / okunamıyorsa taranacak bir şey yok
            return
        for sha, _mtime in blobs:
            yield _vault_chunks(vault.path_for(sha))


def verify_remains(studio: Any, store: GraphStore, sc: "Scope", tool_store: Any = None,
                   overlay: _Overlay | None = None, unscanned: dict[str, int] | None = None) -> list[dict[str, Any]]:
    """uygulamadan sonra doğrulanmış kalanlar (bkz. `_Verifier`). `overlay` verilirse aynı tarama
    uygulamanın yazacağı durum üzerinde kuru çalışır (önizleme tahmini = uygulamadan sonraki sonuç). QA34b-01:
    `unscanned` verilirse tam taranamayan kayıt sayıları (`{"vault": n}`) oraya yazılır."""
    v = _Verifier(store, sc, overlay)
    out = v.run(studio, tool_store)
    if unscanned is not None:
        unscanned.update(v.unscanned)
    return out


def _bus_drops(rows: list[tuple[int, str]], m: Matcher, foreign: set[str] | None = None, ns: str | None = None,
               keep: set[str] | None = None, only: set[str] | None = None) -> set[int]:
    """SSE yeniden oynatma önbelleğinden düşecek satırlar (uygulama ve önizleme aynı kararı kullanır)."""
    items = _log_items(rows)
    if only is not None:  # yalnız bu koşuların satırları
        items = [it for it in items if str(it[2] or "") in only]
    if foreign is not None and ns is not None:  # yalnız unutma ad alanının satırları
        items = scope_items(items, foreign, ns, keep or set())
    # parçalara bölünmüş cümlenin her parçası da düşer
    return set(scrub_events(m, items))


# ------------------------------------------------------------------ servis
@dataclass
class Plan:
    id: str
    scope: str
    target: str | None
    namespace: str
    fingerprint: str
    preview: dict[str, Any]
    created: float = field(default_factory=time.time)
    tokens: list[str] = field(default_factory=list)   # seçili jetonlar (uygulamada aynı seçim)
    unscoped: list[str] = field(default_factory=list)  # içeride de karartılmayacak işaretsiz terimler
    amounts: list[str] = field(default_factory=list)   # tutar biçimiyle de eşleşecek sayısal terimler


class ForgetService:
    def __init__(self, studio: Any):
        self.studio = studio
        self.dir = Path(studio.changes.data_dir) / SUBDIR
        self.pending: dict[str, Plan] = {}
        self._lock = threading.RLock()   # plan/uygula/geri al sıralaması
        self._tlock = threading.Lock()   # yalnız mezar önbelleği (yazma kapısı bunu alır; graf kilidiyle iç içe girmez)
        self._tombs: list[dict[str, Any]] | None = None
        self._inflight: dict[str, list[str]] = {}  # canlı koşu → düz metin iğneleri (yalnız bellekte; kanca için)
        self._inflight_terms: dict[str, list[str]] = {}  # canlı koşu → seçili jetonlar (yalnız bellekte)
        studio.store.write_guard = self.guard
        self._attach_engine()

    # ------------------------------------------------------------ yollar ve kayıtlar
    @property
    def store(self) -> GraphStore:
        return self.studio.store

    @property
    def data_dir(self) -> Path:
        return Path(self.studio.changes.data_dir)

    @property
    def tomb_path(self) -> Path:
        return self.dir / "tombstones.json"

    @property
    def log_path(self) -> Path:
        return self.dir / "log.jsonl"

    def backup_path(self, change_id: str) -> Path:
        return self.dir / "backups" / f"{change_id}.json"

    # ------------------------------------------------------------ yedek: şifreli + doğrulanmış
    def _key(self) -> bytes:
        """Yedek anahtarı (`<veri>/forget/.key`, 0600). Yedek düz metin tutulmaz; değiştirilmiş yedek geri yüklenmez.
        Sınır: anahtar veri dizinindedir; o dizine yazabilen biri anahtarı da okuyabilir (yerel saldırgan modeli)."""
        path = self.dir / ".key"
        with self._tlock:
            try:
                raw = bytes.fromhex(path.read_text("ascii").strip())
                if len(raw) == 32:
                    return raw
            except (OSError, ValueError):
                pass
            raw = os.urandom(32)
            self._write_json_raw(path, raw.hex())
            return raw

    def _write_json_raw(self, path: Path, text: str) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_name(f".{path.name}.{uuid.uuid4().hex[:6]}.tmp")
        tmp.write_text(text, "utf-8")
        _restrict(tmp)
        os.replace(tmp, path)

    def _seal(self, obj: Any, change_id: str | None = None) -> dict[str, Any]:
        """MAC değişiklik kimliğine bağlıdır: başka bir unutmanın yedeği bu yola konursa doğrulanmaz.
        Sınır (belgeli): `<veri>/forget/.key` dosyasını okuyabilen yerel saldırgan geçerli yedek üretebilir."""
        key = self._key()
        cid = str(change_id or (obj.get("id") if isinstance(obj, dict) else "") or "")
        nonce = os.urandom(16)
        plain = json.dumps(obj, ensure_ascii=False, default=str).encode("utf-8")
        ct = bytes(a ^ b for a, b in zip(plain, _keystream(key, nonce, len(plain))))
        mac = hmac.new(key, _mac_input(cid, nonce, ct), hashlib.sha256).hexdigest()
        # biçim sürümü 2 kalır ( düzeni); `id` alanı varsa MAC ona bağlıdır. `id` silinirse eski MAC girdisiyle
        # doğrulanır ve tutmaz (bağlı MAC farklıdır) → alanı atarak bağlamadan kaçılamaz.
        return {"v": 2, "id": cid, "nonce": nonce.hex(), "ct": base64.b64encode(ct).decode("ascii"), "mac": mac}

    def _open_sealed(self, sealed: Any, change_id: str | None = None) -> dict[str, Any]:
        if not isinstance(sealed, dict) or sealed.get("v") != 2:
            raise ForgetError(ERR_BACKUP)
        try:
            key = self._key()
            nonce = bytes.fromhex(str(sealed["nonce"]))
            ct = base64.b64decode(str(sealed["ct"]), validate=True)
            if "id" in sealed:  # kimliğe bağlı MAC
                cid = str(sealed.get("id") or "")
                if change_id is not None and cid != change_id:
                    raise ForgetError(ERR_BACKUP)
                mac = hmac.new(key, _mac_input(cid, nonce, ct), hashlib.sha256).hexdigest()
            else:  # sürümü (pencere içindeki eski yedekler): kimlik aşağıda şifreli içerikten denetlenir
                mac = hmac.new(key, b"forget-backup-v2" + nonce + ct, hashlib.sha256).hexdigest()
            if not hmac.compare_digest(mac, str(sealed.get("mac") or "")):
                raise ForgetError(ERR_BACKUP)
            plain = bytes(a ^ b for a, b in zip(ct, _keystream(key, nonce, len(ct))))
            out = json.loads(plain.decode("utf-8"))
        except ForgetError:
            raise
        except (KeyError, ValueError, TypeError):
            raise ForgetError(ERR_BACKUP) from None
        if not isinstance(out, dict):
            raise ForgetError(ERR_BACKUP)
        if change_id is not None and str(out.get("id") or "") != change_id:
            raise ForgetError(ERR_BACKUP)  # yedek bu değişikliğe ait değil
        return out

    def _write_backup(self, change_id: str, backup: dict[str, Any]) -> None:
        self._write_json(self.backup_path(change_id), self._seal(backup, change_id))
        self._schedule_purge()

    def _read_backup(self, change_id: str) -> dict[str, Any]:
        return self._open_sealed(json.loads(self.backup_path(change_id).read_text("utf-8")), change_id)

    def _schedule_purge(self) -> None:
        """Pencere dolunca yedek kendiliğinden silinir (açılışta ve her unutma işleminde de süpürülür)."""
        t = threading.Timer(UNDO_WINDOW_S + 5, self.purge_expired)
        t.daemon = True
        t.start()

    def _write_json(self, path: Path, obj: Any) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_name(f".{path.name}.{uuid.uuid4().hex[:6]}.tmp")
        tmp.write_text(json.dumps(obj, ensure_ascii=False, default=str), "utf-8")
        _restrict(tmp)
        os.replace(tmp, path)

    def tombstones(self) -> list[dict[str, Any]]:
        with self._tlock:
            if self._tombs is None:
                try:
                    raw = json.loads(self.tomb_path.read_text("utf-8")) if self.tomb_path.is_file() else []
                except (OSError, ValueError):
                    log.exception("mezar kaydı okunamadı")
                    raw = []
                self._tombs = [t for t in raw if isinstance(t, dict) and t.get("id")]
                for t in self._tombs:
                    t["_keys"], t["_hashes"], t["_runs"] = set(t.get("keys") or []), set(t.get("hashes") or []), \
                        set(t.get("runs") or [])
                    t["_trecs"] = [t["tokens"]] if isinstance(t.get("tokens"), dict) else []
                    # işaretsiz terimler yalnız kaynak koşuların kayıtlarına uygulanır
                    t["_sruns"] = set(t.get("scoped_runs") or []) if isinstance(t.get("scoped"), dict) else set()
                    t["_runs"] |= t["_sruns"]
                    t["_pkeys"] = set(t.get("pkeys") or [])  # ayraçla eşleştiği için karartılan bilgiler
            return self._tombs

    @staticmethod
    def tomb_matcher(t: dict[str, Any], needles: Iterable[str] = (), terms: Iterable[str] = ()) -> Matcher:
        """Yalnız mezar kaydıyla (ve varsa bellekteki düz iğnelerle) çalışan eşleyici (jeton özetleri dahil)."""
        return Matcher(needles, t.get("_hashes") or set(t.get("hashes") or []), t.get("lens") or (), terms=terms,
                       token_recs=t.get("_trecs") or ([t["tokens"]] if isinstance(t.get("tokens"), dict) else []),
                       shingle_salt=t.get("shingle_salt"))

    def _cached_matcher(self, t: dict[str, Any]) -> Matcher:
        """mezar kaydının eşleyicisi bir kez kurulur (kayıt yeniden okununca düşer)."""
        m = t.get("_m")
        if m is None:
            m = t["_m"] = self.tomb_matcher(t)
        return m

    def _split_matchers(self, t: dict[str, Any], run: str = "", live: bool = False) -> tuple[Matcher, Matcher]:
        """(cümle eşleyicisi, jeton eşleyicisi) — yazma kapısı ayraçla birleşik jeton geçişini reddetmez,
        karartır. Canlı koşuda bellekteki düz iğneler/terimler de eklenir (önbelleğe alınmaz)."""
        if live:
            return (Matcher(self._inflight.get(run, ()), t.get("_hashes") or set(), t.get("lens") or (),
                            shingle_salt=t.get("shingle_salt")),
                    Matcher(terms=self._inflight_terms.get(run, ()), token_recs=t.get("_trecs") or ()))
        pair = t.get("_split")
        if pair is None:
            pair = t["_split"] = (Matcher((), t.get("_hashes") or set(), t.get("lens") or (),
                                          shingle_salt=t.get("shingle_salt")),
                                  Matcher(token_recs=t.get("_trecs") or ()))
        return pair

    @staticmethod
    def _scoped_tomb_matcher(t: dict[str, Any]) -> Matcher | None:
        """mezar kaydının işaretsiz terim bölümü (yalnız kaynak koşuların kayıtlarına uygulanır)."""
        if not isinstance(t.get("scoped"), dict):
            return None
        m = t.get("_sm")
        if m is None:
            m = t["_sm"] = Matcher(token_recs=[t["scoped"]])
        return m or None

    def _save_tombs(self, tombs: list[dict[str, Any]]) -> None:
        clean = [{k: v for k, v in t.items() if not k.startswith("_")} for t in tombs]
        with self._tlock:
            self._write_json(self.tomb_path, clean)
            self._tombs = None

    def _log(self, entry: dict[str, Any]) -> None:
        self.dir.mkdir(parents=True, exist_ok=True)
        with self.log_path.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(entry, ensure_ascii=False) + "\n")

    def history(self, limit: int = 100) -> list[dict[str, Any]]:
        self.purge_expired()
        if not self.log_path.is_file():
            return []
        entries = [json.loads(l) for l in self.log_path.read_text("utf-8").splitlines() if l.strip()]
        undone = {e["id"].rsplit(":", 1)[0] for e in entries if e.get("undone")}
        pending = set(self.wal_pending())  # WAL sıfırlaması hâlâ bekleyen unutmalar
        out = []
        for e in entries:
            if e.get("undone"):
                continue
            e = {**e, "undone": e["id"] in undone, "wal_pending": e["id"] in pending}
            e["can_undo"] = (not e["undone"] and time.time() - float(e["ts"]) <= UNDO_WINDOW_S
                             and self.backup_path(e["id"]).is_file())
            out.append(e)
        return list(reversed(out))[:limit]

    def purge_expired(self) -> int:
        """Pencere dolan yedekleri siler (unutma kalıcı olur)."""
        root = self.dir / "backups"
        if not root.is_dir():
            return 0
        n = 0
        for f in root.glob("*.json"):
            try:
                if time.time() - f.stat().st_mtime > UNDO_WINDOW_S:
                    f.unlink()
                    n += 1
            except OSError:
                pass
        return n

    # ------------------------------------------------------------ yazma kapısı
    def guard(self, type_name: str, props: dict[str, Any]) -> dict[str, Any]:
        if type_name not in ("Fact", "Episode", "Concept"):
            return props
        tombs = self.tombstones()
        if not tombs:
            return props
        if type_name == "Concept":
            return self._guard_concept(props, tombs)
        key = props.get("hash") if type_name == "Fact" else props.get("id")
        kh = key_hash(type_name, str(key or ""))
        created = str(props.get("recorded_from") or props.get("created_at") or "")
        cb = props.get("created_by") if isinstance(props.get("created_by"), dict) else {}
        run = str(props.get("run_id") or cb.get("run") or "")
        statement = str(props.get("statement") or "") if type_name == "Fact" else ""
        stmt = chashes(statement) if statement else set()
        probe = Probe(statement) if statement else None  # metin bir kez jetonlanır
        for t in tombs:
            old = not created or _before(created, str(t.get("ts") or ""))  # aynı saniye = yeni öğrenme
            from_run = bool(run) and run in t["_runs"]
            if not (old or from_run):
                continue
            same_ns = nsm.of_node({"props": props}) == t.get("namespace")
            hit = kh in t["_keys"] or (bool(stmt & t["_hashes"]) and same_ns)
            if t.get("scope") == "project" and old and nsm.of_node({"props": props}) == t.get("namespace"):
                hit = True
            live = from_run and (run in self._inflight or run in self._inflight_terms)
            if not hit and statement and same_ns:
                # unutulmuş cümleyi ya da jetonu İÇEREN önerme ("Önceki adımdan: <cümle>", "Kod: X").
                # unutma anında ayraçla eşleştiği için silinmeyip karartılan bilgi (`pkeys`; "Copper
                # Lantern, 58 Mill Road") geri yüklenirse reddedilmez, yine karartılarak yazılır. Başka eski kayıtta
                # ayraçla birleşik uzun kod reddedilir ( kuralı)
                m = self.tomb_matcher(t, self._inflight.get(run, ()), self._inflight_terms.get(run, ())) if live \
                    else self._cached_matcher(t)
                msent, mtok = self._split_matchers(t, run, live) if m.may_hit(probe) else (None, None)  # type: ignore[attr-defined]
                if msent and msent.text(statement)[1]:
                    hit = True
                elif mtok:
                    th = mtok.term_hits(statement)
                    if th and not any(x for _a, _b, x in th) and kh in t["_pkeys"]:
                        # unutma anında ayraçla eşleştiği için karartılmış bilgi (geri yükleme): yine karartılır
                        statement = mtok.text(statement)[0]
                        props = {**props, "statement": statement}
                        probe = Probe(statement)
                    elif th:
                        hit = True
            if hit:
                raise ForgottenError(ERR_FORGOTTEN)
            if type_name == "Fact" and statement and run in t["_sruns"] and not _user_origin(props):
                msc = self._scoped_tomb_matcher(t)  # kaynak koşunun bilgisi — işaretsiz terimler karartılır
                if msc and msc.may_hit(probe):  # type: ignore[attr-defined]
                    new, n = msc.text(statement)
                    if n:
                        statement = new
                        props = {**props, "statement": statement}
                        probe = Probe(statement)
            if type_name == "Episode" and (from_run or same_ns):  # geri yüklenen eski anı da
                m = self.tomb_matcher(t, self._inflight.get(run, ()), self._inflight_terms.get(run, ())) if live \
                    else self._cached_matcher(t)
                msc = self._scoped_tomb_matcher(t) if run in t["_sruns"] else None
                props = {**props}
                for k in ("summary", "title"):
                    for mm in (m, msc):
                        if mm and isinstance(props.get(k), str) and mm.may_hit(Probe(props[k])):  # type: ignore[attr-defined]
                            props[k] = mm.text(props[k])[0]
        return props

    def _guard_concept(self, props: dict[str, Any], tombs: list[dict[str, Any]]) -> dict[str, Any]:
        """adı/görünen adı unutulmuş bir jetonu taşıyan kavram (unutmanın ad alanında) yazılmaz."""
        texts = [str(props.get(k) or "") for k in ("display", "name") if props.get(k)]
        if not texts:
            return props
        spaces: set[str] = set()
        for x in props.get("namespaces") or []:
            try:
                spaces.add(nsm.normalize(x))
            except Exception:  # noqa: BLE001 - geçersiz ad alanı adı: yok sayılır
                continue
        name = str(props.get("name") or "")
        if "::" in name:
            spaces.add(name.split("::", 1)[0])
        for t in tombs:
            if not t.get("_trecs"):
                continue
            ns = str(t.get("namespace") or "")
            if spaces and ns not in spaces:
                continue
            if not spaces and not nsm.is_global(ns):
                continue
            m = t.get("_cm")
            if m is None:
                m = t["_cm"] = Matcher(token_recs=t["_trecs"])  # kayıt başına bir kez
            if any(m.contains_term(x) for x in texts):
                raise ForgottenError(ERR_FORGOTTEN)
        return props

    # ------------------------------------------------------------ önizleme
    def _matcher(self, sc: Scope) -> Matcher:
        # düz iğne (jeton dizisi + ham) + cümle özetleri + seçili jetonlar
        return Matcher(sc.needles, content_hashes(sc.needles), terms=sc.tokens, amount_ok=sc.amount_ok)

    def _scoped_matcher(self, sc: Scope) -> Matcher | None:
        """işaretsiz terimlerin İÇERİDEKİ kopyaları için eşleyici (kısa sayılar yalnız anahtar sözcükle)."""
        if not (sc.scoped or sc.scoped_kw):
            return None
        return Matcher(terms=sc.scoped, kw_terms=sc.scoped_kw, amount_ok=sc.amount_ok)

    def _analyze(self, sc: Scope, impact: bool = True) -> dict[str, Any]:
        st = self.store
        m = self._matcher(sc)
        mt = Matcher(terms=sc.tokens, amount_ok=sc.amount_ok) if sc.tokens else None  # ad alanının geri kalanı
        ms = self._scoped_matcher(sc)  # içerideki işaretsiz terimler
        foreign = foreign_runs(st, sc.namespace)
        at = now_iso()
        ids = list(sc.delete)
        with st._read() as conn:  # noqa: SLF001
            edges = []
            for chunk in _chunks(ids):
                marks = ",".join("?" * len(chunk))
                edges += [dict(r) for r in conn.execute(
                    f"SELECT * FROM edges WHERE src IN ({marks}) OR dst IN ({marks})", (*chunk, *chunk))]
            edges = list({e["id"]: e for e in [*edges, *sc.unlink_edges.values()]}.values())  # kenar yedeği
        # aday düğüm → eşleyici katmanları (sırayla uygulanır): koşu türevleri m, ad alanının geri kalanı mt, ayraçla
        # eşleşen bilgiler m, içerideki kayıtlar ayrıca ms
        layers: dict[str, tuple[dict[str, Any], list[Any]]] = {}

        def add(node: dict[str, Any], mm: Any) -> None:
            if mm and node["id"] not in sc.delete:
                cur = layers.setdefault(node["id"], (node, []))
                if mm not in cur[1]:
                    cur[1].append(mm)
        if m:
            for node in derived_nodes(st, sc).values():
                add(node, m)
        if mt:
            extra = derived_nodes(st, Scope(sc.scope, sc.namespace, sc.target, runs=set(sc.ns_runs))) \
                if sc.ns_runs else {}
            for node in _ns_episodes(st, sc.namespace, set(sc.delete)):
                extra.setdefault(node["id"], node)
            for nid, node in extra.items():
                if nid not in layers:
                    add(node, mt)
        for node in sc.patch_facts.values():
            add(node, m)
        scoped_ids: set[str] = set()
        if ms:
            inside = derived_nodes(st, Scope(sc.scope, sc.namespace, sc.target, runs=set(sc.source_runs)))
            for node in list(inside.values()) + list(sc.inside_facts.values()):
                if node["type"] == "Concept" or (node["type"] == "Fact" and node["id"] not in sc.inside_facts):
                    continue  # yalnız kaynak koşuların kendi kayıtları (dışarıdaki bilgi/kavram değil)
                add(node, ms)
        patches: dict[str, tuple[dict[str, Any], dict[str, Any]]] = {}
        for nid, (node, mms) in layers.items():
            patch: dict[str, Any] = {}
            cur = node
            for mm in mms:
                p = scrub_patch(st, cur, mm, at)
                if p:
                    patch.update(p)
                    cur = {**cur, "props": {**cur["props"], **p}}
                    if mm is ms:
                        scoped_ids.add(nid)
            if patch:
                patches[nid] = (node, patch)
        for cid, rest in sc.concept_ns.items():
            node = st.get_node(cid)
            patch = patches.get(cid, (node, {}))[1]
            patches[cid] = (node, {**patch, "namespaces": rest})
        fts_ids = ids + [nid for nid, (n, _p) in patches.items() if self._searchable(n["type"])]
        with st._read() as conn:  # noqa: SLF001
            fts = sum(int(conn.execute(f"SELECT COUNT(*) FROM nodes_fts WHERE node_id IN ({','.join('?' * len(c))})",
                                       c).fetchone()[0]) for c in _chunks(fts_ids))
        run_events = []
        if m or ms:  # aynı adımın ardışık parçaları birlikte de taranır
            rows = st.run_event_rows(sc.runs) if m else []
            changed = scrub_events(m, _run_items(rows)) if m else {}
            if mt and sc.ns_runs:
                more = st.run_event_rows(sc.ns_runs)
                changed.update(scrub_events(mt, _run_items(more)))
                rows += more
            if ms and sc.source_runs:  # kaynak koşuların olayları işaretsiz terimlerden de arınır
                have = {r["rowid"] for r in rows}
                rows += [r for r in st.run_event_rows(sc.source_runs) if r["rowid"] not in have]
                mine = [{**r, "data": json.dumps(changed[r["rowid"]], ensure_ascii=False, default=str)}
                        if r["rowid"] in changed else r for r in rows if str(r["run_id"]) in sc.source_runs]
                changed.update(scrub_events(ms, _run_items(mine)))
            run_events = [{**r, "new": json.dumps(changed[r["rowid"]], ensure_ascii=False, default=str)}
                          for r in rows if r["rowid"] in changed]
        event_log = []
        elog = getattr(self.studio, "events_log", None)
        if (m or ms) and elog is not None:
            raw_rows = elog.all_rows()
            items = _log_items(raw_rows)
            # yalnız unutma ad alanının satırları (başka projenin koşularına dokunulmaz)
            changed = scrub_events(m, scope_items(items, foreign, sc.namespace, sc.runs)) if m else {}
            if ms and sc.source_runs:  # yalnız kaynak koşuların satırları
                mine = [(seq, typ, run, changed.get(seq, data)) for seq, typ, run, data in items
                        if str(run or "") in sc.source_runs]
                changed.update(scrub_events(ms, mine))
            raws = dict(raw_rows)
            for seq, typ, run, _data in items:
                if seq in changed:
                    event_log.append({"seq": seq, "data": raws[seq], "type": typ, "run_id": run,
                                      "new": json.dumps(changed[seq], ensure_ascii=False, default=str)})
        active = self._live_matches(sc, m)
        tool_outputs = self._tool_output_hits(m, skip=foreign - sc.runs)  # başka ad alanı hariç
        if ms and sc.source_runs:  # kaynak koşuların araç çıktıları
            by_id = {(h["row"]["run_id"], h["row"]["id"]): h for h in tool_outputs}
            for h in self._tool_output_hits(ms, runs=sorted(sc.source_runs)):
                key = (h["row"]["run_id"], h["row"]["id"])
                if key in by_id:
                    new, n = ms.text(by_id[key]["new"])
                    if n:
                        by_id[key]["new"] = new
                else:
                    tool_outputs.append(h)
        return {"hermes": self._hermes_hits(m), "tool_outputs": tool_outputs,
                "matcher": m, "token_matcher": mt, "scoped_matcher": ms, "foreign": foreign, "edges": edges,
                "patches": patches, "fts": fts, "scoped_ids": scoped_ids,
                "run_events": run_events, "event_log": event_log, "boost": booster_rows(self.data_dir, sc.runs),
                "metrics": metrics_rows(self.data_dir, sc.runs), "active": active,
                "impact": (sc.impact if sc.impact is not None else token_impact(st, sc)) if impact else [],
                "other": other_copies(st, sc) if impact else {}}

    # ------------------------------------------------------------ referanslı araç çıktısı artefaktları
    def _tool_store(self) -> Any:
        try:
            from studio.tools.outputs import store_for  # noqa: PLC0415
            return store_for(self.studio.settings)
        except Exception:  # noqa: BLE001 - depo yoksa kapsanacak artefakt yok
            return None

    def _tool_output_hits(self, m: Matcher, runs: Iterable[str] | None = None,
                          skip: set[str] | None = None) -> list[dict[str, Any]]:
        """Unutulan içeriği taşıyan araç çıktısı artefaktları: [{row, new}] (yeni = karartılmış metin).
        `skip` (başka ad alanının koşuları) taranmaz."""
        store = self._tool_store()
        if not m or store is None:
            return []
        out = []
        for row in store.rows(runs):
            if skip and str(row.get("run_id") or "") in skip:
                continue
            text = store.text(row)
            if not text:
                continue
            new, n = m.text(text)
            if n:
                out.append({"row": row, "new": new, "old": text})
        return out

    def _scrub_tool_outputs(self, hits: list[dict[str, Any]], at: str | None) -> list[dict[str, Any]]:
        store = self._tool_store()
        done = []
        for h in hits:
            try:
                row = store.rewrite(h["row"], h["new"], forgotten_at=at)
                done.append({"run_id": row["run_id"], "id": row["id"], "text": h["old"], "after": row["sha"]})
            except OSError:
                log.exception("araç çıktısı artefaktı karartılamadı: %s", h["row"].get("id"))
        return done

    def _hermes_hits(self, m: Matcher) -> list[str]:
        """Hermes `memories/*.md` dosyalarında aynı içerik (yalnız okunur; değiştirilmez, önizlemede belirtilir).
        Kullanıcı dosyası değişikliği değişiklik servisinden (önizle → onay) geçmelidir (AGENTS.md kural 2)."""
        try:
            home = self.studio.settings.get("hermes_home")
        except Exception:  # noqa: BLE001
            home = None
        root = Path(str(home)) / "memories" if home else None
        if not m or root is None or not root.is_dir():
            return []
        out = []
        for f in sorted(root.glob("*.md"))[:50]:
            try:
                if f.stat().st_size <= 2_000_000 and m.text(f.read_text("utf-8", "replace"))[1]:
                    out.append(f.name)
            except OSError:
                continue
        return out

    def _searchable(self, type_name: str) -> bool:
        try:
            return bool(self.store.ontology.entity(type_name).search)
        except Exception:  # noqa: BLE001
            return False

    def _live_runs(self) -> list[Any]:
        engine = getattr(self.studio, "engine", None)
        return list(getattr(engine, "runs", {}).values()) if engine is not None else []

    def _live_matches(self, sc: Scope, m: Matcher) -> list[Any]:
        """Kapsamdaki canlı (bellekte) koşular: etkilenen koşu, silinen düğümü hatırlamış adım ya da AYNI ad
        alanında içerik eşleşmesi. Başka ad alanının koşusu, aynı cümleyi taşısa da kapsam dışıdır."""
        out = []
        dead = set(sc.delete)
        for run in self._live_runs():
            hit = run.id in sc.runs
            same_ns = str(getattr(run, "project", "") or nsm.GLOBAL) == sc.namespace or (
                nsm.is_global(sc.namespace) and nsm.is_global(getattr(run, "project", None)))
            for st in getattr(run, "steps", {}).values():
                if hit:
                    break
                if any(i.get("id") in dead for i in (getattr(st, "recalled", None) or [])):
                    hit = True
                elif same_ns and m and any(m.text(str(getattr(st, f, "") or ""))[1] for f in ("prompt", "output")):
                    hit = True
            if hit or (same_ns and m and m.value(getattr(run, "inputs", {}) or {})[1]):
                out.append(run)
        return out

    @staticmethod
    def _busy(runs: Iterable[Any]) -> list[Any]:
        """henüz bitmemiş (süren, duraklatılmış, onay bekleyen) koşular."""
        return [r for r in runs if str(getattr(r, "status", "")) not in RUN_FINAL]

    def busy_runs(self, plan_id: str) -> list[str]:
        """planın kapsamındaki süren koşuların kimlikleri (uç "durdur ve unut" için)."""
        with self._lock:
            plan = self.pending.get(plan_id)
            if plan is None or time.time() - plan.created > PLAN_TTL_S:
                raise ForgetError(ERR_PLAN)
            sc = collect(self.store, plan.scope, plan.target if plan.scope != "project" else None, plan.namespace,
                         tokens=plan.tokens, unscoped=plan.unscoped, amounts=plan.amounts)
        return [r.id for r in self._busy(self._live_matches(sc, self._matcher(sc)))]

    def plan(self, scope: str, target: str | None = None, namespace: str | None = None, *,
             by: str = "user", tokens: Iterable[str] | None = None, extra_terms: Iterable[str] = (),
             unscoped: Iterable[str] = (), amounts: Iterable[str] = ()) -> dict[str, Any]:
        """Önizleme. `tokens` seçili jetonlar (None = varsayılan seçim), `extra_terms` kullanıcı terimleri.
        `unscoped` işaretsiz olduğu hâlde hedefin kendi koşusundaki kopyalarında da karartılmayacak terimler.
        `amounts` sayı biçimli tutarlarla ("900.000 TL") da eşleşmesine kullanıcının açıkça izin verdiği
        sayısal terimler (varsayılan: hiçbiri)."""
        if by != "user":
            raise ForgetDenied(ERR_USER_ONLY)
        self.purge_expired()
        sc = collect(self.store, scope, target, namespace, tokens=tokens, extra_terms=extra_terms, unscoped=unscoped,
                     amounts=amounts)
        if not sc.delete and not sc.concept_ns:
            raise ForgetError(ERR_EMPTY)
        a = self._analyze(sc)
        plan_id = f"fgp_{uuid.uuid4().hex[:10]}"
        preview = self._preview(plan_id, sc, a)
        # "okunur kalır" tahmini uygulamanın doğrulama taramasıyla aynı işlevden (kuru çalıştırma). Tarama
        # tamamlanamazsa eski (terim etkisine dayalı) tahmin kalır ve önizleme bunu `remains_predicted: false` ile söyler.
        try:
            preview["remains"] = self._predict_remains(sc, a)
            preview["remains_predicted"] = True
        except Exception as exc:  # noqa: BLE001 - önizleme bozulmaz (istisna metni terim taşıyabilir: günlüğe yalnız tür)
            log.error("unutma: önizleme kuru çalıştırması tamamlanamadı (%s)", type(exc).__name__)
            preview["remains_predicted"] = False
        with self._lock:
            now = time.time()
            for pid in [p for p, pl in self.pending.items() if now - pl.created > PLAN_TTL_S]:
                self.pending.pop(pid, None)
            self.pending[plan_id] = Plan(plan_id, scope, sc.target["id"], sc.namespace, sc.fingerprint(), preview,
                                         tokens=list(sc.tokens), unscoped=list(sc.unscoped),
                                         amounts=list(sc.amount_ok))
        return preview

    def _preview(self, plan_id: str, sc: Scope, a: dict[str, Any]) -> dict[str, Any]:
        by_type: dict[str, int] = {}
        for n in sc.delete.values():
            by_type[n["type"]] = by_type.get(n["type"], 0) + 1
        patches = a["patches"]
        summaries = [n for n, p in patches.values() if (n["type"] == "Deliverable") or
                     (n["type"] == "Episode" and "summary" in p)]
        checkpoints = [n for n, p in patches.values() if n["type"] == "Run" and "checkpoint" in p]
        skip = {n["id"] for n in summaries} | set(sc.concept_ns)
        derived = [n for n, _p in patches.values() if n["id"] not in skip]
        node = lambda n: {"id": n["id"], "type": n["type"], "label": _clip(n["label"])}  # noqa: E731
        counts = {"nodes": len(sc.delete), "by_type": by_type, "edges": len(a["edges"]), "fts_rows": a["fts"],
                  "checkpoints": len(checkpoints), "run_events": len(a["run_events"]),
                  "event_log": len(a["event_log"]), "summaries": len(summaries), "derived": len(derived),
                  "concepts_unlinked": len(sc.concept_ns), "booster_rows": len(a["boost"]),
                  "metrics_rows": len(a["metrics"]), "active_runs": len(a["active"]), "runs": len(sc.runs),
                  "hermes_memory": len(a.get("hermes") or []),
                  "tool_outputs": len(a.get("tool_outputs") or []),
                  "facts": sum(1 for n in sc.delete.values() if n["type"] == "Fact"),
                  "sibling_facts": len(sc.siblings),
                  "running": len(self._busy(a["active"])),  # süren koşu varken uygulama reddedilir
                  "tokens": len(sc.tokens), "token_facts": len(sc.token_facts),
                  "namespace_runs": len(sc.ns_runs),
                  # işaretsiz terimlerden içeride karartılan kayıtlar; ayraçla eşleştiği için silinmeyip
                  # karartılan bilgiler
                  "scoped_redacted": len(a.get("scoped_ids") or ()), "separator_facts": len(sc.patch_facts)}
        return {
            "id": plan_id, "scope": sc.scope, "namespace": sc.namespace,
            "target": {**sc.target, "label": _clip(sc.target.get("label"), 120)},
            "counts": counts,
            "samples": {
                "nodes": [node(n) for n in list(sc.delete.values())[:SAMPLES]],
                # unutulacak bilgiler (hedef + terfi kopyaları + aynı cümleyi içeren kardeşler)
                "facts": [{**node(n), "sibling": n["id"] in sc.siblings} for n in sc.delete.values()
                          if n["type"] == "Fact"][:SAMPLES],
                "edges": [{"id": e["id"], "type": e["type"], "src": e["src"], "dst": e["dst"]}
                          for e in a["edges"][:SAMPLES]],
                "checkpoints": [node(n) for n in checkpoints[:SAMPLES]],
                "summaries": [node(n) for n in summaries[:SAMPLES]],
                "derived": [node(n) for n in derived[:SAMPLES]],
                "run_events": [{"run_id": r["run_id"], "seq": r["seq"], "type": r["type"]}
                               for r in a["run_events"][:SAMPLES]],
                "event_log": [{"seq": r["seq"], "type": r["type"], "run_id": r["run_id"]}
                              for r in a["event_log"][:SAMPLES]],
                "booster_rows": [{"run_id": r["run_id"], "step_id": r["step_id"]} for r in a["boost"][:SAMPLES]],
                "metrics_rows": [{"event_id": r["event_id"][:12], "event_type": r["event_type"], "run_id": r["run_id"]}
                                 for r in a["metrics"][:SAMPLES]],
                "active_runs": [{"id": r.id, "title": _clip(getattr(r, "title", ""))} for r in a["active"][:SAMPLES]],
                # kapsamdaki SÜREN koşuların tamamı (uygulama bunlar varken reddedilir; "durdur ve unut")
                "running": [{"id": r.id, "title": _clip(getattr(r, "title", "")), "status": str(r.status)}
                            for r in self._busy(a["active"])],
                "hermes_memory": [{"file": f"memories/{n}"} for n in (a.get("hermes") or [])[:SAMPLES]],
                "tool_outputs": [{"run_id": h["row"]["run_id"], "id": h["row"]["id"], "tool": h["row"].get("tool"),
                                  "size": h["row"]["size"]} for h in (a.get("tool_outputs") or [])[:SAMPLES]],
            },
            "actions": {"nodes": "delete", "edges": "delete", "fts_rows": "delete_or_reindex",
                        "checkpoints": "scrub", "run_events": "scrub", "event_log": "scrub",
                        "summaries": "regenerate", "derived": "scrub", "concepts_unlinked": "unlink",
                        "booster_rows": "keep", "metrics_rows": "clear_input_sig", "active_runs": "note",
                        "hermes_memory": "not_changed", "tool_outputs": "scrub"},
            # yedek şifreli + HMAC, pencere sonunda silinir; SQLite serbest sayfaları ve WAL temizlenir
            "backup": {"dir": f"{SUBDIR}/backups", "encrypted": True, "retention_s": UNDO_WINDOW_S},
            "storage": {"secure_delete": True, "wal_truncate": True, "vacuum_max_bytes": 256 * 1024 * 1024},
            "mark": MARK, "expires_in_s": PLAN_TTL_S, "undo_window_s": UNDO_WINDOW_S,
            # ayırt edici jetonlar (kullanıcı işaretini kaldırabilir / terim ekleyebilir; seçim plana bağlı)
            "tokens": [{"text": c["text"], "kind": c["kind"], "selected": bool(c["selected"]),
                        **({"held": True} if c.get("held") else {})} for c in sc.token_candidates],
            # işaretsiz olduğu hâlde hedefin kendi kayıtlarında (kaynak koşular) karartılacak terimler,
            # kullanıcının "içeride de dokunma" dediği terimler; yalnız anahtar sözcükten sonra eşlenenler
            "scoped_terms": [c["text"] for c in sc.token_candidates if c.get("scoped")],
            "unscoped_terms": list(sc.unscoped),
            "keyword_only_terms": [c["text"] for c in sc.token_candidates if c.get("kwonly")],
            "token_scope": {"namespace": sc.namespace, "runs": len(sc.runs) + len(sc.ns_runs)},
            # jeton başına etki (bilgi/teslim/mesaj sayısı + kısa bağlam; yalnız arayüz önizlemesi),
            # reddedilen (çok kısa) terimler ve kısa terim eşiği (altı aşırı silme uyarısı taşır)
            "token_impact": a.get("impact") or [],
            "rejected_terms": list(sc.rejected), "short_term": SHORT_TERM, "min_term": MIN_USER_TERM,
            # işaretsiz terimlerin OKUNUR kalacağı kayıtlar (dışarıda; etiketler maskeli), ayraçla
            # eşleşen (tam yazım dışı) kayıtlar — silinmez, eşleşen kısım karartılır, yalnız bu ad alanı
            # etkilenir; başka ad alanlarındaki kopya sayısı (içerik yok)
            "remains": remains_list(sc.token_candidates, a.get("impact") or []),
            # her ayraçlı eşleşmenin uygulamadaki sonucu (`outcome`: redact = aralık karartılır, delete = kayıt
            # silinir) — uygulamanın kullandığı karar (`fact_outcome`)
            "separator_matches": separator_list(sc.token_candidates, a.get("impact") or [], sc),
            # sayı biçimli tutar geçişleri ("900.000 TL"); kullanıcı izin vermedikçe dokunulmaz
            "amount_matches": amount_list(sc.token_candidates, a.get("impact") or [], sc),
            "amount_terms": list(sc.amount_ok),
            "other_projects": a.get("other") or {},
            "loose_min": LOOSE_MIN,
        }

    # ------------------------------------------------------------ uygulama
    def apply(self, plan_id: str, confirm: bool, *, by: str = "user", active: str = "note") -> dict[str, Any]:
        """`active`: kapsamda süren koşu varsa "refuse" → `ForgetBusy` (uç varsayılanı; kullanıcı önce
        durdurur ya da "durdur ve unut" seçer), "note" → koşu bağlamı karartılır ve koşuya not düşer (doğrudan
        çağrı/geriye uyum; koşu sonu kancası, olay kapsamı ve içerik eşleyen yazma kapısı geç kopyaları süpürür)."""
        if by != "user":
            raise ForgetDenied(ERR_USER_ONLY)
        if confirm is not True:
            raise ForgetError(ERR_CONFIRM)
        with self._lock:
            plan = self.pending.get(plan_id)
            if plan is None or time.time() - plan.created > PLAN_TTL_S:
                self.pending.pop(plan_id, None)
                raise ForgetError(ERR_PLAN)
            with self.start_gate(plan.namespace):  # süren koşu denetiminden ÖNCE kapanır
                sc = collect(self.store, plan.scope, plan.target if plan.scope != "project" else None,
                             plan.namespace, tokens=plan.tokens, unscoped=plan.unscoped, amounts=plan.amounts)
                if sc.fingerprint() != plan.fingerprint:
                    self.pending.pop(plan_id, None)
                    raise ForgetError(ERR_DRIFT)
                a = self._analyze(sc, impact=False)
                busy = self._busy(a["active"])
                if busy and active == "refuse":
                    raise ForgetBusy(ERR_ACTIVE, [r.id for r in busy])
                change_id = f"fgt_{uuid.uuid4().hex[:10]}"
                entry = self._apply(change_id, sc, a)
                self.pending.pop(plan_id, None)
        return entry

    @contextlib.contextmanager
    def start_gate(self, namespace: str) -> Iterator[None]:
        """ad alanında yeni koşu başlatmayı uygulama bitene kadar kapatır (motor yoksa etkisiz).
        `memory.isolation` kapalıyken hatırlama ad alanları arasında geçer → kapı BÜTÜN ad alanları için
        kapanır (`startgate.ALL`)."""
        gate = getattr(getattr(self.studio, "engine", None), "start_gate", None)
        if gate is None:
            yield
            return
        from studio.workflow.startgate import ALL  # noqa: PLC0415
        mem = getattr(self.studio, "memory", None)
        key = namespace if getattr(mem, "isolated", True) else ALL
        gate.close(key)
        try:
            yield
        finally:
            gate.open(key)

    def plan_namespace(self, plan_id: str) -> str | None:
        with self._lock:
            plan = self.pending.get(plan_id)
            return plan.namespace if plan is not None else None

    def _apply(self, change_id: str, sc: Scope, a: dict[str, Any]) -> dict[str, Any]:
        st = self.store
        m: Matcher = a["matcher"]
        ts = time.time()
        at = _iso_from(ts)
        ids = list(sc.delete)
        with st._read() as conn:  # noqa: SLF001
            raw_nodes = []
            for chunk in _chunks(ids):
                raw_nodes += [dict(r) for r in conn.execute(
                    f"SELECT * FROM nodes WHERE id IN ({','.join('?' * len(chunk))})", chunk)]
        patched = []
        for nid, (node, _p) in a["patches"].items():
            patched.append({"id": nid, "type": node["type"], "props": node["props"], "label": node["label"],
                            "updated_at": node["updated_at"]})
        backup = {"id": change_id, "ts": ts, "scope": sc.scope, "namespace": sc.namespace,
                  "target": sc.target["id"], "nodes": raw_nodes, "edges": a["edges"], "patched": patched,
                  "run_events": [{"rowid": r["rowid"], "data": r["data"], "after": _sha(r["new"])}
                                 for r in a["run_events"]],
                  "event_log": [{"seq": r["seq"], "data": r["data"], "after": _sha(r["new"])} for r in a["event_log"]],
                  "metrics": [{"event_id": r["event_id"], "input_sig": r["input_sig"]}
                              for r in a["metrics"] if r.get("input_sig") is not None]}
        self._write_backup(change_id, backup)  # 1) yedek (uygulamadan ÖNCE; şifreli + HMAC)
        keys = [key_hash(n["type"], n["key"]) for n in sc.delete.values()]
        ssalt = os.urandom(16).hex()  # kayıt başına zincir tuzu
        tomb = {"id": change_id, "ts": at, "scope": sc.scope, "namespace": sc.namespace, "keys": keys,
                "shingle_salt": ssalt,
                "hashes": sorted(content_hashes(sc.needles, ssalt)), "lens": content_lens(sc.needles),
                "runs": sorted(sc.runs | {r.id for r in a["active"]})}
        trec = token_record(sc.tokens, amount_ok=sc.amount_ok)  # tuzlu jeton özetleri (içerik yok)
        if trec:
            tomb["tokens"] = trec
        if sc.patch_facts:  # ayraçla eşleştiği için silinmeyip karartılan bilgilerin anahtar özetleri
            tomb["pkeys"] = sorted(key_hash("Fact", n["key"]) for n in sc.patch_facts.values())
        if sc.concept_ns:  # bu ad alanından çıkarılan paylaşılan kavramlar (geri yüklemede yeniden çıkarılır)
            tomb["ckeys"] = sorted(key_hash("Concept", n["key"]) for n in st.get_nodes(sc.concept_ns).values())
        srec = token_record(sc.scoped, kw_terms=sc.scoped_kw, amount_ok=sc.amount_ok)  # yalnız kaynak koşular
        if srec and sc.source_runs:
            tomb["scoped"] = srec
            tomb["scoped_runs"] = sorted(sc.source_runs)
        tombs = [t for t in self.tombstones() if t["id"] != change_id]
        self._save_tombs([*tombs, tomb])  # 2) mezar kaydı (yazma kapısı uygulama sırasında da etkin)
        try:
            with st.bulk():  # 3) graf: tek işlem; hata olursa tamamı geri alınır
                for nid, (_node, patch) in a["patches"].items():
                    if nid in sc.delete:
                        continue
                    st.patch_node(nid, patch)
                for nid in ids:
                    st.delete_node(nid)
                if sc.unlink_edges:  # paylaşılan kavramın bu ad alanındaki kenarları (düğüm ve adı kalır)
                    st.delete_edges(sc.unlink_edges)  # CDC C5: GraphStore yolu (günlüğe edge.delete)
                st.set_run_event_data((r["rowid"], r["new"]) for r in a["run_events"])
                st.cdc_rotate_key()  # CDC: unutulan içeriğin günlükteki özetleri artık doğrulanamaz (kripto-kırpma)
                self._mark_db(change_id)
        except BaseException:
            self._save_tombs([t for t in self.tombstones() if t["id"] != change_id])
            self.backup_path(change_id).unlink(missing_ok=True)
            raise
        after = st.get_nodes(p["id"] for p in patched)
        for p in patched:
            if p["id"] in after:
                p["after"] = _sha(after[p["id"]]["props"])
        self._write_backup(change_id, backup)
        warnings: list[str] = []
        self._scrub_vault([m, a.get("scoped_matcher") if sc.source_runs else None],
                          sc.runs | {r.id for r in a["active"]}, warnings)  # 3b) çıktı kasası
        try:  # 3c) QA34b-03: yedek `deliveries.json` mailto alıcı/gövde taşımaz (kalan alanlara dokunulmaz)
            from studio.delivery.records import scrub_legacy_file  # noqa: PLC0415
            scrub_legacy_file(self.data_dir)
        except Exception:  # noqa: BLE001 - yedek temizliği unutmayı bozmaz
            log.exception("unutma: deliveries.json yedeği temizlenemedi")
            if "delivery_backup" not in warnings:
                warnings.append("delivery_backup")
        elog = getattr(self.studio, "events_log", None)
        if elog is not None:  # 4) kalıcı olay günlüğü + SSE önbelleği
            try:
                elog.rewrite_rows([(r["seq"], r["new"]) for r in a["event_log"]])
                elog.set_marker(f"forget:{change_id}")
            except Exception:  # noqa: BLE001
                log.exception("olay günlüğü karartılamadı")
                warnings.append("event_log")
        self._purge_bus_cache(m, a.get("foreign"), sc.namespace, sc.runs)
        ms = a.get("scoped_matcher")
        if ms and sc.source_runs:  # SSE önbelleğinde kaynak koşuların satırları
            self._purge_bus_cache(ms, only=sc.source_runs)
        set_metrics_sig(self.data_dir, [(r["event_id"], None) for r in backup["metrics"]])  # 5) ölçüm defteri
        if a.get("tool_outputs"):  # 5b) araç çıktısı artefaktları: önce şifreli yedek (özgün metin), sonra karartma
            from studio.tools.outputs import sha256 as text_sha  # noqa: PLC0415
            backup["tool_outputs"] = [{"run_id": h["row"]["run_id"], "id": h["row"]["id"], "text": h["old"],
                                       "after": text_sha(h["new"])} for h in a["tool_outputs"]]
            self._write_backup(change_id, backup)
            self._scrub_tool_outputs(a["tool_outputs"], at)
        noted = self._scrub_live(change_id, a["active"], m, set(ids), sc.needles, sc.tokens)  # 6) canlı bağlam
        if ms and sc.source_runs:  # kaynak koşu bellekte tutuluyorsa işaretsiz terimler de karartılır
            for run in self._live_runs():
                if run.id in sc.source_runs:
                    _scrub_state(run, ms)
                    if isinstance(getattr(run, "inputs", None), dict):
                        run.inputs = ms.value(run.inputs)[0]
        # denetimden sonra (kapı kapanmadan önce başlamış) silinen bilgiyi hatırlayan koşu da not alır
        seen = {r.id for r in a["active"]}
        late = [r for r in self._live_matches(sc, m) if r.id not in seen]
        if late:
            noted += self._scrub_live(change_id, late, m, set(ids), sc.needles, sc.tokens)
            tombs = self.tombstones()
            for t in tombs:
                if t["id"] == change_id:
                    t["runs"] = sorted({*t.get("runs", []), *(r.id for r in late)})
            self._save_tombs(tombs)
        self._scrub_files(warnings, change_id)  # 7) SQLite serbest sayfaları + WAL
        counts = self._preview("-", sc, a)["counts"]
        # uygulamadan SONRA terimleri hâlâ taşıyan kayıtlar (dürüst sonuç) ve başka ad alanındaki kopyalar
        # sonuç PLANDAN değil, uygulamadan sonraki doğrulama taramasından (depolar okunur; içerik günlüğe
        # yazılmaz, yanıt yalnız kullanıcıya döner). Tarama tamamlanamazsa sonuç "temiz" demez.
        verified = True
        unscanned: dict[str, int] = {}
        try:
            remains = verify_remains(self.studio, st, sc, self._tool_store(), unscanned=unscanned)
            other = other_copies(st, sc)
        except Exception as exc:  # noqa: BLE001 - sonuç özeti uygulamayı bozmaz (istisna metni terim taşıyabilir)
            log.error("unutma: doğrulama taraması tamamlanamadı (%s)", type(exc).__name__)
            remains, other, verified = [], {}, False
        counts["remains"] = sum(r["total"] for r in remains)
        counts["vault_unscanned"] = int(unscanned.get("vault") or 0)  # QA34b-01
        if counts["vault_unscanned"] and "vault" not in warnings:
            warnings.append("vault")  # kasa tam doğrulanamadı: kapsam dışı taranamayan blob'lar kaldı
        counts["other_projects"] = int(other.get("total") or 0)
        entry = {"id": change_id, "ts": ts, "at": at, "scope": sc.scope, "namespace": sc.namespace,
                 "target": sc.target.get("id"), "target_type": sc.target.get("type"), "counts": counts, "noted_runs": noted,
                 "undo_until": ts + UNDO_WINDOW_S, "warnings": warnings, "undone": False}
        self._log(entry)  # içeriksiz (terim ve etiket yok): kalanlar yalnız yanıtta
        self._publish("memory.forgotten", change_id=change_id, scope=sc.scope, namespace=sc.namespace,
                      counts={k: v for k, v in counts.items() if isinstance(v, int)})
        message = {lang: remains_text(remains, other, lang, counts["nodes"] if verified else None,
                                      counts["vault_unscanned"])
                   for lang in ("tr", "en")}
        if not verified:
            message = {"tr": f"Unutuldu: {counts['nodes']} düğüm silindi, türevler karartıldı. Sonuç doğrulanamadı; "
                             f"okunur kopya kalmış olabilir. {message['tr']}".strip(),
                       "en": f"Forgotten: {counts['nodes']} nodes deleted, derived data redacted. The result couldn't be "
                             f"verified; a readable copy may remain. {message['en']}".strip()}
        return {**entry, "remains": remains, "other_projects": other, "verified": verified, "message": message}

    def _scrub_vault(self, matchers: Iterable[Matcher | None], runs: Iterable[str] = (),
                     warnings: list[str] | None = None) -> int:
        """çıktı kasasındaki (`<veri>/deliverables/blobs`) kopyalar da unutulur. Kasa stüdyoya ait, graf dışı bir
        kopyadır (çalışma klasöründeki kullanıcı dosyası değişmez). Eşleyiciye uyan (metin / OOXML / zip içi metin) blob
        SİLİNİR; taranamayan ikili blob'lar yalnız unutulan koşuların çıktısıysa silinir. Anan `Deliverable` düğümleri
        `vault_status: forgotten` olur (ham / indirme / önizleme kasadan sunmaz; site rotası 404). Geri alma kasa
        kopyalarını GERİ GETİRMEZ. Silinen blob sayısını döner."""
        ms = [m for m in matchers if m]
        if not ms:
            return 0
        try:
            from studio.deliverables.api import get_service  # noqa: PLC0415

            svc = get_service(self.studio)
            vault = svc.vault
            if vault is None or not vault.root.is_dir():
                return 0
            runset = {str(r) for r in runs}
            nodes: list[dict[str, Any]] = []
            offset = 0
            while True:
                rows = self.store.nodes("Deliverable", limit=500, offset=offset, order="created_at ASC")
                if not rows:
                    break
                nodes += rows
                offset += len(rows)
            sha_runs: dict[str, set[str]] = {}
            for n in nodes:
                p = n["props"]
                shas = [p.get("sha256")] if p.get("blob") else []
                shas += [e.get("sha256") for e in (p.get("manifest") or []) if isinstance(e, dict)]
                for sha in shas:
                    if isinstance(sha, str):
                        sha_runs.setdefault(sha, set()).add(str(p.get("run_id") or ""))
            purge: set[str] = set()
            for sha, _mtime in vault.iter_blobs():
                chunks, complete = _vault_chunks(vault.path_for(sha))
                if any(m.text(c)[1] for c in chunks for m in ms):
                    purge.add(sha)
                elif not complete and sha_runs.get(sha, set()) & runset:  # taranamayan blob: unutulan koşunun ise silinir
                    purge.add(sha)
            with contextlib.suppress(Exception):
                vault.purge_pending()  # önceki unutmada açık tutamaç yüzünden silinemeyenler
            gone = {sha for sha in purge if vault.delete(sha)}
            stuck = purge - gone
            for delay in (0.25, 0.5, 1.0):  # (Windows): zip üretimi blob'u o an açık tutuyor olabilir → kısa yeniden deneme
                if not stuck:
                    break
                time.sleep(delay)
                for sha in list(stuck):
                    if vault.delete(sha) or not vault.has(sha):
                        stuck.discard(sha)
                        gone.add(sha)
            if stuck:
                # Silinemedi: düğümler yine de `forgotten` olur (kasa kopyası artık hiçbir uçtan sunulmaz), özet bekleyenlere yazılır
                # ve sonraki unutmada / açılışta silinir; kullanıcıya uyarı düşer ("vault": okunur kopya kasada kalmış olabilir).
                vault.pending_add(stuck)
                if warnings is not None and "vault" not in warnings:
                    warnings.append("vault")
                log.warning("unutma: %d kasa dosyası silinemedi (açık tutamaç); sonra yeniden denenecek", len(stuck))
            hidden = gone | stuck
            if not hidden:
                return 0
            at = now_iso()
            with self.store.bulk():
                for n in nodes:
                    p = n["props"]
                    patch: dict[str, Any] = {}
                    if p.get("sha256") in hidden and p.get("blob"):
                        patch.update(sha256=None, blob=None)
                    man = p.get("manifest")
                    if isinstance(man, list) and any(isinstance(e, dict) and e.get("sha256") in hidden for e in man):
                        patch["manifest"] = [
                            {k: v for k, v in e.items() if k != "sha256"} | {"forgotten": True}
                            if isinstance(e, dict) and e.get("sha256") in hidden else e for e in man]
                    if patch:
                        patch.update(vault_status="forgotten", forgotten_at=p.get("forgotten_at") or at)
                        merged = {**p, **patch}
                        for m in ms:  # özet / alıntı da (kasadan silinen içeriğin türevi) karartılır
                            merged.update(scrub_patch(self.store, {"type": "Deliverable", "props": merged}, m, at))
                        self.store.patch_node(n["id"], {k: v for k, v in merged.items()
                                                        if k in patch or v != p.get(k)})
            return len(gone)
        except Exception:  # noqa: BLE001 - kasa süpürmesi unutmayı bozmaz; uyarı düşer
            log.exception("unutma: çıktı kasası süpürülemedi")
            if warnings is not None and "vault" not in warnings:
                warnings.append("vault")
            return 0

    def _scrub_files(self, warnings: list[str] | None = None, change_id: str | None = None) -> None:
        """Graf ve olay veritabanlarında unutulan metnin eski sürümleri (serbest sayfa, WAL) silinir.
        bir okuyucu anlık görüntü tuttuğu için `wal_checkpoint(TRUNCATE)` tamamlanamazsa kısa geri çekilmeyle
        yeniden denenir; yine olmazsa unutma kaydına `wal_pending` uyarısı düşer, bekleyen iş `wal_pending.json`'a
        (içeriksiz: yalnız değişiklik kimlikleri) yazılır ve arka planda (boşta) + açılışta yeniden denenir."""
        ok = True
        try:
            ok = bool(self.store.scrub_free_space().get("wal_truncated", True))
        except Exception:  # noqa: BLE001
            log.exception("graf dosyası süpürülemedi")
            ok = False
            if warnings is not None:
                warnings.append("studio_db_free_pages")
        elog = getattr(self.studio, "events_log", None)
        if elog is not None and hasattr(elog, "scrub_free_space"):
            try:
                ok = bool(elog.scrub_free_space()) and ok if getattr(elog, "persistent", True) else ok
            except Exception:  # noqa: BLE001
                log.exception("olay günlüğü dosyası süpürülemedi")
                ok = False
                if warnings is not None:
                    warnings.append("events_db_free_pages")
        for delay in WAL_RETRY_S:
            if ok:
                break
            time.sleep(delay)
            ok = self._wal_truncate_all()
        if not ok:
            log.warning("unutma: WAL sıfırlanamadı (açık okuyucu); arka planda ve açılışta yeniden denenecek")
            if warnings is not None and "wal_pending" not in warnings:
                warnings.append("wal_pending")
            self._wal_pending_add(change_id or "-")
            self._schedule_wal_retry(0)

    # ------------------------------------------------------------ bekleyen WAL sıfırlama
    @property
    def wal_pending_path(self) -> Path:
        return self.dir / "wal_pending.json"

    def _wal_truncate_all(self) -> bool:
        ok = True
        try:
            ok = bool(self.store.wal_truncate())
        except Exception:  # noqa: BLE001
            ok = False
        elog = getattr(self.studio, "events_log", None)
        if elog is not None and hasattr(elog, "wal_truncate") and getattr(elog, "persistent", True):
            try:
                ok = bool(elog.wal_truncate()) and ok
            except Exception:  # noqa: BLE001
                ok = False
        return ok

    def wal_pending(self) -> list[str]:
        try:
            raw = json.loads(self.wal_pending_path.read_text("utf-8")) if self.wal_pending_path.is_file() else []
        except (OSError, ValueError):
            return []
        return [str(x) for x in raw] if isinstance(raw, list) else []

    def _wal_pending_add(self, change_id: str) -> None:
        with self._tlock:
            cur = self.wal_pending()
            if change_id not in cur:
                self._write_json(self.wal_pending_path, [*cur, change_id])

    def retry_wal_pending(self) -> bool:
        """Bekleyen WAL sıfırlamasını dener (açılış, boşta zamanlayıcı). True = bekleyen iş kalmadı."""
        pending = self.wal_pending()
        if not pending:
            return True
        if not self._wal_truncate_all():
            return False
        try:
            self.wal_pending_path.unlink(missing_ok=True)
        except OSError:
            return False
        log.info("unutma: bekleyen WAL sıfırlaması tamamlandı (%s)", ", ".join(pending))
        return True

    def _schedule_wal_retry(self, attempt: int) -> None:
        if attempt >= len(WAL_IDLE_RETRY_S):
            log.warning("unutma: WAL sıfırlaması hâlâ bekliyor; bir sonraki açılışta yeniden denenecek")
            return

        def run() -> None:
            try:
                done = self.retry_wal_pending()
            except Exception:  # noqa: BLE001 - kapanmış depo vb.; açılışta yeniden denenir
                log.warning("unutma: WAL yeniden denemesi başarısız", exc_info=True)
                return
            if not done:
                self._schedule_wal_retry(attempt + 1)

        t = threading.Timer(WAL_IDLE_RETRY_S[attempt], run)
        t.daemon = True
        t.start()

    def _mark_db(self, change_id: str) -> None:
        with self.store._write() as conn:  # noqa: SLF001
            conn.execute("CREATE TABLE IF NOT EXISTS forget_applied (id TEXT PRIMARY KEY, at TEXT NOT NULL)")
            conn.execute("INSERT OR REPLACE INTO forget_applied(id, at) VALUES(?, ?)", (change_id, now_iso()))
            self.store._commit()  # noqa: SLF001

    def _db_marked(self) -> set[str]:
        with self.store._read() as conn:  # noqa: SLF001
            try:
                return {r[0] for r in conn.execute("SELECT id FROM forget_applied").fetchall()}
            except sqlite3.OperationalError:
                return set()

    def _purge_bus_cache(self, m: Matcher, foreign: set[str] | None = None, ns: str | None = None,
                         keep: set[str] | None = None, only: set[str] | None = None) -> None:
        cache = getattr(getattr(self.studio, "bus", None), "_json", None)
        if not isinstance(cache, dict) or not m:
            return
        for seq in _bus_drops(list(cache.items()), m, foreign, ns, keep, only):
            cache.pop(seq, None)

    def _sse_drops(self, sc: Scope, a: dict[str, Any]) -> set[int]:
        """uygulamanın SSE önbelleğinden düşüreceği satırlar (`_apply` ile aynı iki geçiş)."""
        cache = getattr(getattr(self.studio, "bus", None), "_json", None)
        if not isinstance(cache, dict):
            return set()
        rows = list(cache.items())
        drop = _bus_drops(rows, a["matcher"], a.get("foreign"), sc.namespace, sc.runs) if a["matcher"] else set()
        ms = a.get("scoped_matcher")
        if ms and sc.source_runs:
            drop |= _bus_drops([r for r in rows if r[0] not in drop], ms, only=sc.source_runs)
        return drop

    def _predict_remains(self, sc: Scope, a: dict[str, Any]) -> list[dict[str, Any]]:
        """önizlemenin "okunur kalır" listesi — uygulamadan sonraki doğrulama taramasının (`_Verifier`) aynısı,
        uygulamanın yazacağı durum üzerinde kuru çalıştırılır. Tutulan, işaretsiz ve `unscoped` terimler, kavram adları,
        adımlar ve olaylar dahil sayılar uygulamanın bırakacağına eşittir (kayıtlar maskeli etiket taşır)."""
        ov = _Overlay(
            delete=set(sc.delete),
            patches={nid: patch for nid, (_n, patch) in a["patches"].items() if nid not in sc.delete},
            run_events={r["rowid"]: r["new"] for r in a["run_events"]},
            event_log={r["seq"]: r["new"] for r in a["event_log"]},
            sse_drop=self._sse_drops(sc, a),
            tools={(str(h["row"].get("run_id") or ""), str(h["row"].get("id") or "")): h["new"]
                   for h in a.get("tool_outputs") or []})
        return verify_remains(self.studio, self.store, sc, self._tool_store(), overlay=ov)

    def _scrub_live(self, change_id: str, runs: list[Any], m: Matcher, dead: set[str],
                    needles: list[str], terms: Iterable[str] = ()) -> list[str]:
        """Canlı (ve bellekte tutulan bitmiş) koşular: içerik karartılır; sürenlere not düşer."""
        noted: list[str] = []
        engine = getattr(self.studio, "engine", None)
        for run in runs:
            for st in getattr(run, "steps", {}).values():
                for f in ("output", "prompt", "thought"):
                    val = getattr(st, f, None)
                    if isinstance(val, str) and val:
                        setattr(st, f, m.text(val)[0])
                _scrub_tools(st, m)  # araç girdileri ve (parçalı) araç çıktıları
                rec = getattr(st, "recalled", None)
                if isinstance(rec, list):
                    st.recalled = [i for i in rec if i.get("id") not in dead]
            for f in ("output", "title"):
                val = getattr(run, f, None)
                if isinstance(val, str) and val:
                    setattr(run, f, m.text(val)[0])
            _scrub_specs(run, m)  # adım/akış tanımındaki başlık ve istem (görev istemi = bilgi)
            if isinstance(getattr(run, "inputs", None), dict):
                run.inputs = m.value(run.inputs)[0]
            status = str(getattr(run, "status", ""))
            if status in RUN_FINAL:
                continue
            self._inflight[run.id] = [*self._inflight.get(run.id, []), *needles]
            self._inflight_terms[run.id] = [*self._inflight_terms.get(run.id, []), *terms]
            noted.append(run.id)
            if engine is not None:
                lang = getattr(run, "lang", None) or "tr"
                try:
                    engine._emit(run, "memory.forgotten", change_id=change_id,  # noqa: SLF001
                                 note=NOTE["en" if lang == "en" else "tr"])
                    engine._checkpoint(run)  # noqa: SLF001
                except Exception:  # noqa: BLE001
                    log.exception("canlı koşuya not düşülemedi: %s", run.id)
        return noted

    def _publish(self, type_: str, **data: Any) -> None:
        bus = getattr(self.studio, "bus", None)
        if bus is not None:
            try:
                bus.publish(type_, **data)
            except Exception:  # noqa: BLE001
                pass

    # ------------------------------------------------------------ geri al
    def undo(self, change_id: str, confirm: bool, *, by: str = "user") -> dict[str, Any]:
        if by != "user":
            raise ForgetDenied(ERR_USER_ONLY)
        if confirm is not True:
            raise ForgetError(ERR_UNDO_CONFIRM)
        with self._lock:
            entry = next((e for e in self.history(10000) if e["id"] == change_id), None)
            if entry is None:
                raise ForgetError(ERR_NO_CHANGE)
            if entry["undone"]:
                raise ForgetError(ERR_UNDONE)
            path = self.backup_path(change_id)
            if time.time() - float(entry["ts"]) > UNDO_WINDOW_S or not path.is_file():
                path.unlink(missing_ok=True)
                raise ForgetError(ERR_EXPIRED)
            try:
                backup = self._read_backup(change_id)
            except (OSError, ValueError) as exc:
                raise ForgetError(ERR_BACKUP) from exc
            before = list(self.tombstones())
            self._save_tombs([t for t in before if t["id"] != change_id])
            try:
                result = self._restore(backup)
            except BaseException:
                self._save_tombs(before)  # geri alma başarısız: mezar kaydı yerinde kalır
                raise
            path.unlink(missing_ok=True)
            undo_entry = {**entry, "id": f"{change_id}:undo", "ts": time.time(), "undone": True, "restored": result}
            undo_entry.pop("can_undo", None)
            self._log(undo_entry)
        self._publish("memory.forget_undone", change_id=change_id, restored=result)
        return undo_entry

    def _covered(self, row: dict[str, Any], tombs: list[dict[str, Any]]) -> bool:
        """Başka etkin mezar kaydı bu düğümü kapsıyor mu (geri getirilmez)."""
        if row["type"] not in ("Fact", "Episode", "Concept"):
            return False
        props = json.loads(row["props"]) if isinstance(row["props"], str) else row["props"]
        kh = key_hash(row["type"], row["key"])
        stmt = chashes(str(props.get("statement") or "")) if row["type"] == "Fact" else set()
        ns = nsm.of_node({"props": props})
        for t in tombs:
            if kh in t["_keys"] or (stmt & t["_hashes"] and ns == t.get("namespace")):
                return True
            if t.get("scope") == "project" and row["type"] != "Concept" and ns == t.get("namespace") \
                    and str(row["created_at"]) <= str(t.get("ts")):
                return True
        return False

    def _restore(self, backup: dict[str, Any]) -> dict[str, int]:
        st = self.store
        res = {"nodes": 0, "edges": 0, "patched": 0, "skipped": 0, "run_events": 0, "event_log": 0, "metrics": 0}
        others = self.tombstones()  # bu unutmanın kaydı çıkarılmış hâli
        # geri gelen her metin, hâlâ etkin olan (daha yeni) mezar kayıtlarının eşleyicisinden geçer
        # kayıtların zincir tuzları farklı olabilir → kayıt başına eşleyici, sırayla
        om = _Chain([self.tomb_matcher(t) for t in others])

        def scrub_json(raw: str, skip: frozenset[str] = KEEP_KEYS) -> str:
            if not om:
                return raw
            try:
                val = json.loads(raw)
            except (TypeError, ValueError):
                return raw
            new, c = om.value(val, skip)
            return json.dumps(new, ensure_ascii=False, default=str) if c else raw

        with st.bulk():
            conn = st.conn
            for r in backup["nodes"]:
                if r.get("type") not in RESTORE_TYPES or self._covered(r, others):
                    res["skipped"] += 1  # plan dışı tür (ör. Agent) yedekten asla geri gelmez
                    continue
                props_raw = scrub_json(r["props"], _skip_for(st, r["type"]))
                label = om.text(str(r["label"] or ""))[0] if om else r["label"]
                # CDC C5: GraphStore yolu (INSERT OR IGNORE + FTS + günlüğe node.insert; içerik günlüğe girmez)
                if st.restore_node_row({**r, "label": label, "props": props_raw}):
                    res["nodes"] += 1
                else:
                    res["skipped"] += 1
            for e in backup["edges"]:
                res["edges"] += int(st.restore_edge_row(e))  # CDC C5: iki uç da varsa (günlüğe edge.insert)
            for p in backup["patched"]:
                row = conn.execute("SELECT props FROM nodes WHERE id=?", (p["id"],)).fetchone()
                if row is None or _sha(json.loads(row[0])) != p.get("after"):
                    res["skipped"] += 1  # uygulamadan sonra değişti: ezilmez (içerik karartılmış kalır)
                    continue
                props = om.value(p["props"], _skip_for(st, p["type"]))[0] if om else p["props"]
                label = om.text(str(p["label"] or ""))[0] if om else p["label"]
                # CDC C5: yedekteki etiket ve zamanla yerinde yaz + FTS (günlüğe node.update)
                st.replace_node_content(p["id"], props, label=label, updated_at=p["updated_at"])
                res["patched"] += 1
            restore_ev = []
            for r in backup["run_events"]:
                cur_row = conn.execute("SELECT data FROM run_events WHERE rowid=?", (r["rowid"],)).fetchone()
                if cur_row is not None and _sha(cur_row[0]) == r["after"]:
                    restore_ev.append((r["rowid"], scrub_json(r["data"])))
            res["run_events"] = st.set_run_event_data(restore_ev)
            try:
                conn.execute("DELETE FROM forget_applied WHERE id=?", (backup["id"],))
            except sqlite3.OperationalError:
                pass
        elog = getattr(self.studio, "events_log", None)
        if elog is not None and backup["event_log"]:
            current = dict(elog.all_rows())
            res["event_log"] = elog.rewrite_rows([(r["seq"], scrub_json(r["data"])) for r in backup["event_log"]
                                                  if _sha(current.get(r["seq"], "")) == r["after"]])
            elog.set_marker(f"forget:{backup['id']}", False)
        res["metrics"] = set_metrics_sig(self.data_dir, [(r["event_id"], r["input_sig"]) for r in backup["metrics"]])
        res["tool_outputs"] = 0
        store = self._tool_store() if backup.get("tool_outputs") else None
        for r in backup.get("tool_outputs") or []:  # yalnız değişmemiş (hâlâ karartılmış) artefakt geri yazılır
            row = store.get(r["run_id"], r["id"]) if store is not None else None
            if row is None or row["sha"] != r["after"]:
                res["skipped"] += 1
                continue
            store.rewrite(row, om.text(r["text"])[0] if om else r["text"], forgotten_at=None)
            res["tool_outputs"] += 1
        return res

    # ------------------------------------------------------------ yeniden uygulama (geri yükleme / içe aktarma)
    def reapply(self, *, force: bool = False) -> dict[str, Any]:
        """Mezar kayıtlarını yeniden uygular. `studio.db`/`events.db` içinde işareti olmayan (yedekten geri yüklenmiş ya
        da içe aktarılmış) kayıtlar süpürülür. İdempotent; `force` işarete bakmadan süpürür."""
        tombs = self.tombstones()
        out = {"tombstones": len(tombs), "swept": 0, "nodes": 0, "derived": 0, "run_events": 0, "event_log": 0}
        if not tombs:
            return out
        marked = set() if force else self._db_marked()
        elog = getattr(self.studio, "events_log", None)
        for t in tombs:
            db_needed = force or t["id"] not in marked
            log_needed = elog is not None and (force or not elog.marker(f"forget:{t['id']}"))
            if not (db_needed or log_needed):
                continue
            out["swept"] += 1
            m = self.tomb_matcher(t)
            if db_needed:
                n, d, e = self._sweep_db(t, m)
                out["nodes"] += n
                out["derived"] += d
                out["run_events"] += e
                self._mark_db(t["id"])
                if not force:  # işaretsiz = veritabanı yedekten döndü: CDC imleçleri yeniden eşitlensin
                    with contextlib.suppress(Exception):
                        st_reset = getattr(self.store, "cdc_reset_journal", None)
                        if st_reset:
                            st_reset()
                self._scrub_vault([m, self._scoped_tomb_matcher(t) if t["_sruns"] else None], t["_runs"])
            if log_needed and elog is not None:
                ns = str(t.get("namespace") or nsm.GLOBAL)
                items = scope_items(_log_items(elog.all_rows()), foreign_runs(self.store, ns), ns, t["_runs"])
                changed = scrub_events(m, items)  # yalnız unutma ad alanı
                msc = self._scoped_tomb_matcher(t)
                if msc and t["_sruns"]:  # kaynak koşuların satırları işaretsiz terimlerden de
                    mine = [(seq, typ, run, changed.get(seq, data)) for seq, typ, run, data in items
                            if str(run or "") in t["_sruns"]]
                    changed.update(scrub_events(msc, mine))
                rows = [(seq, json.dumps(new, ensure_ascii=False, default=str)) for seq, new in changed.items()]
                out["event_log"] += elog.rewrite_rows(rows)
                elog.set_marker(f"forget:{t['id']}")
        if out["swept"]:
            self._scrub_files()
        return out

    def _sweep_db(self, t: dict[str, Any], m: Matcher) -> tuple[int, int, int]:
        st = self.store
        with st._read() as conn:  # noqa: SLF001
            rows = conn.execute("SELECT * FROM nodes WHERE type IN ('Fact', 'Episode', 'Concept')").fetchall()
        doomed = []
        for r in rows:
            row = dict(r)
            created_ok = str(row["created_at"]) <= str(t.get("ts"))
            props = json.loads(row["props"])
            cb = props.get("created_by") if isinstance(props.get("created_by"), dict) else {}
            run = str(props.get("run_id") or cb.get("run") or "")
            if not (created_ok or (run and run in t["_runs"])):
                continue
            if self._covered(row, [t]):
                doomed.append(row["id"])
        derived = 0
        sc = Scope(t.get("scope") or "fact", t.get("namespace") or "global", {"id": t["id"]}, runs=set(t["_runs"]))
        at = now_iso()
        doomed = list(dict.fromkeys(doomed))
        ckeys = set(t.get("ckeys") or ())  # paylaşılan kavram ad alanından yeniden çıkarılır (adı değişmez)
        unlink: dict[str, list[str]] = {}
        for r in rows if ckeys else ():
            if r["type"] == "Concept" and r["id"] not in doomed and key_hash("Concept", r["key"]) in ckeys:
                cur = nsm.concept_namespaces({"props": json.loads(r["props"])})
                if sc.namespace in cur:
                    unlink[r["id"]] = [x for x in cur if x != sc.namespace]
        msc = self._scoped_tomb_matcher(t)
        sruns = set(t.get("_sruns") or ())
        _msent, mtok = self._split_matchers(t)
        fact_patches: dict[str, dict[str, Any]] = {}
        for r in rows:  # geri yüklenen bilgiler — ayraçla eşleşen seçili terim ve içerideki işaretsiz terim
            if r["type"] != "Fact" or r["id"] in doomed:
                continue
            props = json.loads(r["props"])
            stmt = str(props.get("statement") or "")
            made = _creating_runs(props)
            if not stmt or not (str(r["created_at"]) <= str(t.get("ts")) or made & t["_runs"]):
                continue
            new = stmt
            if mtok and nsm.of_node({"props": props}) == t.get("namespace"):
                th = mtok.term_hits(new)
                if any(x for _a, _b, x in th) or (th and key_hash("Fact", r["key"]) not in t["_pkeys"]):
                    doomed.append(r["id"])  # yazma kapısıyla aynı karar (bilinen benzer bilgi karartılır)
                    continue
                if th:
                    new = mtok.text(new)[0]
            if msc and made & sruns and not _user_origin(props):
                new = msc.text(new)[0]
            if new != stmt:
                fact_patches[r["id"]] = {"statement": new}
        with st.bulk():
            for nid in doomed:
                st.delete_node(nid)
            for nid, patch in fact_patches.items():
                st.patch_node(nid, patch)
                derived += 1
            for cid, rest in unlink.items():
                st.patch_node(cid, {"namespaces": rest or [nsm.GLOBAL]})
                inside, _o = _concept_links(st, cid, sc.namespace)
                inside += _cooccur_edges(st, cid, sc.namespace, set(doomed))
                st.delete_edges(e["id"] for e in inside)  # CDC C5: GraphStore yolu (günlüğe edge.delete)
                derived += 1
            if m:
                for nid, node in derived_nodes(st, sc).items():
                    patch = scrub_patch(st, node, m, at)
                    if patch:
                        st.patch_node(nid, patch)
                        derived += 1
            if msc and sruns:  # kaynak koşuların türevleri işaretsiz terimlerden de arınır
                for nid, node in derived_nodes(st, Scope(sc.scope, sc.namespace, sc.target, runs=sruns)).items():
                    if node["type"] in ("Fact", "Concept"):
                        continue
                    patch = scrub_patch(st, st.get_node(nid), msc, at)
                    if patch:
                        st.patch_node(nid, patch)
                        derived += 1
            changed = scrub_events(m, _run_items(st.run_event_rows(sc.runs))) if m else {}
            if msc and sruns:
                cur = {r["rowid"]: r for r in st.run_event_rows(sruns)}
                mine = [{**r, "data": json.dumps(changed[k], ensure_ascii=False, default=str)} if k in changed else r
                        for k, r in cur.items()]
                changed.update(scrub_events(msc, _run_items(mine)))
            mt = Matcher(token_recs=t.get("_trecs") or ())
            ns_runs = (_ns_runs(st, sc.namespace) - sc.runs) if mt else set()
            if mt:  # jetonlar ad alanının diğer koşularında ve anılarında da
                extra = derived_nodes(st, Scope(sc.scope, sc.namespace, sc.target, runs=ns_runs))
                for node in _ns_episodes(st, sc.namespace, set(extra)):
                    extra[node["id"]] = node
                for nid, node in extra.items():
                    patch = scrub_patch(st, node, mt, at)
                    if patch:
                        st.patch_node(nid, patch)
                        derived += 1
                if ns_runs:
                    changed.update(scrub_events(mt, _run_items(st.run_event_rows(ns_runs))))
            ev = [(rowid, json.dumps(new, ensure_ascii=False, default=str)) for rowid, new in changed.items()]
            n_ev = st.set_run_event_data(ev)
            if doomed or derived:
                st.cdc_rotate_key()  # CDC: yeniden uygulanan unutmada da eski özetler doğrulanamaz olur
        if m:  # geri yüklenen veri dizinindeki araç çıktısı artefaktları (başka ad alanı hariç)
            skip = foreign_runs(st, sc.namespace) - sc.runs
            self._scrub_tool_outputs(self._tool_output_hits(m, skip=skip), now_iso())
        if msc and sruns:
            self._scrub_tool_outputs(self._tool_output_hits(msc, sorted(sruns)), now_iso())
        return len(doomed), derived, n_ev

    # ------------------------------------------------------------ motor kancası
    def _attach_engine(self) -> None:
        engine = getattr(self.studio, "engine", None)
        hooks = getattr(getattr(engine, "hooks", None), "on_run_finished", None)
        if isinstance(hooks, list) and not any(getattr(h, "__self__", None) is not None and
                                               isinstance(h.__self__, ForgetService) for h in hooks):
            hooks.append(self._on_run_finished)
        # sıradan bağımsız tasarım. Çıktı kancası (`DeliverableService`) kasaya kopyalayıp özet çıkarmadan ÖNCE
        # çalışmış olabilir; bu yüzden süpürme "geç" listede (tüm olağan kancalardan SONRA) bir kez daha çalışır.
        late = getattr(getattr(engine, "hooks", None), "late_on_run_finished", None)
        if isinstance(late, list) and not any(getattr(h, "__self__", None) is not None and
                                              isinstance(h.__self__, ForgetService) for h in late):
            late.append(self._on_run_finished_late)

    def _on_run_finished_late(self, run: Any, status: str) -> None:
        """tüm olağan koşu-sonu kancalarından (çıktı kaydı + kasa kopyası + özet dahil) SONRA ikinci süpürme."""
        self._on_run_finished(run, status, final=True)

    def _on_run_finished(self, run: Any, status: str, final: bool | None = None) -> None:
        """Unutma sırasında süren koşu bitince türevleri (teslim özeti dahil) bir kez daha süpürülür. unutmadan
        SONRA yayılan olaylar da (koşu olayları, `events.db`, SSE önbelleği) aynı eşleyiciyle karartılır."""
        rid = str(getattr(run, "id", ""))
        tombs = [t for t in self.tombstones() if rid in t["_runs"]]
        if not tombs:
            return
        try:
            for t, m in [(t, mm) for t in tombs
                         for mm in (self.tomb_matcher(t, self._inflight.get(rid, ()), self._inflight_terms.get(rid, ())),
                                    self._scoped_tomb_matcher(t) if rid in t["_sruns"] else None) if mm]:
                _scrub_state(run, m)
                sc = Scope(t.get("scope") or "fact", t.get("namespace") or "global", {"id": t["id"]}, runs={rid})
                at = now_iso()
                scoped = m is t.get("_sm")
                with self.store.bulk():
                    for nid, node in derived_nodes(self.store, sc).items():
                        if scoped and node["type"] in ("Fact", "Concept"):
                            continue  # işaretsiz terim dışarıdaki bilgiye/kavrama dokunmaz
                        patch = scrub_patch(self.store, self.store.get_node(nid) if scoped else node, m, at)
                        if patch:
                            self.store.patch_node(nid, patch)
                    changed = scrub_events(m, _run_items(self.store.run_event_rows([rid])))
                    self.store.set_run_event_data(
                        (k, json.dumps(v, ensure_ascii=False, default=str)) for k, v in changed.items())
                elog = getattr(self.studio, "events_log", None)
                if elog is not None:
                    try:
                        items = [it for it in _log_items(elog.all_rows()) if str(it[2] or "") == rid]
                        rows = [(seq, json.dumps(new, ensure_ascii=False, default=str))
                                for seq, new in scrub_events(m, items).items()]
                        if rows:
                            elog.rewrite_rows(rows)
                    except Exception:  # noqa: BLE001
                        log.exception("unutma: koşu sonu olay günlüğü süpürülemedi: %s", rid)
                cache = getattr(getattr(self.studio, "bus", None), "_json", None)
                if isinstance(cache, dict):
                    mine = [it for it in _log_items(list(cache.items())) if str(it[2] or "") == rid]
                    for seq in scrub_events(m, mine):
                        cache.pop(seq, None)
                self._scrub_tool_outputs(self._tool_output_hits(m, [rid]), at)  # süren koşunun sonraki çıktıları
                self._scrub_vault([m], {rid})  # koşunun kasa kopyaları
        except Exception:  # noqa: BLE001 - kanca koşuyu bozmaz
            log.exception("unutma süpürmesi başarısız: %s", rid)
        finally:
            late_ok = getattr(getattr(getattr(self.studio, "engine", None), "hooks", None), "late_on_run_finished", None)
            if final is True or (final is None and not isinstance(late_ok, list)):
                # geç kanca varsa süren-koşu bağlamı onu bekler (ilk geçişte düşmez)
                self._inflight.pop(rid, None)
                self._inflight_terms.pop(rid, None)


def _scrub_tools(st: Any, m: Matcher) -> None:
    """Adımın bellekteki araç kayıtları (`tools`: girdi + çıktı): ardışık çıktılar birlikte taranır, sonra her
    kayıt derin karartılır (JSON kaçışlı girdi dahil)."""
    tools = getattr(st, "tools", None)
    if not isinstance(tools, list) or not tools or not m:
        return
    items = [(i, "step.tool_result", "", {"step": "", "output": t.get("output")}) for i, t in enumerate(tools)
             if isinstance(t, dict) and isinstance(t.get("output"), str)]
    changed = scrub_events(m, items)
    out = []
    for i, t in enumerate(tools):
        if i in changed:
            t = {**t, "output": changed[i]["output"]}
        out.append(m.value(t)[0] if isinstance(t, dict) else t)
    st.tools = out


def _scrub_fields(obj: Any, m: Matcher, fields: Iterable[str]) -> None:
    for f in fields:
        val = getattr(obj, f, None)
        if isinstance(val, str) and val:
            new = m.text(val)[0]
            if new != val:
                try:
                    setattr(obj, f, new)
                except (AttributeError, TypeError):  # salt okunur nesne: dokunulmaz
                    pass


def _scrub_specs(run: Any, m: Matcher) -> None:
    """canlı koşunun akış/adım tanımları (görev başlığı ve istemi unutulan cümle olabilir)."""
    spec = getattr(run, "spec", None)
    if spec is not None:
        _scrub_fields(spec, m, ("name", "description"))
        for sp in getattr(spec, "steps", None) or []:
            _scrub_fields(sp, m, ("title", "prompt"))
    for st in getattr(run, "steps", {}).values():
        sp = getattr(st, "spec", None)
        if sp is not None:
            _scrub_fields(sp, m, ("title", "prompt"))


def _scrub_state(run: Any, m: Matcher) -> None:
    for st in getattr(run, "steps", {}).values():
        _scrub_tools(st, m)
        for f in ("output", "prompt", "thought"):
            val = getattr(st, f, None)
            if isinstance(val, str) and val:
                setattr(st, f, m.text(val)[0])
    for f in ("output", "title"):
        val = getattr(run, f, None)
        if isinstance(val, str) and val:
            setattr(run, f, m.text(val)[0])
    _scrub_specs(run, m)


def service_for(studio: Any) -> ForgetService:
    svc = studio.__dict__.get("_forget_service")
    if svc is None:
        svc = ForgetService(studio)
        studio.__dict__["_forget_service"] = svc
    return svc


def reapply_on_start(studio: Any) -> dict[str, Any]:
    """Açılış: mezar kayıtlarını yeniden uygular (yedekten geri yükleme). Hata açılışı engellemez."""
    try:
        svc = service_for(studio)
        svc.purge_expired()  # süresi dolan yedekler açılışta da silinir
        if not svc.retry_wal_pending():  # önceki oturumda tamamlanamamış WAL sıfırlaması
            svc._schedule_wal_retry(0)  # noqa: SLF001
        return svc.reapply()
    except Exception:  # noqa: BLE001
        log.exception("unutma mezar kayıtları yeniden uygulanamadı")
        return {"error": True}


__all__ = ["ForgetService", "ForgetError", "ForgetDenied", "ForgottenError", "Matcher", "MARK", "SCOPES",
           "UNDO_WINDOW_S", "collect", "service_for", "reapply_on_start", "ForgetBusy", "extract_tokens", "term_seq",
           "token_record", "neutral_name", "scope_items", "foreign_runs"]
