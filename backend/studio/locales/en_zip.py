"""İngilizce katalog — zip paketi (`deliverables/bundle.py`). `en.py` sonunda birleştirilir (ayrı dosya)."""

from __future__ import annotations

MESSAGES: dict[str, str] = {
    "Zip paketi yalnızca uygulama arayüzünden, kullanıcı tarafından indirilebilir":
        "The zip bundle can only be downloaded from the studio interface, by the user",
    "run_id ya da ids verilmeli (yalnız biri)": "Provide run_id or ids (exactly one)",
    "run_id geçersiz": "run_id is invalid",
    "ids boş olmayan bir kimlik listesi olmalı": "ids must be a non-empty list of ids",
    "En çok {} çıktı seçilebilir": "At most {} outputs can be selected",
    "Bu koşunun çıktısı yok": "This run has no outputs",
    "Pakete eklenecek dosya yok": "There is nothing to add to the bundle",
    "Başka bir paket hazırlanıyor; biraz sonra tekrar dene": "Another bundle is being prepared; try again shortly",
    "{} true/false olmalı": "{} must be true/false",
}
