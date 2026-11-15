""" sunucu iletileri (EN): motor hatasıyla failed biten koşu, biten koşuda iptal / devam, olası kaydedilmemiş
istek işareti ve metrik / kapsam anahtarı yer tutuculu koşu kartı başlıkları."""

from __future__ import annotations

MESSAGES: dict[str, str] = {
    "Motor beklenmeyen bir hatayla durdu ({}); koşu başarısız sayıldı. Harcama ve biten adımların çıktısı korundu; "
    "başarısız adımı yeniden deneyebilir ya da koşuyu çatallayabilirsin.":
        "The engine stopped on an unexpected error ({}); the run is marked as failed. Spending and the output of finished "
        "steps are kept; you can retry the failed step or fork the run.",
    "Koşu zaten bitti; iptal edilecek çalışan iş yok": "The run has already finished; there is no running work to cancel",
    "Koşu bitti; devam ettirilemez. Başarısız adımı yeniden deneyebilir ya da koşuyu çatallayabilirsin.":
        "The run has finished and cannot be resumed. You can retry the failed step or fork the run.",
    "Olası kaydedilmemiş istek: adım durdurulurken sıradaki isteği göndermiş olabilir (en çok ≈ {} token girdi). Kanıt "
    "olmadığı için harcamaya sayılmadı.":
        "Possible unrecorded request: the step may have sent its next request while it was being stopped (at most ≈ {} "
        "input tokens). It is not counted as spending because there is no evidence.",
    " Bu tek sorudur: onaylarsan token sınırı önerilen değer olur; o da aşılırsa koşu, koyduğun sınır için seçtiğin gibi "
    "duraklar (yeniden sorulmaz).":
        " This is the only question: if you approve, the token limit becomes the proposed value; if that is exceeded too, "
        "the run pauses, as you chose for your own limit (you will not be asked again).",
    " Bu tek sorudur: onaylarsan token sınırı önerilen değer olur; o da aşılırsa koşu, koyduğun sınır için seçtiğin gibi "
    "durur (yeniden sorulmaz).":
        " This is the only question: if you approve, the token limit becomes the proposed value; if that is exceeded too, "
        "the run stops, as you chose for your own limit (you will not be asked again).",
    "Koşu bütçesi doldu ({} · {}: {} kullanıldı, sınır {}). Bu koşuda {} iş aynı koşu sınırını paylaşıyor; bu tek karar "
    "hepsini kapsar.":
        "Run budget reached ({} · {}: {} used, limit {}). {} jobs in this run share the same run limit; this one "
        "decision covers all of them.",
    "Koşu sınırı kalan işlere yetmiyor ({} · {}: {} kullanıldı, sınır {}). Bu koşuda {} iş aynı koşu sınırını "
    "paylaşıyor; bu tek karar hepsini kapsar.":
        "The run limit is not enough for the remaining jobs ({} · {}: {} used, limit {}). {} jobs in this run share the "
        "same run limit; this one decision covers all of them.",
}
