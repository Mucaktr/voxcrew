"""API sunucusu etkinleştirme akışı: önizle (yazmaz) → kullanıcı onayı → yedekli uygulama (Ekip S2).

Kullanıcı kuralı: "Önce profil .env dosyasında yapılacak değişikliği bana göster, onaylayınca uygula."
- preview(): her seçili profil için studio.changes.plan_env ile plan üretir; HİÇBİR dosyaya yazmaz.
  Kök .env (default profil) her zaman dahildir: dinleyiciyi açan oradaki API_SERVER_KEY'dir.
- enable(): yalnızca bu akışın ürettiği plan kimliklerini, confirm=True ile, sırayla uygular; ilk hatada durur.
Anahtar değerleri yalnızca plan nesnesinin bellekteki 'after' metninde ve hedef .env dosyasında bulunur;
yanıtlar maskeli diff (••••son4) içerir, changes.jsonl yalnızca yol/özet/özet-hash tutar.
"""

from __future__ import annotations

import secrets
from typing import Any

from studio.changes import ChangeError, ChangeService, env_get, mask_value, read_exact
from studio.gateway.manager import GatewayManager, _env_truthy, usable_key
from studio.i18n import translate


def new_key() -> str:
    """Kriptografik rastgele, URL güvenli, 43 karakter (Hermes en az 16 ister)."""
    return secrets.token_urlsafe(32)


class EnableFlow:
    def __init__(self, manager: GatewayManager, changes: ChangeService):
        self.manager = manager
        self.changes = changes
        self.issued: dict[str, str] = {}  # plan_id → profil (yalnızca bu akışın planları uygulanabilir)

    # ------------------------------------------------------------------ önizleme (yazmaz)
    def _profile_plan(self, profile: str, root: bool) -> dict[str, Any]:
        text = self.manager.read_env(profile)
        updates: dict[str, str] = {}
        changes: list[dict[str, Any]] = []
        if root:
            if _env_truthy(text, "API_SERVER_ENABLED"):
                changes.append({"key": "API_SERVER_ENABLED", "action": "keep", "value_preview": "true"})
            else:
                updates["API_SERVER_ENABLED"] = "true"
                changes.append({"key": "API_SERVER_ENABLED",
                                "action": "update" if env_get(text, "API_SERVER_ENABLED") is not None else "add",
                                "value_preview": "true"})
        current = env_get(text, "API_SERVER_KEY")
        if usable_key(current):
            changes.append({"key": "API_SERVER_KEY", "action": "keep", "value_preview": mask_value(current or "")})
        else:
            key = new_key()
            updates["API_SERVER_KEY"] = key
            changes.append({"key": "API_SERVER_KEY", "action": "update" if current is not None else "add",
                            "value_preview": mask_value(key)})
        path = self.manager.env_path(profile)
        where = "kök .env (default profil)" if root else f"{profile} profili .env"
        names = ", ".join(updates) or "değişiklik yok"
        summary = f"Hermes API sunucusu — {where}: {names}"
        if updates:
            plan = self.changes.plan_env(path, updates, summary)
        else:
            # değişiklik yok: dosyayı satır sonu çevirisi olmadan aynen öner (no_change=True)
            plan = self.changes.plan_text(path, read_exact(path) or "", summary, kind="env")
        self.issued[plan["id"]] = profile
        return {**plan, "profile": profile, "root": root, "changes": changes,
                "backup_pattern": f"{path.name}.bak-<YYYYmmdd-HHMMSS>" if text is not None else None}

    def warnings(self, selected: list[str]) -> list[str]:
        fx = self.manager.side_effects()
        out = [
            "Gateway yalnızca sen 'Başlat'a bastığında uygulamanın alt süreci olarak çalışır ve uygulama kapanınca durur. "
            "Otomatik başlatma ya da Windows servisi kurulumu yok.",
            "Gateway çalışırken TÜM profillerin cron zamanlayıcısı (60 sn'de bir) da çalışır — "
            + (f"{fx['cron_jobs']} kayıtlı cron işi bulundu." if fx["cron_jobs"] else "şu an kayıtlı cron işi bulunamadı."),
            "Kanban dağıtıcısı ve bildirimleri de gateway içinde çalışır; kanban görevi oluşturulmadıkça boşta bekler.",
        ]
        if fx["adapters"]:
            items = "; ".join(f"{a['adapter']} ({a['profile']} .env: {', '.join(a['keys'])})" for a in fx["adapters"])
            out.append(f"Kimlik bilgisi bulunan mesajlaşma bağdaştırıcıları da başlar: {items}.")
        else:
            out.append("Hiçbir profil .env dosyasında mesajlaşma bağdaştırıcısı kimlik bilgisi yok; yalnızca API sunucusu açılır.")
        if fx["env_adapters"]:
            out.append("Uygulamanın ortam değişkenlerinde şu bağdaştırıcılar için kimlik bilgisi var ve gateway bunları "
                       f"devralır: {', '.join(fx['env_adapters'])}.")
        if fx["hooks"]:
            out.append(f"{fx['hooks']} gateway hook'u (hooks/*/HOOK.yaml) gateway süreci içinde yüklenir.")
        out.append("API üzerinden çalışan görevler profilin api_server araç paketini alır: CLI'dakinden daha fazla araç "
                   "açıktır (ör. vision, image_gen, session_search). Skill ve araç seti seçimi API yolunda uygulanmaz; "
                   "skill ya da araç seti atanmış ajanlar 'otomatik' modda CLI ile çalışmaya devam eder.")
        out.append("İlk başlatmada Hermes, kök config.yaml dosyasına 'gateway.multiplex_profiles: true' yazabilir "
                   "(Hermes'in kendi davranışı; tek gateway tüm profillere hizmet eder).")
        others = [p for p in fx["profiles"] if p != "default" and p not in selected]
        if others:
            out.append(f"Seçilmeyen profiller ({', '.join(others)}) API isteklerini 401 ile reddeder; "
                       "bu profillerin ajanları CLI ile çalışır.")
        out.append("Anahtarlar kriptografik rastgele üretilir (43 karakter) ve her profil için ayrıdır. Değer yalnızca "
                   ".env dosyasına yazılır; arayüzde, loglarda ve uygulama verisinde yalnızca maskeli (••••son4) görünür.")
        out.append("Her dosyanın yanına <ad>.bak-<zaman> yedeği alınır; değişiklik geçmişinden geri alınabilir.")
        # başarılı (200) yanıt ara katmanda çevrilmez: isteğin diline burada çevrilir (AUDIT C-04 / QA O-26)
        return [translate(x) for x in out]

    def preview(self, profiles: list[str]) -> dict[str, Any]:
        available = [p for p, _d in self.manager.profiles()]
        wanted = [p.strip() for p in profiles if p and p.strip()]
        unknown = [p for p in wanted if p not in available]
        if unknown:
            raise KeyError(f"Profil yok: {', '.join(unknown)}")
        selected = [p for p in available if p in wanted and p != "default"]
        plans = [self._profile_plan("default", root=True)] + [self._profile_plan(p, root=False) for p in selected]
        return {"plans": plans, "warnings": self.warnings(selected), "profiles": ["default", *selected],
                "port": self.manager.port()}

    # ------------------------------------------------------------------ uygulama (yalnızca onayla)
    def enable(self, plan_ids: list[str], confirm: bool) -> dict[str, Any]:
        if confirm is not True:
            raise ChangeError("Uygulamak için açık onay (confirm: true) gerekli")
        ids = [str(p) for p in plan_ids or []]
        if not ids:
            raise ChangeError("Uygulanacak plan yok")
        foreign = [p for p in ids if p not in self.issued]
        if foreign:
            raise ChangeError("Bu planlar gateway önizlemesinden gelmiyor veya süresi doldu; önizlemeyi yenile")
        applied: list[dict[str, Any]] = []
        for pid in ids:
            profile = self.issued[pid]
            plan = self.changes.pending.get(pid)
            if plan is not None and plan.before == plan.after:
                self.changes.pending.pop(pid, None)  # değişiklik yok: dosyaya dokunma
                self.issued.pop(pid, None)
                applied.append({"id": pid, "profile": profile, "path": str(plan.path), "skipped": True,
                                "summary": plan.summary, "backup": None})
                continue
            try:
                entry = self.changes.apply(pid, True)
            except ChangeError as exc:
                self.issued.pop(pid, None)
                return {"ok": False, "applied": applied,
                        "failed": {"plan_id": pid, "profile": profile, "error": str(exc)}}
            self.issued.pop(pid, None)
            applied.append({**entry, "profile": profile, "skipped": False})
        return {"ok": True, "applied": applied, "failed": None}
