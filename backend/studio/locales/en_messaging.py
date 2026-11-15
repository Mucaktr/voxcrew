"""İngilizce katalog — Faz 6 'messaging' alanı. `en.py` bu sözlükleri MESSAGES/SECTION_TITLES'a katar.

Ekipler aynı dosyayı aynı anda düzenlemesin diye her alanın kataloğu ayrı modüldedir; biçim `en.py` ile aynıdır
(TR ileti → EN ileti, f-string yer tutucuları `{}`).

S24 ( mesajlaşma, orkestratör): REST hata iletileri, iletişim politikası, orchestrate şema doğrulaması ve
motorun koşu dilindeki (`Engine._t`) kart/uyarı metinleri.
"""

from __future__ import annotations

MESSAGES: dict[str, str] = {
    # ---- REST (messaging/api.py) ve servis
    "Mesajlaşma hazır değil": "Messaging is not ready",
    "{} metin olmalı": "{} must be text",
    "Geçersiz mesaj türü: {}": "Invalid message kind: {}",
    "Sistem mesajı bu uçtan gönderilemez": "System messages cannot be sent from this endpoint",
    "Çalıştırma yok: {}": "Run not found: {}",
    "Alıcı ajan boş olamaz": "Recipient agent cannot be empty",
    "Mesaj metni boş olamaz": "Message text cannot be empty",
    "Mesaj yok: {}": "Message not found: {}",
    "Yalnızca sana gelen mesajlar okundu yapılabilir; ajana giden not, ajan onu görünce okundu olur":
        "Only messages addressed to you can be marked read; a note to an agent is marked read when the agent sees it",
    "Mesajlaşma politikası bu mesaja izin vermiyor": "The messaging policy does not allow this message",
    # ---- iletişim politikası (office/service.py)
    "Mesajlaşma politikası free, hierarchical ya da custom olmalı":
        "Messaging policy must be free, hierarchical or custom",
    "Ekip politikaları bir sözlük olmalı": "Team policies must be an object",
    "Ekip mesajlaşma politikası free ya da hierarchical olmalı": "Team messaging policy must be free or hierarchical",
    "Hiyerarşik mesajlaşma: '{}' ekipler arası mesajı doğrudan '{}' ajanına gönderemez; mesaj ekip liderleri ya da "
    "raporlama zinciri üzerinden gitmeli":
        "Hierarchical messaging: '{}' cannot send a cross-team message directly to '{}'; the message must go through "
        "team leads or the reporting chain",
    # ---- hedefler (goals/service.py)
    "launch_mode 'delegate' ya da 'orchestrate' olmalı": "launch_mode must be 'delegate' or 'orchestrate'",
    # ---- şema (workflow/spec.py) ve motor girişleri
    "{}: {} bir sayı olmalı": "{}: {} must be a number",
    "{}: plan onayı 'ask' ya da 'auto' olmalı": "{}: plan approval must be 'ask' or 'auto'",
    "{}: yeniden plan sayısı 0–{} olmalı": "{}: number of replans must be 0–{}",
    "{}: izleme aralığı {}–{} sn olmalı": "{}: monitoring interval must be {}–{} s",
    "{}: plan_approval, max_replans ve monitor_every_s yalnızca orchestrate adımında kullanılabilir":
        "{}: plan_approval, max_replans and monitor_every_s can only be used in an orchestrate step",
    "{}: {} doğrulanamadı: {}": "{}: {} could not be validated: {}",
    "{}: {} seçilmeli": "{}: {} must be selected",
    "monitor_every_s bir sayı olmalı": "monitor_every_s must be a number",
    "{}: istemi düzenlenemez (yalnızca ajan ve devretme adımları)":
        "{}: its prompt cannot be edited (agent and delegation steps only)",
    "edits değerleri metin ya da prompt/output alanlı bir sözlük olmalı":
        "edits values must be text or an object with prompt/output fields",
    "{}: istem boş olamaz": "{}: prompt cannot be empty",
    # ---- orkestratör kartları ve hataları (Engine._t, koşunun dilinde)
    "Plan onayı · {}": "Plan approval · {}",
    "{} şu planı öneriyor (tur {}, {} alt görev): {} — onaylansın mı? Reddedilirse koşu biter.":
        "{} proposes this plan (round {}, {} subtasks): {} — approve? Rejecting ends the run.",
    "Plan reddedildi": "Plan rejected",
    "Yeniden plan sınırı · {}": "Replan limit · {}",
    "En fazla {} yeniden plan turu kullanıldı; {} alt görev hâlâ tamamlanamadı ({}). Eldeki sonuçlarla sentezlensin "
    "mi? Reddedilirse koşu başarısız biter.":
        "The maximum of {} replan rounds was used; {} subtasks are still not completed ({}). Synthesize with the "
        "results at hand? Rejecting fails the run.",
    "Yeniden plan sınırı aşıldı; kullanıcı durdurdu": "Replan limit exceeded; stopped by the user",
    "Yönetici geçerli bir JSON plan üretemedi (bir kez yeniden denendi)":
        "The manager could not produce a valid JSON plan (retried once)",
    "Alt görevlerin hiçbiri tamamlanamadı: {}": "None of the subtasks could be completed: {}",
    "Sentez tamamlanamadı: {}": "Synthesis could not be completed: {}",
    "{} alt görev tamamlanamadı: {}": "{} subtasks could not be completed: {}",
}

SECTION_TITLES: dict[str, str] = {
    "GELEN MESAJLAR (doğrulanmamış)": "INCOMING MESSAGES (unverified)",
}
