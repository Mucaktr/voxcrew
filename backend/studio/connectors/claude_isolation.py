"""Claude Code ajanlarının kullanıcı `~/.claude` kurulumundan yalıtımı (kullanıcı kararı 3, AUDIT G-4).

Karar 3: Claude Code ajanları kullanıcının `~/.claude` kurulumunu (CLAUDE.md, skill, eklenti) **varsayılan olarak
devralmaz**; ajan başına açılabilir. Mekanizma resmî belgeden doğrulandı:

- `--setting-sources project,local`: `user` kaynağı yüklenmez. Belgeye göre `user` kaynağı `~/.claude/settings.json`
  (hook'lar, izinler, `env`, `enabledPlugins`), kullanıcı `CLAUDE.md` + `~/.claude/rules/*.md`, `~/.claude/skills`,
  `~/.claude/commands` ve `~/.claude/agents` demektir.
- `CLAUDE_CODE_DISABLE_CLAUDE_MDS=1`: belgeye göre "any CLAUDE.md memory files … including user, project, and
  auto memory files" yüklenmez. `project` kaynağı CLAUDE.md'yi çalışma klasöründen KÖKE kadar her üst dizinde arar;
  varsayılan çalışma klasörü ev dizininin altında olduğundan `~/CLAUDE.md` aksi hâlde "proje" olarak yüklenirdi. Ajan
  yönergeleri zaten istemde gider; projenin CLAUDE.md'sine gerek yoktur.
- `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`: kullanıcının otomatik belleği ne okunur ne yazılır.
- `--no-session-persistence`: `-p` koşusu kullanıcının `~/.claude/projects` oturum listesine transcript yazmaz.
- `--settings <stüdyo ayar dosyası>` (TL kararı): stüdyonun veri dizinine (asla bir `.claude` klasörüne
  değil) yazılan, kullanıcı içeriği taşımayan JSON. `claudeMdExcludes` her klasördeki `CLAUDE.md`, `.claude/CLAUDE.md`,
  `CLAUDE.local.md`, `.claude/rules/**`, `AGENTS.md` ve `.claude/AGENTS.md`'yi dışarıda bırakır (glob + çalışma
  klasörünün üst dizinleri için mutlak yol); `pluginConfigs["cc-plugin-agents-md@builtin"]` (ve v2.1.285 öncesi kimlik
  `agents-md@builtin`) `instructionFiles: "managed-only"` ile proje/yerel/kullanıcı CLAUDE.md'lerini, `.claude/rules`'u ve
  her `AGENTS.md`'yi açılışta kapatır. Belge bu girdiyi `--settings` dosyasından okur, proje/yerel dosyada yok sayar.

Üst dizinlerdeki `CLAUDE.local.md`, `.claude/rules` ve `AGENTS.md` artık belgeye dayalı olarak dışarıda bırakılır. Geriye
kalan DOĞRULANMAMIŞ nokta: belge `--settings` katmanının `--setting-sources project,local` ile birlikte okunduğunu açıkça
yazmıyor (ÇIKARIM: `--settings` ayrı "command line" katmanıdır, `SettingSource` değerlerinden biri değildir) ve gerçek
bir `claude` ile denenmedi. Bu yüzden `ancestor_files` bu adları YALNIZ varlık denetimiyle (içerik okunmaz, hiçbir şey
yazılmaz) aramaya devam eder; bulursa koşu izinde ve kartta "dışarıda bırakıldı, canlı doğrulanmadı" notu verilir.
REAL-CLAUDE (2026-10-22, gerçek `claude` 2.1.302; araştırma notu §7): `--settings` + `--setting-sources` birlikteliği,
CLAUDE.md/CLAUDE.local.md/.claude/rules dışlaması, skill/komut/alt ajan aracı reddi, eşitlenen eklentiler ve `Edit(//…)`
yasağı canlı doğrulandı; AGENTS.md dışlaması ile kurulu eklenti ve hook'ların durması doğrulanmadı (`LIVE_*`, `view`).

 (belgeye dayalı, gerçek `claude` ile doğrulanmadı):
- Kurulu eklentiler: `CLAUDE_CODE_PLUGIN_CACHE_DIR` koşuya özel boş bir stüdyo klasörüne (veri dizini; asla
  `~/.claude`) yönelir. Belge eklentilerin bu kökteki `installed_plugins.json` ve önbellekten yüklendiğini söyler.
- Skill, komut, alt ajan: `--disable-slash-commands` + `--disallowedTools Skill,Agent`. `project` kaynağı bunları
  "repository root"a kadar üst dizinlerde arar; depo yokken nerede durduğu belgede yazmıyor, bu yüzden araçlar kapatılır.
- `--settings` dosyası `permissions.deny` ile stüdyonun yalıtım dosyalarına `Edit(//…)` yazımını yasaklar; kayıt
  ayrıca yalnız stüdyonun API'si yazdığında geçerlidir (son yazımın sha256'sı graf veritabanında; uyuşmazsa yok sayılır).
- Ayar dosyası hiçbir zaman bir `.claude` klasörüne ya da `CLAUDE_CONFIG_DIR` altına yazılmaz; yol `realpath` + uzun ad
  açılımıyla denetlenir. npm `claude.cmd` kabuğunda cmd.exe'nin bölebileceği argüman verilmez.

 (K2; QA dalga 18 küçük ve bilgi bulguları):
- Artık dosya bırakılmaz: koşuya özel eklenti kökü ve istem dosyası OLUŞTURULMADAN önce koşunun silme
  listesine yazılır; `launch` iş parçacığındayken iptal edilen koşuda iş parçacığı dönünce silinir. Adlar
  `<stüdyo pid>-<rastgele>`; açılışta (`sweep_leftovers`) yalnız stüdyonun kendi klasörlerinde, sahibi ölmüş ya da 24 saati
  aşmış girdiler süpürülür (çökme artıkları). İstem dosyası artık çıplak `%TEMP%`'te değil, stüdyonun kendi klasöründe
  (`<veri>/claude_isolation_prompts`, yoksa `%TEMP%/voxcrew-claude-prompts`), POSIX'te 0700/0600.
- Bir kez güven yalnız bu sürümün gerçekten ilk açılışında (veritabanında sürüm işareti yok ve özet tablosu
  boş). Sonrasında özet satırı yoksa kayıt geçersizdir (yalıtılmış, uyarı). Anahtar tam çözülmüş veri dizini yoludur
  (8.3 kısa ad ve uzun ad aynı anahtar). Graf veritabanı ve WAL/SHM dosyaları da `Edit(//…)` yasağında.
- Kayıt geçersizken/okunamazken/dosya yokken ajan silinirse (`forget`) saklı özet iptal edilir; eski baytların aynen geri
  konması onayı geri getiremez. `view` geçersiz kaydı `record_ignored` ile bildirir.
- `claude --version` ( en küçük ortamla bağlantı yoklamasının önbelleği; koşu yolunda süreç başlatılmaz) 2.1.63
  öncesini ya da bilinmeyen sürümü gösteriyorsa `--disallowedTools` listesine `Task` da eklenir.

Neden `CLAUDE_CONFIG_DIR` değil: belge, bu değişkenin `.credentials.json` girişini de taşıdığını söyler; ajan başına
boş bir dizin kullanıcının aboneliğiyle oturumunu kaybeder. Bilinçli olarak kapsam DIŞI: `~/.claude.json` (genel
yapılandırma, kullanıcı MCP sunucuları dahil; belge "Always read"), claude.ai bağlayıcıları, yönetilen (managed) ayar ve
yönetilen CLAUDE.md.

Ajan başına açma (`inherit_user_claude_config`): `<veri>/claude_isolation.json` içinde ajanın DEĞİŞMEZ düğüm
kimliği + oluşturma damgasıyla tutulur (kısa ad değil). Ajan silinince kayıt silinir; aynı kısa adla yeniden oluşturulan
ajan yeni bir örnektir ve yalıtılmış başlar. Eski (kısa ad anahtarlı, biçim 1) kayıt yalnız şimdiki örnekle eşleşirse
geçerlidir (örnek, onaydan en az bir saniye önce oluşturulmuş olmalı); eşleşmezse yalıtılmış. Yalnız kullanıcı
değiştirebilir (`/api/claude-isolation/…` USER_ONLY_RE — MCP 403), açmak açık onay ister (`confirm: "inherit"`), iç
(sistem) ajanlar hiç açamaz. Kayıt okunamazsa (bozuk JSON, derinlik/boyut sınırı, dizin, yinelenen anahtar, bilinmeyen
biçim) herkes yalıtılmıştır ve uyarı günlüğe yazılır; koşu düşmez, uç 500 vermez. Açıkken argv ve ortam bu modülden
önceki davranışla bayt bayt aynıdır. Bu modül `~/.claude`'a hiçbir koşulda yazmaz.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import shutil
import stat
import subprocess
import tempfile
import threading
import time
import uuid
import weakref
from datetime import datetime
from pathlib import Path
from typing import Any

log = logging.getLogger("studio.claude_isolation")

FILE = "claude_isolation.json"
FORMAT = "voxcrew-claude-isolation/2"
LEGACY_FORMAT = "voxcrew-claude-isolation/1"
CONFIRM = "inherit"
ISOLATED_SOURCES = "project,local"
ISOLATION_FLAGS = ("--setting-sources", ISOLATED_SOURCES, "--no-session-persistence")
ISOLATION_ENV = {"CLAUDE_CODE_DISABLE_AUTO_MEMORY": "1", "CLAUDE_CODE_DISABLE_CLAUDE_MDS": "1"}
DOCS = ""
# kayıt okunurken boyut ve iç içe geçme sınırı (aşan kayıt bozuk sayılır → yalıtılmış)
MAX_BYTES = 256 * 1024
MAX_DEPTH = 8
# stüdyonun kendi (gizli) ajanlarının kısa adları — kullanıcı oluşturamaz (`agents.RESERVED_AGENT_SLUGS`) ve
# hiçbir zaman devralma açılamaz. Sistem çağrıları (gizli denetçi dahil) ayrıca örneksiz çalıştığı için her zaman yalıtılmış.
INTERNAL_SLUGS = frozenset({"system", "sistem", "studio", "studyo", "user", "kullanici"})
# env değişkeninin belgesinde adı geçmeyen yönerge dosyaları (çalışma klasörü ve üst dizinlerinde aranır).
# bunlar artık `--settings` ile dışarıda bırakılır; uyarı yalnız "canlı doğrulanmadı" anlamındadır.
UNCOVERED_NAMES = ("CLAUDE.local.md", "AGENTS.md", ".claude/AGENTS.md", ".claude/rules")
# stüdyonun yalıtılmış koşulara verdiği ayar dosyası (`--settings`; belge: cli-reference, settings, memory)
SETTINGS_FLAG = "--settings"
SETTINGS_DIR = "claude_isolation"           # <veri>/claude_isolation/settings-<özet>.json (asla bir .claude klasörü)
SETTINGS_MAX_BYTES = 2 * 1024 * 1024        # belge: "The file must be a regular file no larger than 2 MiB"
# claudeMdExcludes: "Patterns are matched against absolute file paths using glob syntax"
EXCLUDED_FILES = ("CLAUDE.md", ".claude/CLAUDE.md", "CLAUDE.local.md", "AGENTS.md", ".claude/AGENTS.md")
EXCLUDED_DIRS = (".claude/rules",)
# AGENTS.md okuyan yerleşik eklenti; v2.1.285 öncesi kimlik `agents-md@builtin` (v2.1.285+ ikisini de okur)
AGENTS_MD_PLUGINS = ("cc-plugin-agents-md@builtin", "agents-md@builtin")
INSTRUCTION_FILES = "managed-only"
# skill, komut ve alt ajan. `--disable-slash-commands` (cli-reference: "Disable all skills and commands for this
# session"); `--disallowedTools` çıplak araç adı aracı bağlamdan kaldırır ("A bare tool name removes the matching tools from
# Claude's context"): `Skill` (skills: "Disable all skills by denying the Skill tool") ve `Agent` (alt ajan aracı; 2.1.63'te
# Task'tan yeniden adlandırıldı). Ev dizinindeki ~/.claude/skills|commands|agents, çalışma klasörü depo dışındayken `project`
# kaynağının üst dizin taramasına girebilir (belgede durma noktası yazmıyor); bu bayraklar onları kullanılamaz kılar.
NO_SKILLS_FLAG = "--disable-slash-commands"
DENY_TOOLS = ("Skill", "Agent")
# kurulu eklentiler. env-vars: CLAUDE_CODE_PLUGIN_CACHE_DIR "Override the plugins root directory … Defaults to
# ~/.claude/plugins"; plugins/loading: "Plugins load at session start from `installed_plugins.json` and the cache" ve ikisi
# de bu kökün altındadır. Yalıtılmış her koşu stüdyonun veri dizininde koşuya özel BOŞ bir kök alır (asla ~/.claude).
PLUGIN_ENV = "CLAUDE_CODE_PLUGIN_CACHE_DIR"
PLUGINS_DIR = "claude_isolation_plugins"    # <veri>/claude_isolation_plugins/<koşu>/ (koşu bitince silinir)
TEMP_PREFIX = "voxcrew-claude-"             # veri dizini kullanılamıyorsa sistem geçici klasörü
STALE_S = 24 * 3600
# istem dosyaları stüdyonun kendi klasöründe (çıplak %TEMP% değil); geçici klasör yedeği de stüdyoya ait alt klasör
PROMPTS_DIR = "claude_isolation_prompts"    # <veri>/claude_isolation_prompts/<pid>-<id>.txt
TEMP_PLUGINS_DIR = TEMP_PREFIX + "plugins"  # %TEMP%/voxcrew-claude-plugins/<pid>-<id>/
TEMP_PROMPTS_DIR = TEMP_PREFIX + "prompts"  # %TEMP%/voxcrew-claude-prompts/<pid>-<id>.txt
STUDIO_DIRS = frozenset({PLUGINS_DIR, PROMPTS_DIR, TEMP_PLUGINS_DIR, TEMP_PROMPTS_DIR})
# sürümünün çıplak %TEMP% adları (yalnız açılış süpürmesi; başka bir stüdyo sürecinde kullanımda olabilir → süreli)
LEGACY_TEMP_PLUGINS = TEMP_PREFIX + "plugins-"   # mkdtemp klasörü
LEGACY_TEMP_PROMPT = TEMP_PREFIX + "prompt-"     # mkstemp dosyası (.txt)
LEGACY_PROMPT_GRACE_S = 600                 # istem dosyası yalnız claude açılırken okunur; 10 dk sonra artıktır
ENTRY_RE = re.compile(r"(\d{1,10})-[0-9a-f]{12}(?:\.txt)?")
# alt ajan aracı 2.1.63'te Task → Agent oldu (sub-agents: "Existing `Task(...)` references … still work as
# aliases"). Sürüm bilinmiyor ya da daha eskiyse eski ad da reddedilir.
# ISO-WORDING: 2.1.302'de `Agent` reddi `Task`'ı da kaldırıyor (canlı doğrulandı, araştırma notu §7.3: araç `init.tools`'ta
# `Task` adıyla geliyor, `--disallowedTools Skill,Agent` ile yok). Bu girdi yalnız eski CLI'ler için tutuluyor.
LEGACY_AGENT_TOOL = "Task"
# ISO-WORDING: gerçek `claude` canlı doğrulaması (araştırma notu §7); kartla aynı
LIVE_CHECKED_VERSION = "2.1.302"
LIVE_VERIFIED = ("--settings read together with --setting-sources",
                 "CLAUDE.md, .claude/CLAUDE.md, CLAUDE.local.md, .claude/rules in workdir and parent folders "
                 "(incl. on-demand subfolder files) not loaded; existing ~/.claude/CLAUDE.md not loaded",
                 "skills and commands: none; Skill and Agent (Task) tools absent",
                 "parent-folder subagent definitions listed in init.agents but unusable",
                 "claude.ai synced plugins not loaded",
                 "Edit deny rules on studio isolation files",
                 "sign-in kept; no transcript or auto memory written")
LIVE_NOT_VERIFIED = ("AGENTS.md exclusion (not read even unprotected in the test)",
                     "empty plugins root stops installed (marketplace) plugins and their hooks",
                     "~/.claude/skills plugin folders (@skills-dir) with user source off",
                     "marker files placed in the home folder itself (~/CLAUDE.local.md, ~/.claude/rules)",
                     "workdir given as an 8.3 short path or in another letter case")
AGENT_TOOL_SINCE = (2, 1, 63)
INLINE_SHIM_MAX = 4096                      # cmd.exe satırı 8191 karakter; satır içi ayar payı
# npm `claude.cmd` kabuğu cmd.exe ile çalışır; bu karakterler komutu böler ya da değiştirir
CMD_META = frozenset('&|<>^%!"') | frozenset(chr(c) for c in (13, 10, 0))
# tırnak içinde de etkili: satır sonu komutu keser, `%` ve `!` genişler (ölçüm: `a\nb` → yalnız `a` ulaşır)
CMD_ALWAYS = frozenset(chr(c) for c in (13, 10, 0)) | frozenset("%!")
CMD_OUTSIDE = frozenset("&|<>^()")          # tırnak dışında komut ayırıcı / kaçış; `` blok sınırı
REPLACE_TRIES = 8                           # Windows'ta geçici dosya kilidi (os.replace PermissionError)
# kayıt yalnız stüdyonun API'si yazdığında geçerlidir; son yazımın özeti graf veritabanında tutulur
DIGEST_TABLE = "claude_isolation_digest"
ABSENT = "absent"
# "bu sürüme ilk açılış" veritabanındaki işaretle bilinir; iptal edilmiş özet hiçbir bayta eşit değil
MARKER_TABLE = "claude_isolation_marker"
MARKER = "voxcrew-claude-isolation-digest/2"
REVOKED = "revoked"
DB_SUFFIXES = ("", "-wal", "-shm", "-journal")
DEFAULT_DB = "studio.db"

_LOCK = threading.RLock()
_WARNED: set[str] = set()
_STORES: "weakref.WeakValueDictionary[str, Any]" = weakref.WeakValueDictionary()
_DB_PATHS: dict[str, str] = {}               # veri anahtarı → bağlı graf veritabanının yolu (Edit yasağı için)


class IsolationError(ValueError):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


def data_dir(settings: Any) -> Path | None:
    try:
        path = getattr(settings, "path", None)
        return Path(path).parent if path else None
    except (TypeError, ValueError):
        return None


def _file(settings: Any) -> Path | None:
    d = data_dir(settings)
    return d / FILE if d is not None else None


def _empty() -> dict[str, Any]:
    return {"format": FORMAT, "agents": {}}


def _warn(reason: str, f: Path | None) -> None:
    key = f"{f}:{reason}"
    if key not in _WARNED:
        _WARNED.add(key)
        log.warning("claude_isolation.json okunamadı (%s); bütün Claude ajanları yalıtılmış çalışır", reason)


def _depth_ok(text: str, limit: int = MAX_DEPTH) -> bool:
    """JSON metninin iç içe geçme derinliği sınırı aşmıyor mu (dizgi içeriği sayılmaz; ayrıştırmadan ÖNCE)."""
    depth, in_str, esc = 0, False, False
    for ch in text:
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
        elif ch == '"':
            in_str = True
        elif ch in "[{":
            depth += 1
            if depth > limit:
                return False
        elif ch in "]}":
            depth -= 1
    return True


class _BadRecord(ValueError):
    """Kayıt ayrıştırma hatası (iç; günlüğe yalnız sınıf adı yazılır, kullanıcıya gösterilmez)."""


def _no_dupes(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for k, v in pairs:
        if k in out:  # yinelenen anahtar → bozuk kayıt
            raise _BadRecord(k[:40])
        out[k] = v
    return out


def _reject_constant(name: str) -> Any:  # NaN / Infinity → bozuk kayıt
    raise _BadRecord(name)


def load(settings: Any) -> dict[str, Any]:
    """Kayıt → {format, agents}, `corrupt: True` (her okuma hatası) ya da `void: True` (stüdyonun son yazımı
    değil). Asla istisna fırlatmaz; bozuk ve geçersiz kayıtta herkes yalıtılmıştır."""
    f = _file(settings)
    if f is None:
        return _empty()
    try:
        if not os.path.lexists(f):
            return _empty()
        if not f.is_file():
            _warn("dosya değil (dizin ya da başka bir şey)", f)
            return {**_empty(), "corrupt": True}
        if f.stat().st_size > MAX_BYTES:
            _warn("boyut sınırı", f)
            return {**_empty(), "corrupt": True}
        with open(f, "rb") as fh:
            raw = fh.read(MAX_BYTES + 1)
        if len(raw) > MAX_BYTES:
            _warn("boyut sınırı", f)
            return {**_empty(), "corrupt": True}
        text = raw.decode("utf-8")
        if not _depth_ok(text):
            _warn("derinlik sınırı", f)
            return {**_empty(), "corrupt": True}
        data = json.loads(text, object_pairs_hook=_no_dupes, parse_constant=_reject_constant)
    except Exception as exc:  # noqa: BLE001 - bozuk kayıt: güvenli taraf = herkes yalıtılmış (koşu düşmez)
        _warn(type(exc).__name__, f)
        return {**_empty(), "corrupt": True}
    if (not isinstance(data, dict) or not isinstance(data.get("agents"), dict)
            or data.get("format") not in (FORMAT, LEGACY_FORMAT)):
        _warn("beklenmeyen biçim", f)
        return {**_empty(), "corrupt": True}
    # yalnız stüdyonun API'sinin yazdığı kayıt geçerlidir. Son yazımın sha256'sı graf veritabanındadır; dosya
    # başka biri (ör. yazma izinli yalıtılmış bir ajan) tarafından yazıldıysa uyuşmaz → kayıt yok sayılır (herkes yalıtılmış)
    if not _trusted(settings, raw):
        _warn("uygulama dışında yazılmış (son uygulama yazımıyla uyuşmuyor)", f)
        return {**_empty(), "void": True}
    return data


# ---------------------------------------------------------------------- kayıt bütünlüğü (graf veritabanı)
def _key(settings: Any) -> str | None:
    """tam çözülmüş veri dizini yolu (`realpath` + 8.3 → uzun ad): aynı klasörün her yazımı aynı anahtar."""
    d = data_dir(settings)
    if d is None:
        return None
    try:
        return os.path.normcase(str(resolved(d)))
    except (TypeError, ValueError, OSError):
        return None


def _legacy_key(settings: Any) -> str | None:
    """ sürümünün anahtarı (`abspath`; yalnız bu sürüme ilk açılışta taşımak için)."""
    d = data_dir(settings)
    try:
        return os.path.normcase(os.path.abspath(str(d))) if d is not None else None
    except (TypeError, ValueError, OSError):
        return None


def _sha(raw: bytes | None) -> str:
    return ABSENT if raw is None else hashlib.sha256(raw).hexdigest()


def _current(f: Path) -> bytes | None:
    try:
        if not f.is_file() or f.stat().st_size > MAX_BYTES:
            return None if not os.path.lexists(f) else b"\0unreadable"
        return f.read_bytes()
    except OSError:
        return b"\0unreadable"


def bind(settings: Any, store: Any) -> None:
    """Stüdyo açılışı: kayıt bütünlüğü için graf veritabanını bağla.

    dosyanın o anki hâline bir kez güvenmek YALNIZ bu sürümün gerçekten ilk açılışındadır: veritabanında sürüm
    işareti (`MARKER_TABLE`) yok VE özet tablosu boş (yeni kurulum ya da özet öncesi sürümden yükseltme). İşaret varsa ya
    da tabloda başka satırlar varsa, bu veri dizininin satırı yoksa kayıt GEÇERSİZDİR (herkes yalıtılmış, uyarı). İlk
    açılışta `abspath` anahtarındaki satır tam çözülmüş anahtara taşınır. Dosya hiç yoksa `absent` yazılır."""
    k = _key(settings)
    f = _file(settings)
    if k is None or f is None or store is None:
        return
    missing = False
    try:
        with store._write() as c:  # noqa: SLF001 - stüdyoya ait küçük tablo (game/expanse ile aynı yaklaşım)
            c.execute(f"CREATE TABLE IF NOT EXISTS {DIGEST_TABLE} (data_key TEXT PRIMARY KEY, sha256 TEXT NOT NULL, "
                      "updated REAL NOT NULL)")
            c.execute(f"CREATE TABLE IF NOT EXISTS {MARKER_TABLE} (name TEXT PRIMARY KEY, value TEXT NOT NULL, "
                      "updated REAL NOT NULL)")
            first = c.execute(f"SELECT 1 FROM {MARKER_TABLE} WHERE name=?", (MARKER,)).fetchone() is None
            if c.execute(f"SELECT 1 FROM {DIGEST_TABLE} WHERE data_key=?", (k,)).fetchone() is None:
                current = _current(f)
                legacy = _legacy_key(settings)
                old = (c.execute(f"SELECT sha256 FROM {DIGEST_TABLE} WHERE data_key=?", (legacy,)).fetchone()
                       if first and legacy and legacy != k else None)
                empty = c.execute(f"SELECT 1 FROM {DIGEST_TABLE} LIMIT 1").fetchone() is None
                if old is not None:                      # anahtarı (aynı klasör, abspath yazımı) → taşı
                    value: str | None = str(old[0])
                elif first and empty:                    # gerçekten ilk açılış: bir kez güven
                    value = _sha(current)
                elif current is None:                    # dosya yok: güvenilecek bir şey yok, durum doğru kaydedilir
                    value = ABSENT
                else:                                    # satır yok → geçersiz (yeniden kurulmaz)
                    value, missing = None, True
                if value is not None:
                    c.execute(f"INSERT INTO {DIGEST_TABLE} (data_key, sha256, updated) VALUES (?, ?, ?)",
                              (k, value, time.time()))
            if first:
                c.execute(f"INSERT OR IGNORE INTO {MARKER_TABLE} (name, value, updated) VALUES (?, ?, ?)",
                          (MARKER, "1", time.time()))
            store._commit()  # noqa: SLF001
    except Exception:  # noqa: BLE001 - bağlanamazsa kayıtlar yok sayılır (herkes yalıtılmış); açılış düşmez
        log.warning("claude_isolation özet tablosu hazırlanamadı; Claude ajanları yalıtılmış çalışır")
        return
    if missing:
        log.warning("claude_isolation özet satırı yok (ilk açılış değil); kayıt yok sayılır, Claude ajanları yalıtılmış "
                    "çalışır. Ajan başına yeniden açmak kaydı yeniler")
    _STORES[k] = store
    if not getattr(store, "_memory", False) and getattr(store, "path", None):
        _DB_PATHS[k] = os.path.abspath(str(store.path))


def _stored_digest(settings: Any) -> str | None:
    k = _key(settings)
    store = _STORES.get(k) if k else None
    if store is None:
        return None
    try:
        with store._read() as c:  # noqa: SLF001
            row = c.execute(f"SELECT sha256 FROM {DIGEST_TABLE} WHERE data_key=?", (k,)).fetchone()
    except Exception:  # noqa: BLE001
        return None
    return str(row[0]) if row else None


def _record_digest(settings: Any, raw: bytes | None) -> None:
    k = _key(settings)
    store = _STORES.get(k) if k else None
    if store is None:
        raise OSError("claude_isolation özet tablosu bağlı değil")
    with store._write() as c:  # noqa: SLF001
        c.execute(f"INSERT INTO {DIGEST_TABLE} (data_key, sha256, updated) VALUES (?, ?, ?) "
                  "ON CONFLICT(data_key) DO UPDATE SET sha256=excluded.sha256, updated=excluded.updated",
                  (k, _sha(raw), time.time()))
        store._commit()  # noqa: SLF001


def _trusted(settings: Any, raw: bytes) -> bool:
    """Dosyanın baytları stüdyonun son yazımıyla aynı mı (özet yoksa, veritabanı bağlı değilse: hayır)."""
    stored = _stored_digest(settings)
    return stored is not None and stored == _sha(raw)


def _revoke(settings: Any, value: str = REVOKED) -> None:
    """saklı özeti iptal et (`revoked` hiçbir bayta eşit değildir; `absent` = dosya yok). Kayıt geçersiz, okunamaz
    ya da yokken bir ajan silinirse eski baytların aynen geri konması o ajanın (ya da herhangi birinin) onayını geri
    getiremez. Kullanıcı ajan başına yeniden açarak (stüdyo yazımı) kaydı yeniler."""
    stored = _stored_digest(settings)
    if stored is None or stored in (REVOKED, value):
        return
    k = _key(settings)
    store = _STORES.get(k) if k else None
    if store is None:
        return
    try:
        with store._write() as c:  # noqa: SLF001
            c.execute(f"UPDATE {DIGEST_TABLE} SET sha256=?, updated=? WHERE data_key=?", (value, time.time(), k))
            store._commit()  # noqa: SLF001
    except Exception:  # noqa: BLE001 - iptal edilemezse kayıt zaten geçersiz/yok (herkes yalıtılmış)
        log.warning("claude_isolation özeti iptal edilemedi (silinen ajanın eski onayı kayıt geri konursa dönebilir)")


def record_state(settings: Any) -> str:
    """`absent` (kayıt yok), `ok`, `void` (stüdyonun son yazımı değil: elle değişiklik ya da eski bir veritabanı
    yedeği) ya da `corrupt` (okunamadı). `void`/`corrupt` iken herkes yalıtılmıştır."""
    f = _file(settings)
    if f is None or not os.path.lexists(f):
        return "absent"
    data = load(settings)
    return "corrupt" if data.get("corrupt") else "void" if data.get("void") else "ok"


# ---------------------------------------------------------------------- ajan örneği
def instance_of(node: Any) -> dict[str, str] | None:
    """Graf düğümü ya da serileştirilmiş ajan → {id, created_at} (ikisi de yoksa None)."""
    if not isinstance(node, dict):
        return None
    nid, created = node.get("id"), node.get("created_at")
    if isinstance(nid, str) and nid and isinstance(created, str) and created:
        return {"id": nid, "created_at": created}
    return None


def _ts(iso: Any) -> float | None:
    try:
        return datetime.fromisoformat(str(iso)).timestamp()
    except (TypeError, ValueError):
        return None


def _legacy_match(rec: Any, instance: dict[str, str]) -> bool:
    """Biçim 1 (kısa ad anahtarlı) kayıt şimdiki örneğe mi verilmiş: örnek onaydan (set_at) en az 1 sn önce oluşmuş
    olmalı (oluşturma damgası saniye hassasiyetindedir). Silinip yeniden oluşturulan ajan onaydan SONRA doğar → eşleşmez."""
    if not isinstance(rec, dict) or rec.get("inherit") is not True:
        return False
    set_at = rec.get("set_at")
    created = _ts(instance.get("created_at"))
    if isinstance(set_at, bool) or not isinstance(set_at, (int, float)) or created is None:
        return False
    return created + 1 <= float(set_at)


def _match(data: dict[str, Any], slug: str, instance: dict[str, str] | None) -> bool:
    if not instance:
        return False
    agents = data.get("agents") or {}
    if data.get("format") == FORMAT:
        rec = agents.get(instance["id"])
        return (isinstance(rec, dict) and rec.get("inherit") is True and rec.get("created_at") == instance["created_at"]
                and rec.get("slug") == slug)
    return _legacy_match(agents.get(slug), instance)


def internal(slug: Any) -> bool:
    return str(slug or "").strip().lower() in INTERNAL_SLUGS


def inherits(settings: Any, slug: str | None, instance: dict[str, str] | None = None) -> bool:
    """Ajan kullanıcı `~/.claude` kurulumunu devralıyor mu? Varsayılan (kayıt yok, bozuk kayıt, örnek bilinmiyor, kayıt
    başka bir örneğe ait, iç ajan) HAYIR."""
    if not slug or not instance or internal(slug):
        return False
    data = load(settings)
    if data.get("corrupt"):
        return False
    return _match(data, str(slug), instance)


def mode(settings: Any, slug: str | None, instance: dict[str, str] | None = None) -> str:
    return "inherited" if inherits(settings, slug, instance) else "isolated"


def _replace(tmp: Path, f: Path) -> None:
    """Windows'ta hedef dosya o an başka bir okuyucuda (koşu başlatan iş parçacığı, virüs tarayıcı, dizinleyici)
    açıksa `os.replace` geçici olarak PermissionError verir. Sınırlı yeniden deneme (üstel bekleme, toplam < 1 sn);
    yine olmazsa hata yükselir ve uç 409 döner."""
    delay = 0.01
    for attempt in range(REPLACE_TRIES):
        try:
            os.replace(tmp, f)
            return
        except PermissionError:
            if attempt == REPLACE_TRIES - 1:
                raise
            time.sleep(delay)
            delay = min(delay * 2, 0.25)


def _write(f: Path, data: dict[str, Any], settings: Any = None) -> None:
    """Kaydı atomik yaz; `settings` verilirse (stüdyonun her yazımı) baytların sha256'sı graf veritabanına işlenir
. Özet işlenemezse OSError: dosya yeni, özet eski → kayıt geçersiz → herkes yalıtılmış (güvenli taraf)."""
    f.parent.mkdir(parents=True, exist_ok=True)
    body = (json.dumps(data, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode("utf-8")
    tmp = f.with_name(f".{FILE}.{uuid.uuid4().hex[:6]}.tmp")
    try:
        tmp.write_bytes(body)
        _replace(tmp, f)
    finally:
        try:
            tmp.unlink(missing_ok=True)
        except OSError:
            pass
    if settings is not None:
        try:
            _record_digest(settings, body)
        except Exception as exc:  # noqa: BLE001
            raise OSError("claude_isolation özeti kaydedilemedi") from exc


def _migrated(data: dict[str, Any], resolve: Any) -> dict[str, Any]:
    """Biçim 1 → 2: kısa ad anahtarlı kayıtlar yalnız şimdiki örnekle eşleşirse taşınır; diğerleri düşer."""
    if data.get("format") == FORMAT:
        return {k: v for k, v in (data.get("agents") or {}).items() if isinstance(v, dict)}
    out: dict[str, Any] = {}
    for slug, rec in (data.get("agents") or {}).items():
        inst = resolve(slug) if resolve is not None else None
        if inst and not internal(slug) and _legacy_match(rec, inst):
            out[inst["id"]] = {"inherit": True, "slug": slug, "created_at": inst["created_at"],
                               "set_at": rec.get("set_at"), "migrated_from": 1}
    return out


def set_inherit(settings: Any, slug: str, inherit: bool, instance: dict[str, str] | None = None,
                resolve: Any = None) -> dict[str, Any]:
    """Kullanıcı kararı. `instance`: ajanın {id, created_at}'i (zorunlu); `resolve(slug)` eski kayıtları taşımak için."""
    f = _file(settings)
    if f is None:
        raise IsolationError(409, "Veri dizini bulunamadı")
    if inherit and internal(slug):
        raise IsolationError(403, "Uygulamanın iç ajanları kişisel ~/.claude kurulumunu devralamaz")
    if inherit and not instance:
        raise IsolationError(409, "Ajan örneği belirlenemedi; devralma açılmadı")
    with _LOCK:
        data = load(settings)
        if data.get("corrupt"):
            raise IsolationError(409, "claude_isolation.json okunamadı; elle incele (üzerine yazılmaz)")
        # stüdyo dışında yazılmış kayıt güvenilmez; içindeki hiçbir onay taşınmaz (yalnız bu karar yazılır)
        agents = {} if data.get("void") else _migrated(data, resolve)
        if instance:
            agents.pop(instance["id"], None)
        for k in [k for k, v in agents.items() if isinstance(v, dict) and v.get("slug") == slug]:
            agents.pop(k)   # aynı kısa adın eski örneklerine ait kayıtlar da temizlenir
        if inherit and instance:
            agents[instance["id"]] = {"inherit": True, "slug": slug, "created_at": instance["created_at"],
                                      "set_at": time.time()}
        try:
            _write(f, {"format": FORMAT, "agents": agents}, settings)
        except OSError as exc:
            raise IsolationError(409, "claude_isolation.json yazılamadı; elle incele") from exc
    return view(settings, slug, instance)


def forget(settings: Any, slug: str | None, instance: dict[str, str] | None = None) -> bool:
    """Ajan silindi: ona ait (ve aynı kısa adlı eski biçim) kayıt silinir. Kayıt okunamıyorsa dosyaya dokunulmaz
    ama saklı özet iptal edilir: geçersiz/okunamaz/silinmiş kaydın eski baytları geri konsa da silinen ajanın
    (gizlenen Hermes ajanı dahil) onayı dönmez. Dönüş: geçerli bir kayıttan girdi silindi mi."""
    f = _file(settings)
    if f is None:
        return False
    with _LOCK:
        if not os.path.lexists(f):
            _revoke(settings, ABSENT)       # dosya stüdyo dışında kaldırılmış: eski baytlar geri konursa geçersiz
            return False
        data = load(settings)
        if data.get("corrupt") or data.get("void"):
            _revoke(settings)
            return False
        agents = dict(data.get("agents") or {})
        before = len(agents)
        if instance:
            agents.pop(instance["id"], None)
        if slug:
            agents.pop(slug, None)
            for k in [k for k, v in agents.items() if isinstance(v, dict) and v.get("slug") == slug]:
                agents.pop(k)
        if len(agents) == before:
            return False
        try:
            _write(f, {**data, "agents": agents}, settings)
        except OSError:
            log.warning("claude_isolation.json güncellenemedi (silinen ajan kaydı kaldı; yeni örnek yine yalıtılmış)")
            return False
    return True


# ---------------------------------------------------------------------- yönerge dosyaları
def ancestor_files(workdir: Any) -> list[str]:
    """Çalışma klasörü ve köke kadar üst dizinlerinde env değişkeninin belgesinde adı geçmeyen yönerge dosyaları
    (`CLAUDE.local.md`, `AGENTS.md`, `.claude/AGENTS.md`, `.claude/rules`). Yalnız varlık denetimi; içerik okunmaz.
    bunlar `--settings` ile dışarıda bırakılır; sayı yalnız "canlı doğrulanmadı" notu için kullanılır."""
    if not workdir:
        return []
    try:
        start = Path(os.path.abspath(str(workdir)))
    except (TypeError, ValueError, OSError):
        return []
    found: list[str] = []
    for d in (start, *start.parents):
        for name in UNCOVERED_NAMES:
            p = d / name
            try:
                if p.exists():
                    found.append(str(p))
            except OSError:
                continue
    return found


# ---------------------------------------------------------------------- `--settings` dosyası
def _ancestors(workdir: Any) -> list[Path]:
    """Çalışma klasörü ve köke kadar üst dizinleri; hem verildiği hâliyle (`abspath`) hem tam çözülmüş (`resolved`:
    `realpath` + `GetLongPathNameW`, `forbidden_dir` ile aynı yol) hâliyle. ISO-WORDING: 8.3 kısa adla (`MUSTAF~1`) ya da
    bağlantı noktası üzerinden verilen çalışma klasöründe `claude`'un gördüğü yol hangisi olursa olsun mutlak yol
    dışlamaları ikisini de kapsasın (fazla dışlama zararsızdır). Aynı yolun harf büyüklüğü farklı biçimleri ayrı tutulur
    (`claudeMdExcludes` eşlemesinin harf duyarlılığı belgede yazmıyor)."""
    if not workdir:
        return []
    try:
        raw = Path(os.path.abspath(str(workdir)))
    except (TypeError, ValueError, OSError):
        return []
    try:
        full = resolved(workdir)
    except (TypeError, ValueError, OSError):
        full = raw
    out: dict[str, Path] = {}
    for start in (raw, full):
        for d in (start, *start.parents):
            out.setdefault(str(d), d)
    return list(out.values())


def _join(root: str, rel: str) -> str:
    sep = "/" if "/" in root or "\\" not in root else "\\"
    return root.rstrip("/\\") + sep + rel.replace("/", sep)


def _posix_roots(path: str) -> list[str]:
    """permissions: "On Windows, paths are normalized to POSIX form before matching. `C:\\Users\\alice` becomes
    `/c/Users/alice`". Sürücü harfi belgeye göre küçük; büyük harfli biçim de yazılır (fazla yasak zararsızdır)."""
    s = path.replace("\\", "/")
    if len(s) >= 2 and s[1] == ":" and s[0].isalpha():
        rest = s[2:] or "/"
        return list(dict.fromkeys((f"/{s[0].lower()}{rest}", f"/{s[0].upper()}{rest}")))
    return [s]


def _gitignore_escape(s: str) -> str:
    # permissions: Read/Edit kuralları gitignore sözdizimi; yol içindeki desen karakterleri düz eşlensin
    return re.sub(r"([\[\]*?])", r"\\\1", s)


def deny_rules(settings: Any) -> list[str]:
    """ (permissions): `Edit` kuralları dosya düzenleyen bütün yerleşik araçlara uygulanır ("`Edit` rules apply to
    all built-in tools that edit files"); `Write(path)` kuralına ise hiç bakılmaz ("accepts the rule but never consults
    it"). `//path` dosya sisteminin kökünden mutlak yoldur. Yalıtılmış ajan stüdyonun kaydını, ayar dosyalarını ve eklenti
    kökünü düzenleyemesin. Ayrıca `Skill` ve `Agent` araçları.

    kaydın özetini tutan graf veritabanı ve WAL/SHM/journal dosyaları; istem klasörü ve stüdyonun
    geçici klasördeki kendi klasörleri de yasak. (`Task` yalnız argv'de: bkz. `deny_tools`.)"""
    rules = list(DENY_TOOLS)
    d = data_dir(settings)
    if d is None:
        return rules
    for base in _edit_bases(d):
        rules += [f"Edit({base}/{FILE})", f"Edit({base}/.{FILE}.*)", f"Edit({base}/{SETTINGS_DIR}/**)",
                  f"Edit({base}/{PLUGINS_DIR}/**)", f"Edit({base}/{PROMPTS_DIR}/**)"]
    k = _key(settings)
    db = Path(_DB_PATHS.get(k or "") or Path(os.path.abspath(str(d))) / DEFAULT_DB)
    for base in _edit_bases(db.parent):
        rules += [f"Edit({base}/{_gitignore_escape(db.name)}{suffix})" for suffix in DB_SUFFIXES]
    try:
        tmp = tempfile.gettempdir()
    except OSError:
        tmp = ""
    for base in _edit_bases(tmp) if tmp else []:
        rules += [f"Edit({base}/{TEMP_PLUGINS_DIR}/**)", f"Edit({base}/{TEMP_PROMPTS_DIR}/**)"]
    return list(dict.fromkeys(rules))


def _edit_bases(path: Any) -> list[str]:
    """`Edit(//…)` kökleri: ham ve tam çözülmüş yol, sürücü harfi küçük ve büyük, gitignore karakterleri kaçışlı."""
    roots: list[str] = []
    for cand in (os.path.abspath(str(path)), str(resolved(path))):
        roots += _posix_roots(cand)
    return ["/" + _gitignore_escape(root.rstrip("/")) for root in dict.fromkeys(roots)]


def deny_tools(version: tuple[int, int, int] | None) -> tuple[str, ...]:
    """`--disallowedTools` araç adları. 2.1.63 ve sonrası: `Skill`, `Agent` (Task oradan beri `Agent`'ın takma adı);
    daha eski ya da bilinmeyen sürüm: eski alt ajan aracı adı `Task` da."""
    if version is not None and version >= AGENT_TOOL_SINCE:
        return DENY_TOOLS
    return (*DENY_TOOLS, LEGACY_AGENT_TOOL)


def parse_version(text: Any) -> tuple[int, int, int] | None:
    m = re.match(r"\s*v?(\d+)\.(\d+)\.(\d+)", str(text or ""))
    return (int(m.group(1)), int(m.group(2)), int(m.group(3))) if m else None


def claude_version(settings: Any, exe: Any = None) -> tuple[int, int, int] | None:
    """kurulu `claude`'un sürümü YALNIZ bağlantı yoklamasının önbelleğinden (`claude --version` en küçük
    ortamla, `connections/providers/cli_tools.ClaudeProvider`). Koşu yolunda hiçbir süreç başlatılmaz. Önbellek yoksa ya da
    başka bir çalıştırılabilire aitse: bilinmiyor (None)."""
    if settings is None:
        return None
    try:
        from studio.connections import service as conn_service  # noqa: PLC0415 - döngüsel içe aktarmadan kaçın

        svc = conn_service._INSTANCES.get(settings)  # noqa: SLF001 - var olan servisi oku; yenisini oluşturma
        st = dict(svc.states.get("claude") or {}) if svc is not None else {}
    except Exception:  # noqa: BLE001
        return None
    if not st.get("version"):
        return None
    if exe and st.get("install_path"):
        try:
            same = os.path.normcase(os.path.abspath(str(st["install_path"]))) == \
                os.path.normcase(os.path.abspath(str(exe)))
        except (TypeError, ValueError, OSError):
            same = False
        if not same:
            return None
    return parse_version(st.get("version"))


def isolated_settings(workdir: Any = None, settings: Any = None) -> dict[str, Any]:
    """Yalıtılmış koşunun `--settings` içeriği: yalnız sabit desenler, çalışma klasörünün üst dizin YOLLARI ve stüdyonun
    kendi veri dizini yolu. Hiçbir kullanıcı dosyası okunmaz, hiçbir kullanıcı ayarı kopyalanmaz.

    - `claudeMdExcludes`: her klasördeki (çalışma klasörü ve alt klasörleri dahil; ajan yönergeleri istemde gider)
      CLAUDE.md,.claude/CLAUDE.md, CLAUDE.local.md, AGENTS.md,.claude/AGENTS.md ve `.claude/rules/**`. Belge desenleri
      mutlak yola karşı glob olarak eşler ve mutlak yolu da kabul eder. Windows ayraç davranışı belgede yazmadığından
      üst dizinler ayrıca hem yerel hem `/` ayraçlı mutlak yolla yazılır (fazla dışlama zararsızdır); ISO-WORDING: hem
      verilen hem tam çözülmüş (8.3 → uzun ad, `realpath`) yolla (`_ancestors`).
    - `pluginConfigs`: AGENTS.md eklentisinin **Project instructions** ayarı `managed-only`.
    - `permissions.deny`: `Skill`, `Agent` ve veri dizinindeki yalıtım dosyalarına `Edit(//…)`."""
    excludes = [f"**/{n}" for n in EXCLUDED_FILES] + [f"**/{d}/**" for d in EXCLUDED_DIRS]
    for d in _ancestors(workdir):
        for root in dict.fromkeys((str(d), d.as_posix())):
            excludes += [_join(root, n) for n in EXCLUDED_FILES]
            excludes += [_join(root, f"{n}/**") for n in EXCLUDED_DIRS]
    return {"claudeMdExcludes": list(dict.fromkeys(excludes)),
            "permissions": {"deny": deny_rules(settings)},
            "pluginConfigs": {pid: {"options": {"instructionFiles": INSTRUCTION_FILES}} for pid in AGENTS_MD_PLUGINS}}


def _inline(settings: Any = None, cmd_shim: bool = False) -> str:
    """Yedek (belge: "Path to a settings JSON file or an inline JSON string"): sabit glob'lar ve araç adları; boşluk yok,
    cmd.exe'nin tırnak dışında yorumladığı karakter yok — Windows `.cmd` kabuğunda da tek argüman kalır.

    `settings` verilirse (ayar dosyası yazılamadı ya da 2 MiB'ı aştı) stüdyonun `Edit(//…)` yasakları da taşınır;
    `.cmd` kabuğunda yalnız tarayıcı (`cmd_unsafe_index`) değeri bölünmez bulursa ve satır `INLINE_SHIM_MAX`'ı aşmazsa.
    Bilerek yol taşımayan durumlar (`settings_arg`): veri dizini yok (yasaklanacak dosya yok); veri dizini bir `.claude`
    klasöründe ya da `CLAUDE_CONFIG_DIR` altında ( sözleşmesi: satır içi değer yol taşımaz, ayar dosyası oraya hiç
    yazılmaz); `.cmd` kabuğunda veri dizini yolu cmd.exe karakteri taşıyor (yasak kuralları da o yolu taşırdı; cmd.exe'nin
    tırnak sayımına bırakılmaz). Bu durumlarda kayıt bütünlüğü (özet) arka korumadır."""
    base = isolated_settings(None)
    plain = json.dumps(base, ensure_ascii=True, separators=(",", ":"), sort_keys=True)
    edits = [r for r in deny_rules(settings) if r.startswith("Edit(")] if settings is not None else []
    if not edits:
        return plain
    val = json.dumps({**base, "permissions": {"deny": [*base["permissions"]["deny"], *edits]}}, ensure_ascii=True,
                     separators=(",", ":"), sort_keys=True)
    if cmd_shim and (len(val) > INLINE_SHIM_MAX or has_cmd_meta(val.replace('"', "")) or cmd_unsafe_index([val]) is not None):
        return plain
    return val


# ---------------------------------------------------------------------- yasak klasörler
def _long_name(p: str) -> str:
    """Windows 8.3 kısa adını (`CLAUDE~1`) uzun ada açar (`GetLongPathNameW`; yalnız var olan yol)."""
    if os.name != "nt":
        return p
    try:
        import ctypes
        from ctypes import wintypes

        fn = ctypes.windll.kernel32.GetLongPathNameW  # type: ignore[attr-defined]
        fn.argtypes = [wintypes.LPCWSTR, wintypes.LPWSTR, wintypes.DWORD]
        fn.restype = wintypes.DWORD
        n = fn(p, None, 0)
        if not n:
            return p
        buf = ctypes.create_unicode_buffer(n + 1)
        return buf.value if fn(p, buf, n + 1) else p
    except Exception:  # noqa: BLE001
        return p


def resolved(path: Any) -> Path:
    """Tam çözülmüş yol: `realpath` (bağlantı noktası/sembolik bağ) + var olan en derin üst dizinde uzun ad açılımı."""
    p = os.path.realpath(os.path.abspath(str(path)))
    head, tail = p, []
    while head and not os.path.exists(head):
        parent, name = os.path.split(head)
        if parent == head:
            break
        tail.append(name)
        head = parent
    head = os.path.realpath(_long_name(head))
    return Path(head, *reversed(tail))


def _within(path: str, root: str) -> bool:
    a, b = os.path.normcase(path).rstrip("\\/"), os.path.normcase(root).rstrip("\\/")
    return bool(b) and (a == b or a.startswith(b + os.sep) or a.startswith(b + "/"))


def forbidden_dir(path: Any) -> bool:
    """Stüdyo buraya yazmaz: yolun (ham ya da tam çözülmüş hâli) bir `.claude` klasöründen geçmesi (Windows'un attığı
    sondaki nokta/boşluk ve harf büyüklüğü yok sayılır) ya da `CLAUDE_CONFIG_DIR`'in (ham ya da çözülmüş) içinde olması."""
    try:
        raw = os.path.abspath(str(path))
        res = str(resolved(path))
    except (TypeError, ValueError, OSError):
        return True
    for cand in (raw, res):
        if any(part.rstrip(". ").lower() == ".claude" for part in Path(cand).parts):
            return True
    cfg = os.environ.get("CLAUDE_CONFIG_DIR", "").strip()
    if cfg:
        try:
            roots = {os.path.abspath(cfg), str(resolved(cfg))}
        except (TypeError, ValueError, OSError):
            return True
        if any(_within(c, r) for c in (raw, res) for r in roots):
            return True
    return False


# ---------------------------------------------------------------------- npm `claude.cmd` kabuğu
def is_cmd_shim(exe: Any) -> bool:
    return os.name == "nt" and str(exe or "").lower().endswith((".cmd", ".bat"))


def has_cmd_meta(text: str) -> bool:
    """Karar 5'in karakter listesi (`& | < > ^ % ! "` ve satır sonu/NUL): yalnız stüdyonun kendi ürettiği değerler için
    (ayar dosyası yolu, istem dosyası yolu)."""
    return any(ch in CMD_META for ch in str(text))


def cmd_unsafe_index(argv: list[str]) -> int | None:
    """cmd.exe'nin (`.cmd` kabuğu: `cmd /c` + `%*`) komutu böleceği ya da değiştireceği ilk argümanın sırası; yoksa None.
    `subprocess.list2cmdline` ile kurulan satır taranır: satır sonu/NUL, `%` ve `!` her yerde (genişleme, satır kesme);
    `& | < > ^ ` tırnak dışında (komut ayırıcı, kaçış, `IF … ( …) ELSE ( …)` bloğunu kapatan/açan
    parantez). cmd.exe her `"` ile tırnak durumunu değiştirir (`\\"` dahil)."""
    q = False
    for i, arg in enumerate(argv):
        line = subprocess.list2cmdline([arg])
        for ch in (" " + line if i else line):
            if ch in CMD_ALWAYS:
                return i
            if ch == '"':
                q = not q
            elif not q and ch in CMD_OUTSIDE:
                return i
    return None


# ---------------------------------------------------------------------- koşuya özel geçici yollar
def _entry_name(suffix: str = "") -> str:
    """`<stüdyo pid>-<12 onaltılık>`: açılış süpürmesi sahibi ölmüş girdiyi tanır (canlı başka bir stüdyonunkine dokunmaz)."""
    return f"{os.getpid()}-{uuid.uuid4().hex[:12]}{suffix}"


def _pid_alive(pid: int) -> bool:
    """Süreç yaşıyor mu (emin değilse EVET: girdi korunur, en geç `STALE_S` sonra süpürülür)."""
    if pid <= 0:
        return False
    if pid == os.getpid():
        return True
    if os.name == "nt":
        try:
            import ctypes

            k32 = ctypes.WinDLL("kernel32", use_last_error=True)  # type: ignore[attr-defined]
            k32.OpenProcess.restype = ctypes.c_void_p
            k32.OpenProcess.argtypes = [ctypes.c_uint32, ctypes.c_int, ctypes.c_uint32]
            k32.GetExitCodeProcess.argtypes = [ctypes.c_void_p, ctypes.POINTER(ctypes.c_uint32)]
            k32.CloseHandle.argtypes = [ctypes.c_void_p]
            h = k32.OpenProcess(0x1000, False, pid)  # PROCESS_QUERY_LIMITED_INFORMATION
            if not h:
                return ctypes.get_last_error() != 87  # ERROR_INVALID_PARAMETER = böyle bir süreç yok
            try:
                code = ctypes.c_uint32()
                if not k32.GetExitCodeProcess(h, ctypes.byref(code)):
                    return True
                return code.value == 259  # STILL_ACTIVE
            finally:
                k32.CloseHandle(h)
        except Exception:  # noqa: BLE001
            return True
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except OSError:
        return True
    return True


def _stale(p: Path, now: float, max_age: float = STALE_S) -> bool:
    """Stüdyonun klasöründeki girdi artık mı: adındaki stüdyo süreci yaşamıyor ya da `max_age`'i aştı."""
    try:
        st = os.lstat(p)
    except OSError:
        return False
    m = ENTRY_RE.fullmatch(p.name)
    if m and not _pid_alive(int(m.group(1))):
        return True
    return now - st.st_mtime > max_age


def _remove(p: Path) -> None:
    try:
        st = os.lstat(p)
        if stat.S_ISDIR(st.st_mode) and not stat.S_ISLNK(st.st_mode) and not getattr(st, "st_reparse_tag", 0):
            shutil.rmtree(p, ignore_errors=True)
        elif stat.S_ISREG(st.st_mode) or stat.S_ISLNK(st.st_mode):
            p.unlink(missing_ok=True)
    except OSError:
        pass


def _sweep(parent: Path) -> None:
    """Stüdyonun kendi klasöründe (eklenti kökleri / istem dosyaları) artıkları sil: sahibi ölmüş ya da 1 günü aşmış."""
    try:
        now = time.time()
        for p in parent.iterdir():
            if _stale(p, now):
                _remove(p)
    except OSError:
        pass


def _owned_dir(path: Path) -> Path | None:
    """stüdyoya ait klasör: yoksa sahibine özel (POSIX 0700) oluşturulur; sembolik bağ / bağlantı noktası değil;
    POSIX'te bu kullanıcıya ait (paylaşılan /tmp'de başkasının açtığı klasör kullanılmaz). Windows'ta erişim listesi
    üst klasörden gelir (`%LOCALAPPDATA%` ve kullanıcı `%TEMP%` varsayılan olarak yalnız kullanıcıya açıktır)."""
    try:
        path.mkdir(parents=True, exist_ok=True, mode=0o700)
        st = os.lstat(path)
        if not stat.S_ISDIR(st.st_mode) or stat.S_ISLNK(st.st_mode) or getattr(st, "st_reparse_tag", 0):
            return None
        if os.name != "nt":
            if st.st_uid != os.getuid():  # type: ignore[attr-defined]
                return None
            if st.st_mode & 0o077:
                os.chmod(path, 0o700)
        return path
    except OSError:
        return None


def _temp_root() -> Path | None:
    try:
        return Path(os.path.abspath(tempfile.gettempdir()))
    except OSError:
        return None


def _studio_parents(settings: Any, data_name: str, temp_name: str) -> list[Path]:
    """Aday üst klasörler: `<veri>/<data_name>` (veri dizini `.claude`/`CLAUDE_CONFIG_DIR` altında değilse), sonra
    `%TEMP%/<temp_name>`. Hiçbir zaman `~/.claude`, hiçbir zaman çıplak `%TEMP%`."""
    out: list[Path] = []
    d = data_dir(settings)
    if d is not None:
        cand = Path(os.path.abspath(str(d))) / data_name
        if not forbidden_dir(cand):
            out.append(cand)
    tmp = _temp_root()
    if tmp is not None:
        out.append(tmp / temp_name)
    return out


def sweep_leftovers(settings: Any) -> None:
    """stüdyo açılışı: çökme ya da iptal artıklarını süpür. Yalnız stüdyonun adlandırdığı yerler:
    `<veri>/claude_isolation_plugins|prompts` ve `%TEMP%/voxcrew-claude-plugins|prompts` içindeki girdiler (sahibi ölmüş
    ya da 1 günü aşmış); sürümünün çıplak `%TEMP%` adları (`voxcrew-claude-plugins-*` klasörü 1 günden,
    `voxcrew-claude-prompt-*.txt` 10 dakikadan eski). Başka hiçbir geçici dosyaya dokunulmaz; hata açılışı düşürmez."""
    now = time.time()
    d = data_dir(settings)
    parents: list[Path] = []
    if d is not None:
        parents += [Path(os.path.abspath(str(d))) / n for n in (PLUGINS_DIR, PROMPTS_DIR)]
    tmp = _temp_root()
    if tmp is not None:
        parents += [tmp / TEMP_PLUGINS_DIR, tmp / TEMP_PROMPTS_DIR]
    for parent in parents:
        try:
            st = os.lstat(parent)
        except OSError:
            continue
        if stat.S_ISDIR(st.st_mode) and not stat.S_ISLNK(st.st_mode) and not getattr(st, "st_reparse_tag", 0):
            _sweep(parent)
    if tmp is None:
        return
    try:
        with os.scandir(tmp) as it:
            for e in it:
                if not e.name.startswith(TEMP_PREFIX):
                    continue
                try:
                    st = e.stat(follow_symlinks=False)
                except OSError:
                    continue
                legacy_root = e.name.startswith(LEGACY_TEMP_PLUGINS) and stat.S_ISDIR(st.st_mode)
                legacy_prompt = (e.name.startswith(LEGACY_TEMP_PROMPT) and e.name.endswith(".txt")
                                 and stat.S_ISREG(st.st_mode))
                if ((legacy_root and now - st.st_mtime > STALE_S)
                        or (legacy_prompt and now - st.st_mtime > LEGACY_PROMPT_GRACE_S)):
                    _remove(Path(e.path))
    except OSError:
        pass


def plugin_root(settings: Any, register: list[str] | None = None) -> str:
    """Koşuya özel, BOŞ eklenti kökü (`CLAUDE_CODE_PLUGIN_CACHE_DIR`). Veri dizini kullanılabiliyorsa
    `<veri>/claude_isolation_plugins/<pid>-<id>`; değilse (yok, `.claude` ya da `CLAUDE_CONFIG_DIR` altında)
    `%TEMP%/voxcrew-claude-plugins/<pid>-<id>`. Hiçbir zaman `~/.claude`. Koşu bitince `release` siler. yol,
    klasör oluşturulmadan ÖNCE `register`'a eklenir (iptal/hata yolunda silinebilsin)."""
    for parent in _studio_parents(settings, PLUGINS_DIR, TEMP_PLUGINS_DIR):
        base = _owned_dir(parent)
        if base is None:
            continue
        _sweep(base)
        path = base / _entry_name()
        if forbidden_dir(path):
            continue
        if register is not None:
            register.append(str(path))
        try:
            path.mkdir(mode=0o700)
        except OSError:
            continue
        return str(path)
    raise IsolationError(409, "Yalıtılmış Claude koşusu için boş eklenti klasörü oluşturulamadı")


def release(path: Any) -> None:
    """Koşu bitti: stüdyonun oluşturduğu eklenti kökünü / istem dosyasını sil. Yalnız stüdyonun adlandırdığı yerler:
    stüdyo klasörlerinin (`STUDIO_DIRS`) doğrudan girdileri ya da sürümünün `%TEMP%`'teki `voxcrew-claude-*` adları."""
    if not path:
        return
    p = Path(str(path))
    try:
        tmp_root = os.path.normcase(os.path.abspath(tempfile.gettempdir()))
        if p.parent.name in STUDIO_DIRS or (p.name.startswith(TEMP_PREFIX)
                                            and os.path.normcase(str(p.parent)) == tmp_root):
            _remove(p)
    except OSError:
        pass


def release_all(paths: list[str]) -> None:
    """koşunun silme listesindeki her yol (iki kez çağrılması zararsız)."""
    for p in list(paths):
        release(p)


def prompt_file(text: str, register: list[str] | None = None, settings: Any = None) -> str:
    """`.cmd` kabuğunda cmd.exe'nin bölebileceği sistem istemi bir dosyaya yazılır ve `--append-system-prompt-file`
    ile verilir (cli-reference: "Load additional system prompt text from a file and append to the default prompt").

    dosya stüdyonun kendi klasöründedir (`<veri>/claude_isolation_prompts`, yoksa `%TEMP%/voxcrew-claude-prompts`;
    çıplak `%TEMP%` değil), POSIX'te 0600 (klasör 0700), `O_EXCL` ile oluşturulur. Yol dosya oluşturulmadan ÖNCE
    `register`'a eklenir. cmd.exe karakteri taşıyan aday yol atlanır; hiçbiri uygun değilse koşu reddedilir."""
    body = text.encode("utf-8")
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_BINARY", 0) | getattr(os, "O_NOFOLLOW", 0)
    for parent in _studio_parents(settings, PROMPTS_DIR, TEMP_PROMPTS_DIR):
        if has_cmd_meta(str(parent)):
            continue
        base = _owned_dir(parent)
        if base is None:
            continue
        _sweep(base)
        path = base / _entry_name(".txt")
        if register is not None:
            register.append(str(path))
        try:
            fd = os.open(path, flags, 0o600)
        except OSError:
            continue
        try:
            with os.fdopen(fd, "wb") as fh:
                fh.write(body)
        except OSError:
            release(path)
            continue
        return str(path)
    raise IsolationError(409, "Sistem istemi dosyası güvenli bir yola yazılamadı (cmd.exe)")


def shim_safe(argv: list[str], register: list[str] | None = None,
              settings: Any = None) -> tuple[list[str], list[str]]:
    """`.cmd` kabuğu için argv: güvensiz `--append-system-prompt` değeri dosyaya taşınır. (argv, silinecek yollar).
    Kalan her argüman `cmd_unsafe_index` ile denetlenir; biri güvensizse IsolationError (koşu reddedilir, cmd.exe'ye
    bölünecek bir satır hiç verilmez; bu çağrının oluşturduğu dosya silinir). `register` verilirse yollar oraya
    (oluşturulmadan önce) eklenir; dönen liste yalnız bu çağrının eklediklerini içerir."""
    out = list(argv)
    reg = register if register is not None else []
    start = len(reg)

    def drop() -> None:
        for c in reg[start:]:
            release(c)
    if "--append-system-prompt" in out:
        i = out.index("--append-system-prompt")
        if i + 1 < len(out) and (has_cmd_meta(out[i + 1]) or cmd_unsafe_index([out[i + 1]]) is not None):
            try:
                path = prompt_file(out[i + 1], register=reg, settings=settings)
            except IsolationError:
                drop()
                raise
            if has_cmd_meta(path):
                drop()
                raise IsolationError(409, "Sistem istemi dosyası güvenli bir yola yazılamadı (cmd.exe)")
            out[i:i + 2] = ["--append-system-prompt-file", path]
    bad = cmd_unsafe_index(out)
    if bad is not None:
        drop()
        raise IsolationError(409, "Claude komut satırı npm claude.cmd kabuğundan (cmd.exe) bozulmadan geçemez; koşu "
                                  "başlatılmadı. Claude Code'u yerel yükleyiciyle (claude.exe) kur ya da ajanın model, "
                                  "araç ve istem ayarlarındaki & | < > ^ % ! ( ) karakterlerini kaldır")
    return out, list(reg[start:])


def settings_arg(settings: Any, workdir: Any = None, cmd_shim: bool = False) -> str:
    """`--settings` değeri: `<veri>/claude_isolation/settings-<özet>.json`. İçerik özetli ad: aynı çalışma klasörü aynı
    dosya; eşzamanlı koşular aynı baytları yazar. Satır içi JSON'a düşülen durumlar: veri dizini yok; tam çözülmüş yolu bir
    `.claude` klasöründen geçiyor ya da `CLAUDE_CONFIG_DIR` içinde; `.cmd` kabuğunda yol cmd.exe karakteri
    taşıyor; dosya yazılamıyor."""
    d = data_dir(settings)
    if d is None:
        return _inline()
    folder = Path(os.path.abspath(str(d))) / SETTINGS_DIR
    if forbidden_dir(folder):            # stüdyo hiçbir koşulda bir .claude klasörüne ya da CLAUDE_CONFIG_DIR'e yazmaz
        return _inline()
    body = (json.dumps(isolated_settings(workdir, settings), ensure_ascii=False, indent=2, sort_keys=True)
            + "\n").encode("utf-8")
    if len(body) > SETTINGS_MAX_BYTES:
        return _inline(settings, cmd_shim)
    f = folder / f"settings-{hashlib.sha256(body).hexdigest()[:16]}.json"
    if cmd_shim and has_cmd_meta(str(f)):
        return _inline()

    def ready() -> bool:
        return f.is_file() and not f.is_symlink() and f.stat().st_size == len(body) and f.read_bytes() == body

    # aynı dosyayı yazan / okuyan iş parçacıkları yol başına kilitle sıraya girer (Windows'ta `os.replace`
    # hedef başka bir tutamakla açıkken PermissionError verir); başka bir süreçle çakışmada kısa geri çekilmeli birkaç
    # deneme. Her denemeden önce ve sonra dosya zaten doğruysa (eşzamanlı yazan aynı baytları yazdı) yolu döner.
    with _path_lock(f):
        for attempt in range(SETTINGS_WRITE_TRIES):
            try:
                if ready():
                    return str(f)
                folder.mkdir(parents=True, exist_ok=True)
                tmp = folder / f".{f.name}.{uuid.uuid4().hex[:6]}.tmp"
                try:
                    tmp.write_bytes(body)
                    os.replace(tmp, f)
                finally:
                    try:
                        tmp.unlink(missing_ok=True)
                    except OSError:
                        pass
                return str(f)
            except OSError:
                try:
                    if ready():          # eşzamanlı koşu aynı dosyayı yazdı (Windows'ta replace kilitlenebilir)
                        return str(f)
                except OSError:
                    pass
                if attempt + 1 < SETTINGS_WRITE_TRIES:
                    time.sleep(SETTINGS_WRITE_BACKOFF_S * (attempt + 1))
    log.warning("Yalıtılmış Claude ayar dosyası yazılamadı; satır içi --settings kullanılıyor")
    return _inline(settings, cmd_shim)


# yol başına süreç içi kilit + PermissionError'da kısa geri çekilmeli yeniden deneme
SETTINGS_WRITE_TRIES = 6
SETTINGS_WRITE_BACKOFF_S = 0.01
_PATH_LOCKS: "weakref.WeakValueDictionary[str, threading.Lock]" = weakref.WeakValueDictionary()
_PATH_LOCKS_GUARD = threading.Lock()


def _path_lock(path: Path) -> threading.Lock:
    """Aynı ayar dosyası için tek kilit (süreç içi; dosya adı içerik özeti olduğundan çakışma yalnız aynı içerikte)."""
    key = os.path.normcase(os.path.abspath(str(path)))
    with _PATH_LOCKS_GUARD:
        lock = _PATH_LOCKS.get(key)
        if lock is None:
            lock = threading.Lock()
            _PATH_LOCKS[key] = lock
        return lock


def apply(settings: Any, slug: str | None, argv: list[str], instance: dict[str, str] | None = None,
          workdir: Any = None, register: list[str] | None = None) -> tuple[list[str], dict[str, str], str]:
    """Bağlayıcı için: (argv, ek ortam, kip). Devralan ajanda argv ve ortam değişmez ve hiçbir dosya yazılmaz.
    Yalıtılmış, `--allowedTools`'tan önce: `--setting-sources project,local --no-session-persistence --settings <dosya>
    --disable-slash-commands` ve `--disallowedTools` listesine `Skill,Agent` (sürüm 2.1.63 öncesi ya da
    bilinmiyorsa `Task` da; varsa mevcut listeye eklenir); ortam: iki CLAUDE_CODE_DISABLE_* + koşuya özel boş
    `CLAUDE_CODE_PLUGIN_CACHE_DIR` (koşu bitince `release`; `register` verilirse yol klasör oluşturulmadan ÖNCE
    oraya eklenir)."""
    if inherits(settings, slug, instance):
        return list(argv), {}, "inherited"
    out = list(argv)
    shim = is_cmd_shim(out[0]) if out else False
    tools = deny_tools(claude_version(settings, out[0] if out else None))
    extra = [*ISOLATION_FLAGS, SETTINGS_FLAG, settings_arg(settings, workdir, cmd_shim=shim), NO_SKILLS_FLAG]
    if "--disallowedTools" in out and out.index("--disallowedTools") + 1 < len(out):
        j = out.index("--disallowedTools") + 1
        have = [t for t in out[j].split(",") if t]
        out[j] = ",".join([*have, *[t for t in tools if t not in have]])
    else:
        extra += ["--disallowedTools", ",".join(tools)]
    insert = out.index("--allowedTools") if "--allowedTools" in out else len(out)
    out[insert:insert] = extra
    return out, {**ISOLATION_ENV, PLUGIN_ENV: plugin_root(settings, register=register)}, "isolated"


def view(settings: Any, slug: str, instance: dict[str, str] | None = None, workdir: Any = None) -> dict[str, Any]:
    m = mode(settings, slug, instance)
    out: dict[str, Any] = {
        "agent": slug, "mode": m, "inherit_user_claude_config": m == "inherited", "default": "isolated",
        "internal": internal(slug),
        # kayıt geçersiz (stüdyonun son yazımı değil; ör. eski bir veritabanı yedeği) ya da okunamaz → herkes
        # yalıtılmış; kart bunu açıkça söyler (yalnız günlükte kalmaz)
        "record": (rs := record_state(settings)), "record_ignored": rs in ("void", "corrupt"),
        "isolation": {"flags": [*ISOLATION_FLAGS, SETTINGS_FLAG], "env": sorted(ISOLATION_ENV),
                      "args": [NO_SKILLS_FLAG], "deny_tools": list(DENY_TOOLS), "plugin_root_env": PLUGIN_ENV,
                      # sürüm 2.1.63 öncesi ya da bilinmiyorsa argv'ye eklenen eski alt ajan aracı adı
                      "deny_tools_legacy": [LEGACY_AGENT_TOOL], "agent_tool_since": ".".join(map(str, AGENT_TOOL_SINCE)),
                      "settings": {"claudeMdExcludes": isolated_settings(None)["claudeMdExcludes"],
                                   "instructionFiles": INSTRUCTION_FILES, "plugins": list(AGENTS_MD_PLUGINS),
                                   "edit_deny": [r for r in deny_rules(settings) if r.startswith("Edit(")]}},
        # kart ile aynı, kesin liste. `covers`: stüdyonun kapattıkları (belgeye dayalı; hangilerinin gerçek
        # claude ile doğrulandığı `live_check`'te)
        "covers": ["~/.claude/settings.json (user source)", "~/.claude/CLAUDE.md", "~/.claude/rules",
                   "skills (all, incl. ~/.claude/skills)", "commands (all, incl. ~/.claude/commands)",
                   "subagents (Agent tool removed)", "installed plugins (empty plugins root)", "auto memory",
                   "CLAUDE.md (every folder)", "CLAUDE.local.md (every folder)", ".claude/rules (every folder)",
                   "AGENTS.md (every folder)"],
        "not_covered": ["managed settings", "managed CLAUDE.md", "~/.claude.json (global config, incl. MCP servers)",
                        "claude.ai connectors",
                        "workdir project settings (.claude/settings.json, .claude/settings.local.json, .mcp.json)",
                        # ISO-WORDING (canlı, §7.3): tanımlar listelenir ama alt ajan aracı reddedildiği için kullanılamaz
                        "subagent definitions in parent folders (.claude/agents) still listed in init.agents; "
                        "unusable (Agent tool denied)",
                        # ISO-WORDING (canlı, §7.2/§7.6): CLI'nin kendi bakım yazımları; stüdyo engelleyemez
                        "claude CLI housekeeping in ~/.claude even when isolated (~/.claude.json caches and account "
                        "fields, backups, credentials refresh, policy/remote caches, ~/.claude/plugins rotation into "
                        ".trash, large tool outputs such as WebFetch PDFs under "
                        "~/.claude/projects/<workdir>/<session>/tool-results/, which the agent may read again later "
                        "with Read in the same workdir); no transcript or memory is written"],
        # bu adlar belgeye göre `--settings` ile dışarıda bırakılır; kalan doğrulanmamış nokta canlı deneme
        # ve `--settings` + `--setting-sources` birlikteliğidir (belgede açıkça yazmıyor; ÇIKARIM)
        "unverified": list(UNCOVERED_NAMES), "unverified_reason": "excluded_not_live_tested",
        # canlı doğrulamadan önce yalnız belgeye dayanan maddeler (geriye dönük uyumluluk için aynen duruyor);
        # ISO-WORDING: bugünkü durum `live_check`'te (araştırma notu §7). `live_verified` = hepsi doğrulandı mı (hayır).
        "docs_only": ["--settings read together with --setting-sources", "empty plugins root stops installed plugins",
                      "~/.claude/skills plugin folders (@skills-dir) with user source off",
                      "--disable-slash-commands / Skill,Agent deny", "managed-only AGENTS.md setting (v2.1.277+)",
                      "Edit deny rules on studio isolation files"],
        "live_verified": False,
        "live_check": {"version": LIVE_CHECKED_VERSION, "verified": list(LIVE_VERIFIED),
                       "not_verified": list(LIVE_NOT_VERIFIED)},
        "docs": DOCS}
    if workdir is not None:
        out["ancestor_files"] = len(ancestor_files(workdir))
    return out


# ---------------------------------------------------------------------- REST
def build_router(studio: Any) -> Any:
    import asyncio

    from fastapi import APIRouter, Body, HTTPException

    r = APIRouter(prefix="/api/claude-isolation", tags=["claude"])

    def _node(slug: str) -> dict[str, Any]:
        n = studio.agents.node(slug)
        if n is None:
            raise HTTPException(404, "Ajan yok")
        return n

    def _resolve(slug: str) -> dict[str, str] | None:
        return instance_of(studio.agents.node(slug))

    def _workdir() -> Any:
        try:
            return studio.settings.workdir
        except Exception:  # noqa: BLE001
            return None

    @r.get("/{slug}")
    async def get_one(slug: str) -> dict[str, Any]:
        n = _node(slug)
        return await asyncio.to_thread(view, studio.settings, slug, instance_of(n), _workdir())

    @r.post("/{slug}")
    async def set_one(slug: str, body: dict[str, Any] = Body(default_factory=dict)) -> dict[str, Any]:
        """Kullanıcı-yalnız (USER_ONLY_RE). `inherit: true` yalnız `confirm: "inherit"` ile (arayüz onay penceresi)."""
        n = _node(slug)
        inherit = body.get("inherit_user_claude_config", body.get("inherit"))
        if not isinstance(inherit, bool):
            raise HTTPException(400, "inherit_user_claude_config true ya da false olmalı")
        if inherit and body.get("confirm") != CONFIRM:
            raise HTTPException(400, "Kullanıcı ~/.claude kurulumunu devralmak açık onay ister (confirm: \"inherit\")")
        props = n.get("props") or {}
        if inherit and (internal(slug) or props.get("eval_matrix") or props.get("eval_temp")):
            raise HTTPException(403, "Uygulamanın iç ajanları kişisel ~/.claude kurulumunu devralamaz")
        try:
            res = await asyncio.to_thread(set_inherit, studio.settings, slug, inherit, instance_of(n), _resolve)
        except IsolationError as exc:
            raise HTTPException(exc.status, exc.message) from exc
        try:
            studio.bus.publish("agent.claude_isolation", agent=slug, mode=res["mode"])
        except Exception:  # noqa: BLE001 - olay yayınlanamazsa ayar yine kaydedildi
            pass
        return res

    return r
