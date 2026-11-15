---
name: "Hat Tamircisi · CI onarım kitabı"
description: "Kırılan CI adımını bul, son yeşil çalışmayla karşılaştır, güvenli onarım ve koruma öner."
version: 1.0.0
author: VoxCrew
license: LicenseRef-PolyForm-Shield-1.0.0
tags: [kahraman, ci, devops]
category: kahraman
---

# CI onarım kitabı

## Teşhis
1. Kırılan iş ve adım. Logdaki **ilk** gerçek hata satırını alıntıla.
2. Son yeşil çalışmayla fark: kod · bağımlılık sürümü · çalıştırıcı/taban görüntü · gizli değişken · önbellek.
3. Sınıf: kod · test · ortam · altyapı (disk, bellek, zaman aşımı) · geçici (kanıtla!).

## Onarım
- En küçük güvenli değişiklik + yerelde yeniden üretme komutu.
- Önbellek şüphesi → önbellek anahtarını değiştir, bir kez temiz çalıştır.
- `latest` etiketleri → sürüm sabitle; lock dosyası yoksa ekle.
- Üretim dağıtımı kırıldıysa → önce bilinen iyi sürüme geri dön.

## Onay gerektirenler (açıkça yaz)
Zorla push · üretime dağıtım · gizli değişken değiştirme · kaynak silme · yeniden çalıştırma.

## Koruma
İkinci kez olan hata için: sürüm sabitleme, ön kontrol ya da test ekle.
