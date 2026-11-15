""" sunucu iletileri (EN): koşu düzeyinde tek bütçe kararı (birden çok çocuk), yan etki sınıfına göre araç
yürütme defteri, kendi araçlarını çalıştıran beyinler için dürüst kapsam notu, çitli dosya adları."""

from __future__ import annotations

MESSAGES: dict[str, str] = {
    # yürütme defteri
    " Uygulamanın araç döngüsünde daha önce başarıyla yürütülen yan etkili araç çağrıları yeniden yürütülmez, kayıtlı "
    "sonuçları kullanılır; salt okunur araçlar yeniden çalışır.":
        " Side-effecting tool calls that already ran successfully in the studio's tool loop are not executed again; "
        "their recorded results are used. Read-only tools run again.",
    "Araç sınıfları yalnızca /api/tools/classes üzerinden değiştirilebilir":
        "Tool classes can only be changed through /api/tools/classes",
    "Araç adı 'sunucu:araç' biçiminde olmalı": "The tool name must have the form 'server:tool'",
    "Sınıf read, idempotent, effect ya da null olmalı": "The class must be read, idempotent, effect or null",
    "Araç sınıfı yalnızca uygulama arayüzünden, kullanıcı tarafından değiştirilebilir":
        "A tool's class can only be changed by the user, from the studio interface",
    # kendi araçlarını çalıştıran beyinler
    " Bu adımın beyni ({}) kendi araçlarını kendisi çalıştırır: uygulamanın araç yürütme defteri yalnız uygulamanın API "
    "araç döngüsünü kapsar. Adım baştan çalışırsa bu beynin araçları (dosya yazma, komut, ağ isteği) yeniden "
    "çalışabilir.":
        " This step's brain ({}) runs its own tools: the studio's tool execution ledger covers only the studio's own "
        "API tool loop. If the step runs again from the start, this brain's tools (file writes, commands, network "
        "requests) may run again.",
    # dosya adları çitli veri
    "[uygulanan dosya adları (veri): {}]": "[applied file names (data): {}]",
    "adı aşağıda çitli veri bölümünde": "name in the fenced data section below",
    # öneri değişen kart
    "Öneri değişti; yerine yeni kart açıldı": "The proposal changed; a new card replaced this one",
    # kısmi seçenek başlamadan önceki kartta
    " Bu adımda {} bütçe kartı onaylandı; adıma şimdiye kadar toplam {} token harcandı. Önerilen: adımı durdur ve son "
    "korunan kısmi çıktısıyla devam et.":
        " {} budget cards were approved for this step; {} tokens have been spent on it so far. Suggested: stop the step "
        "and continue with its last kept partial output.",
    " Bu adım onaylanan önceki tam denemede de durdu; tahmin işi küçük gördüğü için öneri bu kez {} kat geniş tutuldu "
    "(sınır bir tavandır, kullanılmayan pay harcanmaz).":
        " This step also stopped in the previously approved full attempt; the estimate saw the job as too small, so this "
        "time the suggestion is {}× wider (the limit is a ceiling; unused room is not spent).",
    # koşu düzeyinde tek karar
    "Koşu bütçesi kararı": "Run budget decision",
    "Koşu bütçesi doldu (run · tokens: {} kullanıldı, sınır {}). Bu koşuda {} iş aynı koşu sınırını paylaşıyor; bu tek "
    "karar hepsini kapsar.":
        "Run budget reached (run · tokens: {} used, limit {}). {} jobs in this run share the same run limit; this one "
        "decision covers all of them.",
    " Durdurulan: {}.": " Stopped: {}.",
    " Önerilen sınır, bu iş bitince yöneticinin sonuçları birleştirmesini (sentez, ≈ {} token) de karşılar.":
        " The suggested limit also covers the manager combining the results once this job is done (synthesis, "
        "≈ {} tokens).",
    " Ardından yöneticinin sonuçları birleştirmesi (sentez) de bu sınırla çalışır.":
        " After that, the manager's synthesis of the results also runs under this limit.",
    " Çalışan: {}.": " Running: {}.",
    " Sırada: {}.": " Waiting: {}.",
    " Onaylarsan durdurulan işler yeniden çalışır (API araç döngüsü KALDIĞI YERDEN, diğer beyinler BAŞTAN) ve hepsi "
    "yeni sınır {} altında sürer; kalan işlerin beklenen toplam maliyeti ≈ {} token (iş başına bir tam deneme × 1,25).":
        " If you approve, the stopped jobs run again (the API tool loop FROM WHERE IT STOPPED, other brains FROM THE "
        "START) and all of them continue under the new limit {}; the expected total cost of the remaining jobs is "
        "≈ {} tokens (one full attempt × 1.25 per job).",
    " Bu işler için {} bütçe kartı onaylandı; şimdiye kadar toplam {} token harcandı. Önerilen: kalan işleri durdur ve "
    "bitenlerle devam et (durdurulan işler korunan kısmi çıktılarıyla, eksik olarak işaretli biter).":
        " {} budget cards were approved for these jobs; {} tokens have been spent so far. Suggested: stop the remaining "
        "jobs and continue with what is done (stopped jobs finish with their kept partial output, marked as "
        "incomplete).",
    " Bitenlerle devam edersen sonuçları birleştirmek için koşu sınırı {} olur.":
        " If you continue with what is done, the run limit becomes {} so the results can be combined.",
    " İstersen yeni sınır {} ile sürdür ya da koşuyu durdur.":
        " Or continue with the new limit {}, or stop the run.",
    " Onaylarsan işlerin kendi adım sınırları da gerektiği kadar yükselir ({} iş).":
        " If you approve, the jobs' own step limits are raised as needed too ({} jobs).",
    "Kullanıcı bütçe sınırında kalan işleri durdurdu; bu iş tamamlanmadı.":
        "The user stopped the remaining jobs at the budget limit; this job was not completed.",
    "Kullanıcı bütçe sınırında kalan işleri durdurdu": "The user stopped the remaining jobs at the budget limit",
}
