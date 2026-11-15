""" düzeltmelerinin sunucu iletileri (EN): ayrılmış matris önekleri ve booster açma yasağı."""

from __future__ import annotations

MESSAGES: dict[str, str] = {
    "'{}' ayrılmış bir ad: 'eval-mx' ve 'evalmx' ile başlayan proje ve ajan adları değerlendirme matrisinin geçici "
    "kayıtlarına ayrılmıştır; başka bir ad seç":
        "'{}' is a reserved name: project and agent names starting with 'eval-mx' or 'evalmx' are reserved for the "
        "evaluation matrix's temporary records; choose another name",
    "Booster açmak yalnızca uygulama arayüzünden, kullanıcı tarafından yapılabilir; MCP ve diğer istemciler booster "
    "durumunu okuyabilir ve kapatabilir":
        "Only the user can turn a booster on, from the studio UI; MCP and other clients can read booster state and "
        "turn boosters off",
    "{} (açılacaktı: {})": "{} (would have turned on: {})",
}
