""" sunucu iletileri (EN): Codex başlatma ve skill bütçesi, bütçe kartı metinleri, revizyon hedefi."""

from __future__ import annotations

MESSAGES: dict[str, str] = {
    # Codex: npm kabuğu ve skill listesi bütçesi
    "Kişisel beceri sayısı çok fazla; yalıtım tamamlanamıyor: bulunan {}, komut satırına sığan {}. Koşu başlatılmadı. "
    "Skill klasörlerini azalt ya da ajan kartında \"eksik yalıtımla çalıştır\" iznini ver":
        "Too many personal skills; isolation can't be completed: found {}, fit on the command line {}. The run wasn't "
        "started. Reduce the skill folders or allow \"run with incomplete isolation\" on the agent card",
    "Codex komut satırı npm codex.cmd kabuğundan (cmd.exe) bozulmadan geçemez ve kabuğun hedefi (node + codex.js) "
    "çözülemedi; koşu başlatılmadı. Codex'i masaüstü uygulamasıyla kur ya da node'u PATH'e ekle, veya çalışma klasörü, "
    "model ve skill adlarındaki & | < > ^ % ! ( ) karakterlerini kaldır":
        "The Codex command line can't pass through the npm codex.cmd shim (cmd.exe) intact, and the shim's target "
        "(node + codex.js) couldn't be resolved; the run wasn't started. Install Codex with the desktop app or add node "
        "to PATH, or remove the & | < > ^ % ! ( ) characters from the working folder, model and skill names",
    "inherit_user_codex_config, web_search ya da partial_isolation verilmeli":
        "Give inherit_user_codex_config, web_search or partial_isolation",
    "partial_isolation true ya da false olmalı": "partial_isolation must be true or false",
    'Eksik yalıtımla çalıştırmak açık onay ister (confirm: "partial")':
        'Running with incomplete isolation needs explicit consent (confirm: "partial")',
    # bütçe kartı
    "Sıradaki adım '{}' bütçeye sığmıyor ({} · {}: {} kullanıldı, sınır {}; beklenen maliyet ≈ {} token{}). Yeni sınır {} "
    "ile devam et / durdur?":
        "The next step '{}' doesn't fit the budget ({} · {}: {} used, limit {}; expected cost ≈ {} tokens{}). Continue "
        "with a new limit of {} / stop?",
    " Biten adımların çıktısı korundu.": " Output of the finished steps was kept.",
    "Bütçe doldu ({} · {}: {} / {}). Onaylarsan sıradaki adım '{}' çalışır, beklenen maliyet ≈ {} token{}. Yeni sınır {} "
    "ile devam et / durdur?":
        "Budget reached ({} · {}: {} / {}). If you approve, the next step '{}' runs, expected cost ≈ {} tokens{}. "
        "Continue with a new limit of {} / stop?",
    " '{}' adımının biten turu (plan) korundu; yeniden istenmez.":
        " The finished round (plan) of step '{}' was kept; it won't be requested again.",
    "Sınır elle {} yapıldı. Onaylarsan bu sınırla devam eder / durdur?":
        "The limit was set to {} by hand. If you approve, the run continues with this limit / stop?",
    "Sınır elle {} yapıldı; sıradaki iş için yetmiyor. Onaylarsan sınır önerilen {} olur / durdur?":
        "The limit was set to {} by hand; it isn't enough for the next work. If you approve, the limit becomes the "
        "suggested {} / stop?",
}
