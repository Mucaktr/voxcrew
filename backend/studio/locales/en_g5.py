"""G5 (iş ailesi ve konfigürasyon matrisi) iletilerinin İngilizce karşılıkları."""

from __future__ import annotations

MESSAGES: dict[str, str] = {
    "İş ailesi yok: {}": "Task family not found: {}",
    "İş ailesi yüklenemedi: {}": "The task family couldn't be loaded: {}",
    "Vaka seti sabitlenmiş sha ile uyuşmuyor; sürümü artırıp bölünmeyi yeniden sabitle":
        "The case set doesn't match its pinned sha; bump the version and re-pin the split",
    "split 'dev' ya da 'holdout' olmalı": "split must be 'dev' or 'holdout'",
    "configs A, B, C, D değerlerinden oluşmalı": "configs must be made of A, B, C, D",
    "k bir tam sayı olmalı": "k must be an integer",
    "k 1–{} olmalı": "k must be 1–{}",
    "reviewer true ya da false olmalı": "reviewer must be true or false",
    "attempt_timeout_s bir sayı olmalı": "attempt_timeout_s must be a number",
    "attempt_timeout_s {}–{} sn olmalı": "attempt_timeout_s must be {}–{} s",
    "Ayrık sette vaka seçilemez; set bütün olarak koşar": "You can't pick cases from the holdout set; it runs as a whole",
    "case_ids geliştirme setindeki vaka kimliklerinden oluşmalı": "case_ids must be case ids from the dev set",
    "Bir matris koşusu zaten sürüyor; bitmesini bekle ya da iptal et":
        "A matrix run is already in progress; wait for it to finish or cancel it",
    "Bir matris koşusu sürüyor; bitmesini bekle ya da iptal et":
        "A matrix run is in progress; wait for it to finish or cancel it",
    "memory.graph_expand 0, 1 ya da 2 olmalı": "memory.graph_expand must be 0, 1 or 2",
    "Koşu bitmeden silinemez": "A run can't be deleted before it finishes",
    "Matris koşusu yok: {}": "Matrix run not found: {}",
    "Bu matris koşusu çalışmıyor": "This matrix run isn't running",
}
