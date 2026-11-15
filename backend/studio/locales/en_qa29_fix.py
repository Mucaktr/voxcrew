""" sunucu iletileri (EN): koşu sınırının şekli, otomatik bütçenin başlangıç payı, koşu kartı önerisi ("bitene
kadar devam et"), araç yürütme defteri / havuz sınırı, kaçak adım bildirimi, iptal edilen adım."""

from __future__ import annotations

MESSAGES: dict[str, str] = {
    "İptal edildi": "Cancelled",
    "Araç yürütme havuzu dolu ({} kayıt): {} yürütme havuza eklenemedi. Güvenlik için bu alt ağaçta önceki bir "
    "yürütmeyle eşleşmeyen yan etkili araç çağrıları artık çalıştırılmıyor (ikinci kez yürümesinler diye).":
        "The tool execution pool is full ({} entries): {} executions could not be added. For safety, side-effecting tool "
        "calls in this subtree that do not match an earlier execution are no longer run (so they cannot run twice).",
    "Araç yürütme defteri dolu ({} yan etkili yürütme): bu adımın yeni yan etkili araç çağrıları güvenlik için "
    "çalıştırılmıyor (yeniden denemede ikinci kez yürümesinler diye). Adımı daha küçük işlere böl.":
        "The tool execution ledger is full ({} side-effecting executions): for safety this step's new side-effecting "
        "tool calls are not run (so they cannot run twice on a retry). Split the step into smaller jobs.",
    "Araç yürütme havuzu dolu: önceki denemelerin bütün yürütmeleri izlenemediği için bu alt ağaçtaki yan etkili araç "
    "çağrıları güvenlik için çalıştırılmıyor (ikinci kez yürümesinler diye).":
        "The tool execution pool is full: not every execution of the earlier attempts can be tracked, so for safety "
        "side-effecting tool calls in this subtree are not run (so they cannot run twice).",
    "Otomatik koşu bütçesi {} token'a yükseldi: koşunun ilk turları için ayrılan pay (× 1,25) sınıra sığmıyordu (henüz "
    "harcama yok)":
        "The automatic run budget was raised to {} tokens: the share reserved for the run's first turns (× 1.25) did "
        "not fit the limit (nothing spent yet)",
    " Bu koşuya token sınırı koymadın: token sınırı, başlamadan önceki öngörüden ({} token × 1,25) hesaplanan otomatik "
    "koşu bütçesidir (senin koyduğun sınır da geçerli).":
        " You set no token limit for this run: the token limit is the automatic run budget computed from the pre-start "
        "estimate ({} tokens × 1.25) (your own limit applies too).",
    " Ya da bitene kadar devam et: koşu sınırı {} olur (şimdiye kadar harcananın {} katı; değiştirebilirsin).":
        " Or continue until done: the run limit becomes {} ({}× what has been spent so far; you can change it).",
    " Para sınırı da doldu ({} kullanıldı, sınır {}); onaylarsan para sınırı {} olur.":
        " The money limit is reached too ({} used, limit {}); if you approve, the money limit becomes {}.",
    "'{}' adımı beklenenden çok harcıyor: {} token (otomatik adım sınırı {} olurdu). Koşunun sınırı otomatik koşu "
    "bütçesi ({} token; şimdiye kadar {} harcandı): bu bir tavandır, hedef değil, ve oraya varmadan kart açılmaz. Adım "
    "çalışmaya devam ediyor; istersen koşuyu duraklat ya da bütçe kutusundan sınırı düşür.":
        "Step '{}' is spending more than expected: {} tokens (the automatic step limit would have been {}). The run's "
        "limit is the automatic run budget ({} tokens; {} spent so far): it is a ceiling, not a target, and no card "
        "opens before it is reached. The step keeps running; pause the run or lower the limit in the budget box if you "
        "want.",
    "Adım beklenenden çok harcıyor: {}": "A step is spending more than expected: {}",
}
