""" sunucu iletileri (EN): mini oyun ortak motoru (genel tur defteri, ortak günlük havuz, işaret uzun yoklaması)."""

from __future__ import annotations

MESSAGES: dict[str, str] = {
    "Bilinmeyen mini oyun": "Unknown mini-game",
    "Bu mini oyun genel tur defterini kullanmıyor": "This mini-game does not use the shared round ledger",
    "round_id gerekli": "round_id is required",
    "Mini oyun çok sık başlatılıyor; biraz bekle": "Mini-game started too often; wait a moment",
    "result bir nesne olmalı": "result must be an object",
    "Mini oyun turu bulunamadı": "Mini-game round not found",
    "Bu tur zaten kapandı": "This round is already closed",
    "Bu tur artık geçerli değil": "This round is no longer valid",
    "Tur bu kadar kısa sürede bitemez": "A round cannot finish that quickly",
    "Tur sonucu geçersiz": "The round result is invalid",
    "Bu turda işaret yok": "This round has no cue",
    "Çok fazla bekleyen işaret; biraz bekle": "Too many pending cues; wait a moment",
}
