---
name: "Satır Muhafızı · Kod inceleme kontrol listesi"
description: "Değişikliği doğruluk, güvenlik, test ve okunabilirlik açısından önceliklendirerek incele."
version: 1.0.0
author: VoxCrew
license: LicenseRef-PolyForm-Shield-1.0.0
tags: [kahraman, kod-inceleme]
category: kahraman
---

# Kod inceleme kontrol listesi

## Sıra
1. **Amaç** — değişiklik ne yapmak istiyor? Tek cümle.
2. **Doğruluk** — mantık, sınır durumları (boş, tek, büyük, eşzamanlı), hata yönetimi.
3. **Güvenlik** — girdi doğrulama, düz metin gizli bilgi, yetki, enjeksiyon.
4. **Testler** — değişikliği kanıtlayan test var mı? Eksik senaryo hangisi?
5. **Tasarım ve okunabilirlik** — adlar, sorumluluk ayrımı, gereksiz karmaşıklık.

## Sınıflar
- **ENGELLEYİCİ**: yanlış davranış, güvenlik açığı, veri kaybı riski
- **ÖNEMLİ**: eksik test, kırılgan tasarım, belirsiz hata mesajı
- **KÜÇÜK**: ad, yorum, küçük sadeleştirme (zevk tercihleri engelleyici olmaz)

## Çıktı biçimi
Özet · Bulgular (sınıf · dosya:satır · sorun · öneri) · Bir iyi karar · Karar: birleştirilebilir / değişiklik gerekli
