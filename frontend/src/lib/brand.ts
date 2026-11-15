// Marka bilgisi — tek kaynak (backend karşılığı: backend/studio/brand.py).
// Ad değişikliği kararı kullanıcıdadır; değiştirilirse brand.py, frontend/index.html (başlık ve açıklama) ve
// README'ler birlikte güncellenir (backend/tests/test_oss.py tutarlılığı denetler).

export const BRAND = {
  name: "VoxCrew",
  nameEn: "VoxCrew",
  slug: "voxcrew",
  /** logonun altındaki kısa etiket */
  tagline: "ajan dünyası",
  /** İngilizce arayüzde logonun altındaki etiket */
  taglineEn: "agent world",
  description: "Yerel yapay zekâ ajanları için voxel dünya, görev ve iş akışı stüdyosu",
  /** GitHub deposu; eklenti komutlarının herkes için geçerli yolu. Depo herkese açılınca repoPublic true olur. */
  githubRepo: "Mucaktr/voxcrew",
  repoPublic: false,
  /** S40 yönetici / test modu (derleme anı). brand.py ADMIN_MODE_AVAILABLE ile aynı olmalı; false
   *. false iken Ayarlar'daki bölüm ve "TEST MODU" rozeti hiç çizilmez, /api/admin çağrılmaz.*/
  adminModeAvailable: true,
  license: "LicenseRef-PolyForm-Shield-1.0.0",
  copyright: "Copyright (c) 2026 Mustafa Uçak <mustafa.ucak@gmail.com>",
  disclaimer: "Nous Research, OpenAI, Anthropic ya da Ollama ile bağlantılı değildir; adlar ilgili sahiplerinin markalarıdır.",
} as const;

/** Başlatma betikleri (hata ve yardım metinlerinde). */
export const START_HINT = "start.ps1 (Windows) ya da ./start.sh (macOS/Linux)";
