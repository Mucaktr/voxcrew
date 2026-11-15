"""Hak motoru (–§4.4). Saf, yerel, ağsız.

Bu dosya ÇEKİRDEK çözümlemeyi taşır: plan her zaman Free'dir (`resolve`). Lisans belirteci, kurucu kurulumu, yönetici/test
modu ve test paketi, bulut hesabı `studio/full/entitlements.py` alt sınıfındadır; `EDITION == "full"` iken dosya sonunda
`Entitlements` o alt sınıfla değiştirilir. Free sürümde alt sınıf yoktur ve plan sabit Free'dir.

Kontrol noktaları yalnız `check(feature,...)` üzerinden sorar (T15: CI araması).
"""

from __future__ import annotations

import threading
from dataclasses import asdict, dataclass, field
from typing import TYPE_CHECKING, Any, Iterable

from fastapi import HTTPException

from studio import admin as admin_mode
from studio._edition import EDITION
from studio.entitlements import usage
from studio.entitlements.plans import (COUNT_KEYS, F_BOOSTERS, F_DELEGATE, F_HIRE, F_SEASON_PREMIUM, NEVER_GATED, PACK_BY_ID,
                                       PLANS, TIER_PACKS, Resolved)

if TYPE_CHECKING:
    from studio.api import Studio

ADMIN_SEATS = 10**6

# ---------------------------------------------------------------- iletiler (TR/EN; istek dilinde)
_MSG: dict[str, tuple[str, str]] = {
    "seat_limit": ("Koltukların dolu: {used}/{limit}. Yedekteki biriyle değiştirebilir ya da paketi görebilirsin.",
                   "Your seats are full: {used}/{limit}. Swap with someone on the bench, or see the plans."),
    "seat_limit_run": ("Bu akış {used} farklı ajan istiyor, kadronda {limit} koltuk var.",
                       "This run needs {used} different agents; your roster has {limit} seats."),
    # tek görevde de doğru okunur ("Bu akıştaki" değil)
    "seat_inactive": ("Yedekteki ajana iş verilemez: {names}. Önce kadroya al (başka biriyle değiştir).",
                      "This work needs an agent on the bench: {names}. Move them to the active roster first."),
    "count_limit.workflows": ("Kayıtlı özel akış sınırı: {used}/{limit}. Var olanları düzenleyebilirsin; yenisi için "
                              "birini arşivle ya da paketi gör.",
                              "Saved custom workflow limit: {used}/{limit}. You can still edit existing ones; archive "
                              "one to add a new one, or see the plans."),
    "count_limit.schedules": ("Etkin zamanlama sınırı: {used}/{limit}. Birini duraklatıp bunu açabilirsin.",
                              "Active schedule limit: {used}/{limit}. Pause another one to turn this on."),
    "count_limit.worlds": ("Özel dünya sınırı: {used}/{limit}. Var olan dünyaları açıp düzenleyebilirsin.",
                           "Custom world limit: {used}/{limit}. You can still open and edit your existing worlds."),
    "count_limit.api_connections": ("Adlandırılmış API bağlantısı sınırı: {used}/{limit}. Yerel sunucular (LM Studio, "
                                    "llama.cpp) sayılmaz; var olanı düzenleyebilirsin.",
                                    "Named API connection limit: {used}/{limit}. Local servers (LM Studio, llama.cpp) "
                                    "do not count; you can edit the existing one."),
    "feature_tier.delegate": ("Devretme ve orkestratör Plus ile gelir. Görevi doğrudan bir ajana verebilirsin.",
                              "Delegation and the orchestrator come with Plus. You can give the task to one agent "
                              "directly."),
    "feature_tier.boosters": ("3 booster her pakette ücretsiz; diğerleri Plus ya da Pro ile açılır.",
                             "3 boosters are free on every plan; the others come with Plus or Pro."),
    "feature_tier": ("Bu özellik paketinde yok.", "This feature is not in your plan."),
    "feature_tier.pack": ("'{label}' özellik paketi bu pakette yok. Çekirdek iş her pakette aynı çalışır.",
                          "The '{label}' feature pack is not in your plan. Core work runs the same on every plan."),
    "not_available": ("Bu özellik henüz yok.", "This feature is not available yet."),
    "agent_busy": ("{name} çalışan bir koşuda; koşu bitince değiştirebilirsin.",
                   "{name} is in a running run; you can swap once it finishes."),
    "admin_mode": ("Yönetici/test modunda kadro değişmez (atla, verme). Modu kapatıp yeniden dene.",
                   "The roster does not change in admin/test mode. Turn the mode off and try again."),
    "feature_tier.hire": ("Free pakette yeni ajan alınamaz. Var olan ajanlarınla çalışabilirsin.",
                          "New agents cannot be hired on Free. You can work with your existing agents."),
    "hire_free": ("Free pakette yeni ajan alınamaz; '{title}' işe alınmadı, '{sub}' yöneticide kalır",
                  "New agents cannot be hired on Free; '{title}' was not hired, '{sub}' stays with the manager"),
    "hire_seat_limit": ("Kadro dolu ({used}/{limit}); '{title}' işe alınmadı, '{sub}' yöneticide kalır",
                        "Roster is full ({used}/{limit}); '{title}' was not hired, '{sub}' stays with the manager"),
    "assign_seat": ("'{who}' yedekte ya da bu koşunun koltuk sınırı ({limit}) dolu; '{sub}' yöneticide kalır",
                    "'{who}' is on the bench or this run's seat limit ({limit}) is reached; '{sub}' stays with the "
                    "manager"),
}


def msg(key: str, lang: str | None = None, **kw: Any) -> str:
    if lang is None:
        from studio.i18n import request_lang

        lang = request_lang()
    tr, en = _MSG.get(key) or _MSG["feature_tier"]
    text = en if lang == "en" else tr
    try:
        return text.format(**kw)
    except (KeyError, IndexError):
        return text


# ---------------------------------------------------------------- karar
@dataclass(frozen=True)
class Decision:
    allowed: bool
    feature: str
    reason: str | None = None       # seat_limit | seat_inactive | count_limit | feature_tier | not_available |
    #                                 license_offline_grace | license_expired
    limit: int | None = None
    used: int | None = None
    plan: str = "free"              # free (çekirdek); full sürümde ayrıca plus | pro | founder | admin
    source: str = "default"         # default | test | founder | token | admin
    upgrade_to: str | None = None   # en düşük yeterli paket (admin ve founder'da None)
    alternatives: list[str] = field(default_factory=list)   # önce ücretsiz çözüm
    message: str | None = None
    agents: list[str] = field(default_factory=list)          # seat_inactive: yedekteki ajanlar
    packs: list[str] = field(default_factory=list)           # etkin özellik paketleri (yalnız bilgi)

    def to_dict(self) -> dict[str, Any]:
        return {"code": "plan_limit", **asdict(self)}


class EntitlementError(HTTPException):
    """Kontrol noktası reddi → 409 ve gövdede `Decision` (arayüz sınır kartı bunu okur)."""

    def __init__(self, decision: Decision, status: int = 409):
        super().__init__(status, decision.to_dict())
        self.decision = decision


_ALTERNATIVES = {
    "seats": ["bench_swap"], "workflows": ["edit_existing", "archive"], "schedules": ["pause_other"],
    "worlds": ["edit_existing", "archive"], "api_connections": ["edit_existing", "local_model"],
    "delegate": ["single_agent"], "hire": ["existing_agents", "bench_swap"],
}


class Entitlements:
    """Çekirdek hak motoru: plan sabit Free. (Full sürümde alt sınıf lisans/kurucu/test paketi ekler.)"""

    def __init__(self, studio: "Studio", verifier: Any = None):
        self.studio = studio
        data_dir = getattr(getattr(studio, "changes", None), "data_dir", None)
        if data_dir is None:
            from studio.config import DATA_DIR
            data_dir = DATA_DIR
        self.data_dir = data_dir
        self._lock = threading.RLock()
        # ayrı hak defterleri; yazma yalnız gerçek lisansla (çekirdekte lisans yok → yalnız okuma/önizleme)
        from studio.entitlements.ledger import Ledgers, writable_for  # noqa: PLC0415

        self.ledgers = Ledgers(data_dir, writable=lambda: writable_for(self.resolve()))

    # ------------------------------------------------------------ çözümleme
    def admin_active(self) -> bool:
        return admin_mode.is_active(self.studio.settings)

    def resolve(self) -> Resolved:
        f = PLANS["free"]
        return Resolved("free", "default", f.seats, dict(f.limits), f.features, f.included_scene_packs,
                        f.included_hero_packs, base="free")

    # ------------------------------------------------------------ yardımcılar
    @staticmethod
    def _upgrade_for(feature: str, need: int | None, r: Resolved) -> str | None:
        if r.source in ("admin", "founder"):
            return None
        cur = PLANS.get(r.base)
        for p in sorted(PLANS.values(), key=lambda x: x.order):
            if cur and p.order <= cur.order:
                continue
            if feature == "seats" and (need is None or p.seats >= need):
                return p.id
            if feature in COUNT_KEYS:
                lim = p.limits.get(feature)
                if lim is None or need is None or lim >= need:
                    return p.id
            if feature in (F_DELEGATE, F_HIRE, F_BOOSTERS, F_SEASON_PREMIUM) and feature in p.features:
                return p.id
            if feature.startswith("scene:") and p.included_scene_packs == "all":
                return p.id
            if feature.startswith("pack:") and feature.split(":", 1)[1] in TIER_PACKS.get(p.id, frozenset()):
                return p.id
        return None

    def _deny(self, r: Resolved, feature: str, reason: str, message: str, *, limit: int | None = None,
              used: int | None = None, need: int | None = None, alts: list[str] | None = None,
              agents: list[str] | None = None) -> Decision:
        key = "seats" if feature in ("seats", "run") else feature
        return Decision(False, feature, reason, limit, used, r.plan, r.source,
                        self._upgrade_for(key, need, r),
                        list(alts if alts is not None else _ALTERNATIVES.get(key, [])), message, list(agents or []),
                        sorted(r.packs))

    def _ok(self, r: Resolved, feature: str, limit: int | None = None, used: int | None = None) -> Decision:
        reason = "license_offline_grace" if r.license.get("state") == "offline_grace" else None
        return Decision(True, feature, reason, limit, used, r.plan, r.source, packs=sorted(r.packs))

    # ------------------------------------------------------------ karar
    def check(self, feature: str, *, agents: Iterable[str] | None = None, lang: str | None = None) -> Decision:
        """Tek giriş noktası. `feature`: seats | run | delegate | workflows | schedules | worlds | api_connections |
        scene:<id> | hero_pack:<id> | history | publish | plots | season_premium | NEVER_GATED öğeleri."""
        r = self.resolve()
        if feature in NEVER_GATED or r.source == "admin":
            return self._ok(r, feature)
        if feature == "seats":
            used = usage.seats(self.studio)["used"]
            if used < r.seats:
                return self._ok(r, feature, r.seats, used)
            return self._deny(r, feature, "seat_limit", msg("seat_limit", lang, used=used, limit=r.seats),
                              limit=r.seats, used=used, need=used + 1)
        if feature == "run":
            return self._check_run(r, list(agents or []), lang)
        if feature in COUNT_KEYS:
            limit = r.limits.get(feature)
            used = usage.count(self.studio, feature)
            if limit is None or used < limit:
                return self._ok(r, feature, limit, used)
            return self._deny(r, feature, "count_limit", msg(f"count_limit.{feature}", lang, used=used, limit=limit),
                              limit=limit, used=used, need=used + 1)
        if feature in (F_DELEGATE, F_HIRE, F_BOOSTERS, F_SEASON_PREMIUM):
            if feature in r.features:
                return self._ok(r, feature)
            return self._deny(r, feature, "feature_tier", msg(f"feature_tier.{feature}", lang))
        if feature.startswith("scene:"):
            return self._check_scene(r, feature)
        if feature.startswith("hero_pack:"):
            ok = r.hero_packs == "all"
            return self._ok(r, feature) if ok else self._deny(r, feature, "feature_tier", msg("feature_tier", lang),
                                                               alts=[])
        if feature == "history":
            return self._ok(r, feature, r.limits.get("history_days"))
        if feature == "plots":
            return self._ok(r, feature)     # arsa: kazanımla, her pakette aynı (D4 A); ek yuva `pack:plots_plus`
        if feature.startswith("pack:"):
            pack = PACK_BY_ID.get(feature.split(":", 1)[1])
            if pack is None:
                return self._deny(r, feature, "not_available", msg("not_available", lang), alts=[])
            if pack.id in r.packs:
                return self._ok(r, feature)
            from studio.i18n import request_lang  # noqa: PLC0415

            label = pack.label_en if (lang or request_lang()) == "en" else pack.label_tr
            return self._deny(r, feature, "feature_tier", msg("feature_tier.pack", lang, label=label), alts=[])
        if feature == "publish":
            return self._deny(r, feature, "not_available", msg("not_available", lang), alts=[])
        return self._ok(r, feature)

    def _check_run(self, r: Resolved, slugs: list[str], lang: str | None) -> Decision:
        nodes = [self.studio.agents.node(s) for s in dict.fromkeys(x for x in slugs if x)]
        nodes = [n for n in nodes if n and not usage.seat_exempt(n)]  # gizli ajan da koltuk sayılır
        benched = [str(n["props"].get("name") or n["props"]["slug"]) for n in nodes if usage.is_benched(n)]
        if benched:
            return self._deny(r, "run", "seat_inactive", msg("seat_inactive", lang, names=", ".join(benched)),
                              limit=r.seats, used=len(nodes), alts=["bench_swap"],
                              agents=[n["props"]["slug"] for n in nodes if usage.is_benched(n)])
        if len(nodes) > r.seats:
            return self._deny(r, "run", "seat_limit", msg("seat_limit_run", lang, used=len(nodes), limit=r.seats),
                              limit=r.seats, used=len(nodes), need=len(nodes), alts=["bench_swap", "merge_roles"])
        return self._ok(r, "run", r.seats, len(nodes))

    def _check_scene(self, r: Resolved, feature: str) -> Decision:
        from studio.game import catalog as C

        scene = feature.split(":", 1)[1]
        pack = C.scene_pack(scene)
        included = bool(pack and not pack.free and r.scene_packs == "all")
        if included:
            return self._ok(r, feature)
        return Decision(False, feature, "feature_tier", None, None, r.plan, r.source,
                        self._upgrade_for(feature, None, r), ["earn"], None)

    def includes(self, item: str) -> bool:
        """Pakete dahil içerik (ör. `scene:<kimlik>`). Envantere yazılmaz; abonelik bitince kalıntı kalmaz (§4.6)."""
        return self.check(item).allowed if item.startswith(("scene:", "hero_pack:")) else False

    def require(self, feature: str, **ctx: Any) -> Decision:
        d = self.check(feature, **ctx)
        if not d.allowed:
            raise EntitlementError(d)
        return d

    # ------------------------------------------------------------ özet (GET /api/plan)
    def snapshot(self) -> dict[str, Any]:
        from studio.entitlements.plans import CHECKPOINTS

        r = self.resolve()
        s = usage.seats(self.studio)
        use = usage.all_usage(self.studio)
        admin_on = r.source == "admin"
        return {
            "plan": r.plan, "source": r.source, "base": r.base,
            "seats": {"limit": None if admin_on else r.seats, "used": s["used"], "benched": s["benched"],
                      "free": None if admin_on else max(0, r.seats - s["used"])},
            "limits": r.limits, "usage": use,
            "features": {"delegate": F_DELEGATE in r.features, "hire": F_HIRE in r.features, "boosters": F_BOOSTERS in r.features, "season_premium": F_SEASON_PREMIUM in r.features,
                         "scene_packs": r.scene_packs, "hero_packs": r.hero_packs,
                         "packs": sorted(r.packs), "chests": r.chests},
            "license": r.license or {"state": "none"},
            # deneme: lisans iddiası ya da promo defterindeki etkin deneme (okuma kancası)
            "trial": bool((r.license or {}).get("trial")) or self.ledgers.active_trial() is not None,
            **self._snapshot_extras(r),
            "checkpoints": [{"id": c.id, "feature": c.feature, "spec": c.spec_ref, "enforced": c.enforced,
                             "note": c.note} for c in CHECKPOINTS],
            "never_gated": list(NEVER_GATED),
        }

    def _snapshot_extras(self, r: Resolved) -> dict[str, Any]:
        """Çekirdekte kurucu, yönetici modu, test paketi ve satın alma yoktur (hepsi kapalı değerlerle döner)."""
        return {"founder": {"founder": False, "seats": None},
                "admin": {"available": False, "active": False},
                "test_plan": {"available": False, "value": None, "options": []},
                "purchase": {"available": False}}


def get(owner: Any) -> Entitlements | None:
    """Studio ya da AgentRegistry'den bağlı motoru döner (bağlı değilse None → kontrol noktası pas geçer)."""
    ent = getattr(owner, "entitlements", None)
    return ent if isinstance(ent, Entitlements) else None


def attach(studio: "Studio", verifier: SignatureVerifier | None = None) -> Entitlements:
    """Motoru Studio'ya ve ajan kayıt defterine bağlar (idempotent). `create_app` router kaydında çağrılır."""
    ent = get(studio)
    if ent is None:
        ent = Entitlements(studio, verifier)
        studio.entitlements = ent  # type: ignore[attr-defined]
        studio.agents.entitlements = ent  # type: ignore[attr-defined]
    return ent


if EDITION == "full":  # lisans/kurucu/test paketi/hesap: alt sınıf (studio/full/entitlements.py bunu yalnız buradan yükler)
    from studio.full.entitlements import ENV_PLAN, FullEntitlements as Entitlements  # noqa: E402,F401,F811
