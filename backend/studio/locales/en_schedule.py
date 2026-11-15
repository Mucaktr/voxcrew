"""İngilizce katalog — Faz 6 'schedule' alanı. `en.py` bu sözlükleri MESSAGES/SECTION_TITLES'a katar.

Ekipler aynı dosyayı aynı anda düzenlemesin diye her alanın kataloğu ayrı modüldedir; biçim `en.py` ile aynıdır
(TR ileti → EN ileti, f-string yer tutucuları `{}`).
"""

from __future__ import annotations

MESSAGES: dict[str, str] = {
    # schedule/api.py
    "Zamanlamalar yalnızca uygulama arayüzünden değiştirilebilir; MCP ve diğer istemciler yalnızca listeleyebilir":
        "Schedules can only be changed from the studio UI; MCP and other clients can only list them",
    "Gövde çok büyük (en fazla 64 KB)": "Body too large (max 64 KB)",
    "Origin başlıklı istek reddedildi: tetikleyici yalnızca yerel araçlardan çağrılır":
        "Request with an Origin header rejected: triggers can only be called by local tools",
    "Tetikleyici yalnızca yerel (loopback) istemcileri kabul eder": "Triggers only accept local (loopback) clients",
    "Geçersiz tetikleyici ya da erişim anahtarı": "Invalid trigger or token",
    "Zamanlama kapalı": "Schedule is disabled",
    "Zamanlayıcı ayarlarda kapalı": "The scheduler is turned off in settings",
    # schedule/cron.py
    "Cron {} alanında geçersiz değer: {}": "Invalid value in cron {} field: {}",
    "Cron {} alanı {}–{} aralığında olmalı: {}": "Cron {} field must be within {}–{}: {}",
    "Cron {} alanında boş öğe var": "Cron {} field has an empty item",
    "Cron {} alanında geçersiz adım: {}": "Invalid step in cron {} field: {}",
    "Cron {} alanında ters aralık: {}": "Reversed range in cron {} field: {}",
    "Cron ifadesi boş": "Cron expression is empty",
    "Cron ifadesi 5 alan olmalı: dakika saat ay-günü ay hafta-günü":
        "Cron expression must have 5 fields: minute hour day-of-month month day-of-week",
    "Cron ifadesi hiçbir zaman çalışmaz: {}": "Cron expression never fires: {}",
    # schedule/service.py
    "{}: sır (anahtar/parola) gibi görünen bir değer var; zamanlamaya sır yazma":
        "{}: contains a value that looks like a secret (key/token/password); don't put secrets in schedules",
    "{}: istem enjeksiyonu kalıbı içeriyor (önceki talimatları yok say vb.); kaydedilmedi":
        "{}: contains a prompt-injection pattern (ignore previous instructions etc.); not saved",
    "{} bir tam sayı olmalı": "{} must be an integer",
    "Bilinmeyen zamanlama türü: {}": "Unknown schedule kind: {}",
    "Zamanlama yok: {}": "No such schedule: {}",
    "spec bir nesne olmalı": "spec must be an object",
    "policy bir nesne olmalı": "policy must be an object",
    "Hedef (target) gerekli: task, workflow ya da goal": "A target is required: task, workflow or goal",
    "Hedef türü task, workflow ya da goal olmalı": "Target type must be task, workflow or goal",
    "Onay politikası yalnızca pause (duraklat) ya da deny (reddet) olabilir; gözetimsiz koşu onayları kendiliğinden "
    "onaylayamaz":
        "Approval policy can only be pause or deny; unattended runs can never approve on their own",
    "Eşzamanlılık skip_if_running ya da queue olmalı": "Concurrency must be skip_if_running or queue",
    "Kaçan tetik politikası once ya da skip olmalı": "Catch-up policy must be once or skip",
    "Başlık en fazla {} karakter olabilir": "Title can be at most {} characters",
    "Erişim anahtarı yalnızca webhook zamanlamalarında vardır": "Only webhook schedules have a token",
    "Aralık {} saniye ile 31 gün arasında olmalı": "Interval must be between {} seconds and 31 days",
    "Tek seferlik zamanlama için geçerli bir tarih-saat (at) gerekli":
        "A one-time schedule needs a valid date-time (at)",
    "Tek seferlik zamanlamanın saati gelecekte olmalı": "A one-time schedule must be in the future",
    "İzlenen klasör çalışma klasörünün içinde olmalı": "The watched folder must be inside the workspace folder",
    "İzlenen klasör yok: {}": "Watched folder not found: {}",
    "Dosya deseni (glob) klasörün dışına çıkamaz": "The file pattern (glob) cannot leave the folder",
    "Görev metni en fazla {} karakter olabilir": "Task text can be at most {} characters",
    "Girdiler (inputs) bir nesne olmalı": "inputs must be an object",
    "Girdi en fazla {} karakter olabilir: {}": "Input can be at most {} characters: {}",
    "Takılı koşu eşiği 1 dakika ile 7 gün arasında olmalı": "Stuck-run threshold must be between 1 minute and 7 days",
    "İş akışı yok: {}": "No such workflow: {}",
}

SECTION_TITLES: dict[str, str] = {
}
