""" düzeltmelerinin sunucu iletileri (EN): unutma sırasında karar kapısı ve booster isteğinin bütün doğrulaması."""

from __future__ import annotations

MESSAGES: dict[str, str] = {
    "Bu bellek alanında unutma uygulanıyor; karar şimdi verilemez. Unutma bitince (birkaç saniye) yeniden dene; kart "
    "açık kalır":
        "A forget is being applied in this memory space, so the decision can't be made now. Try again when it finishes "
        "(a few seconds); the card stays open",
    "İstek gövdesi bir nesne olmalı": "The request body must be an object",
    "boosters bir nesne olmalı ({id: true|false|null})": "boosters must be an object ({id: true|false|null})",
    "settings bir nesne olmalı ({id: {ayar: değer}})": "settings must be an object ({id: {setting: value}})",
    "{}: true, false ya da null olmalı": "{}: must be true, false or null",
    "{}: ayarlar bir nesne olmalı": "{}: settings must be an object",
}
