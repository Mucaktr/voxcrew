"""İngilizce katalog — dalga 3 hafif ekip paylaşımı (studio/share iletileri)."""

from __future__ import annotations

# Ortak iletiler (Ajan yok, İş akışı yok…) ana katalogdadır; burada yeniden tanımlanmaz.
MESSAGES: dict[str, str] = {
    "Paket reddedildi": "Bundle rejected",
    "Paket geçerli bir JSON dosyası değil": "The bundle is not a valid JSON file",
    "Paket çok büyük (en fazla {} KB)": "The bundle is too big (up to {} KB)",
    "Paket çok büyük ({} KB; en fazla {} KB): daha az öğe seç": "The bundle is too big ({} KB; up to {} KB): pick fewer items",
    "Gövde {bundle, choices, confirm} biçiminde olmalı": "The body must look like {bundle, choices, confirm}",
    "İçe aktarmak için önizlemeyi onayla (confirm: true)": "Confirm the preview to import (confirm: true)",
    "Geçersiz seçim: {}": "Invalid choice: {}",
    "{}: bu öğe için '{}' seçilemez": "{}: '{}' can't be chosen for this item",
    "Dışa aktarılacak 1–{} öğe seç": "Pick 1–{} items to export",
    "Seçim {kind, id} biçiminde olmalı": "Each selection must look like {kind, id}",
    "Seçim {kind: job|agent|output, id} biçiminde olmalı": "Each selection must look like {kind: job|agent|output, id}",
    "Çıktı şablonu yok: {}": "No such output template: {}",
    "Komut çalıştıran kabul ölçütü içe aktarılamaz": "Acceptance criteria that run a command can't be imported",
    "Komut çalıştıran kalite denetimi (quality.check) içe aktarılamaz":
        "A quality check that runs a command (quality.check) can't be imported",
    "{}: işe alım Güvenli mod'da kapalı; işe alan adım içe aktarılamaz":
        "{}: hiring is off in Safe mode; a step that hires can't be imported",
    "{}: bilinmeyen ya da yerel beyin ({})": "{}: unknown or local-only brain ({})",
    "{}: model politikası bu beyne/modele izin vermiyor": "{}: the model policy doesn't allow this brain/model",
    "{}: otomatik işe alım onayı 'sor' yapıldı": "{}: automatic hiring approval was changed to 'ask'",
    "{}: otomatik plan onayı 'sor' yapıldı": "{}: automatic plan approval was changed to 'ask'",
    "Bu ajanlar sende yok; akışı çalıştırmadan önce adımlara ajan seç: {}":
        "You don't have these agents; pick agents for the steps before running the workflow: {}",
    "Paket sınırı: yeni iş akışı eklenemez": "Plan limit: no new workflows can be added",
}
