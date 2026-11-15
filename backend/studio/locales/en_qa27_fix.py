""" sunucu iletileri (EN): devretme düzeyi yürütme havuzu (tekrar kullanım), sahipsiz kartların kapanışı, kaçak
adım uyarısı, kapsanan işin büyütülmüş önerisi, havuzsuz ("baştan çalıştır") yeniden deneme."""

from __future__ import annotations

MESSAGES: dict[str, str] = {
    "önceki denemeden tekrar kullanıldı": "reused from the previous attempt",
    "{}: önceki denemeden tekrar kullanıldı (yeniden yürütülmedi)": "{}: reused from the previous attempt (not run again)",
    "Koşu bitti; bu karar artık gerekmiyor": "The run finished; this decision is no longer needed",
    "Kartın işi artık yok (yeniden planlandı ya da bitti); karar gerekmiyor":
        "The card's job no longer exists (re-planned or finished); no decision needed",
    "Koşu sürdürüldü; karar gerekirse yeni kartla yeniden sorulur":
        "The run was resumed; if a decision is still needed it is asked again on a new card",
    "Bu adım beklenenden çok harcıyor: {} token (otomatik adım sınırı {} olurdu; karar koşu sınırında). Çalışmaya devam "
    "ediyor.":
        "This step is spending more than expected: {} tokens (its automatic step limit would have been {}; the run limit "
        "decides). It keeps running.",
    " Bu iş onaylanan önceki koşu kartının önerisinde vardı ama o pay yetmedi; öneri bu kez {} kat geniş tutuldu (sınır "
    "bir tavandır, kullanılmayan pay harcanmaz).":
        " This job was included in the previously approved run card's proposal but that share was not enough; this "
        "time the proposal is {}× wider (the limit is a ceiling, unused headroom is not spent).",
    " Bu koşunun sınırı için {} koşu bütçe kartı onaylandı.": " {} run budget cards were approved for this run's limit.",
    "Baştan çalıştır (önceki yürütmeler tekrar kullanılmaz)": "Run from scratch (earlier executions are not reused)",
}
