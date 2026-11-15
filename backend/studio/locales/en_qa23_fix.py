""" sunucu iletileri (EN): tek onay yeter (tam deneme önerisi, gerçek devam, kısmi çıktıyla devam), yedek tur
sınırı, tur başına kullanım bildirmeyen uç nokta."""

from __future__ import annotations

MESSAGES: dict[str, str] = {
    "Sıradaki model turu bütçeye sığmıyor ({} · {}: {} kullanıldı, sınır {}; sıradaki tur en az {} token). '{}' adımı o "
    "turdan önce durduruldu; o ana kadar ürettiği yarım çıktı ({} karakter, {} araç çağrısı) korundu.":
        "The next model turn doesn't fit the budget ({} · {}: {} used, limit {}; the next turn needs at least {} "
        "tokens). Step '{}' was stopped before that turn; the partial output it had produced ({} characters, {} tool "
        "calls) was kept.",
    "Bütçe aşıldı ({} · {}: {} / {}). '{}' adımı sıradaki model turundan önce durduruldu; o ana kadar ürettiği yarım "
    "çıktı ({} karakter, {} araç çağrısı) korundu.":
        "Budget exceeded ({} · {}: {} / {}). Step '{}' was stopped before its next model turn; the partial output it "
        "had produced ({} characters, {} tool calls) was kept.",
    "Bütçe aşıldı ({} · {}: {} / {}). '{}' adımı yarıda kaldı.":
        "Budget exceeded ({} · {}: {} / {}). Step '{}' stopped midway.",
    " Akış tur sonu işareti vermedi; adım bir sonraki güvenli noktada durduruldu, bu yüzden bir tur daha ödenmiş olabilir.":
        " The stream gave no end-of-turn signal; the step was stopped at the next safe point, so one more turn may "
        "have been paid.",
    " Onaylarsan adım KALDIĞI YERDEN devam eder (konuşma ve araç sonuçları korunur, yapılan iş yeniden ödenmez); "
    "beklenen maliyet yalnız kalan turlar ≈ {} token{}.":
        " If you approve, the step CONTINUES WHERE IT STOPPED (the conversation and tool results are kept; work "
        "already done isn't paid again); the expected cost is only the remaining turns ≈ {} tokens{}.",
    " Onaylarsan adım BAŞTAN çalışır (bu beyin yarıda kalan oturumu sürdüremez; korunan çıktı isteme VERİ olarak "
    "eklenir); bir tam denemenin beklenen maliyeti ≈ {} token{}.":
        " If you approve, the step runs AGAIN FROM THE START (this brain can't resume a session cut off midway; the "
        "kept output is added to its prompt as DATA); the expected cost of one full attempt ≈ {} tokens{}.",
    " Onaylarsan adım BAŞTAN çalışır; bir tam denemenin beklenen maliyeti ≈ {} token{}.":
        " If you approve, the step runs AGAIN FROM THE START; the expected cost of one full attempt ≈ {} tokens{}.",
    " Bu adımda {} bütçe kartı onaylandı; adıma şimdiye kadar toplam {} token harcandı (bu adım için beklenen bir tam "
    "işin ≈ {} katı). Önerilen: adımı durdur ve kısmi çıktıyla devam et. İstersen yeni sınır {} ile sürdür ya da koşuyu "
    "durdur.":
        " {} budget cards were already approved for this step; {} tokens have been spent on it so far (≈ {}× the full "
        "job expected for this step). Suggested: stop the step and continue with its partial output. You can still "
        "continue with a new limit of {} or stop the run.",
    " Yeni sınır {} ile devam et / durdur?": " Continue with a new limit of {} / stop?",
    " Yeni sınır bir toplamdır: şimdiye kadar harcanan {} (durdurulan denemeler dahil) bu sınırdan düşülür; harcama "
    "sayacı sıfırlanmaz.":
        " The new limit is a total: the {} spent so far (stopped attempts included) counts against it; the spend "
        "counter isn't reset.",
    "(adım bütçe sınırında durduruldu; kısmi çıktı boş)": "(the step was stopped at its budget limit; partial output is empty)",
    "Adım bütçe sınırında durduruldu; kullanıcı kısmi çıktıyla devam etmeyi seçti ({} karakter, {} araç çağrısı). Çıktı "
    "eksik olabilir.":
        "The step was stopped at its budget limit; the user chose to continue with its partial output ({} characters, "
        "{} tool calls). The output may be incomplete.",
    "Konuşma durumu bu oturumda yok; adım kaldığı yerden sürdürülemedi, korunan çıktıyla baştan çalışıyor.":
        "The conversation state isn't available in this session; the step couldn't continue where it stopped and runs "
        "again from the start with the kept output.",
    "Bu uç nokta tur başına kullanım bildirmiyor: tokenlar tahminidir (≈ karakter/4) ve tavan yalnız adım sonunda "
    "denetlenir (adım sürerken durdurulamaz).":
        "This endpoint doesn't report usage per turn: tokens are estimated (≈ characters/4) and the cap is checked "
        "only when the step ends (it can't be stopped while it runs).",
}
