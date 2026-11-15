"""İngilizce katalog — S50 'deliverables' alanı (çıktılar, teslim, dışa aktarım). `en.py` sonunda birleştirilir
(en_fixes / en_heroes deseni: ortak dosyada eşzamanlı düzenleme olmasın diye ayrı)."""

from __future__ import annotations

MESSAGES: dict[str, str] = {
    "Çıktı yok: {}": "Output not found: {}",
    "Geçersiz çıktı türü: {}": "Invalid output type: {}",
    "Geçersiz çıktı kaynağı: {}": "Invalid output source: {}",
    "Geçersiz biçim: {}": "Invalid format: {}",
    "{} true/false olmalı": "{} must be true/false",
    "{} ilişkisi yalnız aynı türden düğümler arasında kurulur ({} → {})":
        "The {} relationship only links nodes of the same type ({} → {})",
    "Dosya artık çalışma klasöründe yok": "The file is no longer in the working folder",
    "Bu çıktı metin olarak dışa aktarılamaz": "This output cannot be exported as text",
    "Bu dosya türü ham olarak verilmez; metin dışa aktarımını kullan":
        "This file type is not served raw; use a text export",
    "Kullanıcıya yalnızca uygulama teslim kalemi gönderebilir": "Only the studio can deliver items to the user",
    # DELIV-P0 (ikili orijinal indirme, klasörde göster, uygulama önizlemesi, kasa)
    "Bu dosya yalnızca uygulama arayüzünden, maskelenmemiş orijinal olarak indirilebilir":
        "This file can only be downloaded from the studio interface, as the unmasked original",
    "Bu çıktının indirilecek bir orijinal dosyası yok": "This output has no original file to download",
    "Metin dosyaları maskeli indirilir; metin dışa aktarımını kullan":
        "Text files are downloaded masked; use the text export",
    "Bu çıktı bir dosya değil (sonuç metni); klasörde gösterilemez":
        "This output is not a file (result text); it cannot be shown in a folder",
    "Bu çıktı bir uygulama paketi değil": "This output is not an app package",
    "Dosya pakette yok": "The file is not in the package",
    "Çok sık istek: bir dakika içinde en çok 10 kez": "Too many requests: at most 10 per minute",
    "Önce planı al: plan_hash gerekli": "Get the plan first: plan_hash is required",
    "Dosya ya da konum plandan sonra değişti; planı yenile": "The file or its location changed after the plan; refresh the plan",
    "Bu sistemde dosya yöneticisi bulunamadı": "No file manager was found on this system",
    "Dosya yöneticisi başlatılamadı": "Could not start the file manager",
    "Geçersiz içerik özeti": "Invalid content digest",
    # DEPO-TESLIM: sürüm karşılaştırma ve satır içi görüntüleme
    "Bu önizleme yalnızca uygulama arayüzünden, kullanıcı tarafından açılabilir":
        "This preview can only be opened from the studio interface, by the user",
    "Bu çıktının önizlenecek bir dosyası yok": "This output has no file to preview",
    "Bu dosya türü tarayıcıda önizlenemez": "This file type cannot be previewed in the browser",
    "Dosya satır içi önizleme için çok büyük; indirerek aç": "The file is too large for an inline preview; download it to open",
    "Kasa kopyası kayıtla uyuşmuyor; önizleme verilmedi": "The vault copy does not match its record; no preview was served",
    "against (karşılaştırılacak sürüm) gerekli": "against (the version to compare with) is required",
    "Dosya geçerli bir PDF değil; önizleme verilmedi": "The file is not a valid PDF; no preview was served",
    "Kasa kopyası yok; önizleme verilemez": "There is no vault copy; no preview can be served",
    "Bir sürüm kendisiyle karşılaştırılamaz": "A version cannot be compared with itself",
    "Yalnızca aynı çıktının sürümleri karşılaştırılır": "Only versions of the same output can be compared",
}

SECTION_TITLES: dict[str, str] = {}
