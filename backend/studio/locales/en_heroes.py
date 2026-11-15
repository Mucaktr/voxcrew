"""İngilizce katalog — kahramanlar (S44, studio/heroes): API, paket doğrulama ve servis iletileri.

Ayrı dosya: ortak `en.py` ile çakışma olmasın diye `en.py` sonunda birleştirilir (en_fixes deseniyle aynı).
Kahraman içerik metinleri (ad, köken, kişilik, hafıza) paketlerde zaten TR/EN olarak durur ve istek diline göre
sunulur; burada yalnızca sunucu iletileri vardır.
"""

from __future__ import annotations

MESSAGES: dict[str, str] = {
    # heroes/api.py
    "Kahraman işe alma ve kaldırma yalnızca uygulama arayüzünden, kullanıcı tarafından yapılabilir":
        "Heroes can only be recruited or removed by the user, from the studio interface",
    # heroes/service.py
    "Kahraman yok: {}": "Hero not found: {}",
    "Kahraman ajanı yok: {}": "Hero agent not found: {}",
    "Bu kahraman paketi yayımlama kapısından geçmedi (ip_risk > 1)":
        "This hero pack did not pass the publishing gate (ip_risk > 1)",
    # heroes/presets.py — paket doğrulama
    "Paket bir JSON nesnesi olmalı": "The pack must be a JSON object",
    "Biçim '{}' sürüm {} olmalı": "Format must be '{}' version {}",
    "Kimlik 'hero:<küçük-harf-ad>' biçiminde olmalı": "The id must look like 'hero:<lowercase-name>'",
    "{}: TR ve EN metni gerekli": "{}: Turkish and English text are required",
    "{}.{}: boş olamaz": "{}.{}: cannot be empty",
    "{}.{}: en çok {} karakter": "{}.{}: at most {} characters",
    "{}: nesne olmalı": "{}: must be an object",
    "{}.species geçersiz": "{}.species is invalid",
    "{}.{}: #RRGGBB renk olmalı": "{}.{}: must be a #RRGGBB colour",
    "{}.aura: 'none' ya da #RRGGBB olmalı": "{}.aura: must be 'none' or #RRGGBB",
    "{}.{}: geçersiz değer {}": "{}.{}: invalid value {}",
    "{}.{}: true/false olmalı": "{}.{}: must be true/false",
    "{}: pelerin için capeColor gerekli": "{}: a cape needs capeColor",
    "{}: oyun verisi içeremez ({}) — kahraman önde başlamaz":
        "{}: cannot contain game data ({}) — heroes get no head start",
    "{}: ip_risk 0–3 arası tam sayı olmalı": "{}: ip_risk must be an integer from 0 to 3",
    "{}: kimlik metninde korumalı ad/marka çağrışımı var: {}":
        "{}: the identity text references a protected name or brand: {}",
    "{}: lisans {} içinden olmalı": "{}: license must be one of {}",
    "{}: archetype gerekli": "{}: archetype is required",
    "{}: color #RRGGBB olmalı": "{}: color must be #RRGGBB",
    "{}.role.rank {} içinden olmalı": "{}.role.rank must be one of {}",
    "{}: brains en az iki geçerli beyin içermeli ({})": "{}: brains must list at least two valid brains ({})",
    "{}: brains yerel 'ollama' yedeğini içermeli (tek ücretli sağlayıcı şartı yok)":
        "{}: brains must include the local 'ollama' fallback (no single paid provider requirement)",
    "{}: brains tekrar içeremez": "{}: brains cannot contain duplicates",
    "{}: permissions read ya da write olmalı": "{}: permissions must be read or write",
    "{}: boosters nesne olmalı": "{}: boosters must be an object",
    "{}: bilinmeyen booster {}": "{}: unknown booster {}",
    "{}: boosters.{} true/false olmalı": "{}: boosters.{} must be true/false",
    "{}: tools liste olmalı": "{}: tools must be a list",
    "{}.tools[{}]: id gerekli": "{}.tools[{}]: id is required",
    "{}.tools[{}]: access read ya da write olmalı": "{}.tools[{}]: access must be read or write",
    "{}.tools[{}]: araçlar yalnızca öneridir (auto_enable/install/command yasak)":
        "{}.tools[{}]: tools are suggestions only (auto_enable/install/command are not allowed)",
    "{}.memory: facts/concepts liste olmalı": "{}.memory: facts/concepts must be lists",
    "{}.memory: {}–{} düğüm olmalı (şu an {})": "{}.memory: must have {}–{} nodes (currently {})",
    "{}.memory.concepts[{}]: name gerekli": "{}.memory.concepts[{}]: name is required",
    "{}.memory.facts[{}]: tekrar eden bilgi": "{}.memory.facts[{}]: duplicate fact",
    "{}.memory.facts[{}]: bilinmeyen kavram {}": "{}.memory.facts[{}]: unknown concept {}",
    "{}: skill kimliği 'hero-<ad>' biçiminde olmalı: {}": "{}: skill id must look like 'hero-<name>': {}",
    "{}: skill dosyası yok: {}": "{}: skill file missing: {}",
    "{}: en az bir skill gerekli": "{}: at least one skill is required",
    "{}: workflow gerekli": "{}: workflow is required",
    "{}.workflow: en az bir onay (approval) adımı gerekli": "{}.workflow: at least one approval step is required",
    "{}.workflow ({}): {}": "{}.workflow ({}): {}",
    "{}: okunamadı ({})": "{}: could not be read ({})",
    "{}: dosya adı kimlikle aynı olmalı ({}.agent-preset.json)":
        "{}: the file name must match the id ({}.agent-preset.json)",
}
