"""Hafif ekip paylaşımı ( dalga 3, yerel kısım): şablonları tek bir JSON paket dosyasıyla dışa/içe aktarma.

Bulut yok, hesap yok, imza yok. Paket (`voxcrew-share`, sürüm 1) üç tür taşır:
- `job`: tarif benzeri özel iş = kullanıcının iş akışı + `quality` bloğu + zaman tasarrufu tabanı (elle/inceleme dk)
- `agent`: ajan şablonu = ad, unvan, rol, kişilik, rütbe, görünüm, beyin tercihi, izin (sır, bellek, transcript, yerel
  yol, Hermes profili, MCP araç bağları ASLA)
- `output`: çıktı şablonu = biçim + zorunlu bölümler + kalite kuralları

Dışa aktarma okumadır (MCP de yapabilir); içe aktarma yalnızca kullanıcıdan (`clients/tracker.USER_ONLY_RE`:
`/api/share/import…` ve `/api/share/outputs/…` yazma uçları). Ayrıntı: `bundle.py` (şema + temizleme), `service.py`.
"""
