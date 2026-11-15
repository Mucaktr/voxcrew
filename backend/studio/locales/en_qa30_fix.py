""" sunucu iletileri (EN): "bitene kadar devam et" (kartın önerisi varsayılan, yazılan tavan aynen / tabana
çekilir), önerinin dayanağı ve beklenen / tavan, jeton sınırı olmayan koşunun kartı, onaydan sonra kaçak adım bildirimi."""

from __future__ import annotations

MESSAGES: dict[str, str] = {
    "Yazdığın tavan ({} token) şimdiye kadar harcanan ve uçuştaki turların payından ({} token) küçüktü; koşu sınırı {} "
    "token oldu (uçuştaki tur zaten ödenmekte).":
        "The ceiling you entered ({} tokens) was below what has been spent plus the turns in flight ({} tokens); the run "
        "limit became {} tokens (the in-flight turn is already being paid for).",
    " Önerinin dayanağı: bu koşu başlangıçta beklenenin {} katını harcadı ve bitmedi; kalan iş de aynı oranda büyük "
    "sayıldı: öneri şimdiye kadarki harcamanın {} katı.":
        " Why this suggestion: this run has spent {}× what was expected at the start and is not done; the remaining work "
        "is assumed to be off by the same factor, so the suggestion is {}× what has been spent so far.",
    " Önerinin dayanağı: tahmin aşıldı; öneri şimdiye kadarki harcamanın {} katı (en az 3 katı).":
        " Why this suggestion: the estimate was exceeded; the suggestion is {}× what has been spent so far (at least 3×).",
    " Önerinin dayanağı: kalan işlerin tahmini (geçmişteki benzer işler; yoksa beynin tipik adımı).":
        " Why this suggestion: the estimate of the remaining jobs (similar past jobs; otherwise the brain's typical step).",
    " Beklenen maliyet (tahmin): ≈ {} token; tavan (onaylarsan koşu sınırı): {} token. Sınır bir tavandır, hedef değil: "
    "kullanılmayan pay harcanmaz.":
        " Expected cost (estimate): ≈ {} tokens; ceiling (the run limit if you approve): {} tokens. The limit is a "
        "ceiling, not a target: unused room is not spent.",
    " Ya da bitene kadar devam et: koşu sınırı yazdığın tavan olur (varsayılan bu kartın önerisi {}; değiştirebilirsin, "
    "en az şimdiye kadar harcanan + uçuştaki turlar ≈ {}).":
        " Or continue until done: the run limit becomes the ceiling you enter (default is this card's suggestion, {}; you "
        "can change it, at least what has been spent plus the turns in flight ≈ {}).",
    "Koşu bütçesi doldu (run · {}: {} kullanıldı, sınır {}). Bu koşuda {} iş aynı koşu sınırını paylaşıyor; bu tek karar "
    "hepsini kapsar.":
        "Run budget reached (run · {}: {} used, limit {}). {} jobs in this run share the same run limit; this one "
        "decision covers all of them.",
    " Onaylarsan durdurulan işler yeniden çalışır (API araç döngüsü KALDIĞI YERDEN, diğer beyinler BAŞTAN) ve hepsi yeni "
    "para sınırı altında sürer; kalan işlerin beklenen toplam maliyeti ≈ {} token (iş başına bir tam deneme × 1,25). "
    "Koşuya token sınırı eklenmez.":
        " If you approve, the stopped jobs run again (the API tool loop CONTINUES where it stopped, other brains start "
        "OVER) and all of them continue under the new money limit; the expected total cost of the remaining jobs is ≈ {} "
        "tokens (one full attempt × 1.25 per job). No token limit is added to the run.",
    " Onaylarsan durdurulan işler yeniden çalışır (API araç döngüsü KALDIĞI YERDEN, diğer beyinler BAŞTAN) ve hepsi yeni "
    "sınır {} altında sürer.":
        " If you approve, the stopped jobs run again (the API tool loop CONTINUES where it stopped, other brains start "
        "OVER) and all of them continue under the new limit {}.",
    " Devam et / durdur?": " Continue / stop?",
    "'{}' adımı beklenenden çok harcıyor: {} token (otomatik adım sınırı {} olurdu). Koşunun sınırı onayladığın koşu "
    "kartıyla {} token (şimdiye kadar {} harcandı): bu bir tavandır, hedef değil, ve oraya varmadan kart açılmaz. Adım "
    "çalışmaya devam ediyor; istersen koşuyu duraklat ya da bütçe kutusundan sınırı düşür.":
        "Step '{}' is spending more than expected: {} tokens (the automatic step limit would have been {}). The run limit "
        "is {} tokens after the run card you approved ({} spent so far): it is a ceiling, not a target, and no card opens "
        "before it is reached. The step keeps running; pause the run or lower the limit in the budget box if you want.",
}
