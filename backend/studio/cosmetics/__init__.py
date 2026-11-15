"""Kozmetik mağazası arka ucu (COS-A). Satış kapalı: bayrak `store.cosmetics_enabled`
varsayılan kapalı, fiyat `None`, satın alma ucu, ödeme ve ağ yok.

Bağımlılık yönü tektir: `cosmetics/` → `entitlements/` (salt okuma) ve `cosmetics/` → `game/` (`grant_store`). Ne
`entitlements/` ne `game/` bu paketi içe aktarır.
"""
