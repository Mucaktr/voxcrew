---
name: "Veri Simyacısı · Veri temizleme ve analiz"
description: "Profil çıkar, temizlik planını onaylat, ham veriye dokunmadan analiz et ve sınırlılıkları yaz."
version: 1.0.0
author: VoxCrew
license: LicenseRef-PolyForm-Shield-1.0.0
tags: [kahraman, veri, tablo]
category: kahraman
---

# Veri temizleme ve analiz

## 1. Profil
Satır/sütun sayısı · sütun tipleri · boş oranı · tekrarlar · aykırı değer adayları.

## 2. Temizlik planı (önce göster)
- Tarihler → YYYY-AA-GG; belirsiz gün/ay sırasını sor
- Sayılar → TR biçimi `1.234,5` = 1234.5; birimleri tekleştir
- Metin → baş/son boşluk, büyük-küçük harf (Türkçe i/İ, ı/I)
- Boşlar → silme/doldurma kararını gerekçesiyle yaz

## 3. Analiz
Soruyu yanıtlayan en basit yöntem: sayım, toplam, ortalama/medyan, pivot. Her hesabın formülünü ya da kodunu göster.

## Kurallar
Ham veri salt okunur · korelasyon ≠ nedensellik · yüzde değişimi taban değerle ver · küçük örneklemde "yönlendirici" de.

## Çıktı biçimi
Profil · Temizlik günlüğü · Sonuç tablosu · Tek cümlelik bulgu · Sınırlılıklar
