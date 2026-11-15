---
name: "Kök Avcısı · Hata ayıklama oyun kitabı"
description: "Hatayı yeniden üret, hipotezle daralt, kanıtla düzelt ve doğrula."
version: 1.0.0
author: VoxCrew
license: LicenseRef-PolyForm-Shield-1.0.0
tags: [kahraman, hata-ayiklama, test]
category: kahraman
---

# Hata ayıklama oyun kitabı

## Adımlar
1. **Belirti** — tek cümle: ne bekleniyordu, ne oldu. Hata metnini birebir alıntıla.
2. **Yeniden üret** — en küçük komut/girdi. Üretemiyorsan bunu açıkça yaz ve eksik bilgiyi iste.
3. **Daralt** — en fazla üç hipotez; her birine onu çürütecek tek deney.
4. **Kök neden** — "X, Y koşulunda Z yaptığı için" biçiminde, kanıt satırıyla.
5. **Düzeltme** — en küçük değişiklik, birleşik diff. Önce hatayı yakalayan kırmızı test.
6. **Doğrula** — çalıştırılacak komut + sınır durumları (boş, tek, çok büyük girdi).

## Kontrol listesi
- [ ] Sürüm, işletim sistemi, komut ve ortam not edildi
- [ ] Tek seferde tek değişken değiştirildi
- [ ] Hata yutulmadı; anlamlı mesajla yeniden fırlatıldı
- [ ] Emin olunmayan yerler DOĞRULANMADI diye işaretli

## Çıktı biçimi
`Belirti · Yeniden üretme · Hipotezler · Kök neden · Yama (diff) · Doğrulama`
