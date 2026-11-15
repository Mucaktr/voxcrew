"""İngilizce katalog — CG-DELIVER (çıktı teslimi). `studio/locales/en.py` bu sözlüğü MESSAGES'a katar."""

from __future__ import annotations

MESSAGES: dict[str, str] = {
    # delivery/api.py
    "Teslim yalnızca uygulama arayüzünden, kullanıcı onayıyla yapılabilir":
        "Delivery can only be done from the studio UI, with the user's approval",
    # delivery/service.py
    "Bilinmeyen teslim hedefi: {}": "Unknown delivery target: {}",
    "Teslim için açık onay (approved: true) gerekli": "Delivery needs explicit approval (approved: true)",
    "Önce önizle: preview_hash gerekli": "Preview first: preview_hash is required",
    "İçerik ya da hedef önizlemeden sonra değişti; önizlemeyi yenile":
        "The content or target changed after the preview; refresh the preview",
    "Teslim başarısız: {}": "Delivery failed: {}",
    "Kalite kapısı bu çıktıyı durdurdu. Yine de teslim etmek için gerekçe yaz.":
        "The quality gate stopped this output. Write a reason to deliver it anyway.",
    "options bir nesne olmalı": "options must be an object",
    # delivery/quality_gate.py
    "Kalite kapısı çalıştırılamadı; dış hedefe teslim bu yüzden durduruldu. İçeriği kontrol edip yine de teslim etmek "
    "için gerekçe yaz.": "The quality gate could not run, so delivery to an external target was stopped. Check the "
                         "content and write a reason to deliver it anyway.",
    "Kalite kapısı çalıştırılamadı": "The quality gate could not run",
    # delivery/api.py
    "deliverable_id gerekli": "deliverable_id is required",
    "deliverable_id geçersiz": "deliverable_id is invalid",
    # delivery/records.py
    "redact_pii true/false olmalı": "redact_pii must be true/false",
    # delivery/safety.py
    "Hedef klasörü seç": "Choose the target folder",
    "Klasör yolu geçersiz": "The folder path is not valid",
    "Klasör yolunda '..' kullanılamaz": "The folder path cannot contain '..'",
    "Klasör yolu tam (mutlak) olmalı; ör. ~/Belgeler/Raporlar":
        "The folder path must be absolute, e.g. ~/Documents/Reports",
    "Klasör bulunamadı": "Folder not found",
    "Bu yol bir klasör değil": "This path is not a folder",
    "Bu klasöre teslim edilemez (ajan/araç ayar klasörü ya da uygulama veri dizini)":
        "Cannot deliver into this folder (agent/tool config folder or the studio data folder)",
    "Dosya adı geçersiz (tek ad; / \\ : * ? \" < > | ve baştaki nokta olmaz)":
        "The file name is not valid (a single name; no / \\ : * ? \" < > | and no leading dot)",
    "Bu dosya adı işletim sistemince ayrılmış": "This file name is reserved by the operating system",
    "Hedef bir sembolik bağlantı; teslim edilmez": "The target is a symbolic link; nothing is delivered",
    "Hedef klasör dışına çıkıyor": "The target leaves the folder",
    "Hedefte aynı adlı bir klasör var": "A folder with the same name exists at the target",
    "Depodaki dosya yolu geçersiz": "The file path in the repository is not valid",
    "Depodaki dosya yolunda '..', '.git' ya da geçersiz karakter olamaz":
        "The file path in the repository cannot contain '..', '.git' or invalid characters",
    "Dosya deponun dışına çıkıyor": "The file leaves the repository",
    "Dal adı geçersiz (harf, rakam, . _ / -; '..' yok; '-' ile başlamaz)":
        "The branch name is not valid (letters, digits, . _ / -; no '..'; cannot start with '-')",
    # delivery/adapters.py
    "Bu çıktı metin değil; yalnızca klasöre kopyalanabilir ya da indirilebilir":
        "This output is not text; it can only be copied to a folder or downloaded",
    "`{}` bulunamadı (PATH'te yok)": "`{}` was not found (not on PATH)",
    "Hedefte aynı adlı dosya var; üzerine yazmak için onay ver":
        "A file with the same name exists; approve overwriting it",
    "Dosya yazılamadı: {}": "Could not write the file: {}",
    "Geçersiz biçim: {}": "Invalid format: {}",
    "Bu çıktı metin değil; yalnızca özgün dosya olarak kaydedilir":
        "This output is not text; it can only be saved as the original file",
    "Bu dosya türü klasöre kopyalanamaz": "This file type cannot be copied to a folder",
    "{}: en çok 20 adres": "{}: at most 20 addresses",
    "{}: geçersiz e-posta adresi": "{}: invalid email address",
    "Kip 'eml', 'mailto' ya da 'mcp' olmalı": "Mode must be 'eml', 'mailto' or 'mcp'",
    "Taslak dosyasının uzantısı .eml olmalı": "The draft file must have the .eml extension",
    "Ek 'none', 'md' ya da 'docx' olmalı": "Attachment must be 'none', 'md' or 'docx'",
    "Bu klasör bir git deposu değil": "This folder is not a git repository",
    "gh hata verdi: {}": "gh returned an error: {}",
    "Deponun etkin dalı okunamadı (ayrık HEAD?)": "Could not read the repository's current branch (detached HEAD?)",
    "'{}' dalı zaten var; başka bir dal adı seç": "Branch '{}' already exists; choose another branch name",
    "Dosya depoda var; üzerine yazmak için onay ver": "The file exists in the repository; approve overwriting it",
    "`{}` başarısız: {}": "`{}` failed: {}",
    "PR komutu çalışmadı": "The PR command did not run",
    "Bu hedef için ayarlı bir MCP sunucusu yok. Bağlantılar sayfasından kendi MCP sunucunu ekle.":
        "No MCP server is set up for this target. Add your own MCP server on the Connections page.",
    "Seçilen MCP sunucusu bu hedef için uygun değil": "The chosen MCP server does not fit this target",
    "E-posta gönderen araçlar kullanılmaz; yalnızca taslak": "Tools that send email are never used; drafts only",
    "MCP aracı şu alanları istiyor: {}": "The MCP tool needs these fields: {}",
    "MCP sunucusu artık etkin değil": "The MCP server is no longer enabled",
    "MCP çağrısı başarısız: {}": "The MCP call failed: {}",
    "MCP aracı hata döndü: {}": "The MCP tool returned an error: {}",
    "MCP sunucusu hazır değil": "The MCP server is not ready",
    "Araç listesi yok: Bağlantılar sayfasında sunucuyu bir kez yokla":
        "No tool list: probe the server once on the Connections page",
}
