"""İngilizce katalog — Faz 6 'memory' alanı. `en.py` bu sözlükleri MESSAGES/SECTION_TITLES'a katar.

Ekipler aynı dosyayı aynı anda düzenlemesin diye her alanın kataloğu ayrı modüldedir; biçim `en.py` ile aynıdır
(TR ileti → EN ileti, f-string yer tutucuları `{}`).
"""

from __future__ import annotations

MESSAGES: dict[str, str] = {
    # bellek ad alanları (graph/namespace.py, graph/memory.py)
    "Proje anahtarı metin olmalı": "Project key must be text",
    "Geçersiz proje anahtarı: {} (küçük harf, rakam, - ve _; en çok 41 karakter)":
        "Invalid project key: {} (lowercase letters, digits, - and _; at most 41 characters)",
    "Bellek işlemi tek bir ad alanında yapılır; '*' kabul edilmez":
        "Memory operations run in a single namespace; '*' is not accepted",
    "Bu bilgi başka bir bellek ad alanına ait; işlem reddedildi":
        "This fact belongs to another memory namespace; the operation was refused",
    # bellek iddiası (graph/assertion.py, graph/assertion_api.py)
    "Bilgiyi yalnız kullanıcı doğrulayabilir": "Only the user can verify a fact",
    "Bu bellek işlemini yalnız kullanıcı yapabilir": "Only the user can perform this memory operation",
    "Doğrulanmamış (güvenilmeyen kaynaklı) bilgi kendiliğinden sabitlenemez":
        "An unverified (untrusted-source) fact cannot be pinned automatically",
    "Yalnızca Bilgi (Fact) düğümlerinde iddia işlemi yapılır": "Assertion operations apply only to Fact nodes",
    "Bu bilgi artık güncel değil (yerine yenisi geçmiş ya da geçersiz); işlem güncel sürümde yapılır":
        "This fact is no longer current (superseded or invalid); act on the current version",
    "Bilgi metni boş olamaz": "Fact text cannot be empty",
    "İtiraz için kısa bir neden yaz": "Write a short reason for the dispute",
    "Yalnız ajana özel bilgi terfi ettirilebilir": "Only an agent's private fact can be promoted",
    "Tarih ISO biçiminde olmalı (ör. 2026-11-15 ya da 2026-11-15T09:00:00+00:00): {}":
        "Dates must be ISO format (e.g. 2026-11-15 or 2026-11-15T09:00:00+00:00): {}",
    "Sürüm çatışması: bilgi değişti (beklenen {}, güncel {}); yenileyip tekrar dene":
        "Version conflict: the fact changed (expected {}, current {}); refresh and try again",
    "expected_version sayı olmalı": "expected_version must be a number",
    # unutma planı (graph/forget.py, graph/forget_api.py)
    "Unutma kapsamı fact, episode ya da project olmalı": "Forget scope must be fact, episode or project",
    "Unutulacak kayıt yok: {}": "Nothing to forget: {}",
    "Bu kayıt {} değil; unutma kapsamı uyuşmuyor": "This record is not a {}; the forget scope doesn't match",
    "Genel bellek bütün hâlinde unutulamaz; bir proje seç ya da tek tek unut":
        "Global memory can't be forgotten as a whole; pick a project or forget items one by one",
    "Uygulamak için açık onay (confirm: true) gerekli": "Explicit confirmation (confirm: true) is required to apply",
    "Geri almak için açık onay (confirm: true) gerekli": "Explicit confirmation (confirm: true) is required to undo",
    "Plan bulunamadı veya süresi doldu; önizlemeyi yenile": "Plan not found or expired; refresh the preview",
    "Bellek önizlemeden sonra değişti; önizlemeyi yenile": "Memory changed after the preview; refresh the preview",
    "Unutulacak bir şey bulunamadı": "Nothing was found to forget",
    "Unutma kaydı yok": "No such forget record",
    "Bu unutma zaten geri alındı": "This forget was already undone",
    "Geri alma süresi doldu; yedek silindi, unutma kalıcı": "The undo window has passed; the backup was deleted and the forget is permanent",
    "Unutma işlemini yalnız kullanıcı yapabilir": "Only the user can forget memory",
    "Bu kayıt kullanıcı tarafından unutuldu; geri yüklenmez": "The user forgot this record; it won't be restored",
}

SECTION_TITLES: dict[str, str] = {
}
