"""EN karşılıkları: düzeltmelerinin sunucu iletileri.

Ortak `en.py`'de eşzamanlı düzenleme olmasın diye ayrı dosya (`en_<alan>.py` deseni); `en.py` sonunda katılır.
"""

from __future__ import annotations

MESSAGES: dict[str, str] = {
    "Onaylı adımda başka beyin seçimi yalnızca uygulama arayüzünden, kullanıcı tarafından yapılabilir":
        "On a step that needs approval, only the user can pick another brain, from the studio interface",
    "Koşu iptal edildi; bu adım artık onay beklemiyor":
        "The run was cancelled; this step is no longer waiting for approval",
    "Bu çıktı kabul edildi; karar geri alınamaz. Değişiklik için koşuyu çatallayıp yeni bir sürüm başlat (revizyon yeni "
    "sürümde istenir)":
        "This output was accepted and the decision can't be undone. To change it, fork the run and start a new version "
        "(ask for the revision on the new version)",
    "Geri alma yedeği doğrulanamadı (değiştirilmiş ya da bozuk); geri alma yapılmadı":
        "The undo backup couldn't be verified (changed or damaged); nothing was undone",
    "Geçerlilik başlangıcı bitişinden sonra olamaz": "The validity start can't be after its end",
    "expected_version pozitif bir tam sayı olmalı": "expected_version must be a positive whole number",
    "Bu ifadenin yerine daha yeni bir bilgi geçti; eski ifadeyi geri getirmek için güncel bilgiyi değiştir "
    "(supersede/correct)":
        "A newer fact has replaced this statement; to bring the old one back, change the current fact "
        "(supersede/correct)",
    "Bu soru yalnızca uygulama arayüzünden, kullanıcıya görünür":
        "This question is only visible to the user, in the studio interface",
}
