"""İngilizce katalog — W4 yürüme ilerlemesi (`studio/walk`). `locales/en.py` bu sözlüğü MESSAGES'a katar."""

from __future__ import annotations

MESSAGES: dict[str, str] = {
    "Çok fazla istek; biraz bekle": "Too many requests; wait a moment",
    "client_request_id en çok 80 karakterlik metin olmalı": "client_request_id must be text of at most 80 characters",
    "Bu istek kimliği başka bir istek için kullanıldı": "This request id was already used for a different request",
    "Geçersiz dünya kimliği": "Invalid world id",
    "Konum değerleri sonlu sayı olmalı": "Position values must be finite numbers",
    "Konum sınır dışında": "Position is out of bounds",
    "Görünüm third ya da first olmalı": "View must be third or first",
    "Konum çok sık kaydediliyor": "Position is being saved too often",
    "Bilinmeyen sahne": "Unknown scene",
    # şehir haritası (walk/explore.py city_*; worlds/validate.py MESSAGES["city_map"])
    "Bilinmeyen şehir": "Unknown city",
    "Bu kayıt bu şehrin listesinde yok": "This entry is not in this city's list",
    "Önce bu semte gir": "Enter this district first",
    "Bu semt henüz kilitli": "This district is still locked",
    "Şehir haritası bloğu (semtler ve ulaşım) geçersiz: {}": "The city map block (districts and transit) is invalid: {}",
    "Bu hatıra bu sahnenin listesinde yok": "This souvenir is not in this scene's list",
    "Bu simge bu sahnenin listesinde yok": "This landmark is not in this scene's list",
    "Bu sahne açık değil": "This scene is not unlocked",
    "Bilinmeyen olay türü": "Unknown event type",
    "ref gerekli": "ref is required",
    "MCP ile başlatılan koşu sayılmaz": "Runs started through MCP do not count",
    "Yalnızca arayüzden başlatılan koşu sayılır": "Only runs started from the studio UI count",
    "Koşu çok eski; yeni başlatılan koşu sayılır": "The run is too old; only a just-started run counts",
    "Bu çıktı bir ajana ait değil": "This output does not belong to an agent",
    "cards bir nesne olmalı": "cards must be an object",
    "Bilinmeyen kart": "Unknown card",
    "Kart adedi pozitif tam sayı olmalı": "Card counts must be positive whole numbers",
    "Gövde bir nesne olmalı": "The body must be an object",
    # W5: "Ben" avatarı
    "avatar bir nesne olmalı": "avatar must be an object",
    "Avatarda bilinmeyen parça": "The avatar has an unknown part",
    "Avatar rengi #RRGGBB olmalı": "Avatar colours must be #RRGGBB",
    "Ad en çok 24 karakterlik metin olmalı": "The name must be text of at most 24 characters",
    "Bu kozmetik kilitli; önce mağazadan aç": "This cosmetic is locked; unlock it in the shop first",
    # WALK-EXPLORE: keşif
    "Bu keşif bu sahnenin listesinde yok": "This discovery is not in this scene's list",
    "Bu iç mekân kültür incelemesinde; şimdilik girilemez": "This interior is under cultural review; it cannot be entered yet",
    "Önce bu iç mekâna gir": "Enter this interior first",
    # WORLD-FIX: olta
    "water pond ya da open olmalı": "water must be pond or open",
    "assist doğru/yanlış olmalı": "assist must be true or false",
    "Olta çok sık atılıyor; biraz bekle": "Casting too often; wait a moment",
    "cast_id gerekli": "cast_id is required",
    "Atış bulunamadı": "Cast not found",
    "Bu atış kapandı; yeniden at": "This cast is closed; cast again",
}
