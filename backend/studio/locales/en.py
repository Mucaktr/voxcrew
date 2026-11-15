"""İngilizce katalog (Ekip S16): sunucu hata iletileri, sistem istemi satırları ve bölüm başlıkları.

`MESSAGES`: TR ileti → EN ileti. f-string ile üretilen iletiler `{}` yer tutucusuyla şablondur; `studio.i18n.translate`
şablonu düzenli ifadeye çevirip yakaladığı parçaları EN şablona sırayla yerleştirir (`{0}`, `{1}` ile yeniden
sıralanabilir). Burada karşılığı olmayan ileti Türkçe kalır (bozulmaz). Kataloğu güncellemek için:

    uv run --no-sync python -m studio.locales._extract --missing

Ton: doğal, kısa, ürün dili; kelime kelime çeviri değil. Teknik anahtarlar (confirm: true, slug, hooks…) olduğu gibi.
"""

from __future__ import annotations

MESSAGES: dict[str, str] = {
    # ---------------------------------------------------------------- genel / çekirdek API
    "Ajan yok": "Agent not found",
    "Ajan yok: {}": "Agent not found: {}",
    "Görev yok": "Quest not found",
    "Görev metni boş": "Task text is empty",
    "Çalıştırma yok": "Run not found",
    "Bulunamadı": "Not found",
    "OpenAI uyumlu sunucu ayarlanmadı (Bağlantılar → OpenAI uyumlu sunucu)":
        "OpenAI-compatible server is not set up (Connections → OpenAI-compatible server)",
    # ---------------------------------------------------------------- iş akışı doğrulama (workflow/spec.py)
    "slug yalnızca küçük harf, rakam, - ve _ içerebilir": "slug may only contain lowercase letters, digits, - and _",
    "En az bir adım gerekli": "At least one step is required",
    "Adım id'leri benzersiz olmalı": "Step ids must be unique",
    "Geçersiz adım id: {}": "Invalid step id: {}",
    "Adım yok: {}": "Step not found: {}",
    "İş akışı bir sözlük olmalı": "The workflow must be a mapping",
    "Her adımın bir id'si olmalı": "Every step needs an id",
    "İş akışında döngü var (DAG olmalı)": "The workflow has a cycle (it must be a DAG)",
    "{}: bilinmeyen adım türü {}": "{}: unknown step type {}",
    "{}: kök yönetici (ajan ya da rol) seçilmeli": "{}: choose a root manager (agent or role)",
    "{}: ajan ya da rol seçilmeli": "{}: choose an agent or a role",
    "{}: '{}' adlı ajan yok": "{}: no agent named '{}'",
    "{}: hedef metni boş": "{}: goal text is empty",
    "{}: görev metni boş": "{}: task text is empty",
    "{}: devretme derinliği 1–{} olmalı": "{}: delegation depth must be 1–{}",
    "{}: alt görev sayısı 1–{} olmalı": "{}: subtask count must be 1–{}",
    "{}: işe alım bütçesi 0–{} olmalı": "{}: hiring budget must be 0–{}",
    "{}: işe alım onayı 'ask' ya da 'auto' olmalı": "{}: hiring approval must be 'ask' or 'auto'",
    "{}: gözden geçirme döngüsü yalnızca ajan adımında kullanılabilir": "{}: a review loop can only be used on an agent step",
    "{}: bilinmeyen bağımlılık {}": "{}: unknown dependency {}",
    "{}: revise hedefi yok: {}": "{}: revise target not found: {}",
    "{}: revise hedefi ({}) bu adımdan önce gelmeli": "{}: revise target ({}) must come before this step",
    "{}: revise hedefi ({}) bir ajan adımı olmalı": "{}: revise target ({}) must be an agent step",
    "{}: {} bir tam sayı olmalı": "{}: {} must be an integer",
    "Bilinmeyen sahne": "Unknown scene",
    "Bu sahne kilitli — Başarılar → Mağaza'dan açabilirsin": "This scene is locked — unlock it in Achievements → Shop",
    "Test edilebilir bağlantılar: ollama, codex, claude": "Testable connections: ollama, codex, claude",
    "Dosya yok: {}": "File not found: {}",
    "Çalışma klasörü dışındaki dosyalar okunamaz": "Files outside the workspace folder cannot be read",
    "Bilinmeyen hata": "Unknown error",
    "Sunucu yeniden başlatıldı": "Server restarted",
    # ---------------------------------------------------------------- ajanlar (agents.py)
    "Bilinmeyen bağlantı: {}": "Unknown connection: {}",
    "Böyle bir ekip yok: {}": "No such team: {}",
    "Bir ajan kendine raporlayamaz": "An agent cannot report to itself",
    "Raporlama döngüsü oluşur; bu yönetici zaten bu ajana bağlı":
        "This would create a reporting cycle; that manager already reports to this agent",
    "Böyle bir yönetici yok: {}": "No such manager: {}",
    "{} bir liste olmalı": "{} must be a list",
    "'Profil ayarı' yalnızca Hermes çalışma zamanında kullanılabilir":
        "'Profile setting' is only available with the Hermes runtime",
    "Geçersiz akıl yürütme düzeyi: {}. Geçerli değerler: {}": "Invalid reasoning level: {}. Valid values: {}",
    "Geçersiz taşıma: {}. Geçerli değerler: {}": "Invalid transport: {}. Valid values: {}",
    "Bilinmeyen araç seti: {}": "Unknown toolset: {}",
    "Bu araç setleri yalnızca kendi mesajlaşma platformunda çalışır, CLI'da kullanılamaz: {}":
        "These toolsets only work on their own messaging platform and cannot be used in the CLI: {}",
    "Ollama'da kurulu model yok": "No models are installed in Ollama",
    "Beyin seçilmedi: bu ajana hazır bir beyin seç (profil → Beyin)":
        "No brain chosen: pick a ready brain for this agent (profile → Brain)",
    # S19: başarılı yanıtlarda da çevrilen ajan rotası alanları (agents.py serialize) ve bağlantı adları
    "Hermes/{} › profil ayarı": "Hermes/{} › profile setting",
    "OpenAI uyumlu": "OpenAI-compatible",
    "OpenAI uyumlu · {}": "OpenAI-compatible · {}",
    "OpenAI uyumlu sunucu": "OpenAI-compatible server",
    "Bu Hermes profilinde Codex oturumu yok (hermes auth gerekebilir)":
        "This Hermes profile has no Codex session (you may need to run hermes auth)",
    "Hermes ≥64K bağlam ister; bu model için num_ctx ayarlı değil":
        "Hermes needs ≥64K context; num_ctx is not set for this model",
    "'{}' Hermes profili bulunamadı; skill atanamaz": "Hermes profile '{}' not found; skills cannot be assigned",
    "'{}' skill'i '{}' profilinde kurulu değil": "Skill '{}' is not installed in profile '{}'",
    "'{}' skill'i atanamaz: {}": "Skill '{}' cannot be assigned: {}",
    "Bu araç setleri '{}' profilinde kapalı (agent.disabled_toolsets) ve -t ile açılamaz: {}":
        "These toolsets are disabled in profile '{}' (agent.disabled_toolsets) and cannot be enabled with -t: {}",
    # ---------------------------------------------------------------- değişiklik servisi (changes.py)
    "Dosya yazılamadı (başka bir süreç kullanıyor olabilir): {}":
        "File could not be written (another process may be using it): {}",
    "Uygulamak için açık onay (confirm: true) gerekli": "Explicit confirmation (confirm: true) is required to apply",
    "Plan bulunamadı veya süresi doldu; önizlemeyi yenile": "Plan not found or expired; refresh the preview",
    "Dosya önizlemeden sonra değişti; önizlemeyi yenile": "The file changed after the preview; refresh the preview",
    "Geri almak için açık onay (confirm: true) gerekli":
        "Explicit confirmation (confirm: true) is required to roll back",
    "Değişiklik kaydı yok": "No change record",
    "Dosya bu değişiklikten sonra yeniden değişmiş; elle geri al":
        "The file changed again after this change; roll back manually",
    "Geri alınamadı: {}": "Rollback failed: {}",
    "Hermes bu dosyayı şu an kullanıyor (kilitli); birkaç saniye sonra tekrar dene":
        "Hermes is using this file right now (locked); try again in a few seconds",
    "Plan yok veya süresi doldu": "No plan, or it has expired",
    # ---------------------------------------------------------------- istemciler / MCP (clients/*)
    "Proje klasörü gerekli": "Project folder is required",
    "Proje klasörü mutlak bir yol olmalı": "Project folder must be an absolute path",
    "Klasör bulunamadı: {}": "Folder not found: {}",
    "Klasör çözümlenemedi: {}": "Folder could not be resolved: {}",
    "Dosya bu arada değişti; planı yeniden oluştur": "The file changed in the meantime; rebuild the plan",
    "Bu klasör bir araç yapılandırma klasörü; bir proje klasörü seç":
        "This folder is a tool configuration folder; choose a project folder",
    ".mcp.json okunamadı: {}": ".mcp.json could not be read: {}",
    "config.toml okunamadı: {}": "config.toml could not be read: {}",
    "[mcp_servers.{}] dosyada birden fazla yerde tanımlı; elle birleştir":
        "[mcp_servers.{}] is defined in more than one place in the file; merge them manually",
    "'{}' sunucusu config.toml içinde satır içi (inline) ya da noktalı anahtarla tanımlı; [mcp_servers.{}] tablosuna "
    "çevirip yeniden dene ya da elle düzenle":
        "Server '{}' is defined inline or with dotted keys in config.toml; convert it to an [mcp_servers.{}] table "
        "and retry, or edit it manually",
    "config.toml güvenle düzenlenemedi (beklenmeyen yapı); bloğu elle ekle":
        "config.toml could not be edited safely (unexpected structure); add the block manually",
    "Üretilen blok doğrulanamadı; bloğu elle ekle": "The generated block failed validation; add it manually",
    "Var olan notify değeri korunamadı; işlem durduruldu":
        "The existing notify value could not be preserved; operation aborted",
    ".mcp.json içindeki mcpServers bir nesne olmalı": "mcpServers in .mcp.json must be an object",
    "{} geçerli TOML değil ({}); önce dosyayı düzelt": "{} is not valid TOML ({}); fix the file first",
    ".mcp.json bir JSON nesnesi olmalı": ".mcp.json must be a JSON object",
    ".mcp.json geçerli JSON değil ({}, satır {}); önce dosyayı düzelt":
        ".mcp.json is not valid JSON ({}, line {}); fix the file first",
    "Uygulama ayarlarında MCP erişimi kapalı (Claude ve Codex sayfasından açılabilir)":
        "MCP access is disabled in the studio settings (enable it on the Claude & Codex page)",
    "Bu işlem yalnızca uygulama arayüzünden, kullanıcı tarafından yapılabilir":
        "This action can only be taken by the user from the studio interface",
    "Yalnızca GET": "GET only",
    "MCP istemcilerinin onay kararı vermesi kapalı; kararı uygulama arayüzünden ver":
        "Approval decisions by MCP clients are disabled; decide from the studio interface",
    # ---------------------------------------------------------------- bağlayıcılar (connectors/*)
    "Oturum dosyası yok — terminalde `claude` açıp /login gerekebilir":
        "No session file — you may need to open `claude` in a terminal and run /login",
    "Oturum dosyası bulundu": "Session file found",
    "API anahtarıyla (ANTHROPIC_API_KEY)": "Via API key (ANTHROPIC_API_KEY)",
    "Oturum macOS anahtar zincirinde tutulur; durum ilk görevde anlaşılır":
        "The session is kept in the macOS keychain; the status becomes clear on the first task",
    "'{}' profilinde kullanılabilir API_SERVER_KEY yok": "No usable API_SERVER_KEY in profile '{}'",
    "Geçersiz onay seçimi: {}": "Invalid approval choice: {}",
    "Bu Hermes çalıştırması artık etkin değil": "This Hermes run is no longer active",
    "Onay iletilemedi: {}": "Approval could not be delivered: {}",
    "Onay gateway'e iletilemedi ({})": "Approval could not be delivered to the gateway ({})",
    "Bu ajan Hermes API taşımasına ayarlı ama API kullanılamıyor: {}. Bağlantılar → Hermes API sunucusu bölümünden "
    "etkinleştirip başlat ya da ajanın taşımasını 'Otomatik' veya 'CLI' yap.":
        "This agent is set to the Hermes API transport but the API is unavailable: {}. Enable and start it under "
        "Connections → Hermes API server, or set the agent's transport to 'Auto' or 'CLI'.",
    "Bağlayıcı yok: {}": "Connector not found: {}",
    # ---------------------------------------------------------------- harici kaynaklar (external/*)
    "Origin başlıklı istek reddedildi: alım yalnızca yerel araçlardan yapılır":
        "Request with an Origin header rejected: ingestion is only accepted from local tools",
    "Gövde çok büyük (en fazla 256 KB)": "Body too large (max 256 KB)",
    "Gövde bir JSON nesnesi olmalı": "Body must be a JSON object",
    "Geçersiz ya da eksik erişim anahtarı": "Invalid or missing token",
    "Erişim anahtarı tanımlı değilken yalnızca yerel (loopback) istemciler kabul edilir":
        "Without a token, only local (loopback) clients are accepted",
    "Gövde geçerli JSON değil": "Body is not valid JSON",
    "{} alımı kapalı": "{} ingestion is disabled",
    "Yalnızca http/json desteklenir (OTEL_EXPORTER_OTLP_PROTOCOL=http/json)":
        "Only http/json is supported (OTEL_EXPORTER_OTLP_PROTOCOL=http/json)",
    "Proje bulunamadı": "Project not found",
    "Oturum bulunamadı": "Session not found",
    "Değiştirilecek bilinen bir ayar yok": "No known setting to change",
    "{}.{} true/false olmalı": "{}.{} must be true/false",
    "Mevcut dosyanın kökü bir JSON nesnesi değil; elle düzelt":
        "The root of the existing file is not a JSON object; fix it manually",
    "Mevcut dosyadaki 'hooks' alanı nesne değil; elle düzelt":
        "The 'hooks' field in the existing file is not an object; fix it manually",
    "İstemci 'claude-code' ya da 'codex' olmalı": "Client must be 'claude-code' or 'codex'",
    "Kapsam 'project' ya da 'user' olmalı": "Scope must be 'project' or 'user'",
    "Proje klasörü tam yol olmalı": "Project folder must be an absolute path",
    "Proje klasörü bulunamadı": "Project folder not found",
    "Ev klasörü proje olarak seçilemez; tüm projeler için 'Kullanıcı' kapsamını kullan":
        "The home folder cannot be used as a project; use the 'User' scope for all projects",
    "Bu klasör bir araç yapılandırma klasörü; proje klasörünü seç":
        "This folder is a tool configuration folder; choose the project folder",
    "'hooks.{}' alanı liste değil; elle düzelt": "'hooks.{}' is not a list; fix it manually",
    "Mevcut dosya geçerli JSON değil ({}, satır {}); elle düzelt":
        "The existing file is not valid JSON ({}, line {}); fix it manually",
    # ---------------------------------------------------------------- oyunlaştırma (game/*)
    "Mağazada böyle bir öğe yok": "No such item in the shop",
    "Bilinmeyen sinyal": "Unknown signal",
    "Çok fazla sinyal; biraz bekle": "Too many signals; wait a moment",
    "Yalnızca devam eden görev değiştirilebilir": "Only an active quest can be swapped",
    "Şu an başka uygun görev yok": "No other suitable quest right now",
    "Görev henüz tamamlanmadı": "Quest not completed yet",
    "Bu öğe için ofis seviyesi {} gerekir": "This item requires office level {}",
    "Satın alma için açık onay gerekli (confirm: true)": "Explicit confirmation is required to buy (confirm: true)",
    "Yetersiz jeton: {} gerekli, bakiye {}": "Not enough coins: {} needed, balance {}",
    # ---------------------------------------------------------------- gateway (gateway/*)
    "Gateway'i başlatmak için açık onay (confirm: true) gerekli":
        "Explicit confirmation (confirm: true) is required to start the gateway",
    "Profil yok: {}": "Profile not found: {}",
    "hermes bulunamadı ({})": "hermes not found ({})",
    # S19: gateway durum alanları (başarılı yanıtlarda da çevrilir: gateway/manager.py gateway_info)
    "İşlem sürüyor…": "An operation is in progress…",
    "Önce API sunucusunu etkinleştir (kök .env içinde API_SERVER_KEY yok)":
        "Enable the API server first (API_SERVER_KEY is missing from the root .env)",
    "Gateway zaten çalışıyor": "The gateway is already running",
    "Gateway zaten çalışıyor (uygulama dışında başlatılmış)": "The gateway is already running (started outside the studio)",
    "Gateway başlıyor…": "The gateway is starting…",
    "Gateway {} koduyla çıktı": "The gateway exited with code {}",
    "Gateway başlatılamadı: {}": "Couldn't start the gateway: {}",
    # S19: bilgi notları (WSL, Hermes SOUL/bellek planı)
    "WSL kurulu: Linux tarafındaki ~/.hermes ayrı bir Hermes kurulumu olabilir; uygulama yalnızca Windows (native) kurulumunu kullanır.":
        "WSL is installed: ~/.hermes on the Linux side may be a separate Hermes install; the studio only uses the Windows (native) one.",
    "Değişiklik Hermes'in bir sonraki oturumunda geçerli olur.": "The change takes effect in Hermes's next session.",
    "Bellek oturum başında okunur; değişiklik yeni oturumda geçerli olur.":
        "Memory is read at the start of a session; the change takes effect in a new session.",
    # S19: model önerileri (connections/models.py recommend_models, lang="en")
    "16 GB RAM: ajan görevleri için önerilen": "16 GB RAM: recommended for agent tasks",
    "16 GB RAM: hızlı, Avrupa menşeli": "16 GB RAM: fast, made in Europe",
    "16 GB RAM: uzun bağlam, araç kullanır": "16 GB RAM: long context, uses tools",
    "32 GB RAM / 12 GB+ VRAM: daha isabetli": "32 GB RAM / 12 GB+ VRAM: more accurate",
    "32 GB RAM: akıl yürütme, araç kullanır": "32 GB RAM: reasoning, uses tools",
    "32 GB RAM: güçlü, görsel destekli": "32 GB RAM: strong, supports images",
    "8 GB RAM: dengeli, araç kullanır": "8 GB RAM: balanced, uses tools",
    "8 GB RAM: hızlı, uzun bağlam": "8 GB RAM: fast, long context",
    "Kod ağırlıklı görevler": "Code-heavy tasks",
    "Yazılım ajanı görevleri": "Software agent tasks",
    "Çok zayıf makineler; hızlı, basit görevler": "Very low-end machines; fast, simple tasks",
    "Ollama kütüphanesi (ollama.com/library) — boyut ve bağlam yaklaşık; lisans model kartından":
        "Ollama library (ollama.com/library) — size and context are approximate; license from the model card",
    "Donanım bilinmiyor: küçük bir modelle başla.": "Hardware unknown: start with a small model.",
    "Yaklaşık {} GB sınıfı: {} önerilir.": "About the {} GB class: {} is recommended.",
    "GPU bilgisi alınamadı (yalnızca NVIDIA algılanır); öneriler RAM'e göre":
        "Couldn't read GPU info (only NVIDIA is detected); recommendations are based on RAM",
    "Gateway başlatılamıyor": "The gateway cannot be started",
    "Port {} başka bir süreç tarafından kullanılıyor; gateway başlatılmadı":
        "Port {} is in use by another process; the gateway was not started",
    "Bu gateway uygulama dışında başlatılmış; uygulama onu durdurmaz":
        "This gateway was started outside the studio; the studio will not stop it",
    "Uygulanacak plan yok": "No plan to apply",
    "Bu planlar gateway önizlemesinden gelmiyor veya süresi doldu; önizlemeyi yenile":
        "These plans are not from the gateway preview or have expired; refresh the preview",
    # ---------------------------------------------------------------- hedefler (goals/*)
    "Bilinmeyen öncelik: {} (düşük, orta, yüksek, kritik)":
        "Unknown priority: {} (expected one of: düşük, orta, yüksek, kritik)",
    "Geçersiz tarih: {} (ör. 2026-12-31 ya da 31.12.2026)": "Invalid date: {} (e.g. 2026-12-31 or 31.12.2026)",
    "Metinde hedef bulunamadı": "No goals found in the text",
    "Metin çok uzun (en fazla {} karakter)": "Text is too long (max {} characters)",
    "Hedef başlığı boş": "Goal title is empty",
    "Başlık {} karakteri aşıyor": "Title exceeds {} characters",
    "Tek seferde en fazla {} hedef eklenebilir": "At most {} goals can be added at once",
    "Anahtar sonucun üstünde bir hedef yok": "A key result must come after a goal",
    "Anahtar sonuç metni boş": "Key result text is empty",
    "Bilinmeyen ajan: @{}": "Unknown agent: @{}",
    "Bir hedefte en fazla {} anahtar sonuç olabilir": "A goal can have at most {} key results",
    "Bilinmeyen ekip: #{}": "Unknown team: #{}",
    "Anahtar sonuç {} karakteri aşıyor": "Key result exceeds {} characters",
    "Anahtar sonucun hedef değeri sıfırdan büyük olmalı": "Key result target must be greater than zero",
    "{} boş olamaz": "{} cannot be empty",
    "{} bir sayı olmalı": "{} must be a number",
    "Hedef yok: {}": "Goal not found: {}",
    "Geçersiz düzey: {} (company, team, agent)": "Invalid level: {} (company, team, agent)",
    "key_results bir liste olmalı": "key_results must be a list",
    "Anahtar sonuç kimlikleri tekil olmalı": "Key result ids must be unique",
    "Gövde bir nesne olmalı": "Body must be an object",
    "Ajan düzeyindeki hedefin bir sahip ajanı olmalı": "An agent-level goal needs an owner agent",
    "Ekip düzeyindeki hedefin bir sahip ekibi olmalı": "A team-level goal needs an owner team",
    "options bir nesne olmalı": "options must be an object",
    "Güncellenecek alan yok": "Nothing to update",
    "Anahtar sonuç yok: {}": "Key result not found: {}",
    "Güncellenecek alan yok (current, done, title, target, unit)":
        "Nothing to update (current, done, title, target, unit)",
    "İptal edilmiş hedef başlatılamaz; önce durumunu değiştir":
        "A cancelled goal cannot be started; change its status first",
    "Bu hedef için kök ajan yok: hedefe lideri olan bir ekip ya da bir sahip ajan ata veya başlatırken kök ajanı seç":
        "No root agent for this goal: assign a team with a lead or an owner agent, or pick the root agent when starting",
    "Kök ajan bulunamadı: {}": "Root agent not found: {}",
    "Devretme motoru hazır değil": "The delegation engine is not ready",
    "{}. anahtar sonuç metin ya da nesne olmalı": "Key result {} must be text or an object",
    "{}. anahtar sonucun başlığı boş": "Key result {} has an empty title",
    "{}. anahtar sonuç {} karakteri aşıyor": "Key result {} exceeds {} characters",
    "{}. anahtar sonucun hedef değeri sıfırdan büyük olmalı": "Key result {} needs a target greater than zero",
    "{}. anahtar sonucun done alanı true/false olmalı": "Key result {}: done must be true/false",
    "Hedef başlığı boş olamaz": "Goal title cannot be empty",
    "Hedef başlığı {} karakteri aşıyor": "Goal title exceeds {} characters",
    "Açıklama {} karakteri aşıyor": "Description exceeds {} characters",
    "Geçersiz durum: {} ({})": "Invalid status: {} ({})",
    "Üst hedef bulunamadı: {}": "Parent goal not found: {}",
    "İlerleme 0 ile 1 arasında olmalı": "Progress must be between 0 and 1",
    "{} ({}) bir tam sayı olmalı": "{} ({}) must be an integer",
    "{} ({}) {}–{} arasında olmalı": "{} ({}) must be between {} and {}",
    "allow_hiring true ya da false olmalı": "allow_hiring must be true or false",
    "hiring_approval 'ask' (onayımla) ya da 'auto' (otomatik) olmalı":
        "hiring_approval must be 'ask' (with your approval) or 'auto'",
    "Hedef metin ya da nesne olmalı": "A goal must be text or an object",
    "children bir liste olmalı": "children must be a list",
    "Toplu ekleme için 'text' (çok satırlı metin) ya da 'items' (liste) gerekli":
        "Bulk add needs 'text' (multi-line text) or 'items' (a list)",
    "Hedef kendisinin ya da alt hedefinin altına taşınamaz":
        "A goal cannot be moved under itself or one of its sub-goals",
    "Bu hedefin ilerlemesi anahtar sonuçlardan ya da alt hedeflerden hesaplanıyor":
        "This goal's progress is computed from its key results or sub-goals",
    "Sahip {} bulunamadı: {}": "Owner {} not found: {}",
    # ---------------------------------------------------------------- graf (graph/*)
    "Yalnızca Bilgi (Fact) düğümleri sabitlenebilir veya geçersiz kılınabilir":
        "Only Fact nodes can be pinned or invalidated",
    "Düğüm yok: {}": "Node not found: {}",
    "Geçersiz özellik adı": "Invalid property name",
    # ---------------------------------------------------------------- Hermes (hermes/*)
    "Hermes profili bulunamadı: {}": "Hermes profile not found: {}",
    "Hermes profili bulunamadı: {}{}": "Hermes profile not found: {}{}",
    "Hermes profili bulunamadı; Hermes çalışma zamanı kullanılamaz":
        "No Hermes profile found; the Hermes runtime is unavailable",
    "content (metin) gerekli": "content (text) is required",
    "Dosya dışarıda değişti; yeniden yükleyip tekrar dene": "The file changed externally; reload and try again",
    "which: 'memory' veya 'user' olmalı": "which must be 'memory' or 'user'",
    "Karakter sınırı aşıldı: {}/{}. Hermes bu dosyayı sınırı aşınca kabul etmez; bazı girdileri kısalt.":
        "Character limit exceeded: {}/{}. Hermes rejects this file when it is over the limit; shorten some entries.",
    "Profil oluşturmak için açık onay (confirm: true) gerekli":
        "Explicit confirmation (confirm: true) is required to create a profile",
    "Profil adı küçük harf, rakam, '-' veya '_' içermeli, harf/rakamla başlamalı (en fazla 64 karakter); "
    "'default' kullanılamaz":
        "Profile name may contain lowercase letters, digits, '-' or '_' and must start with a letter or digit "
        "(max 64 characters); 'default' is not allowed",
    "'{}' adında bir profil zaten var": "A profile named '{}' already exists",
    "hermes.exe bulunamadı ({})": "hermes.exe not found ({})",
    "hermes profile create başarısız: {}": "hermes profile create failed: {}",
    "entries (liste) ya da content (metin) gerekli": "entries (list) or content (text) is required",
    "Skill bulunamadı: {} (profil: {})": "Skill not found: {} (profile: {})",
    # ---------------------------------------------------------------- ofis (office/*)
    "Şablon yok: {}": "Template not found: {}",
    "{}: iş akışı tanımı yok": "{}: no workflow definition",
    "Rol yok: {}": "Role not found: {}",
    "Ekip yok: {}": "Team not found: {}",
    "Lider olarak seçilen ajan yok: {}": "The agent chosen as lead does not exist: {}",
    "Yalnızca devretme sırasında işe alınan ajanlar işten çıkarılabilir; diğer ajanları ajan ayarlarından "
    "kaldırabilirsin":
        "Only agents hired during delegation can be let go; remove other agents from the agent settings",
    "Kip 'hide' ya da 'delete' olmalı": "Mode must be 'hide' or 'delete'",
    "Strateji economy (Tasarruf), balanced (Dengeli) ya da quality (Kalite) olmalı":
        "Strategy must be economy, balanced or quality",
    "Rol adı boş olamaz": "Role name cannot be empty",
    "Rütbe şunlardan biri olmalı: {}": "Rank must be one of: {}",
    "skills_hint bir liste olmalı": "skills_hint must be a list",
    "Beyin ağırlığı light, standard ya da heavy olmalı": "Brain weight must be light, standard or heavy",
    "Ekip adı boş olamaz": "Team name cannot be empty",
    "Renk #RRGGBB biçiminde olmalı": "Color must be in #RRGGBB format",
    "Beyin şunlardan biri olmalı: {}": "Brain must be one of: {}",
    "Çalışma zamanı 'hermes' ya da 'direct' olmalı": "Runtime must be 'hermes' or 'direct'",
    "Ajan slug'ı çakıştı: {}": "Agent slug collision: {}",
    "İş akışı doğrulanamadı: {}": "Workflow validation failed: {}",
    "Sıra bir tam sayı olmalı": "Order must be an integer",
    "Bir ajan kendisine raporlayamaz": "An agent cannot report to itself",
    "Yönetici olarak seçilen ajan yok: {}": "The agent chosen as manager does not exist: {}",
    "Bu atama raporlama hattında döngü oluşturur": "This assignment would create a cycle in the reporting line",
    # ---------------------------------------------------------------- ontoloji (ontology.py)
    "{}: anahtar ({}) boş": "{}: key ({}) is empty",
    "{} ilişkisi {} → {} için geçersiz (izinli: {} → {})": "Relationship {} is invalid for {} → {} (allowed: {} → {})",
    "{}: anahtar özellik tanımsız: {}": "{}: key property is undefined: {}",
    "Ontolojide olmayan varlık türü: {}": "Entity type not in the ontology: {}",
    "Ontolojide olmayan ilişki: {}": "Relationship not in the ontology: {}",
    "{}.{} ontolojide tanımlı değil": "{}.{} is not defined in the ontology",
    "{}.{} sayı olmalı": "{}.{} must be a number",
    "{}.{} türü {} olmalı (gelen: {})": "{}.{} must be of type {} (got: {})",
    "{}.{} şu değerlerden biri olmalı: {}": "{}.{} must be one of: {}",
    "{}: bilinmeyen tür {}": "{}: unknown type {}",
    "{}.{} zorunlu": "{}.{} is required",
    # ---------------------------------------------------------------- güvenlik (security.py)
    "Geçersiz Host başlığı: {} yalnızca yerel adresten kullanılabilir":
        "Invalid Host header: {} can only be used from a local address",
    "Başka bir siteden gelen istek reddedildi": "Cross-site request rejected",
    "İstek gövdesi çok büyük (sınır {} KB)": "Request body too large (limit {} KB)",
    "Geçersiz Content-Length başlığı": "Invalid Content-Length header",
    # ---------------------------------------------------------------- iş akışı motoru ve şema (workflow/*)
    "Eksik girdi: {}": "Missing input: {}",
    "Hedef metni boş": "Goal text is empty",
    "Çalıştırma veya adım bulunamadı": "Run or step not found",
    "Bu adım onay beklemiyor": "This step is not awaiting approval",
    "Koşu duraklatılmış; karar vermek için önce koşuyu sürdür": "The run is paused; resume it before deciding",
    "Bekleyen araç onayı bulunamadı (yanıtlanmış veya süresi dolmuş olabilir)":
        "Pending tool approval not found (it may have been answered or expired)",
    "Bu onay zaten yanıtlandı": "This approval was already answered",
    "Geçersiz seçim: {} (izinli: {})": "Invalid choice: {} (allowed: {})",
    "Çalışan bir çalıştırma bulunamadı": "No running run found",
    # Faz 6 (S23): dayanıklı koşu, adım politikası, bütçe
    "Koşunun kontrol noktası yok; devam edilemez": "This run has no checkpoint; it cannot be resumed",
    "Koşu duraklatılmış ya da kesilmiş değil; devam ettirilemez": "The run is not paused or interrupted; it cannot be resumed",
    "Koşu zaten çalışıyor": "The run is already running",
    "Bütçe hâlâ aşılmış; devam etmeden önce bütçeyi yükselt": "The budget is still exceeded; raise it before resuming",
    "Koşu çalışırken adım yeniden denenemez; önce duraklat": "A step cannot be retried while the run is running; pause it first",
    # G1-B koşu bütünlüğü: iptal çiti ve gönderim idempotency'si
    "Üst koşu iptal edildi; sistem koşusu açılmaz": "The parent run was cancelled; no system run is started",
    "İptal edildi (sonuç iptal isteğinden sonra geldi)": "Cancelled (the result arrived after the cancel request)",
    "Geçersiz istek anahtarı (8-200 karakter; harf, rakam, . _ : -)":
        "Invalid request key (8-200 characters; letters, digits, . _ : -)",
    "Bu istek anahtarı farklı bir istekle zaten kullanıldı": "This request key was already used with a different request",
    "Çatallamak için from_step ya da edits gerekli": "Forking needs from_step or edits",
    "edits bir sözlük olmalı": "edits must be an object",
    "Bütçe bir sözlük olmalı": "The budget must be an object",
    "Bütçe alanı sayı olmalı: {}": "Budget field must be a number: {}",
    "Bütçe alanı negatif olamaz: {}": "Budget field cannot be negative: {}",
    "Bütçe aşım davranışı pause, stop ya da ask olmalı: {}": "Budget overrun behaviour must be pause, stop or ask: {}",
    "{}: Bütçe alanı negatif olamaz: {}": "{}: Budget field cannot be negative: {}",
    "{}: Bütçe alanı sayı olmalı: {}": "{}: Budget field must be a number: {}",
    "{}: policy bir sözlük olmalı": "{}: policy must be an object",
    "{}: policy.retries 0–5 arası tam sayı olmalı": "{}: policy.retries must be a whole number from 0 to 5",
    "{}: policy.backoff exp ya da fixed olmalı": "{}: policy.backoff must be exp or fixed",
    "{}: policy.base_s sayı olmalı": "{}: policy.base_s must be a number",
    "{}: policy.base_s 0–300 sn arası olmalı": "{}: policy.base_s must be between 0 and 300 s",
    "{}: policy.timeout_min pozitif sayı olmalı": "{}: policy.timeout_min must be a positive number",
    "{}: policy.on_fail fail, skip, continue ya da ask olmalı": "{}: policy.on_fail must be fail, skip, continue or ask",
    "{}: {} bir sözlük olmalı": "{}: {} must be an object",
    "defaults bir sözlük olmalı": "defaults must be an object",
    "Bütçe aşıldı: {} {} {} / {}": "Budget exceeded: {} {} {} / {}",
    "Bütçe aşıldı ({}); kullanıcı durdurdu": "Budget exceeded ({}); stopped by the user",
    "Kullanıcı belirsiz etkiyi onaylamadı": "The user did not confirm the uncertain effect",
    "Zaman aşımı ({} sn): adım politikası gereği kesildi": "Timed out ({} s): stopped by the step policy",
    "Bağlayıcı boş çıktı döndürdü": "The connector returned empty output",
    "Adım başarısız oldu ve politika gereği atlandı: {}": "The step failed and was skipped by policy: {}",
    "Adım hatayla bitti ama politika gereği devam edildi: {}": "The step ended with an error but the run continued by policy: {}",
    "Kullanıcı adımı atladı: {}": "The user skipped the step: {}",
    "Çıktı kullanıcı tarafından düzenlendi (çatal)": "Output edited by the user (fork)",
    "Bütçe kararı": "Budget decision",
    "Sürüm değişikliği onayı": "Version change approval",
    "Koşu başladıktan sonra değişenler: {}. Bu değişikliklerle devam edilsin mi?":
        "Changed since the run started: {}. Continue with these changes?",
    "Sürüm değişikliği onayı yalnızca uygulama arayüzünden, kullanıcı tarafından verilebilir":
        "Only the user can approve a version change, from the studio interface",
    "Hata kararı · {}": "Failure decision · {}",
    "Belirsiz etki · {}": "Uncertain effect · {}",
    "'{}' adımı {}. denemede başarısız oldu: {} — bekle (yeniden dene) / başka beyinle dene / atla?":
        "Step '{}' failed on attempt {}: {} — wait (retry) / try another brain / skip?",
    "{} bağlantısı art arda başarısız oldu; '{}' adımı {}. denemede başarısız oldu: {} — bekle (yeniden dene) / "
    "başka beyinle dene / atla?":
        "The {} connection failed repeatedly; step '{}' failed on attempt {}: {} — wait (retry) / try another brain / skip?",
    "Not: boş ya da 'retry' = yeniden dene · 'skip' = atla · 'route:<bağlantı>[:<model>]' = başka beyinle dene":
        "Note: empty or 'retry' = retry · 'skip' = skip · 'route:<connection>[:<model>]' = try another brain",
    "'{}' adımı yarıda kesildi; {} eylemin etkisi belirsiz ({}). Etkisi belirsiz — yine de devam edilsin mi?":
        "Step '{}' was interrupted; the effect of {} action(s) is uncertain ({}). Continue anyway?",
    "Bütçe doldu ({} · {}: {} / {}). Yeni sınır {} ile devam et / durdur?":
        "Budget used up ({} · {}: {} / {}). Continue with a new limit of {} / stop?",
    # karar 13: günlük toplam bütçe tavanı
    "Günlük bütçe doldu": "Daily budget reached",
    "Günlük bütçe doldu ({}: {} / {}). Bugün için yükselt / durdur?":
        "Daily budget reached ({}: {} / {}). Raise it for today / stop?",
    "Günlük bütçe doldu; kullanıcı koşuyu durdurdu ({})": "Daily budget reached; the user stopped the run ({})",
    "Bu adım daha önce yarıda kaldı. Aşağıdaki eylemler ZATEN UYGULANDI; bunları tekrarlama, kaldığın yerden sürdür:\n{}":
        "This step was interrupted earlier. The actions below were ALREADY APPLIED; do not repeat them, continue "
        "from where you left off:\n{}",
    "geçici hata": "transient error",
    "{} (çatal)": "{} (fork)",
    "araç: {}": "tool: {}",
    "dosya: {}": "file: {}",
    "çalışma klasöründe yazma ({})": "writing in the workspace ({})",
    "{} dosya değişti": "{} file(s) changed",
    "dosya değişmedi": "no files changed",
    "{}: '{}' rolünde ajan yok": "{}: no agent holds the role '{}'",
    "'{}' rolünde ajan yok": "No agent holds the role '{}'",
    "{}: ajan yok: {}": "{}: agent not found: {}",
    "Aşamanın adı (name) olmalı": "A stage must have a name",
    "Örnek iş akışları silinemez; kopyasını oluşturup düzenleyebilirsin":
        "Example workflows cannot be deleted; make a copy and edit that instead",
    # ---------------------------------------------------------------- Faz 5 modülleri (S14 skills, S17 boost, S18 market)
    # Bu modüller paralel yazılıyor; iletileri değişirse `_extract --missing` ile buradaki satırlar güncellenir.
    "Dosya işlemi başarısız: {}": "File operation failed: {}",
    "mode: {} olmalı": "mode must be {}",
    "agents (slug listesi) gerekli": "agents (list of slugs) is required",
    "skills (kimlik listesi) gerekli": "skills (list of ids) is required",
    "kind: paste ya da folder olmalı (zip için /api/skills/import/zip)":
        "kind must be paste or folder (use /api/skills/import/zip for zip files)",
    "Skill kimliği küçük harf, rakam, '-' veya '_' içermeli, harf/rakamla başlamalı (en çok 64)":
        "Skill id may contain lowercase letters, digits, '-' or '_' and must start with a letter or digit (max 64)",
    "Skill bulunamadı: {}": "Skill not found: {}",
    "Geçersiz skill dizini": "Invalid skill directory",
    "Bu kaynak salt okunur; yalnızca VoxCrew skill'leri düzenlenebilir. Önce 'VoxCrew'a kopyala' ile kopya oluştur.":
        "This source is read-only; only VoxCrew skills can be edited. Make a copy with 'Copy to VoxCrew' first.",
    "'{}' kimliğiyle bir VoxCrew skill'i zaten var": "A VoxCrew skill with id '{}' already exists",
    "SKILL.md çok uzun": "SKILL.md is too long",
    "Bilinmeyen izin: {}. Geçerli değerler: {}": "Unknown permission: {}. Valid values: {}",
    "SKILL.md içeriği boş": "SKILL.md is empty",
    "Klasörde SKILL.md yok": "No SKILL.md in the folder",
    "Klasör bulunamadı": "Folder not found",
    "Kütüphanenin kendi klasörü içe aktarılamaz": "The library's own folder cannot be imported",
    "Zip dosyası boş": "The zip file is empty",
    "Zip çok büyük (sınır {} MB)": "Zip is too large (limit {} MB)",
    "Bu skill zaten VoxCrew kaynağında": "This skill is already in the VoxCrew source",
    "Kaynak SKILL.md okunamadı": "The source SKILL.md could not be read",
    "Bilinmeyen kaynak: {}. Geçerli değerler: {}": "Unknown source: {}. Valid values: {}",
    "Geçerli bir zip dosyası değil": "Not a valid zip file",
    "Zip içinde SKILL.md yok (kökte ya da tek bir üst klasörde olmalı)":
        "No SKILL.md in the zip (it must be at the root or in a single top-level folder)",
    "Sembolik bağ kabul edilmez: {}": "Symbolic links are not accepted: {}",
    "Geçersiz dosya yolu: {}": "Invalid file path: {}",
    "Çalıştırılabilir ikili dosya kabul edilmez: {}": "Executable binaries are not accepted: {}",
    "Dosya çok büyük: {}": "File too large: {}",
    "Skill klasörü çok büyük (boyut ya da dosya sayısı sınırı)": "Skill folder too large (size or file count limit)",
    "Zip içinde güvensiz yol: {}": "Unsafe path inside the zip: {}",
    "Zip içinde sembolik bağ kabul edilmez: {}": "Symbolic links inside the zip are not accepted: {}",
    "Zip çok büyük (açılmış boyut ya da dosya sayısı sınırı)": "Zip too large (extracted size or file count limit)",
    "Zip açılınca sınırı aştı": "The zip exceeded the limit when extracted",
    "Geçersiz aralık: today | 7d | 30d | all": "Invalid range: today | 7d | 30d | all",
    "Bilinmeyen booster ayarı: {}.{}": "Unknown booster setting: {}.{}",
    "{}.{} en az {} olmalı": "{}.{} must be at least {}",
    "{}.{} en çok {} olmalı": "{}.{} must be at most {}",
    "Booster yok: {}": "Booster not found: {}",
    "Bilinmeyen profil: {}": "Unknown profile: {}",
    "Paket yok": "Pack not found",
    "Dosya pakette listelenmemiş": "The file is not listed in the pack",
    "Dosya çok büyük": "File too large",
    "Bilinmeyen paket türü": "Unknown pack type",
    "Sıralama popular, new ya da name olmalı": "Sort must be popular, new or name",
    "Çok fazla yönlendirme": "Too many redirects",
    "Katalog adresi çok uzun": "Catalog URL is too long",
    "Katalog adresi https:// ya da file:// ile başlamalı": "Catalog URL must start with https:// or file://",
    "Katalog adresi geçersiz (kimlik bilgisi içeremez)": "Catalog URL is invalid (it cannot contain credentials)",
    "file:// adresi yalnızca bu bilgisayardaki bir dosyayı gösterebilir":
        "A file:// URL can only point to a file on this computer",
    "{}: klasör adı paket kimliğiyle aynı olmalı ({})": "{}: the folder name must match the pack id ({})",
    "Katalog {name, packs: []} biçiminde olmalı": "Catalog must have the shape {name, packs: []}",
    "Katalog en fazla {} paket içerebilir": "A catalog may contain at most {} packs",
    "Katalog kaynağı yok": "Catalog source not found",
    "Katalog dosyası bulunamadı": "Catalog file not found",
    "İçerik boyut sınırını aşıyor ({} KB)": "Content exceeds the size limit ({} KB)",
    "Katalog indirilemedi: {}": "Catalog could not be downloaded: {}",
    "Katalog indirilemedi (HTTP {})": "Catalog could not be downloaded (HTTP {})",
    "Yönlendirme https dışına çıkıyor": "Redirect leaves https",
    "Güvensiz dosya yolu: {}": "Unsafe file path: {}",
    "Paket dosyası eksik: {}": "Pack file missing: {}",
    "Paket dosyası çok büyük: {}": "Pack file too large: {}",
    "Paket arşivi çok büyük (sınır {} KB)": "Pack archive too large (limit {} KB)",
    "Paket arşivinde tam bir voxcrew-pack.json olmalı": "The pack archive must contain exactly one voxcrew-pack.json",
    "Manifest arşiv kökünde ya da tek bir üst klasörde olmalı":
        "The manifest must be at the archive root or in a single top-level folder",
    "Katalog geçerli bir JSON değil": "Catalog is not valid JSON",
    "Bu katalog zaten ekli": "This catalog is already added",
    "En fazla {} katalog kaynağı eklenebilir": "At most {} catalog sources can be added",
    "Paket arşivi bozuk (zip değil)": "Pack archive is corrupt (not a zip)",
    "Paket arşivinde sembolik bağ var: {}": "The pack archive contains a symbolic link: {}",
    "Paket çok büyük (sınır {} KB)": "Pack too large (limit {} KB)",
    "Paket içeriğine erişilemiyor": "Pack contents are not accessible",
    "{}: arşiv boyut sınırını aşıyor": "{}: archive exceeds the size limit",
    "{}: archive_sha256 gerekli": "{}: archive_sha256 is required",
    "Bütünlük hatası: indirilen arşivin sha256'sı katalogla uyuşmuyor":
        "Integrity error: the downloaded archive's sha256 does not match the catalog",
    "Bu tür için hedef dizin yok: {}": "No target directory for this type: {}",
    "Kurulum için açık onay gerekli (confirm: true)": "Explicit confirmation is required to install (confirm: true)",
    "Kurulamadı: {}": "Installation failed: {}",
    "Kaldırmak için açık onay gerekli (confirm: true)": "Explicit confirmation is required to remove (confirm: true)",
    "Bu paket kurulu değil": "This pack is not installed",
    "Kurulumdan sonra değiştirilmiş dosya var: {} (yine de kaldırmak için force: true)":
        "Files were modified after installation: {} (use force: true to remove anyway)",
    "Sürüm semver biçiminde olmalı (ör. 1.2.0): {}": "Version must be semver (e.g. 1.2.0): {}",
    "Dosya yolu boş olamaz": "File path cannot be empty",
    "'{}' metin olmalı": "'{}' must be text",
    "Manifest bir JSON nesnesi olmalı": "Manifest must be a JSON object",
    "Desteklenmeyen manifest şeması: {}": "Unsupported manifest schema: {}",
    "Paket kimliği yalnızca küçük harf, rakam, - ve _ içerebilir (2–49 karakter)":
        "Pack id may only contain lowercase letters, digits, - and _ (2–49 characters)",
    "{}: paket adı boş olamaz": "{}: pack name cannot be empty",
    "{}: bilinmeyen paket türü {}": "{}: unknown pack type {}",
    "{}: lisans belirtilmeli (ör. MIT)": "{}: a license is required (e.g. MIT)",
    "{}: yazar adı gerekli": "{}: author name is required",
    "{}: etiketler metin listesi olmalı": "{}: tags must be a list of strings",
    "{}: izinler metin listesi olmalı": "{}: permissions must be a list of strings",
    "{}: bilinmeyen izin beyanı {}": "{}: unknown permission declaration {}",
    "{}: files bir liste olmalı": "{}: files must be a list",
    "{}: paket en fazla {} dosya içerebilir": "{}: a pack may contain at most {} files",
    "{}: her dosya {path, sha256} nesnesi olmalı": "{}: every file must be a {{path, sha256}} object",
    "{}: manifest kendi dosya listesinde olamaz": "{}: the manifest cannot be in its own file list",
    "{}: dosya iki kez listelenmiş: {}": "{}: file listed twice: {}",
    "{}: {} için geçerli sha256 gerekli": "{}: a valid sha256 is required for {}",
    "{}: {} boyutu geçersiz ya da sınırı aşıyor ({} KB)": "{}: size of {} is invalid or exceeds the limit ({} KB)",
    "{}: {} paketi {} dosyasını içermeli": "{}: a {} pack must include the file {}",
    "{}: items metin listesi olmalı": "{}: items must be a list of strings",
    "{}: {} paketi en az bir mağaza öğesi listelemeli": "{}: a {} pack must list at least one shop item",
    "{}: geçersiz mağaza öğesi kimliği {}": "{}: invalid shop item id {}",
    "{}: {} paketi dosya içeremez (yalnızca mağaza kilidi)": "{}: a {} pack cannot contain files (shop unlock only)",
    "{}: bundle en az bir paket listelemeli": "{}: a bundle must list at least one pack",
    "{}: bundle içinde geçersiz paket kimliği {}": "{}: invalid pack id in bundle {}",
    "{}: bundle kendini içeremez": "{}: a bundle cannot contain itself",
    "{}: price yalnızca coins (ve gelecek için reserved) alanı alabilir":
        "{}: price may only have coins (and reserved, for the future)",
    "{}: price.coins negatif olmayan tam sayı olmalı": "{}: price.coins must be a non-negative integer",
    "{}: price 'free' ya da {coins: n} olmalı (ücretli içerik bu fazda yok)":
        "{}: price must be 'free' or {{coins: n}} (no paid content in this phase)",
    "{}: yalnızca kozmetik ve sahne paketleri jetonla satılır": "{}: only cosmetic and scene packs are sold for coins",
    "{}: requires bir nesne olmalı": "{}: requires must be an object",
    "{}: changelog bir liste olmalı": "{}: changelog must be a list",
    "{}: signature bir nesne olmalı": "{}: signature must be an object",
    # ---------------------------------------------------------------- harici izleme durumu ve kurulum notları (S9)
    "{} alımı kapalı; olaylar yok sayılıyor.": "{} ingestion is disabled; events are ignored.",
    "{} oturumları dosyalarda görünüyor ama hook olayı gelmiyor: eklenti/hook kurulu değil ya da hook'lar kapalı "
    "olabilir (disableAllHooks, --bare).":
        "{} sessions appear in the files but no hook events arrive: the plugin/hook may not be installed or hooks "
        "may be disabled (disableAllHooks, --bare).",
    "Henüz Claude Code hook olayı gelmedi. Eklentiyi kur ve Claude Code'u yeniden başlat; hook'lar kapalı olabilir "
    "(disableAllHooks, --bare).":
        "No Claude Code hook event yet. Install the plugin and restart Claude Code; hooks may be disabled "
        "(disableAllHooks, --bare).",
    "Henüz Codex olayı gelmedi. config.toml'a notify satırını ya da hooks.json'a hook'ları ekle.":
        "No Codex event yet. Add the notify line to config.toml or the hooks to hooks.json.",
    "Son 30 dakikada {} hook olayı gelmedi; oturumlar kapanmış ya da hook'lar kapalı olabilir.":
        "No {} hook event in the last 30 minutes; sessions may have ended or hooks may be disabled.",
    "Uygulama farklı bir portta çalışıyorsa STUDIO_URL ortam değişkenini ayarla.":
        "If the studio runs on a different port, set the STUDIO_URL environment variable.",
    "notify yalnızca kullanıcı düzeyindeki ~/.codex/config.toml dosyasında çalışır; var olan bir notify satırını ezme.":
        "notify only works in the user-level ~/.codex/config.toml; do not overwrite an existing notify line.",
    # ---------------------------------------------------------------- bağlantılar (S23) ve bütçe/politika (S29)
    "Bu işlem için açık onay (confirm: true) gerekli": "Explicit confirmation (confirm: true) is required for this action",
    "path gerekli": "path is required",
    "İş bulunamadı": "Job not found",
    "Test edilebilir bağlantılar: {}": "Testable connections: {}",
    "'{}' bağlayıcısı kayıtlı değil": "Connector '{}' is not registered",
    "Ollama'da kurulu yerel model yok; önce bir model indir": "No local model is installed in Ollama; pull a model first",
    "Böyle bir Hermes profili yok: {}": "No such Hermes profile: {}",
    "Geçersiz model adı": "Invalid model name",
    "num_ctx 2K–1M arasında olmalı": "num_ctx must be between 2K and 1M",
    "Ollama {}: {}": "Ollama {}: {}",
    "Giriş yalnızca codex ve claude için": "Sign-in is only for codex and claude",
    "Bu klasör bir Hermes veri kökü gibi görünmüyor (config.yaml / profiles / bin yok)":
        "This folder does not look like a Hermes data root (no config.yaml / profiles / bin)",
    "HERMES_HOME ortam değişkeni ayarlı; uygulama ayarı onu geçersiz kılamaz":
        "The HERMES_HOME environment variable is set; the studio setting cannot override it",
    "base_url http:// ya da https:// ile başlamalı": "base_url must start with http:// or https://",
    "codex CLI bulunamadı": "codex CLI not found",
    "claude CLI bulunamadı": "claude CLI not found",
    "Terminal uygulaması bulunamadı; komutu kendin çalıştır": "No terminal application found; run the command yourself",
    "Ollama zaten çalışıyor": "Ollama is already running",
    "ollama çalıştırıcısı bulunamadı; ollama.com'dan kur": "ollama executable not found; install it from ollama.com",
    "Uygulamanın başlattığı bir Ollama süreci yok (dışarıda başlatılmışsa oradan kapat)":
        "No Ollama process was started by the studio (if it was started elsewhere, stop it there)",
    "Yerleşik adım türü geçersiz kılınamaz: {}": "Built-in step type cannot be overridden: {}",
    "{}policy bir sözlük olmalı": "{}policy must be a mapping",
    "{}policy.retries 0–{} arası tam sayı olmalı": "{}policy.retries must be an integer between 0 and {}",
    "{}policy.backoff exp ya da fixed olmalı": "{}policy.backoff must be exp or fixed",
    "{}policy.base_s sayı olmalı": "{}policy.base_s must be a number",
    "{}policy.base_s 0–{} sn arası olmalı": "{}policy.base_s must be between 0 and {} s",
    "{}policy.timeout_min pozitif sayı olmalı": "{}policy.timeout_min must be a positive number",
    "{}policy.on_fail fail, skip, continue ya da ask olmalı": "{}policy.on_fail must be fail, skip, continue or ask",
    # ---------------------------------------------------------------- dünya yapıcı (S30, studio/worlds)
    "Dünya yok": "World not found",
    "Dünya dosyası okunamadı": "The world file could not be read",
    "Dünya dosyası çok büyük": "The world file is too large",
    "Dünya geçersiz; işaretli karoları düzelt": "The world is invalid; fix the highlighted tiles",
    "Yerleşik dünyalar salt okunur; düzenlemek için kopyasını oluştur": "Built-in worlds are read-only; make a copy to edit",
    # (squad B): kilitli sahne kopyası ve kilitli dekor
    "Bu dünya kilitli bir sahnenin kopyası; önce sahneyi Başarılar → Mağaza'dan aç":
        "This world is a copy of a locked scene; unlock the scene first in Achievements → Shop",
    "Kilitli dekor yerleştirilemez: {} (ofis seviyesi {} gerekir)":
        "Locked decor cannot be placed: {} (requires office level {})",
    # (squad B): kozmetik hediye
    "Bu kozmetik için ofis seviyesi {} gerekir": "This cosmetic requires office level {}",
    "Bu ajan bu kozmetiği zaten giyiyor": "This agent is already wearing this cosmetic",
    "En fazla {} dünya kaydedilebilir": "You can save at most {} worlds",
    "Dosya bozuk ya da değiştirilmiş: sha256 özeti uyuşmuyor": "The file is corrupt or was modified: the sha256 digest does not match",
    "Dünya dosyası biçimi tanınmadı (voxcrew-world v1 bekleniyor)": "Unrecognized world file (expected voxcrew-world v1)",
    "Desteklenmeyen dünya sürümü": "Unsupported world version",
    "Geçersiz dünya kimliği": "Invalid world id",
    "Izgara 24 sütun ve 16–32 satır olmalı; büyüme kiti tanınmadı": "The grid must be 24 columns and 16–32 rows; unknown growth kit",
    "Dünya adı, açıklaması ya da lisansı geçersiz": "The world name, description or license is invalid",
    "Metin alanlarında betik ya da bağlantı kabul edilmez": "Scripts and links are not allowed in text fields",
    "Geçersiz renk ya da ortam ayarı: {}": "Invalid color or environment setting: {}",
    "Geçersiz sayı: {}": "Invalid number: {}",
    "Zemin katmanı ızgara boyutunda değil": "The ground layer does not match the grid size",
    "Prefab #{}: bilinmeyen tür": "Prefab #{}: unknown type",
    "Prefab #{} ({}): '{}' alanı geçersiz": "Prefab #{} ({}): field '{}' is invalid",
    "Karo ({}, {}): prefab #{} ızgaranın dışında": "Tile ({}, {}): prefab #{} is outside the grid",
    "Çok fazla prefab ({} > {})": "Too many prefabs ({} > {})",
    "Çok fazla blok ({} > {})": "Too many blocks ({} > {})",
    "Çok fazla ışık ({} > {})": "Too many lights ({} > {})",
    "En az bir çalışma istasyonu gerekli": "At least one work station is required",
    "Karo ({}, {}): istasyon ızgaranın dışında": "Tile ({}, {}): station is outside the grid",
    "Karo ({}, {}): istasyon yürünemeyen bir karoda": "Tile ({}, {}): station is on a blocked tile",
    "Karo ({}, {}): istasyona yürüyerek ulaşılamıyor": "Tile ({}, {}): station cannot be reached on foot",
    "En az bir dinlenme noktası gerekli": "At least one rest spot is required",
    "Karo ({}, {}): dinlenme noktası ızgaranın dışında": "Tile ({}, {}): rest spot is outside the grid",
    "Karo ({}, {}): dinlenme noktası yürünemeyen bir karoda": "Tile ({}, {}): rest spot is on a blocked tile",
    "Karo ({}, {}): dinlenme noktasına yürüyerek ulaşılamıyor": "Tile ({}, {}): rest spot cannot be reached on foot",
    "Karo ({}, {}): '{}' araç noktası ızgaranın dışında": "Tile ({}, {}): '{}' tool spot is outside the grid",
    "Karo ({}, {}): '{}' araç noktasına ulaşılamıyor": "Tile ({}, {}): '{}' tool spot cannot be reached",
    "'{}' aracı için nokta yok; ajan masasında kalır": "No spot for the '{}' tool; the agent stays at its desk",
    # ---------------------------------------------------------------- akademi
    "Ders yok: {}": "Lesson not found: {}",
    "Bilinmeyen bilgi balonu: {}": "Unknown tip: {}",
    "Bilinmeyen beyin: {}": "Unknown brain: {}",
    # ---------------------------------------------------------------- model API'leri (S37, connections/endpoints.py)
    "Model API'leri": "Model APIs",
    "API bağlantısı bulunamadı: {} (Bağlantılar → Model API'leri)": "API connection not found: {} (Connections → Model APIs)",
    "{}: API anahtarı gerekli (Bağlantılar → Model API'leri)": "{}: an API key is required (Connections → Model APIs)",
    "Böyle bir API bağlantısı yok: {}": "No such API connection: {}",
    "Adres (base URL) gerekli": "An address (base URL) is required",
    "Geçersiz adres": "Invalid address",
    "Adrese kullanıcı adı/parola yazma; anahtarı API anahtarı alanına gir":
        "Don't put a username/password in the address; enter the key in the API key field",
    "Adreste ? ya da # olmamalı": "The address must not contain ? or #",
    "{} henüz desteklenmiyor": "{} is not supported yet",
    "api openai ya da anthropic olmalı": "api must be openai or anthropic",
    "En çok {} API bağlantısı eklenebilir": "At most {} API connections can be added",
    "Sunucu zaman aşımı: {}": "Server timed out: {}",
    # model erişim politikası (S37, connections/policy.py)
    "Bu model yönetici politikasıyla kapalı: {}": "This model is blocked by the model access policy: {}",
    "Bu model yönetici politikasıyla kapalı (yalnız yerel modellere izin var): {}":
        "This model is blocked by the model access policy (only local models are allowed): {}",
    "Bu model yönetici politikasıyla kapalı (izin listesinde yok): {}":
        "This model is blocked by the model access policy (not on the allow list): {}",
    "{} çevrimiçi bir model: istemler bu bilgisayardan {} adresine gider. Önce bir kez onay ver (Bağlantılar → Model izinleri).":
        "{} is an online model: prompts leave this computer for {}. Give one-time consent first (Connections → Model access).",
    "Onay anahtarı gerekli": "A consent key is required",
    "Onay anahtarı çok uzun": "The consent key is too long",
    "Model politikası (güvenli mod) yalnız yerel modellere izin veriyor: önce Ollama ile yerel bir model kur, sonra İkili ofisi seç.": "The model policy (Safe mode) allows local models only: install a local model with Ollama first, then pick a Duo office.",
    "Koltuk açılamadı: ajanlar şu an çalışıyor. Koşu bitince yeniden dene.": "No seat could be freed: agents are running right now. Try again when the run ends.",
    "Bu ofis için listedeki ajanlar yedeğe alınacak; önce onaylaman gerekiyor.": "The listed agents will move to the bench for this office; you need to confirm first.",
    "Geçersiz mod: {}": "Invalid mode: {}",
    "Sunucu bağlantı hatası: {}": "Server connection error: {}",
    "Model seçilmedi (sunucunun /models listesinden bir model seç)": "No model chosen (pick one from the server's /models list)",
    "Adım adım akıl yürüten Mistral modeli": "Mistral model that reasons step by step",
    "Yazılım ajanı görevleri; çok uzun bağlam": "Software agent tasks; very long context",
    "Kod tamamlama (araç kullanmaz; ticari olmayan lisans)": "Code completion (no tool use; non-production license)",
    "16 GB RAM: küçük, hızlı, görsel destekli Mistral": "16 GB RAM: small, fast Mistral with vision",
    "16 GB RAM: uzun bağlamlı, çok dilli Mistral": "16 GB RAM: long-context, multilingual Mistral",
    # ---------------------------------------------------------------- S40 yönetici / test modu (studio/admin.py)
    "Yönetici / test modunda satın alma kapalı": "Purchases are disabled in admin / test mode",
    # SP-W0 pasaport damgası
    "Damgayla açılabilecek böyle bir şehir yok": "There is no such city that a stamp can unlock",
    "Damga kullanmak için açık onay gerekli (confirm: true)": "Explicit confirmation is required to use a stamp (confirm: true)",
    "Yönetici / test modunda damga kullanılamaz": "Stamps cannot be used in admin / test mode",
    "Kullanılabilir pasaport damgası yok": "No passport stamp available",
    "Bu şehir jetonla alınmaz; pasaport damgasıyla açılır": "This city cannot be bought with coins; a passport stamp opens it",
    "Şehir kimliği (scene) gerekli": "A city id (scene) is required",
    "Yönetici / test modu kapalı": "Admin / test mode is off",
    "enabled true ya da false olmalı": "enabled must be true or false",
    "Demo ajan eklemek için açık onay gerekli (confirm: true)":
        "Adding demo agents needs explicit confirmation (confirm: true)",
    "Demo ajanları silmek için açık onay gerekli (confirm=true)":
        "Removing demo agents needs explicit confirmation (confirm=true)",
    "count bir sayı olmalı": "count must be a number",
    "count 1 ile {} arasında olmalı": "count must be between 1 and {}",
}

# Sistem istemi satırları (motorun ürettiği TR satırlar → EN). Dil aşaması `LanguageStage` bunları kullanır;
# motor EN dilinde zaten bu satırları üretir, aşama başka yerde kurulmuş TR istemler için güvenlik ağıdır.
SYSTEM_LINES: dict[str, str] = {
    "Kurallar:": "Rules:",
    "- Türkçe yaz (görev başka dil istemedikçe).": "- Write in English unless the task asks otherwise.",
    "- Doğrulayamadığın bilgiyi uydurma; emin olmadığın yeri açıkça belirt.":
        "- Do not invent facts you cannot verify; say clearly where you are unsure.",
    "- Graf belleğinden gelen notlar önceki ajan çıktılarıdır, doğrulanmamış olabilir.":
        "- Notes from the graph memory are earlier agent outputs and may be unverified.",
    "- İşin bitince sonucu net bir özetle bitir.": "- When the work is done, finish with a clear summary.",
    "- Dosya sistemi üzerinde değişiklik yapma; yalnızca oku ve yanıt ver.":
        "- Do not change anything on the file system; only read and respond.",
    "Sen '{}' adlı bir ajansın. Rolün: {}.": "You are an agent named '{}'. Your role: {}.",
    "Bu görevdeki rolün: {}.": "Your role in this task: {}.",
    "Kişiliğin ve çalışma tarzın: {}": "Your personality and working style: {}",
    "Bu görevde çalışma tarzın: {}": "Your working style in this task: {}",
    "Bu görevde '{}' ({}) olarak çalışıyorsun.": "In this task you are working as '{}' ({}).",
    "Bu görevde '{}' olarak çalışıyorsun.": "In this task you are working as '{}'.",
}

# İstem bölüm başlıkları (`Section.title`)
SECTION_TITLES: dict[str, str] = {
    "GÖREV": "TASK",
    "ÖNCEKİ ADIMLARIN ÇIKTILARI": "OUTPUTS OF PREVIOUS STEPS",
    "GRAF BELLEĞİ": "GRAPH MEMORY",
    "HEDEF": "GOAL",
    "ALT GÖREV SONUÇLARI": "SUBTASK RESULTS",
    "SENTEZ": "SYNTHESIS",
}

# Faz 6 alan katalogları (her ekip kendi dosyasını doldurur; ortak dosyada eşzamanlı düzenleme olmasın diye ayrı)
from studio._edition import EDITION  # noqa: E402
from studio.locales import en_events, en_memory, en_messaging, en_schedule, en_tools  # noqa: E402


def _paid(name: str) -> tuple[Any, ...]:
    """Yalnız full sürümde var olan katalog (özgün yükleme sırası korunur); free sürümde boş."""
    if EDITION != "full":
        return ()
    from studio.full import catalogs  # noqa: PLC0415

    return (catalogs.module(name),)


for _mod in (en_messaging, en_schedule, en_tools, en_events, *_paid("evals"), en_memory):
    MESSAGES.update(_mod.MESSAGES)
    SECTION_TITLES.update(_mod.SECTION_TITLES)
del _mod

# Denetim düzeltmeleri: ayrı katalog, ortak dosyada çakışma olmasın diye
from studio.locales import en_fixes  # noqa: E402

MESSAGES.update(en_fixes.MESSAGES)
SECTION_TITLES.update(en_fixes.SECTION_TITLES)

# S44 kahramanlar: ayrı katalog (studio/heroes iletileri)
from studio.locales import en_heroes  # noqa: E402

MESSAGES.update(en_heroes.MESSAGES)

# S50 çıktılar: ayrı katalog (studio/deliverables iletileri)
from studio.locales import en_deliverables  # noqa: E402

MESSAGES.update(en_deliverables.MESSAGES)

# W1b takdir ve hediye: ayrı katalog
for _mod in _paid("recognition"):
    MESSAGES.update(_mod.MESSAGES)

# W4 yürüme ilerlemesi: ayrı katalog (studio/walk iletileri)
from studio.walk import en as en_walk  # noqa: E402

MESSAGES.update(en_walk.MESSAGES)

# E2 parseller: ayrı katalog (studio/expanse iletileri)
from studio.expanse import en as en_expanse  # noqa: E402

MESSAGES.update(en_expanse.MESSAGES)

# hak motoru: ayrı katalog (studio/entitlements iletileri)
from studio.entitlements import en as en_plan  # noqa: E402

MESSAGES.update(en_plan.MESSAGES)
for _mod in _paid("plan"):
    MESSAGES.update(_mod.MESSAGES)

# CG-QUALITY kalite kapısı: ayrı katalog (studio/quality iletileri)
from studio.locales import en_quality  # noqa: E402

MESSAGES.update(en_quality.MESSAGES)

# CG-COST maliyet ve süre öngörüsü: ayrı katalog
for _mod in _paid("estimate"):
    MESSAGES.update(_mod.MESSAGES)

# CG-DELIVER çıktı teslimi: ayrı katalog (studio/delivery iletileri)
from studio.delivery import en as en_delivery  # noqa: E402

MESSAGES.update(en_delivery.MESSAGES)

# TRUST güvenli mod ve yerel 18+ beyanı: ayrı katalog (studio/safemode.py iletileri)
from studio.locales import en_trust  # noqa: E402

MESSAGES.update(en_trust.MESSAGES)

# CG2 tetikleyiciler, MCP kataloğu ve zaman tasarrufu: ayrı katalog
from studio.locales import en_cg2  # noqa: E402

MESSAGES.update(en_cg2.MESSAGES)

# sezon ve sürpriz teslim kutusu: ayrı katalog (studio/game/en_season.py)
from studio.game import en_season  # noqa: E402

MESSAGES.update(en_season.MESSAGES)

# oyun döngüsü 2 (ilk oturum, açılım yolu, ofis sağlığı, sprint boss'u): ayrı katalog (studio/game/en_loop.py)
from studio.game import en_loop  # noqa: E402

MESSAGES.update(en_loop.MESSAGES)

# Dalga 3 hafif ekip paylaşımı (dışa/içe aktarma): ayrı katalog (studio/share/en.py)
from studio.share import en as en_share  # noqa: E402

MESSAGES.update(en_share.MESSAGES)

# Karar 1 (MCP ortam değişkeni başvuruları) ve karar 13 (günlük bütçe tavanı): ayrı katalog
from studio.locales import en_budget_env  # noqa: E402

MESSAGES.update(en_budget_env.MESSAGES)

# AUDIT 2026-10-19 P1: sistem çağrısı muhasebesi ve gizli denetçi koşusu
from studio.locales import en_core_p1  # noqa: E402

MESSAGES.update(en_core_p1.MESSAGES)

# G1-D skill sabitleme (sürüm, onay, bağlama): ayrı katalog
from studio.skills import en as en_skills_pin  # noqa: E402

MESSAGES.update(en_skills_pin.MESSAGES)

# REV-C iş geliştirme (karar defteri, zaman kaydı, birim ekonomi): ayrı katalog
for _mod in _paid("bizdev"):
    MESSAGES.update(_mod.MESSAGES)

# REV-D skill mağazası çekirdeği (imza, lisans, mağaza kurulumu, kalite kapısı): ayrı katalog
for _mod in _paid("market_store"):
    MESSAGES.update(_mod.MESSAGES)

# COS-A kozmetik mağazası (satış kapalı; bayrak arkasında): ayrı katalog (studio/cosmetics/en.py)
from studio.cosmetics import en as en_cosmetics  # noqa: E402

MESSAGES.update(en_cosmetics.MESSAGES)

# düzeltme iletileri (ayrı katalog)
from studio.locales import en_qa6  # noqa: E402

MESSAGES.update(en_qa6.MESSAGES)

# adım başı onay: ayrı katalog
from studio.locales import en_step_approval  # noqa: E402

MESSAGES.update(en_step_approval.MESSAGES)

# G2-D (R-3) haftalık "eğlenceli miydi?" sorusu: ayrı katalog (studio/game/en_g2d.py)
from studio.game import en_g2d  # noqa: E402

MESSAGES.update(en_g2d.MESSAGES)

# düzeltme iletileri (ayrı katalog)
from studio.locales import en_qa7  # noqa: E402

MESSAGES.update(en_qa7.MESSAGES)

# G4: koşu süresi ve adım bütçesi iletileri (ayrı katalog)
from studio.locales import en_g4  # noqa: E402

MESSAGES.update(en_g4.MESSAGES)

# G5: iş ailesi ve konfigürasyon matrisi iletileri (ayrı katalog)
from studio.locales import en_g5  # noqa: E402

MESSAGES.update(en_g5.MESSAGES)

# G6: oyunu doğrulanmış işe bağlama (sergi, beklenen çıktı ölçütü, bildirim sıklığı)
for _mod in _paid("worktrace"):
    MESSAGES.update(_mod.MESSAGES)

# booster kabul kapısı iletileri (ayrı katalog)
for _mod in _paid("boost_gate"):
    MESSAGES.update(_mod.MESSAGES)

# unutma başlatma kapısı ve ayrık değerlendirme mührü iletileri (ayrı katalog)
from studio.locales import en_qa11  # noqa: E402

MESSAGES.update(en_qa11.MESSAGES)
from studio.locales import en_qa12  # noqa: E402

MESSAGES.update(en_qa12.MESSAGES)

# unutma sırasında karar kapısı ve booster isteğinin bütün doğrulaması (ayrı katalog)
from studio.locales import en_qa13  # noqa: E402

MESSAGES.update(en_qa13.MESSAGES)

# ayrılmış ajan adları ve booster/ayar yazımlarında katı mantıksal değer (ayrı katalog)
from studio.locales import en_qa14  # noqa: E402

MESSAGES.update(en_qa14.MESSAGES)

# ayrılmış ajan adları — görünen ad da denetlenir, ileti yazılan değeri anar (ayrı katalog)
from studio.locales import en_qa15  # noqa: E402

MESSAGES.update(en_qa15.MESSAGES)

# Claude Code ajanının ~/.claude kurulumunu devralma ayarı (ayrı katalog)
from studio.locales import en_g3  # noqa: E402

MESSAGES.update(en_g3.MESSAGES)

# ayrılmış ajan adları (Denetçi, niteleyicili ilk sözcük), Claude devralma kaydı, skill atama MCP sınırı
from studio.locales import en_qa16  # noqa: E402

MESSAGES.update(en_qa16.MESSAGES)

# Claude yalıtımı (boş eklenti kökü, npm claude.cmd kabuğu reddi)
from studio.locales import en_qa17  # noqa: E402

MESSAGES.update(en_qa17.MESSAGES)

# PROC-FIX: bütçe kartı (çıktı korunur, yeniden çalıştırma açıkça), teslim adımı, Codex yalıtımı
from studio.locales import en_proc_fix  # noqa: E402

MESSAGES.update(en_proc_fix.MESSAGES)

# Codex başlatma ve skill bütçesi, bütçe kartı metinleri
from studio.locales import en_qa20  # noqa: E402

MESSAGES.update(en_qa20.MESSAGES)

# PROC2-FIX: adım sürerken bütçe durdurması (yarım çıktı korunur), yerel adım maliyeti, revizyon sürümü başlığı
from studio.locales import en_proc2_fix  # noqa: E402

MESSAGES.update(en_proc2_fix.MESSAGES)

# sınır gerçek harcamayı bağlar, sıradaki tur sınırı, yarım çıktı çiti, beyin başına denetim, zayıf yazar
from studio.locales import en_qa22_fix  # noqa: E402

MESSAGES.update(en_qa22_fix.MESSAGES)

# tek onay yeter, gerçek devam, kısmi çıktıyla devam, yedek tur sınırı, kullanım bildirmeyen uç nokta
from studio.locales import en_qa23_fix  # noqa: E402

MESSAGES.update(en_qa23_fix.MESSAGES)

# araç yürütme defteri, devam kaybı, plan turu tam deneme önerisi, kısmi çıktı devri
from studio.locales import en_qa24_fix  # noqa: E402

MESSAGES.update(en_qa24_fix.MESSAGES)

# koşu düzeyinde tek bütçe kararı, yan etki sınıflı araç defteri, kendi araçlarını çalıştıran beyin notu
from studio.locales import en_qa25_fix  # noqa: E402

MESSAGES.update(en_qa25_fix.MESSAGES)

# koşu genelinde tek bütçe kararı, kart yeniden soruluşunda yeni kimlik, iç içe kısmi sonucun EKSİK işareti
from studio.locales import en_qa26_fix  # noqa: E402

MESSAGES.update(en_qa26_fix.MESSAGES)

# devretme düzeyi yürütme havuzu, sahipsiz kartların kapanışı, kaçak adım uyarısı
from studio.locales import en_qa27_fix  # noqa: E402

MESSAGES.update(en_qa27_fix.MESSAGES)

# otomatik koşu bütçesi, havuz büyüklük uyarıları, baştan çalıştırma denemesinin bitişi
from studio.locales import en_qa28_fix  # noqa: E402

MESSAGES.update(en_qa28_fix.MESSAGES)
# CITY-PACKS şehir paketleri (satış kapalı): ayrı katalog (studio/citypacks/en.py)
from studio.citypacks import en as en_citypacks  # noqa: E402
MESSAGES.update(en_citypacks.MESSAGES)

# koşu sınırının şekli, başlangıç payı, "bitene kadar devam et", defter / havuz sınırı, kaçak adım bildirimi
from studio.locales import en_qa29_fix  # noqa: E402

MESSAGES.update(en_qa29_fix.MESSAGES)

# DASH-MVP: arayüz görünümü ayarı (ui.mode)
from studio.locales import en_ui_mode  # noqa: E402

MESSAGES.update(en_ui_mode.MESSAGES)

# "bitene kadar" (önerinin varsayılanı, yazılan tavan), önerinin dayanağı, jeton sınırsız koşu kartı, kaçak bildirimi
from studio.locales import en_qa30_fix  # noqa: E402

MESSAGES.update(en_qa30_fix.MESSAGES)

# mini oyun ortak motoru (genel tur defteri, ortak günlük havuz, işaret)
from studio.locales import en_minigame  # noqa: E402

MESSAGES.update(en_minigame.MESSAGES)

# anı defteri (şehir ritüellerinin ilk yapılışı; ödülsüz)
from studio.locales import en_rituals  # noqa: E402

MESSAGES.update(en_rituals.MESSAGES)

# duraklat/durdur yerine sorulan kartın gerekçesi, para cinsinden "bitene kadar" tavanı
from studio.locales import en_qa31_fix  # noqa: E402

MESSAGES.update(en_qa31_fix.MESSAGES)

# motor hatasıyla failed biten koşu, olası kaydedilmemiş istek, metrik / kapsam yer tutuculu kart başlıkları
from studio.locales import en_qa32_fix  # noqa: E402

MESSAGES.update(en_qa32_fix.MESSAGES)

# GRAPH-CDC: graf değişiklik günlüğü imleç API'si
from studio.locales import en_graph_cdc  # noqa: E402

MESSAGES.update(en_graph_cdc.MESSAGES)

# REL-FIX (R-13): beyinsiz koşu başlamadan engellenir
from studio.locales import en_rel_fix  # noqa: E402

MESSAGES.update(en_rel_fix.MESSAGES)

# zip paketi
from studio.locales import en_zip  # noqa: E402

MESSAGES.update(en_zip.MESSAGES)

# BOOSTER-TIER (karar 2026-10-28): 3 ücretsiz booster, diğerleri tam sürümde
for _mod in _paid("booster_tier"):
    MESSAGES.update(_mod.MESSAGES)

# WORK-ZONES (plan §5 C2): görev başına çalışma bölgesi (şehir ofis binaları)
from studio.locales import en_work_zones  # noqa: E402

MESSAGES.update(en_work_zones.MESSAGES)

# AGENT-DELETE: ajan silme reddi iletisi
from studio.locales import en_agent_delete  # noqa: E402

MESSAGES.update(en_agent_delete.MESSAGES)

from studio.locales import en_datasafe  # noqa: E402

MESSAGES.update(en_datasafe.MESSAGES)

# free sürüm ilk deneme (r4): `_extract --missing` ile kalan iletiler
MESSAGES.update({
    "Dünya grafı yalnız stüdyonun kendi arayüzünden eşitlenir": "The world graph can only be synced from the studio's own interface",
    "{} bir kavram değil ({})": "{} is not a concept ({})",
    "döngü: kavram kendi alt kavramının altına konamaz": "loop: a concept cannot be placed under its own sub-concept",
    "eş anlamlı boş ya da kavramın kendi adı": "the synonym is empty or the concept's own name",
    "'{}' zaten başka bir kavramın adı ya da eş anlamlısı": "'{}' is already the name or a synonym of another concept",
    "kavram yok: {}": "concept not found: {}",
    "Taksonomi yalnız stüdyonun kendi arayüzünden düzenlenir": "The taxonomy can only be edited from the studio's own interface",
    "Sistem sağlığı yalnız uygulamanın kendi arayüzüne açıktır": "System health is only available to the app's own interface",
    "metrics: eşitleme kilidi alınamadı": "metrics: could not get the sync lock",
    "{}: tanımsız etiket/arama özelliği: {}": "{}: undefined label/search property: {}",
    "Denetim komutu bu sürümde çalışmaz": "The check command does not run in this edition",
    "Tarif hedefi bu sürümde yok": "Recipe targets are not available in this edition",
})
