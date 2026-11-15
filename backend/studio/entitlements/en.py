""" hak motoru: kullanıcıya dönen sabit iletilerin İngilizcesi (karar iletileri engine.msg içinde iki dillidir)."""

MESSAGES = {
    "{} gerekli": "{} is required",
    "Değiştirilecek ajan zaten yedekte": "The agent to swap out is already on the bench",
    # hak defterleri (ledger.py)
    "Bilinmeyen defter: {}": "Unknown ledger: {}",
    "Geçersiz işlem kimliği": "Invalid transaction id",
    "Oyun olayı hak doğurmaz": "A game event cannot create an entitlement",
    "Bu defterde bu hak tutulamaz: {}": "This entitlement cannot be held in this ledger: {}",
    "Adet 1 ile 1000 arasında olmalı": "Units must be between 1 and 1000",
    "Teklif kimliği kimlik@sürüm biçiminde olmalı": "Offer id must look like id@version",
    "Gerekçe gerekli": "A reason is required",
    "Bitiş başlangıçtan sonra olmalı": "The end must be after the start",
    "Dönem hakkının bitişi olmalı": "A period entitlement needs an end",
    "Bu hak tüketilemez": "This entitlement cannot be consumed",
    "Hak bu arada tükendi": "The entitlement ran out in the meantime",
    # finans ekseni (billing_state.py)
    "Geçersiz kök görev kimliği": "Invalid root task id",
    "Bilinmeyen finans durumu": "Unknown billing status",
    "Kendi anahtarınla ya da yerelde çalışan iş faturalanmaz": "Work run with your own key or locally is never billed",
    "Finans geçişi yok: {} → {}": "No billing transition: {} → {}",
    "Finans durumu bu arada değişti": "The billing status changed in the meantime",
}
