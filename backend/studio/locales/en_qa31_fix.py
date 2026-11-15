""" sunucu iletileri (EN): sınır dolmadan, boyutu bilinmeyen işler yüzünden duraklat / durdur yerine sorulduğunda
kartın tek satırlık gerekçesi; para cinsinden "bitene kadar" tavanının tabana çekilmesi."""

from __future__ import annotations

MESSAGES: dict[str, str] = {
    " Bu sınır için aşımda duraklatmayı seçmiştin; sınır henüz dolmadı ama bu işlerin boyutu bilinmiyor (geçmiş yok), bu "
    "yüzden duraklatmak yerine soruyorum.":
        " You chose to pause when this limit is exceeded; the limit is not reached yet, but the size of these jobs is "
        "unknown (no history), so I am asking instead of pausing.",
    " Bu sınır için aşımda durdurmayı seçmiştin; sınır henüz dolmadı ama bu işlerin boyutu bilinmiyor (geçmiş yok), bu "
    "yüzden durdurmak yerine soruyorum.":
        " You chose to stop when this limit is exceeded; the limit is not reached yet, but the size of these jobs is "
        "unknown (no history), so I am asking instead of stopping.",
    "Yazdığın tavan ({}) şimdiye kadar harcanan ve uçuştaki turların payından ({}) küçüktü; koşu sınırı {} oldu (uçuştaki "
    "tur zaten ödenmekte).":
        "The ceiling you entered ({}) was below what has been spent plus the turns in flight ({}); the run limit became "
        "{} (the in-flight turn is already being paid for).",
}
