"""İngilizce katalog — CG2: tetikleyiciler (klasör, e-posta etiketi, toplantı bitişi), MCP kataloğu, zaman tasarrufu."""

from __future__ import annotations

MESSAGES: dict[str, str] = {
    # tetikleyiciler (schedule/service.py, schedule/triggers.py)
    "Klasör yolu geçersiz": "The folder path is invalid",
    "İzlenen klasör çalışma klasörünün içinde olmalı ya da tam (mutlak) bir yol olmalı; '..' kullanılamaz":
        "The watched folder must be inside the work folder or a full (absolute) path; '..' is not allowed",
    "İzlenen klasör çalışma klasörünün içinde olmalı": "The watched folder must be inside the work folder",
    "İzlenen klasör yok: {}": "Watched folder not found: {}",
    "Klasör bulunamadı": "Folder not found",
    "Bu yol bir klasör değil": "This path is not a folder",
    "Bu klasör izlenemez (ajan/araç ayar klasörü ya da uygulama veri dizini)":
        "This folder cannot be watched (an agent/tool settings folder or the studio data folder)",
    "Klasör çok geniş: ev klasörünün, onun üst klasörlerinin ya da sürücünün kendisi yerine bir alt klasör seç":
        "That folder is too broad: pick a subfolder instead of your home folder, a folder above it or a drive root",
    "Bekleme (debounce) 0 ile {} saniye arasında olmalı": "The settle time (debounce) must be 0–{} seconds",
    "MCP sunucusu yok ya da kapalı: Bağlantılar sayfasında posta/takvim sunucunu ekle":
        "The MCP server is missing or turned off: add your mail/calendar server on the Connections page",
    "Yoklama aralığı {} saniye ile 1 gün arasında olmalı": "The check interval must be between {} seconds and 1 day",
    "E-posta etiketi gerekli (en fazla 120 karakter)": "An email label is required (up to 120 characters)",
    "Toplantı eşleşmesi keyword ya da event olmalı": "Meeting match must be keyword or event",
    "Anahtar kelime 2–80 karakter olmalı": "The keyword must be 2–80 characters",
    "Seçilen toplantının kimliği (event_id) gerekli": "The selected meeting's id (event_id) is required",
    "Hedef (target) gerekli: task, workflow, recipe ya da goal": "A target is required: task, workflow, recipe or goal",
    "Hedef türü task, workflow, recipe ya da goal olmalı": "Target type must be task, workflow, recipe or goal",
    "Tetikleyici girdisi tanımlı değil: {}": "The trigger input is not defined: {}",
    "Tarif yok: {}": "Recipe not found: {}",
    "İzlenen klasör bulunamadı ya da artık izlenemez": "The watched folder is missing or can no longer be watched",
    "MCP sunucusu artık yok ya da kapalı": "The MCP server is gone or turned off",
    "Bu sunucuda uygun bir okuma aracı bulunamadı": "No suitable read tool was found on this server",
    "Yazan araçlar tetikleyicide kullanılmaz": "Tools that write are never used by triggers",
    "MCP yoklaması başarısız: {}": "MCP check failed: {}",
    "MCP aracı hata döndü: {}": "The MCP tool returned an error: {}",
    "Araç listesi yok: Bağlantılar sayfasında sunucuyu bir kez yokla":
        "No tool list yet: probe the server once on the Connections page",
    "Bu sunucuda etiketteki iletileri listeleyen bir okuma aracı bulunamadı":
        "This server has no read tool that lists messages with a label",
    "Bu sunucuda etkinlikleri listeleyen bir okuma aracı bulunamadı": "This server has no read tool that lists events",
    # MCP kataloğu (connections/catalog_api.py, mcp_catalog.py)
    "Katalogda yok: {}": "Not in the catalog: {}",
    "Hedef claude ya da codex olmalı": "Target must be claude or codex",
    "Bu kaydın komutu doğrulanmadı; yapılandırma önerilmez": "This entry's command is unverified; setup is not offered",
    "Eksik değer: {}": "Missing value: {}",
    "Desteklenmeyen yer tutucu": "Unsupported placeholder",
    ".mcp.json geçerli JSON değil; elle düzelt": ".mcp.json is not valid JSON; fix it by hand",
    ".mcp.json bir nesne olmalı": ".mcp.json must be an object",
    "`{}` adlı sunucu .mcp.json içinde zaten var ve farklı; var olan ayar ezilmez":
        "A server named `{}` already exists in .mcp.json with different settings; existing settings are never overwritten",
    "config.toml okunamadı: {}": "Could not read config.toml: {}",
    "`{}` adlı MCP sunucusu config.toml içinde zaten var; var olan ayar ezilmez":
        "An MCP server named `{}` already exists in config.toml; existing settings are never overwritten",
    "Yapılandırma dosyası okunamadı: {}": "Could not read the config file: {}",
    "Dosya bu arada değişti; planı yeniden oluştur": "The file changed in the meantime; create the plan again",
    "Ortam değişkenlerinin değerleri yazılmaz; kabuğunda tanımla: {}":
        "Environment variable values are never written; set them in your shell: {}",
    "Claude Code proje kapsamındaki sunucuları ilk açılışta onayına sunar.":
        "Claude Code asks you to approve project-scoped servers the first time it opens.",
    # zaman tasarrufu
    "Gövde {anahtar: {manual_minutes, review_minutes}} biçiminde olmalı":
        "The body must look like {key: {manual_minutes, review_minutes}}",
    "Geçersiz anahtar: {}": "Invalid key: {}",
    "Değer bir nesne olmalı": "The value must be an object",
    "Dakikalar tam sayı olmalı": "Minutes must be whole numbers",
    "Elle süre 1–{}, inceleme 0–{} dakika olmalı": "Manual time must be 1–{} and review 0–{} minutes",
    "Böyle bir tarif ya da iş akışı yok: {}": "No such recipe or workflow: {}",
    # tetikleyici araç politikası ve sıra
    "Araç politikası bu aracı yasaklıyor (tools.deny): {}": "The tool policy denies this tool (tools.deny): {}",
    "Araç politikası bu araca izin vermiyor (tools.allow listesinde yok): {}":
        "The tool policy doesn't allow this tool (not in tools.allow): {}",
}
SECTION_TITLES: dict[str, str] = {}
