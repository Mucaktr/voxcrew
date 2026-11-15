"""İngilizce katalog — sezon ve sürpriz teslim kutusu (`game/season.py`, `game/surprise.py`). `locales/en.py`
bu sözlüğü MESSAGES'a katar."""

from __future__ import annotations

MESSAGES: dict[str, str] = {
    "Yönetici / test modunda sürpriz kutu açılmaz": "Surprise boxes cannot be opened in admin / test mode",
    "Sürpriz kutu yok": "No such surprise box",
    "Havuzdaki her kozmetik zaten sende; kutu yeni öğeler eklenince açılabilir":
        "You already own every cosmetic in the pool; the box can be opened once new items are added",
    # 2026-10-19 üyelik sandıkları (game/chests.py)
    "Yönetici / test modunda sandık açılmaz (yalnız önizleme)": "Chests cannot be opened in admin / test mode (preview only)",
    "Sandık yok": "No such chest",
    "Bu sandıktan bir öğe seç": "Pick one item from this chest",
    "Seçilen öğe bu sandıkta yok": "The chosen item is not in this chest",
    "Bu öğe zaten sende; başka birini seç": "You already own this item; pick another one",
}
