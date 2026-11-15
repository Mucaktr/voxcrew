"""PROC2-FIX sunucu iletileri (EN): adım sürerken bütçe durdurması, yerel adım maliyeti, revizyon sürümü başlığı."""

from __future__ import annotations

MESSAGES: dict[str, str] = {
    "Bütçe aşıldı ({} · {}: {} / {}). '{}' adımı sıradaki model turundan önce durduruldu; o ana kadar ürettiği yarım "
    "çıktı ({} karakter, {} araç çağrısı) korundu. Onaylarsan adım BAŞTAN çalışır (korunan çıktı isteme eklenir), "
    "beklenen maliyet ≈ {} token{}. Yeni sınır {} ile devam et / durdur?":
        "Budget exceeded ({} · {}: {} / {}). Step '{}' was stopped before its next model turn; the partial output it "
        "had produced ({} characters, {} tool calls) was kept. If you approve, the step runs AGAIN FROM THE START (the "
        "kept output is added to its prompt), expected cost ≈ {} tokens{}. Continue with a new limit of {} / stop?",
    " (yerel, 0 $)": " (local, $0)",
    " Sıradaki adımın beklenen maliyeti ≈ {} token{}.": " Expected cost of the next step ≈ {} tokens{}.",
    "{} (sürüm {})": "{} (version {})",
    "deliverable bir adım kimliği ya da kimlik listesi olmalı": "deliverable must be a step id or a list of step ids",
    "deliverable en çok {} adım olabilir": "deliverable can have at most {} steps",
}
