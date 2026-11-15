"""İngilizce katalog — veri güvenliği iletileri (config, changes, secrets). `en.py` sonunda birleştirilir."""

from __future__ import annotations

MESSAGES: dict[str, str] = {
    "Yedek dosya artık yok (eski yedekler temizlenir); geri alınamıyor":
        "The backup file no longer exists (old backups are pruned); this change cannot be undone",
    "{} bozuk; üzerine varsayılanlar yazılmadı (yedek: {}.corrupt). Dosyayı düzeltin ya da silin.":
        "{} is corrupt; defaults were not written over it (backup: {}.corrupt). Fix or delete the file.",
    "kök nesne değil": "root is not an object",
}
