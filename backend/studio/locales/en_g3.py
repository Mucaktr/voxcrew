""" sunucu iletileri (EN): Claude Code ajanının kullanıcı ~/.claude kurulumunu devralma ayarı."""

from __future__ import annotations

MESSAGES: dict[str, str] = {
    "inherit_user_claude_config true ya da false olmalı": "inherit_user_claude_config must be true or false",
    'Kullanıcı ~/.claude kurulumunu devralmak açık onay ister (confirm: "inherit")':
        "Inheriting the user's ~/.claude setup needs explicit confirmation (confirm: \"inherit\")",
    "claude_isolation.json okunamadı; elle incele (üzerine yazılmaz)":
        "claude_isolation.json could not be read; inspect it by hand (it is not overwritten)",
    "Veri dizini bulunamadı": "Data folder not found",
}
