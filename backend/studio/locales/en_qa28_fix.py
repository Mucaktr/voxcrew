""" sunucu iletileri (EN): otomatik koşu bütçesi, havuz büyüklük uyarıları, baştan çalıştırma denemesinin
bitişi."""

from __future__ import annotations

MESSAGES: dict[str, str] = {
    "Otomatik koşu bütçesi: {} token (başlamadan önceki öngörü {} × 1,25)":
        "Automatic run budget: {} tokens (pre-start estimate {} × 1.25)",
    "Otomatik koşu bütçesi yeniden deneme için {} token'a yükseldi (harcanan {} + kalan işin öngörüsü)":
        "The automatic run budget was raised to {} tokens for the retry (spent {} + the estimate of the remaining work)",
    " Bu koşuya sınır koymadın: sınır, başlamadan önceki öngörüden ({} token × 1,25) hesaplanan otomatik koşu "
    "bütçesidir.":
        " You set no limit for this run: the limit is the automatic run budget computed from the pre-start estimate "
        "({} tokens × 1.25).",
    "Araç yürütme havuzu çok büyüdü ({} kayıt): yeni kayıtlar sonuç metni olmadan saklanıyor (yürütmeler yine tekrar "
    "kullanılır, yeniden yürütülmez).":
        "The tool execution pool grew very large ({} entries): new entries are kept without their result text (the "
        "executions are still reused, not run again).",
    "Araç yürütme havuzu dolu ({} kayıt): {} yürütme havuza eklenemedi; bu yürütmeler yeniden denemede tekrar "
    "yürüyebilir.":
        "The tool execution pool is full ({} entries): {} executions could not be added; they may run again on a retry.",
    "Baştan çalıştırma denemesi bitti; sonraki yeniden denemeler bu denemenin yürütmelerini tekrar kullanır":
        "The run-from-scratch attempt ended; later retries reuse this attempt's executions",
    "sonuç metni saklanmadı: havuz çok büyük": "result text not kept: the pool is very large",
}
