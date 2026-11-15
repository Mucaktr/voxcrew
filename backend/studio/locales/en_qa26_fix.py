""" sunucu iletileri (EN): koşu genelinde tek bütçe kararı (tüm ağaç), kart yeniden soruluşunda yeni kimlik,
korunan aşımda gerçekten aşan adım, rezervasyon durması, büyütülmüş öneri, iç içe kısmi sonucun EKSİK işareti."""

from __future__ import annotations

MESSAGES: dict[str, str] = {
    # kart yeniden sorulunca yeni kimlik
    "Karar yeniden soruldu; yerine yeni kart açıldı": "The decision was asked again; a new card replaced this one",
    # kat yalnız adımın / ajanın geçmişiyle
    " Bu adımda {} bütçe kartı onaylandı; adıma şimdiye kadar toplam {} token harcandı. Önerilen: adımı durdur ve kısmi "
    "çıktıyla devam et. İstersen yeni sınır {} ile sürdür ya da koşuyu durdur.":
        " {} budget cards were approved for this step; {} tokens have been spent on it so far. Suggested: stop the step "
        "and continue with its partial output. Or continue with the new limit {}, or stop the run.",
    # tek koşu kartı ağacın kalan işini karşılar
    " Önerilen sınır koşunun kalan işlerini de ({} iş, ≈ {} token) karşılar; bu karar koşu sınırı için tektir.":
        " The suggested limit also covers the run's remaining jobs ({} jobs, ≈ {} tokens); this is the one decision for "
        "the run limit.",
    "Koşu sınırı kalan işlere yetmiyor (run · tokens: {} kullanıldı, sınır {}). Bu koşuda {} iş aynı koşu sınırını "
    "paylaşıyor; bu tek karar hepsini kapsar.":
        "The run limit is not enough for the remaining jobs (run · tokens: {} used, limit {}). {} jobs in this run share "
        "the same run limit; this one decision covers all of them.",
    " Ardından {} sentez de bu sınırla çalışır: {}.": " After that, {} syntheses also run under this limit: {}.",
    # tek adım kartında kısmi çıktıyla devam → kalan işlere yer
    " Kısmi çıktıyla devam edersen kalan işler için koşu sınırı {} olur.":
        " If you continue with the partial output, the run limit becomes {} for the remaining jobs.",
    # büyütülmüş öneri
    " Durdurulan işlerden biri onaylanan önceki tam denemede de durdu; tahmin işi küçük gördüğü için öneri bu kez {} kat "
    "geniş tutuldu (sınır bir tavandır, kullanılmayan pay harcanmaz).":
        " One of the stopped jobs also stopped in the previously approved full attempt; the estimate saw the job as too "
        "small, so this time the suggestion is {}× wider (the limit is a ceiling; unused room is not spent).",
    # korunan aşım kartı aşan adımı adlandırır
    "{} adımı kendi bütçesini aştı ({}: {} / {}); çıktısı korundu. Sıradaki adım '{}' ile devam et / durdur?":
        "Step {} went over its own budget ({}: {} / {}); its output was kept. Continue with the next step '{}' / stop?",
    # iç içe yönetici ve EKSİK işareti
    "Kullanıcı bütçe sınırında kalan işleri durdurdu; bu iş sentezsiz, yalnız biten alt görevlerin çıktısıyla bitti "
    "({} / {} alt görev). Çıktı eksik olabilir.":
        "The user stopped the remaining jobs at the budget limit; this job finished without a synthesis, with only the "
        "output of its finished subtasks ({} / {} subtasks). The output may be incomplete.",
    "Bu işin bazı alt görevleri bütçe sınırında kısmi bitti ya da durduruldu ({}); sonuç eksik sayılır ve sonraki "
    "adımlara EKSİK işaretiyle verilir.":
        "Some subtasks of this job finished with partial output or were stopped at the budget limit ({}); the result "
        "counts as incomplete and is passed on to later steps marked INCOMPLETE.",
}
