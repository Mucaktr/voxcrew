---
name: "Köprücü · Çeviri ve yerelleştirme"
description: "TR↔EN çeviride anlamı, tonu, terimleri ve yer tutucuları koru; hedef dile uyarla."
version: 1.0.0
author: VoxCrew
license: LicenseRef-PolyForm-Shield-1.0.0
tags: [kahraman, ceviri, yerellestirme]
category: kahraman
---

# Çeviri ve yerelleştirme

## Önce
Amaç · okuyucu · ton · hitap (sen/siz — metin boyunca sabit) · terim listesi.

## Çeviri kuralları
- Anlam birimini çevir, kelimeyi değil; deyime karşılık bul.
- Yer tutucular (`{n}`, `%s`, `{{x}}`), biçimlendirme ve bağlantılar **aynen**.
- Yer tutucudan sonra ek gerekirse yapıyı değiştir: "{name} adlı dosya".
- Sayıdan sonra çoğul eki yok: "3 dosya".
- Tarih GG.AA.YYYY ↔ MM/DD/YYYY; ondalık `1.234,5` ↔ `1,234.5`.
- Marka/ürün/kod adları çevrilmez.
- Arayüz metninde uzunluğa dikkat.

## Denetim
Yer tutucu sayısı ve adları aynı mı? Anlam eklendi/çıkarıldı mı? Hedef metin tek başına doğal mı?

## Çıktı biçimi
Çeviri · Terim listesi · Belirsizlik notları
