"""EN karşılıkları: düzeltmelerinin sunucu iletileri.

Ortak `en.py`'de eşzamanlı düzenleme olmasın diye ayrı dosya (`en_<alan>.py` deseni); `en.py` sonunda katılır.
"""

from __future__ import annotations

MESSAGES: dict[str, str] = {
    "Yinelenen kimlik başlığı": "Duplicate identity header",
    "Koşu için iptal istendi; duraklatılamaz": "Cancellation was requested for this run; it cannot be paused",
    "Avatar MCP üzerinden silinemez; uygulama arayüzünden değiştir":
        "The avatar cannot be removed over MCP; change it in the studio interface",
    "Hak yalnız ödeme, lisans, promosyon ya da dönem işleminden doğar":
        "A right can only come from a payment, license, promotion or period transaction",
    "Geçerlilik zamanı sonlu bir sayı olmalı": "The validity time must be a finite number",
    "Paket arşivinde büyük/küçük harfe göre çakışan dosya var: {}":
        "The pack archive has files that collide by upper/lower case: {}",
}
