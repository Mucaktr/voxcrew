"""GPT Codex ajanlarının kullanıcı Codex kurulumundan yalıtımı (PROC-FIX Claude ile aynı ilke).

Süreç testi A : Codex adımı her denemede kullanıcının kişisel skill
dosyalarını okudu, 7–11 web araması yaptı ve `~/.codex/memories` koşu sırasında yeniden yazıldı. Bu modül Codex
ajanlarını varsayılan olarak yalıtır; ajan başına, yalnız kullanıcının açabileceği bir onayla kişisel kurulum devralınır.

Mekanizma resmî Codex belgesinden doğrulandı (alıntı ve adresler orada):

- `--ignore-user-config`: `$CODEX_HOME/config.toml` yüklenmez; belge: "Authentication still uses `CODEX_HOME`." (giriş
  korunur; `CODEX_HOME` TAŞINMAZ — taşımak ChatGPT oturumunun yenileme jetonunu kopyada döndürüp asıl girişi bozabilir).
  config.toml'daki MCP sunucuları, profiller, hook ayarları ve model varsayılanı böylece yüklenmez.
- `--ephemeral`: oturum (rollout) dosyaları diske yazılmaz. `-c history.persistence="none"`: history.jsonl'e yazılmaz.
- Bellek: `--disable memories` (= `-c features.memories=false`), `-c memories.use_memories=false` (okuma yok),
  `-c memories.generate_memories=false` (yeni bellek girdisi yok).
- Web araması: `-c web_search="disabled"` ("to remove the tool"). Adım (`web_search: true`) ya da ajan (kullanıcı-yalnız
  kart ayarı) açıkça izin verirse `-c web_search="live"`.
- Skill'ler: belgede genel bir kapatma anahtarı YOK; yalnız skill başına `[[skills.config]] path=… enabled=false`. Stüdyo
  kullanıcı skill köklerindeki (`~/.agents/skills`, `$CODEX_HOME/skills`) ve çalışma klasöründen köke kadar
  `.agents/skills` altındaki her `SKILL.md`'yi (yalnız ad listesi, içerik okunmaz) `-c skills.config=[…]` ile kapatır.
- Proje AGENTS.md: `-c project_doc_max_bytes=0`. Belge 0'ın anlamını yazmıyor; açık kaynak koddaki davranış (0 → proje
  yönergesi yok) araştırma notunda, kartta "kaynak koddan, belgede yok" diye açıkça yazılır.
- Özellikler: `--disable hooks`, `--disable plugins`, `--disable apps` (eklentiler ve bağlayıcılar onların MCP
  sunucuları ve skill'leriyle birlikte). Özellik adları bu Codex sürümünün `codex features list` çıktısından doğrulandı.

Kapatılamayanlar (kartta TR/EN açıkça): `~/.codex/AGENTS.md` (ya da `AGENTS.override.md`) — belgeye göre CODEX_HOME'dan
okunur, kapatma anahtarı yok; stüdyo yalnız istemde "kişisel skill/talimat dosyalarını okuma" der (yumuşak önlem).
Kuruluşun yönetilen `requirements.toml`'u. Codex CLI'nin kendi bakım yazımları (`$CODEX_HOME/tmp`, sqlite durum/günlük
veritabanları, önbellekler, oturum jetonunun yenilenmesi).

Ajan başına açma (`inherit_user_codex_config`) graf veritabanında, ajanın DEĞİŞMEZ örneğine (düğüm kimliği + oluşturma
damgası) bağlı tutulur (veri klasöründe ajanın yazabileceği bir dosya yok). Yalnız kullanıcı değiştirebilir
(`/api/codex-isolation/…` USER_ONLY_RE — MCP 403); açmak `confirm: "inherit"` ister; iç ajanlar açamaz. Kayıt okunamazsa
herkes yalıtılmıştır. Bu modül `~/.codex` ve `~/.agents` altına HİÇBİR koşulda yazmaz (yalnız ad listesi okur).
"""

from __future__ import annotations

import logging
import os
import re
import shutil
import subprocess
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping

from studio.connectors.claude_isolation import INTERNAL_SLUGS, cmd_unsafe_index, instance_of, is_cmd_shim

log = logging.getLogger("studio.connectors.codex_isolation")

TABLE = "codex_isolation"
CONFIRM = "inherit"
CONFIRM_PARTIAL = "partial"  # "eksik yalıtımla çalıştır" (ajan başına, yalnız kullanıcı)
DOCS = ""
SKILL_FILE = "SKILL.md"
MAX_SKILL_DEPTH = 3         # <kök>/<skill>/SKILL.md (+ bir alt düzey grup klasörü)
# sınır SAYI değil gerçek komut satırı UZUNLUĞU. Tarama tam sayım için yüksek bir üst sınırla
# yürür (yalnız ad listesi); sayım bu sınırı aşarsa "en az" diye bildirilir ve yalıtım tamamlanmış sayılmaz.
SCAN_MAX = 5000
DIRECT_LINE_MAX = 32767     # CreateProcess komut satırı sınırı (Windows)
CMD_LINE_MAX = 8191         # cmd.exe satır sınırı (npm `.cmd` kabuğu)
# node codex.js yerel ikiliyi kendi yoluyla (~200 karakter) aynı argümanlarla yeniden başlatır: pay bırakılır
DIRECT_BUDGET = 30_000
# kabuk satırı `"%_prog%" "%dp0%\node_modules\@openai\codex\bin\codex.js" %*` açılımı ve `cmd /c` öneki için pay
CMD_BUDGET = 7_000

FLAGS = ("--ignore-user-config", "--ephemeral", "--disable", "memories", "--disable", "hooks",
         "--disable", "plugins", "--disable", "apps")
CONFIG = ('memories.use_memories=false', 'memories.generate_memories=false', 'history.persistence="none"',
          'project_doc_max_bytes=0')
WEB_OFF = 'web_search="disabled"'
WEB_ON = 'web_search="live"'
PROMPT_NOTE = {
    "tr": "Uygulama yalıtımı: bu görev yalıtılmış çalışır. Kişisel skill, bellek ya da talimat dosyalarını (ör. ~/.agents, "
          "~/.codex altındakiler) okuma ya da yükleme; yalnız bu görevle ve çalışma klasörüyle çalış.",
    "en": "Studio isolation: this task runs isolated. Don't read or load personal skill, memory or instruction files "
          "(e.g. under ~/.agents or ~/.codex); work only from this task and the working folder.",
}
# Belge (learn.chatgpt.com, 2026-10-22) ve yerel CLI (`codex --help`, `codex features list`) kaynakları; kart bunları gösterir
VERIFIED_DOCS = ("--ignore-user-config (auth still uses CODEX_HOME)", "--ephemeral", "history.persistence=\"none\"",
                 "features.memories / memories.use_memories / memories.generate_memories",
                 "web_search=\"disabled\" | \"live\"", "skills.config per-skill enabled=false",
                 "-c overrides take precedence for the invocation")
VERIFIED_CLI = ("--disable <feature> (codex exec --help)", "features hooks, plugins, apps, memories (codex features list)")
SOURCE_ONLY = ("project_doc_max_bytes=0 → no project AGENTS.md (open-source code; the docs don't say what 0 does)",)
NOT_COVERED = ("~/.codex/AGENTS.md or AGENTS.override.md (global instructions; no documented off switch)",
               "managed requirements.toml of your organization",
               "Codex CLI housekeeping under ~/.codex: tmp folders, sqlite state/log databases, sandbox log, model "
               "cache, sign-in token refresh")
# Gerçek Codex ile iki küçük çağrı (2026-10-22, araştırma notu §5): yalıtılmış argv ile giriş çalıştı, skill listesi boş
# ("NONE"); skills.config olmadan aynı çağrı 31 kullanıcı/sistem skill'i listeledi. İki çağrıda da sessions/, memories/
# ve history.jsonl yazılmadı; yalnız CLI bakım dosyaları değişti.
LIVE_CHECKED_VERSION = "codex-cli 0.163.0-alpha.11.1"
LIVE_VERIFIED = ("sign-in works with --ignore-user-config (auth from CODEX_HOME)",
                 "skills.config overrides hide every listed user and system skill",
                 "no session rollout, memories or history.jsonl written (--ephemeral, memories off, history none)")
LIVE_NOT_VERIFIED = ("~/.codex/AGENTS.md is still loaded (no switch; not tested)",
                     "project_doc_max_bytes=0 (source code only; not tested)",
                     "hooks/plugins/apps off (feature names from codex features list; not exercised)")

_LOCK = threading.RLock()
_STORES: dict[str, Any] = {}


# ---------------------------------------------------------------------- kayıt (graf veritabanı)
def _key(settings: Any) -> str:
    try:
        path = getattr(settings, "path", None)
        return os.path.normcase(os.path.abspath(str(Path(path).parent))) if path else f"mem:{id(settings)}"
    except (TypeError, ValueError, OSError):
        return f"mem:{id(settings)}"


def bind(settings: Any, store: Any) -> None:
    """Stüdyo açılışı: kayıt tablosunu hazırla ve bu veri klasörü için graf veritabanını bağla."""
    if store is None:
        return
    try:
        with store._write() as c:  # noqa: SLF001 - stüdyoya ait küçük tablo (claude_isolation ile aynı yaklaşım)
            c.execute(f"CREATE TABLE IF NOT EXISTS {TABLE} (node_id TEXT PRIMARY KEY, created_at TEXT NOT NULL, "
                      "slug TEXT NOT NULL, inherit INTEGER NOT NULL DEFAULT 0, web INTEGER NOT NULL DEFAULT 0, "
                      "updated REAL NOT NULL)")
            cols = {str(r[1]) for r in c.execute(f"PRAGMA table_info({TABLE})").fetchall()}
            if "partial" not in cols:  # eski veritabanına "eksik yalıtımla çalıştır" sütunu
                c.execute(f"ALTER TABLE {TABLE} ADD COLUMN partial INTEGER NOT NULL DEFAULT 0")
            store._commit()  # noqa: SLF001
    except Exception:  # noqa: BLE001 - tablo kurulamazsa herkes yalıtılmış, web kapalı
        log.warning("codex_isolation tablosu hazırlanamadı; Codex ajanları yalıtılmış çalışır")
        return
    _STORES[_key(settings)] = store


def _row(settings: Any, instance: dict[str, str] | None) -> dict[str, Any] | None:
    store = _STORES.get(_key(settings))
    if store is None or not instance:
        return None
    try:
        with store._read() as c:  # noqa: SLF001
            row = c.execute(f"SELECT created_at, slug, inherit, web, partial FROM {TABLE} WHERE node_id=?",
                            (instance["id"],)).fetchone()
    except Exception:  # noqa: BLE001 - okunamazsa yalıtılmış
        return None
    if not row or str(row[0]) != instance.get("created_at"):
        return None  # silinip aynı adla yeniden oluşturulan ajan yeni örnektir
    return {"slug": str(row[1]), "inherit": bool(row[2]), "web": bool(row[3]), "partial": bool(row[4])}


def internal(slug: Any) -> bool:
    return str(slug or "").strip().lower() in INTERNAL_SLUGS


def settings_of(settings: Any, slug: str | None, instance: dict[str, str] | None) -> dict[str, bool]:
    """{inherit, web, partial}: varsayılan (kayıt yok/okunamaz/başka örnek/iç ajan) yalıtılmış, web kapalı ve skill
    listesi komut satırına sığmazsa koşu reddedilir (`partial` = kullanıcının "eksik yalıtımla çalıştır" izni)."""
    off = {"inherit": False, "web": False, "partial": False}
    if not slug or internal(slug):
        return off
    row = _row(settings, instance)
    if not row or row["slug"] != slug:
        return off
    return {"inherit": row["inherit"], "web": row["web"], "partial": row["partial"]}


def mode(settings: Any, slug: str | None, instance: dict[str, str] | None = None) -> str:
    return "inherited" if settings_of(settings, slug, instance)["inherit"] else "isolated"


def save(settings: Any, slug: str, instance: dict[str, str] | None, *, inherit: bool | None = None,
         web: bool | None = None, partial: bool | None = None) -> dict[str, bool]:
    store = _STORES.get(_key(settings))
    if store is None or not instance:
        raise OSError("codex_isolation tablosu bağlı değil")
    cur = settings_of(settings, slug, instance)
    new = {"inherit": cur["inherit"] if inherit is None else bool(inherit), "web": cur["web"] if web is None else bool(web),
           "partial": cur["partial"] if partial is None else bool(partial)}
    with _LOCK, store._write() as c:  # noqa: SLF001
        c.execute(f"INSERT INTO {TABLE} (node_id, created_at, slug, inherit, web, partial, updated) "
                  "VALUES (?, ?, ?, ?, ?, ?, ?) "
                  "ON CONFLICT(node_id) DO UPDATE SET created_at=excluded.created_at, slug=excluded.slug, "
                  "inherit=excluded.inherit, web=excluded.web, partial=excluded.partial, updated=excluded.updated",
                  (instance["id"], instance["created_at"], slug, int(new["inherit"]), int(new["web"]),
                   int(new["partial"]), time.time()))
        store._commit()  # noqa: SLF001
    return new


def forget(settings: Any, instance: dict[str, str] | None) -> None:
    """Ajan silindi: kaydı silinir (yeniden oluşturulan aynı adlı ajan yalıtılmış başlar)."""
    store = _STORES.get(_key(settings))
    if store is None or not instance:
        return
    try:
        with store._write() as c:  # noqa: SLF001
            c.execute(f"DELETE FROM {TABLE} WHERE node_id=?", (instance["id"],))
            store._commit()  # noqa: SLF001
    except Exception:  # noqa: BLE001
        log.warning("codex_isolation kaydı silinemedi")


# ---------------------------------------------------------------------- skill kökleri (yalnız ad listesi)
ADMIN_SKILLS = Path("/etc/codex/skills")  # belgedeki yönetici kökü (POSIX)


def skill_roots(workdir: Any, env: Mapping[str, str] | None = None, home: Path | None = None) -> list[Path]:
    """Belgedeki kullanıcı ve depo skill kökleri: `$HOME/.agents/skills`, `$CODEX_HOME/skills` (ortam değişkenleri
    sayfası CODEX_HOME'da "skills" tutulduğunu yazar), çalışma klasöründen köke kadar her `.agents/skills`; POSIX'te
    yönetici kökü `/etc/codex/skills`."""
    env = os.environ if env is None else env
    home = home or Path.home()
    codex_home = Path(env.get("CODEX_HOME") or (home / ".codex"))
    roots = [home / ".agents" / "skills", codex_home / "skills"]
    try:
        cur = Path(str(workdir)).resolve() if workdir else None
    except (OSError, ValueError):
        cur = None
    seen = 0
    while cur is not None and seen < 40:
        roots.append(cur / ".agents" / "skills")
        if cur.parent == cur:
            break
        cur, seen = cur.parent, seen + 1
    if os.name != "nt":
        roots.append(ADMIN_SKILLS)
    out: list[Path] = []
    for r in roots:
        if r not in out:
            out.append(r)
    return out


def scan_skills(workdir: Any, env: Mapping[str, str] | None = None,
                home: Path | None = None) -> tuple[list[Path], bool]:
    """(`SKILL.md` yolları, sayım tam mı). İçerik OKUNMAZ, hiçbir şey yazılmaz, sembolik bağlar izlenmez; adlar hiçbir
    yere günlüklenmez ( 6). `SCAN_MAX`'tan fazlası varsa liste kesilir ve sayım "en az" olur."""
    found: list[Path] = []
    for root in skill_roots(workdir, env, home):
        try:
            if not root.is_dir():
                continue
        except OSError:
            continue
        for dirpath, dirnames, filenames in os.walk(root, followlinks=False):
            depth = len(Path(dirpath).relative_to(root).parts)
            if depth >= MAX_SKILL_DEPTH:
                dirnames[:] = []
            dirnames[:] = sorted(d for d in dirnames if d not in (".git", "node_modules", "__pycache__"))
            if SKILL_FILE in filenames:
                if len(found) >= SCAN_MAX:
                    return found, False
                found.append(Path(dirpath) / SKILL_FILE)
    return found, True


def skill_files(workdir: Any, env: Mapping[str, str] | None = None, home: Path | None = None) -> list[Path]:
    return scan_skills(workdir, env, home)[0]


_TOML_ESC = {"\b": "\\b", "\t": "\\t", "\n": "\\n", "\f": "\\f", "\r": "\\r", '"': '\\"', "\\": "\\\\"}


def _toml_path(p: Path) -> str:
    """TOML değişmez dizesi ('…'): Windows ters eğik çizgileri kaçış gerektirmez. Tek tırnak ya da denetim karakteri
    taşıyan yol → tam kaçışlı temel dize (satır sonu ham kalırsa değer TOML olmaktan çıkar, Codex onu düz dize
    sayardı)."""
    s = str(p)
    if "'" not in s and not any(ord(ch) < 0x20 or ord(ch) == 0x7F for ch in s):
        return f"'{s}'"
    out = []
    for ch in s:
        if ch in _TOML_ESC:
            out.append(_TOML_ESC[ch])
        elif ord(ch) < 0x20 or ord(ch) == 0x7F:
            out.append(f"\\u{ord(ch):04X}")
        else:
            out.append(ch)
    return '"' + "".join(out) + '"'


def skills_override(paths: list[Path]) -> str | None:
    items = [f"{{path={_toml_path(p)},enabled=false}}" for p in paths]
    return f"skills.config=[{','.join(items)}]" if items else None


def _line_len(argv: list[str]) -> int:
    return len(subprocess.list2cmdline([str(a) for a in argv]))


# ---------------------------------------------------------------------- tek argv kurucusu (koşu = kart)
REASONING_EFFORTS = ("minimal", "low", "medium", "high", "xhigh")


def sandbox_for(permissions: Any) -> str:
    """Ajan izni → Codex sandbox'ı: yalnız "write" çalışma klasörüne yazabilir; diğer her şey salt okunur."""
    return "workspace-write" if permissions == "write" else "read-only"


def exec_argv(prefix: list[str], *, sandbox: str, workdir: Any, model: str | None = None,
              reasoning_effort: Any = None) -> list[str]:
    """`codex exec` öneki + alt komut ve bayraklar (yalıtım argv'si ve `-` isteminden önceki kısım). bağlayıcı
    (koşu) ve kart (`skills_state`) bu tek kurucuyu kullanır; ikisinin satırı aynı karakterde bütçeyi aşar."""
    argv = [*prefix, "exec", "--json", "--skip-git-repo-check", "-s", sandbox, "-C", str(workdir)]
    if model:
        argv += ["-m", str(model)]
    if reasoning_effort in REASONING_EFFORTS:
        argv += ["-c", f'model_reasoning_effort="{reasoning_effort}"']
    return argv


def isolation_argv(web: bool) -> list[str]:
    """Yalıtılmış koşunun sabit bayrakları + web kararı (skill listesi hariç)."""
    argv: list[str] = list(FLAGS)
    for c in CONFIG:
        argv += ["-c", c]
    return argv + ["-c", WEB_ON if web else WEB_OFF]


def final_argv(base: list[str], iso_argv: list[str], skills: list[Path]) -> list[str]:
    """Koşunun başlatacağı satırın TAMAMI: `base` + yalıtım + (varsa) `-c skills.config=[…]` + `-` (istem stdin'den)."""
    sk = skills_override(skills)
    return [*base, *iso_argv, *(["-c", sk] if sk else []), "-"]


def agent_run_params(props: Mapping[str, Any] | None) -> dict[str, Any]:
    """Ajanın kendi (adım geçersiz kılması olmayan) Codex koşusunun sandbox'ı ve modeli: motorun
    `Invocation.permissions` (= `props.permissions`, varsayılan "read") ve `AgentRegistry._resolve_route` codex dalı
    (bağlantı ajanınki ise `props.model or None`; başka bağlantının ajanında adım `connection: codex` → model yok)."""
    p: Mapping[str, Any] = props or {}
    p = p.get("props", p) or {}
    model = (p.get("model") or None) if p.get("connection") == "codex" else None
    return {"sandbox": sandbox_for(p.get("permissions", "read")), "model": model}


def fit_skills(base: list[str], skills: list[Path], budget: int) -> int:
    """Komut satırı (`base` + `-c skills.config=[…]`) `budget`'a sığacak en büyük skill sayısı (ikili arama; uzunluk
    sayıyla tekdüze artar). Ölçü gerçek satırdır: `subprocess.list2cmdline` (CreateProcess ile aynı tırnaklama)."""
    def ok(k: int) -> bool:
        sk = skills_override(skills[:k])
        return _line_len(base + (["-c", sk] if sk else [])) <= budget
    if ok(len(skills)):
        return len(skills)
    lo, hi = 0, len(skills)
    while lo < hi:
        mid = (lo + hi + 1) // 2
        if ok(mid):
            lo = mid
        else:
            hi = mid - 1
    return lo


def fit_count(base: list[str], iso_argv: list[str], skills: list[Path], budget: int) -> int:
    """koşunun gerçek satırı (`final_argv`) `budget`'a sığacak en büyük skill sayısı (ikili arama; uzunluk sayıyla
    tekdüze artar). Bağlayıcı (`apply`) ve kart (`skills_state`) bunu aynı `base`/`iso_argv` kurucularıyla çağırır."""
    def ok(k: int) -> bool:
        return _line_len(final_argv(base, iso_argv, skills[:k])) <= budget
    if ok(len(skills)):
        return len(skills)
    lo, hi = 0, len(skills)
    while lo < hi:
        mid = (lo + hi + 1) // 2
        if ok(mid):
            lo = mid
        else:
            hi = mid - 1
    return lo


# ---------------------------------------------------------------------- başlatma (cmd.exe yok)
# npm'in yazdığı `codex.cmd` kabuğu: `… "%_prog%"  "%dp0%\node_modules\@openai\codex\bin\codex.js" %*` (eski sürüm:
# `"%~dp0\node_modules\…\codex.js" %*`); `codex.ps1`: `"$basedir/node_modules/@openai/codex/bin/codex.js" $args`.
SHIM_JS_RE = re.compile(r'"%(?:dp0%|~dp0)\\?([^"%\r\n]+?\.(?:js|cjs|mjs))"', re.I)
PS1_JS_RE = re.compile(r'"\$basedir[/\\]([^"$\r\n]+?\.(?:js|cjs|mjs))"', re.I)
NPM_JS = ("node_modules", "@openai", "codex", "bin", "codex.js")
SHIM_READ_MAX = 64 * 1024


@dataclass
class Launch:
    """Codex nasıl başlatılır: `direct` (gerçek ikili), `node` (npm kabuğunun hedefi `node codex.js`, cmd.exe YOK),
    `cmd` (kabuk çözülemedi: cmd.exe üzerinden; yalnız tarayıcı argv'yi güvenli bulursa)."""
    prefix: list[str]
    mode: str

    @property
    def budget(self) -> int:
        return CMD_BUDGET if self.mode == "cmd" else DIRECT_BUDGET


def _node_exe(shim_dir: Path) -> str | None:
    """Kabuğun kullanacağı node: kabuk klasöründeki `node.exe`, yoksa PATH'teki `node` — yalnız gerçek bir ikiliyse
    (`node.cmd` gibi başka bir kabuk değil; o da cmd.exe'den geçerdi)."""
    local = shim_dir / "node.exe"
    try:
        if local.is_file():
            return str(local)
    except OSError:
        pass
    found = shutil.which("node")
    if found and Path(found).suffix.lower() == ".exe":
        return found
    return None


def _within(path: Path, root: Path) -> bool:
    try:
        path.resolve().relative_to(root.resolve())
        return True
    except (OSError, ValueError):
        return False


def shim_target(shim: Path) -> Path | None:
    """npm kabuğunun çalıştırdığı JS dosyası (kabuk metni npm'in yazdığı biçimde ayrıştırılır, yoksa
    `node_modules/@openai/codex/bin/codex.js`). Yalnız kabuk klasörünün `node_modules`'u altında var olan bir dosya."""
    base = shim.parent
    cands: list[Path] = []
    try:
        with open(shim, "rb") as fh:
            text = fh.read(SHIM_READ_MAX).decode("utf-8", "replace")
    except OSError:
        text = ""
    rx = PS1_JS_RE if shim.suffix.lower() == ".ps1" else SHIM_JS_RE
    for m in rx.finditer(text):
        rel = m.group(1).replace("\\", "/").lstrip("/")
        if ".." not in Path(rel).parts:
            cands.append(base / Path(rel))
    cands.append(base.joinpath(*NPM_JS))
    for c in cands:
        try:
            if c.is_file() and _within(c, base / "node_modules"):
                return c
        except OSError:
            continue
    return None


def launch_for(exe: Any) -> Launch:
    """`find_codex` sonucu → başlatma planı. npm `.cmd`/`.bat`/`.ps1` kabuğu hedefine çözülür (`node codex.js`) ve
    CreateProcess ile doğrudan başlar: argv cmd.exe'den hiç geçmez ( enjeksiyon, 8191 sınırı)."""
    s = str(exe)
    low = s.lower()
    shim = is_cmd_shim(s) or (os.name == "nt" and low.endswith(".ps1"))
    if not shim:
        return Launch([s], "direct")
    js = shim_target(Path(s))
    node = _node_exe(Path(s).parent) if js is not None else None
    if js is not None and node:
        return Launch([node, str(js)], "node")
    return Launch([s], "cmd")


def cmd_refusal(argv: list[str]) -> bool:
    """`cmd` kipinde (kabuk çözülemedi) cmd.exe'nin böleceği/değiştireceği bir argüman var mı (Claude yolunun tırnak
    durumu tarayıcısı: `claude_isolation.cmd_unsafe_index`)."""
    return cmd_unsafe_index(list(argv)) is not None


class IncompleteIsolation(Exception):
    """Kişisel skill listesi komut satırına sığmıyor ve ajanın "eksik yalıtımla çalıştır" izni yok: koşu başlamaz."""

    def __init__(self, meta: dict[str, Any]):
        super().__init__("skills over budget")
        self.meta = meta


def incomplete_message(meta: Mapping[str, Any], lang: str | None) -> str:
    from studio.i18n import translate
    found = int(meta.get("skills_found") or 0)
    found_txt = f"{found}+" if meta.get("skills_found_exact") is False else str(found)
    text = ("Kişisel beceri sayısı çok fazla; yalıtım tamamlanamıyor: bulunan {}, komut satırına sığan {}. Koşu "
            "başlatılmadı. Skill klasörlerini azalt ya da ajan kartında \"eksik yalıtımla çalıştır\" iznini ver")
    return translate(text.format(found_txt, int(meta.get("skills_fit") or 0)), lang)


def cmd_refusal_message(lang: str | None) -> str:
    from studio.i18n import translate
    return translate("Codex komut satırı npm codex.cmd kabuğundan (cmd.exe) bozulmadan geçemez ve kabuğun hedefi "
                     "(node + codex.js) çözülemedi; koşu başlatılmadı. Codex'i masaüstü uygulamasıyla kur ya da node'u "
                     "PATH'e ekle, veya çalışma klasörü, model ve skill adlarındaki & | < > ^ % ! ( ) karakterlerini "
                     "kaldır",
                     lang)


# ---------------------------------------------------------------------- argv
def web_allowed(inv_extra: Mapping[str, Any] | None, agent_web: bool) -> bool:
    """Web araması yalnız açık izinle: adım `web_search: true` (motor `inv.extra["web_search"]`) ya da ajanın kullanıcı
    kartındaki izni. Adım `web_search: false` ajan iznini de kapatır."""
    step = (inv_extra or {}).get("web_search")
    if step is False:
        return False
    return step is True or bool(agent_web)


def apply(settings: Any, slug: str | None, instance: dict[str, str] | None, workdir: Any,
          inv_extra: Mapping[str, Any] | None = None, env: Mapping[str, str] | None = None,
          home: Path | None = None, *, base_argv: list[str] | None = None,
          budget: int | None = None) -> tuple[list[str], dict[str, Any]]:
    """`codex exec` için ek argv (alt komuttan sonra, `-` isteminden önce) ve iz özeti. Devralma açıksa yalnız web
    kararı eklenir (varsayılan kapalı); yalıtılmışta belgeye dayalı bayrakların hepsi.

    skill listesi gerçek komut satırı uzunluğuyla ölçülür (`base_argv` = başlatma öneki + alt komut ve
    bayraklar; `budget` = başlatma kipinin satır payı). Hepsi sığmazsa (ya da sayım tam değilse) `IncompleteIsolation`
    — ajanın kullanıcı-yalnız "eksik yalıtımla çalıştır" izni varsa sığanlar kapatılır ve açık kalan sayısı izde kesin
    yazılır. İz yalnız SAYI taşır, hiçbir skill adı taşımaz."""
    st = settings_of(settings, slug, instance)
    web = web_allowed(inv_extra, st["web"])
    web_arg = ["-c", WEB_ON if web else WEB_OFF]
    if st["inherit"]:
        return web_arg, {"codex_config": "inherited", "web_search": "live" if web else "disabled"}
    argv = isolation_argv(web)
    skills, exact = scan_skills(workdir, env, home)
    base = list(base_argv) if base_argv is not None else ["codex", "exec"]
    k = fit_count(base, argv, skills, int(budget or DIRECT_BUDGET))
    meta: dict[str, Any] = {"codex_config": "isolated", "web_search": "live" if web else "disabled",
                            "skills_found": len(skills), "skills_disabled": k}
    if not exact:
        meta["skills_found_exact"] = False
    if k < len(skills) or not exact:
        meta.update({"skills_fit": k, "skills_enabled": len(skills) - k, "isolation_incomplete": True})
        if not st["partial"]:
            raise IncompleteIsolation({**meta, "skills_disabled": 0, "skills_enabled": len(skills), "refused": True})
        meta["partial_override"] = True
    sk = skills_override(skills[:k])
    if sk:
        argv += ["-c", sk]
    return argv, meta


def skill_paths_in(argv: list[str]) -> list[str]:
    """Argv'deki `skills.config` değerinin yolları (yalnız stderr'den ad gizlemek için; günlüğe yazılmaz)."""
    import tomllib
    for a, b in zip(argv, argv[1:]):
        if a == "-c" and str(b).startswith("skills.config="):
            try:
                items = tomllib.loads("x = " + str(b).split("=", 1)[1])["x"]
            except (tomllib.TOMLDecodeError, KeyError, IndexError):
                return []
            return [str(i.get("path")) for i in items if isinstance(i, dict) and i.get("path")]
    return []


def redact(line: str, paths: list[str]) -> str:
    """ 6: Codex hata satırı kişisel skill adı (yolu) taşırsa adım hatasına/ize ad gitmez."""
    if not paths or not line:
        return line
    out = line
    if "skills.config" in out:
        out = out.split("skills.config", 1)[0] + "skills.config=[…]"
    for p in paths:
        folder = str(Path(p).parent)
        for needle in (p, folder, folder.replace("\\", "/"), Path(folder).name):
            if needle and len(needle) > 2 and needle in out:
                out = out.replace(needle, "<skill>")
    return out


def prompt_note(lang: str | None) -> str:
    return PROMPT_NOTE.get(lang or "tr", PROMPT_NOTE["tr"])


# ---------------------------------------------------------------------- kart
def resolve_exe() -> Any:
    """Bağlayıcının kullandığı Codex yürütülebiliri (aynı nesne: `studio.connectors.codex.find_codex`)."""
    try:
        from studio.connectors import codex as codex_mod
        return codex_mod.find_codex()
    except Exception:  # noqa: BLE001
        return None


def skills_state(workdir: Any, partial: bool, exe: Any = None, *, sandbox: str = "read-only",
                 model: str | None = None, web: bool = False) -> dict[str, Any]:
    """Kart için skill özeti: yalnız SAYILAR (ad yok; MCP de yalnız sayı görür). `launch` gerçek başlatma kipi;
    `state`: complete (hepsi kapalı) | too_many (koşu reddedilir) | partial (izinle, `enabled` kadarı açık kalır).
    satır, koşunun kuracağı argv ile AYNI kurucudan (`exec_argv` + `isolation_argv` + `fit_count`) ve ajanın
    gerçek sandbox/model/web kararıyla ölçülür; kartın sayıları koşununkilere birebir eşittir."""
    skills, exact = scan_skills(workdir)
    if exe is None:
        exe = resolve_exe()
    lc = launch_for(exe) if exe else Launch(["codex"], "direct")
    base = exec_argv(lc.prefix, sandbox=sandbox, workdir=workdir if workdir is not None else "", model=model)
    k = fit_count(base, isolation_argv(web), skills, lc.budget)
    complete = exact and k == len(skills)
    if complete:
        state, disabled = "complete", k
    elif partial:
        state, disabled = "partial", k
    else:
        state, disabled = "too_many", 0
    return {"found": len(skills), "found_exact": exact, "fit": k, "disabled": disabled,
            "enabled": len(skills) - disabled, "state": state, "launch": lc.mode if exe else None,
            "budget": lc.budget, "sandbox": sandbox}


def _agent_props(settings: Any, slug: str, instance: dict[str, str] | None) -> Mapping[str, Any] | None:
    """Bağlı graf veritabanından ajanın özellikleri (kart çağrısı ajanı vermediyse; yalnız aynı örnekse)."""
    store = _STORES.get(_key(settings))
    if store is None:
        return None
    try:
        node = store.find("Agent", slug)
    except Exception:  # noqa: BLE001
        return None
    if not node:
        return None
    if instance and instance_of(node) != instance:
        return None
    return node.get("props") or {}


def view(settings: Any, slug: str, instance: dict[str, str] | None = None, workdir: Any = None,
         agent: Mapping[str, Any] | None = None) -> dict[str, Any]:
    """Kart. `agent` = ajan düğümü ya da özellikleri (verilmezse bağlı veritabanından okunur): skill sayıları ajanın kendi
    koşusunun sandbox'ı, modeli ve web kararıyla ölçülür."""
    st = settings_of(settings, slug, instance)
    out: dict[str, Any] = {
        "agent": slug, "mode": "inherited" if st["inherit"] else "isolated",
        "inherit_user_codex_config": st["inherit"], "web_search": st["web"], "default": "isolated",
        "partial_isolation": st["partial"],
        "internal": internal(slug), "bound": _key(settings) in _STORES,
        "isolation": {"flags": list(FLAGS), "config": list(CONFIG), "web": {"off": WEB_OFF, "on": WEB_ON},
                      "skills": "skills.config=[{path=…,enabled=false}]", "prompt_note": True},
        "verified_docs": list(VERIFIED_DOCS), "verified_cli": list(VERIFIED_CLI), "source_only": list(SOURCE_ONLY),
        "not_covered": list(NOT_COVERED), "docs": DOCS,
        "live_check": {"version": LIVE_CHECKED_VERSION, "verified": list(LIVE_VERIFIED),
                       "not_verified": list(LIVE_NOT_VERIFIED)}}
    if workdir is not None:
        try:
            run = agent_run_params(agent if agent is not None else _agent_props(settings, slug, instance))
            sk = skills_state(workdir, st["partial"], sandbox=run["sandbox"], model=run["model"],
                              web=web_allowed(None, st["web"]))
            out["skills"] = sk
            out["skills_found"] = sk["found"]
        except Exception:  # noqa: BLE001
            out["skills_found"] = None
    return out


# ---------------------------------------------------------------------- REST
def build_router(studio: Any) -> Any:
    import asyncio

    from fastapi import APIRouter, Body, HTTPException

    r = APIRouter(prefix="/api/codex-isolation", tags=["codex"])

    def _node(slug: str) -> dict[str, Any]:
        n = studio.agents.node(slug)
        if n is None:
            raise HTTPException(404, "Ajan yok")
        return n

    def _workdir() -> Any:
        try:
            return studio.settings.workdir
        except Exception:  # noqa: BLE001
            return None

    @r.get("/{slug}")
    async def get_one(slug: str) -> dict[str, Any]:
        n = _node(slug)
        return await asyncio.to_thread(view, studio.settings, slug, instance_of(n), _workdir(), n)

    @r.post("/{slug}")
    async def set_one(slug: str, body: dict[str, Any] = Body(default_factory=dict)) -> dict[str, Any]:
        """Kullanıcı-yalnız (USER_ONLY_RE). `inherit: true` yalnız `confirm: "inherit"` ile; `web_search` ajan izni;
        `partial_isolation: true` ("eksik yalıtımla çalıştır") yalnız `confirm: "partial"` ile."""
        n = _node(slug)
        inherit = body.get("inherit_user_codex_config", body.get("inherit"))
        web = body.get("web_search")
        partial = body.get("partial_isolation")
        if inherit is None and web is None and partial is None:
            raise HTTPException(400, "inherit_user_codex_config, web_search ya da partial_isolation verilmeli")
        if inherit is not None and not isinstance(inherit, bool):
            raise HTTPException(400, "inherit_user_codex_config true ya da false olmalı")
        if web is not None and not isinstance(web, bool):
            raise HTTPException(400, "web_search true ya da false olmalı")
        if partial is not None and not isinstance(partial, bool):
            raise HTTPException(400, "partial_isolation true ya da false olmalı")
        if inherit and body.get("confirm") != CONFIRM:
            raise HTTPException(400, "Kullanıcı Codex kurulumunu devralmak açık onay ister (confirm: \"inherit\")")
        if partial and body.get("confirm") != CONFIRM_PARTIAL:
            raise HTTPException(400, "Eksik yalıtımla çalıştırmak açık onay ister (confirm: \"partial\")")
        props = n.get("props") or {}
        if (inherit or web or partial) and (internal(slug) or props.get("eval_matrix") or props.get("eval_temp")):
            raise HTTPException(403, "Uygulamanın iç ajanları kişisel Codex kurulumunu devralamaz")
        try:
            await asyncio.to_thread(save, studio.settings, slug, instance_of(n), inherit=inherit, web=web,
                                    partial=partial)
        except OSError as exc:
            raise HTTPException(409, f"Kaydedilemedi: {exc}") from exc
        res = await asyncio.to_thread(view, studio.settings, slug, instance_of(n), _workdir(), n)
        try:
            studio.bus.publish("agent.codex_isolation", agent=slug, mode=res["mode"], web_search=res["web_search"],
                               partial_isolation=res["partial_isolation"])
        except Exception:  # noqa: BLE001
            pass
        return res

    return r
