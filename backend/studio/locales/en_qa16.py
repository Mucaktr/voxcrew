""" düzeltmelerinin sunucu iletileri (EN): ayrılmış ajan adları (Denetçi + niteleyicili ilk sözcük), Claude
`~/.claude` devralma kaydı (örneğe bağlı), skill bağlama uçlarının MCP sınırı."""

from __future__ import annotations

MESSAGES: dict[str, str] = {
    "“{}” ayrılmış bir ajan adı: Kullanıcı / User, Sistem / System ve Stüdyo / Studio (ve benzer yazımları ya da bu "
    "sözcük ve bir niteleyiciyle başlayan adlar) kullanıcı ve sistem kayıtlarına ayrılmıştır; ad ya da kısa ad olarak "
    "kullanılamaz, başka bir ad seç":
        "“{}” is a reserved agent name: Kullanıcı / User, Sistem / System and Stüdyo / Studio (and similar spellings, "
        "or names that start with one of these words plus a qualifier) are reserved for user and system records and "
        "can't be used as a name or short name; choose another name",
    "Uygulamanın iç ajanları kişisel ~/.claude kurulumunu devralamaz":
        "The studio's internal agents can't inherit the personal ~/.claude setup",
    "Ajan örneği belirlenemedi; devralma açılmadı": "Couldn't identify the agent instance; inheritance was not turned on",
    "claude_isolation.json yazılamadı; elle incele": "claude_isolation.json could not be written; inspect it by hand",
    "Ajanın skill atamaları MCP üzerinden değiştirilemez; uygulama arayüzünden ata":
        "An agent's skill assignments can't be changed over MCP; assign them in the studio",
}
