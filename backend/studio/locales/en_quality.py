"""İngilizce katalog — CG-QUALITY (kalite kapısı). `en.py` bu sözlüğü MESSAGES'a katar."""

from __future__ import annotations

MESSAGES: dict[str, str] = {
    # quality/api.py
    "Kalite kararları yalnızca uygulama arayüzünden, kullanıcı tarafından verilebilir":
        "Quality decisions can only be made by the user from the studio UI",
    "Gövde bir nesne olmalı": "The body must be an object",
    "{} true/false olmalı": "{} must be true/false",
    "Bu çıktı metin içermiyor; kalite denetimi yapılamaz": "This output has no text; it cannot be quality-checked",
    "reason metin olmalı": "reason must be a string",
    "false_positive true/false olmalı": "false_positive must be true/false",
    "note metin olmalı": "note must be a string",
    # quality/service.py
    "Kalite raporu yok: {}": "No quality report: {}",
    "Bulgu yok: {}": "No such finding: {}",
    "Koşu bulunamadı": "Run not found",
    "Koşu hâlâ sürüyor; bitince revizyon iste": "The run is still going; request a revision when it finishes",
    "Revize edilecek ajan adımı yok": "There is no agent step to revise",
    "Çıktıda talimat benzeri metin var (olası istem enjeksiyonu): {}":
        "The output contains instruction-like text (possible prompt injection): {}",
    "Denetim komutu başarısız: {}": "Check command failed: {}",
    "Denetim komutu tanımlı değil": "No check command is declared",
    "Araç politikası izin vermiyor: {}": "Your tool policy does not allow it: {}",
    # quality/reviewer.py
    "Denetçi yanıtında JSON yok": "The reviewer's answer contains no JSON",
    "Denetçi puanı sayı değil": "The reviewer's score is not a number",
    "Denetçi beyni kullanılamıyor: {}": "The reviewer brain is not available: {}",
}
