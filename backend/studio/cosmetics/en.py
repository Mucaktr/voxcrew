"""Kozmetik mağazası (COS-A) hata iletilerinin İngilizce karşılıkları (`studio.locales.en` birleştirir)."""

MESSAGES: dict[str, str] = {
    "Böyle bir kozmetik set yok": "No such cosmetic set",
    "Kozmetik mağazası kapalı (store.cosmetics_enabled)": "The cosmetics store is off (store.cosmetics_enabled)",
    "Bu işlem kimliğiyle kozmetik hak yok": "No cosmetic right with this transaction id",
    "Yalnız store:* parçası, store, earn ya da coin kaynağıyla":
        "Only store:* pieces, with the store, earn or coin source",
    "Geçersiz kozmetik set kaydı": "Invalid cosmetic set registration",
    # kostüm içerik kuralı (pazar yeri kozmetik/sahne manifesti)
    "{}: içerik kuralı (K-1/K-2) yasaklı sözcük: {}": "{}: content rule (K-1/K-2) banned term: {}",
}
