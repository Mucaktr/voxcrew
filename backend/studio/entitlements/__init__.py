"""Yerel hak motoru.

Kontrol noktaları yalnız şu biçimde sorar (T15 CI araması bu kalıbı izler):

    from studio.entitlements import gate
    ent = gate(studio_or_registry) # bağlı değilse None → kontrol pas geçer (motor yalnız create_app'te bağlanır)
    if ent is not None:
        decision = ent.check("schedules") # Decision; reddi EntitlementError (409) ile yükseltmek için ent.require(...)

Modüller: plans (tablo), engine (karar), usage (sayaç), seats (yedek kulübesi), api (/api/plan/*).
"""

from studio.entitlements.engine import Decision, EntitlementError, Entitlements, attach, get as gate

__all__ = ["Decision", "EntitlementError", "Entitlements", "attach", "gate"]
