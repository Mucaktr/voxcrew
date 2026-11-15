"""REL-FIX (R-13) sunucu iletileri (EN): kullanılabilir beyni olmayan koşu başlamadan engellenir."""

from __future__ import annotations

MESSAGES: dict[str, str] = {
    "Çalıştırılamaz: {} için kullanılabilir beyin yok. Bağlantılar sayfasından (/baglantilar) bir beyin bağla "
    "(Ollama, Codex, Claude Code ya da bir API) ya da ajana hazır bir beyin seç; sonra yeniden başlat.":
        "Cannot run: no usable brain for {}. Connect a brain on the Connections page (/baglantilar) (Ollama, Codex, "
        "Claude Code or an API) or pick a ready brain for the agent; then start again.",
}
