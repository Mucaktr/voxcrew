"""İngilizce katalog — E2 parseller (`studio/expanse`). `locales/en.py` bu sözlüğü MESSAGES'a katar."""

from __future__ import annotations

MESSAGES: dict[str, str] = {
    "Çok fazla istek; biraz bekle": "Too many requests; wait a moment",
    "Geçersiz dünya kimliği": "Invalid world id",
    "Dünya yok": "World not found",
    "Gövde bir nesne olmalı": "The body must be an object",
    "slot 0–11 arasında tam sayı olmalı": "slot must be a whole number from 0 to 11",
    "Parsel sahiplenmek için açık onay gerekli (confirm: true)": "Claiming a plot needs explicit confirmation (confirm: true)",
    "Parsel adı en çok 40 karakterlik düz metin olmalı": "The plot name must be plain text of at most 40 characters",
    "Parsel rengi sabit paletten olmalı": "The plot colour must come from the fixed palette",
    "client_request_id en çok 80 karakterlik metin olmalı": "client_request_id must be text of at most 80 characters",
    "Bu sahne açık değil": "This scene is not unlocked",
    "Bu parsel için ofis seviyesi {} gerekir": "This plot requires office level {}",
    "Yetersiz jeton: {} gerekli, bakiye {}": "Not enough coins: {} needed, balance {}",
    "Bu parsel için harcama zaten yazılmış": "The spend for this plot is already recorded",
    "Parsel yok": "Plot not found",
    "Bu blok rengi yapı malzemeleri paketiyle gelir: {}": "This block colour comes with the builder materials pack: {}",
    "Parsel gövdesinde tanınmayan alan var": "The plot body has an unknown field",
    "edits en çok 600 öğelik bir dizi olmalı": "edits must be a list of at most 600 items",
    "Blok farkı [li, y, lj, blok, dönüş] biçiminde ve parsel içinde olmalı":
        "A block edit must be [li, y, lj, block, rotation] inside the plot",
    "Aynı hücrede birden çok blok var": "More than one block in the same cell",
    "prefabs en çok 40 öğelik bir dizi olmalı": "prefabs must be a list of at most 40 items",
    "Parselde bu prefab türü kullanılamaz": "This prefab type cannot be used on a plot",
    "Prefab parselin dışında": "The prefab is outside the plot",
    "Prefab alanı tanınmıyor": "The prefab has an unknown field",
    "Parsel gövdesi 64 KB sınırını aşıyor": "The plot body exceeds the 64 KB limit",
    "Dünyadaki parsel blok toplamı 6000 sınırını aşıyor": "The plot block total in this world exceeds 6000",
    "bits base64 bit kümesi olmalı": "bits must be a base64 bit set",
    # E3 yapı modu (studio/expanse/build.py)
    "Bilinmeyen blok kimliği: {}": "Unknown block id: {}",
    "Parsel kenarına (çit ve dikiş şeridi) inşa edilemez": "You cannot build on the plot edge (fence and seam strip)",
    "Orta yol ve geçitler iki kat yüksekliğe kadar boş kalmalı": "The middle path and gates must stay clear up to two layers high",
    "Eşyanın karosuna blok konamaz": "You cannot place a block on a prop's tile",
    "Eşyalar üst üste gelemez": "Props cannot overlap",
    "Prefab alanı geçersiz: {}": "Invalid prefab field: {}",
    "Zeminde en çok 48 dolu karo olabilir (parselin yarısı yürünebilir kalmalı)":
        "At most 48 ground tiles can be filled (half of the plot must stay walkable)",
    "Yürünebilir alan bölünüyor ya da dünyaya bağlantısı kopuyor":
        "The walkable area would split or lose its link to the world",
    # dünya biçimi v1.2 (worlds/validate.py MESSAGES["expanse"])
    "Genişleme bloğu (parseller ve inşa) geçersiz: {}": "The expanse block (plots and builds) is invalid: {}",
}
