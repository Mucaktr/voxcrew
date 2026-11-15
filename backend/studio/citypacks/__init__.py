"""Şehir paketleri arka ucu (CITY-PACKS). Satış kapalı: para fiyatı `None`, fiyat
yalnız ÖNERİ; jetonla alma yalnız kozmetik mağazası bayrağı (`store.cosmetics_enabled`) açıkken ve oyunun mevcut onaylı alım
akışından. Paketler yalnız görünüştür (dünya yapıcı paleti ve şehir haritası vitrini): XP, jeton, damga, hız ya da yetki vermez.

Bağımlılık yönü tektir: `citypacks/` → `game/` (`register_store_set`, salt okuma) ve `citypacks/` → `entitlements.offers`
(yalnız `scope_hash`). Ne `game/` ne `entitlements/` bu paketi içe aktarır.
"""
