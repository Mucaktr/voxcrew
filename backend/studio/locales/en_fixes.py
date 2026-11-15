"""EN karşılıkları: denetimde eksik bulunan sunucu iletileri.

Ortak `en.py`'de eşzamanlı düzenleme olmasın diye ayrı dosya (Faz 6 `en_<alan>.py` deseni); `en.py` sonunda katılır.
"""

from __future__ import annotations

MESSAGES: dict[str, str] = {
    "okunamadı": "could not be read",
    "Bu klasör bir Hermes veri kökü gibi görünmüyor (config.yaml / profiles / SOUL.md yok)": "This folder does not look like a Hermes data root (no config.yaml / profiles / SOUL.md)",
    "Geçersiz hafta": "Invalid week",
    "Geçersiz dönem": "Invalid period",
    "{}: istemi düzenlenemez (yalnızca ajan ve devretme adımları)": "{}: its prompt cannot be edited (agent and handoff steps only)",
    "edits değerleri metin ya da prompt/output alanlı bir sözlük olmalı": "edits values must be text or a dictionary with prompt/output fields",
    "{}: istem boş olamaz": "{}: the prompt cannot be empty",
    "Dünya paketinde geçerli bir sha256 özeti yok": "The world package has no valid sha256 digest",
    "Dünya geçersiz sayı (NaN/Infinity) içeriyor": "The world contains an invalid number (NaN/Infinity)",
    "JSON dışı değer: {}": "Non-JSON value: {}",
    # A-08: MCP güvenlik kapıları
    "Ajan izinleri MCP üzerinden değiştirilemez; izni uygulama arayüzünden ayarla": "Agent permissions cannot be changed over MCP; set them in the studio interface",
    "MCP üzerinden yalnızca tek seferlik izin (once) ya da ret (deny) verilebilir": "Over MCP only a one-time permission (once) or a denial (deny) can be given",
    "Bu ayarlar MCP üzerinden değiştirilemez: {}": "These settings cannot be changed over MCP: {}",
    "MCP istemcisi kendi başlattığı koşunun onayını veremez; kararı uygulama arayüzünden ver": "An MCP client cannot approve a run it started itself; decide from the studio interface",
    # AUDIT C-04: başarılı (200) yanıtlardaki uyarılar + A-10 kontrol noktası iletisi
    "Gateway yalnızca sen 'Başlat'a bastığında uygulamanın alt süreci olarak çalışır ve uygulama kapanınca durur. Otomatik başlatma ya da Windows servisi kurulumu yok.":
        "The gateway runs only when you press 'Start', as a child process of the studio, and stops when the studio closes. There is no autostart and no Windows service.",
    "Gateway çalışırken TÜM profillerin cron zamanlayıcısı (60 sn'de bir) da çalışır — {} kayıtlı cron işi bulundu.":
        "While the gateway runs, the cron scheduler of ALL profiles runs too (every 60 s) — {} registered cron jobs found.",
    "Gateway çalışırken TÜM profillerin cron zamanlayıcısı (60 sn'de bir) da çalışır — şu an kayıtlı cron işi bulunamadı.":
        "While the gateway runs, the cron scheduler of ALL profiles runs too (every 60 s) — no registered cron jobs found right now.",
    "Kanban dağıtıcısı ve bildirimleri de gateway içinde çalışır; kanban görevi oluşturulmadıkça boşta bekler.":
        "The Kanban dispatcher and its notifications also run inside the gateway; they stay idle until a Kanban task is created.",
    "Kimlik bilgisi bulunan mesajlaşma bağdaştırıcıları da başlar: {}.":
        "Messaging adapters that have credentials start too: {}.",
    "Hiçbir profil .env dosyasında mesajlaşma bağdaştırıcısı kimlik bilgisi yok; yalnızca API sunucusu açılır.":
        "No profile .env file has messaging adapter credentials; only the API server starts.",
    "Uygulamanın ortam değişkenlerinde şu bağdaştırıcılar için kimlik bilgisi var ve gateway bunları devralır: {}.":
        "The studio's environment variables hold credentials for these adapters and the gateway inherits them: {}.",
    "{} gateway hook'u (hooks/*/HOOK.yaml) gateway süreci içinde yüklenir.":
        "{} gateway hooks (hooks/*/HOOK.yaml) are loaded inside the gateway process.",
    "API üzerinden çalışan görevler profilin api_server araç paketini alır: CLI'dakinden daha fazla araç açıktır (ör. vision, image_gen, session_search). Skill ve araç seti seçimi API yolunda uygulanmaz; skill ya da araç seti atanmış ajanlar 'otomatik' modda CLI ile çalışmaya devam eder.":
        "Tasks that run over the API get the profile's api_server tool set: more tools are enabled than in the CLI (e.g. vision, image_gen, session_search). Skill and tool-set selection is not applied on the API path; agents with assigned skills or tool sets keep running via the CLI in 'auto' mode.",
    "İlk başlatmada Hermes, kök config.yaml dosyasına 'gateway.multiplex_profiles: true' yazabilir (Hermes'in kendi davranışı; tek gateway tüm profillere hizmet eder).":
        "On first start Hermes may write 'gateway.multiplex_profiles: true' to the root config.yaml (Hermes's own behaviour; one gateway serves all profiles).",
    "Seçilmeyen profiller ({}) API isteklerini 401 ile reddeder; bu profillerin ajanları CLI ile çalışır.":
        "Profiles not selected ({}) reject API requests with 401; agents on those profiles run via the CLI.",
    "Anahtarlar kriptografik rastgele üretilir (43 karakter) ve her profil için ayrıdır. Değer yalnızca .env dosyasına yazılır; arayüzde, loglarda ve uygulama verisinde yalnızca maskeli (••••son4) görünür.":
        "Keys are cryptographically random (43 characters) and separate for each profile. The value is written only to the .env file; the interface, logs and studio data show it masked (••••last4).",
    "Her dosyanın yanına <ad>.bak-<zaman> yedeği alınır; değişiklik geçmişinden geri alınabilir.":
        "A <name>.bak-<time> backup is made next to each file; you can undo from the change history.",
    "Ollama başlatılamadı: {}":
        "Ollama could not be started: {}",
    "Ollama {} koduyla çıktı (günlük: {})":
        "Ollama exited with code {} (log: {})",
    "Hermes bağımlılık ortamı kayıtlı değil; sorun yaşarsanız terminalde `hermes pm repair` çalıştırın.":
        "The Hermes dependency environment is not registered; if you run into problems, run `hermes pm repair` in a terminal.",
    "Kontrol noktası sürümü uyumsuz ({}); devam edilemez, çatallayarak yeniden başlat":
        "Checkpoint version mismatch ({}); cannot resume — fork the run to start again",
    "OpenAI uyumlu uç noktalar yalnızca /api/connections/openai_compat üzerinden değiştirilebilir":
        "OpenAI-compatible endpoints can only be changed through /api/connections/openai_compat",
    # AUDIT B-01/B-08/B-13/B-02 (dünya şeması, eski kayıt, derinlik, anahtar yeniden girişi)
    "Tanınmayan alan: {}":
        "Unknown field: {}",
    "Dünya dosyası çok derin iç içe yapı içeriyor (en çok {} düzey)":
        "The world file is nested too deeply (at most {} levels)",
    "Dünya bu arada başka bir yerde kaydedildi; üzerine yazılmadı. Yeniden yükleyip tekrar dene":
        "The world was saved elsewhere in the meantime; nothing was overwritten. Reload and try again",
    "Adres başka bir sunucuya değişti; güvenlik için API anahtarını yeniden gir":
        "The address now points to a different server; re-enter the API key for safety",
    # AUDIT C-03: ajan etkinlik metinleri (dünya balonu, ekip listesi)
    "Ekibini kuruyor…": "Building the team…",
    "Plan yapıyor…": "Planning…",
    "Planı yeniden yapıyor…": "Re-planning…",
    "Ekibini bekliyor": "Waiting for the team",
    "Ekibini izliyor": "Watching the team",
    "İşe alım onayı bekliyor": "Waiting for hiring approval",
    "Sonuçları birleştiriyor…": "Combining results…",
    "Plan onayı bekliyor": "Waiting for plan approval",
    "Belleğe bakıyor…": "Checking memory…",
    "Düşünüyor…": "Thinking…",
    "Onay bekliyor": "Waiting for approval",
    "Sırada ({})": "Queued ({})",
    "Reddedildi, devam ediyor": "Denied, carrying on",
    "Onay alındı": "Approved",
    "Sonucu inceliyor": "Reviewing the result",
    "Yazıyor…": "Writing…",
    "{} kullanıyor": "Using {}",
    "Bitti!": "Done!",
    "Hata": "Error",
    "Karar bekliyor": "Waiting for a decision",
    "araç onayı yanıtı: {}": "tool approval reply: {}",
    # AUDIT B-17 / B-16 (graf deposu)
    "{}.{} anahtar özelliğidir; değiştirilemez ya da silinemez": "{}.{} is the key property; it cannot be changed or removed",
    "{}.{} anahtar özelliğidir; yeniden damgalanamaz": "{}.{} is the key property; it cannot be re-tagged",
    "Geçersiz tür ya da özellik adı": "Invalid type or property name",
    "Bu adımın dış etkisi (araç çağrısı ya da mesaj) zaten uygulandı; yeniden deneme o eylemi tekrarlar. Kararı uygulama arayüzünden ver":
        "This step's external effect (a tool call or message) was already applied; retrying would repeat that action. Decide from the studio interface",
    # FIX-SEC (QA-yurume-modu): oyun ayarları gerçek boolean
    "Oyun ayarları true ya da false olmalı": "Game settings must be true or false",
}

SECTION_TITLES: dict[str, str] = {}
