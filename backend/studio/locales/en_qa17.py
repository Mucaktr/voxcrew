""" sunucu iletileri (EN): Claude yalıtımı — boş eklenti kökü, npm `claude.cmd` kabuğu (cmd.exe) reddi."""

from __future__ import annotations

MESSAGES: dict[str, str] = {
    "claude_isolation özet tablosu bağlı değil": "claude_isolation digest table is not bound",
    "claude_isolation özeti kaydedilemedi": "claude_isolation digest could not be recorded",
    "Yalıtılmış Claude koşusu için boş eklenti klasörü oluşturulamadı":
        "Couldn't create the empty plugins folder for an isolated Claude run",
    "Sistem istemi dosyası güvenli bir yola yazılamadı (cmd.exe)":
        "The system prompt file couldn't be written to a safe path (cmd.exe)",
    "Claude komut satırı npm claude.cmd kabuğundan (cmd.exe) bozulmadan geçemez; koşu başlatılmadı. Claude Code'u yerel "
    "yükleyiciyle (claude.exe) kur ya da ajanın model, araç ve istem ayarlarındaki & | < > ^ % ! ( ) karakterlerini "
    "kaldır":
        "The Claude command line can't pass through the npm claude.cmd wrapper (cmd.exe) intact, so the run was not "
        "started. Install Claude Code with the native installer (claude.exe), or remove the & | < > ^ % ! ( ) characters "
        "from the agent's model, tool and prompt settings",
}
