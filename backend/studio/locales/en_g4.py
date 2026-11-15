"""G4 (token yapısı, sürüm ve süre sınırları) iletilerinin İngilizce karşılıkları."""

from __future__ import annotations

MESSAGES: dict[str, str] = {
    "deadline_min bir sayı olmalı": "deadline_min must be a number",
    "deadline_min sıfırdan büyük olmalı": "deadline_min must be greater than zero",
    "Koşu süresi doldu": "Run deadline reached",
    "Koşu süresi doldu (mutlak sınır {}); koşu durduruldu": "Run deadline reached (absolute limit {}); the run was stopped",
    "Koşu süresi doldu ({}); devam edilemez, çatallayarak yeniden başlat":
        "Run deadline reached ({}); it can't be resumed — fork it to start again",
}
