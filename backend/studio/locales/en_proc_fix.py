"""PROC-FIX sunucu iletileri (EN): bütçe aşımı kartı, teslim adımı ve revizyon hedefi, Codex yalıtımı."""

from __future__ import annotations

MESSAGES: dict[str, str] = {
    "Bütçe aşıldı ({} · {}: {} / {}). '{}' adımı yarıda kaldı; onaylarsan adım BAŞTAN çalışır, beklenen maliyet ≈ {} "
    "token{}. Yeni sınır {} ile devam et / durdur?":
        "Budget exceeded ({} · {}: {} / {}). Step '{}' stopped midway; if you approve, the step runs AGAIN FROM THE "
        "START, expected cost ≈ {} tokens{}. Continue with a new limit of {} / stop?",
    "Bütçe doldu ({} · {}: {} / {}). Biten adımların çıktısı korundu. Onaylarsan sıradaki adım '{}' çalışır, beklenen "
    "maliyet ≈ {} token{}. Yeni sınır {} ile devam et / durdur?":
        "Budget reached ({} · {}: {} / {}). Output of finished steps was kept. If you approve, the next step '{}' runs, "
        "expected cost ≈ {} tokens{}. Continue with a new limit of {} / stop?",
    "Bütçe aşıldı ({} {} / {}); adımın çıktısı korundu, karar sıradaki model turundan önce sorulur":
        "Budget exceeded ({} {} / {}); the step's output was kept, you'll be asked before the next model turn",
    "'{}' adımı kendi bütçesini aştı ({}: {} / {}); çıktısı korundu. Sıradaki adım '{}' ile devam et / durdur?":
        "Step '{}' went over its own budget ({}: {} / {}); its output was kept. Continue with the next step '{}' / stop?",
    # Codex yalıtımı
    "codex_isolation tablosu bağlı değil": "codex_isolation table is not bound",
    "inherit_user_codex_config ya da web_search verilmeli": "Give inherit_user_codex_config or web_search",
    "inherit_user_codex_config true ya da false olmalı": "inherit_user_codex_config must be true or false",
    "web_search true ya da false olmalı": "web_search must be true or false",
    'Kullanıcı Codex kurulumunu devralmak açık onay ister (confirm: "inherit")':
        'Inheriting your Codex setup needs explicit consent (confirm: "inherit")',
    "Uygulamanın iç ajanları kişisel Codex kurulumunu devralamaz":
        "The studio's internal agents can't inherit your personal Codex setup",
    "Kaydedilemedi: {}": "Couldn't save: {}",
    # teslim adımı ve revizyon hedefi
    "target bir adım kimliği olmalı": "target must be a step id",
    "Revizyon hedefi bir üst düzey ajan adımı olmalı: {}": "The revision target must be a top-level agent step: {}",
    "Revizyon hedefi yalnız çatallanan revizyonda seçilebilir": "A revision target can only be chosen for a forked revision",
    "{}: kind yalnızca 'review' olabilir": "{}: kind can only be 'review'",
    "{}: web_search true ya da false olmalı": "{}: web_search must be true or false",
    "deliverable: adım yok: {}": "deliverable: no such step: {}",
    "deliverable ({}) bir ajan adımı olmalı": "deliverable ({}) must be an agent step",
}
