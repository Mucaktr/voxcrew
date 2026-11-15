""" düzeltmelerinin sunucu iletileri (EN): unutma başlatma kapısı ve ayrık değerlendirme mührü."""

from __future__ import annotations

MESSAGES: dict[str, str] = {
    "Bu bellek alanında unutma uygulanıyor; koşu biraz sonra başlatılabilir":
        "A forget is being applied in this memory space; the run can start in a moment",
    "Ayrık değerlendirme sürüyor; bu içerik koşu bitince kullanılabilir":
        "A held-out evaluation is running; this content is available when it finishes",
    "Ayrık değerlendirme sürüyor; bu kayıt koşu bitince değiştirilebilir":
        "A held-out evaluation is running; this record can be changed when it finishes",
    "Adım token tavanı 'auto' ya da 1 000–100 000 000 arası bir tam sayı olmalı":
        "The step token cap must be 'auto' or a whole number between 1,000 and 100,000,000",
}
