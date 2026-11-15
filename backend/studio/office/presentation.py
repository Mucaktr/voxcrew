"""Ad -> görünüm (sunum) eşlemesi (GIFTS-GENDER): otomatik verilen insan adları kendi giyim tarzıyla görünür.

`m` erkek, `f` kadın, `n` nötr (ad tabloda yok ya da gerçekten uniseks). Veri göçü yoktur: kayıtlı ajanın `avatar.presentation`
alanı yalnız açık seçimdir (`m`/`f`/`n`); yoksa görünüm ADDAN türetilir (arayüz her çizimde, bu modül işe alımda).
Aynı tablo `frontend/src/lib/presentation.ts` içindedir; `backend/tests/test_gifts_gender.py` ve
`frontend/scripts/gifts_gender.test.mjs` ikisini karşılaştırır.

Kurallar: erkek -> erkek giyimi (sakal serbest); kadın -> kadın giyimi (elbise/etek serbest, sakal yok). Kostüm politikası
(`cosmetics/policy.py`) aynen geçerlidir: siyasi/ideolojik simge, LGBT/onur simgesi ve gökkuşağı bandı yok.
"""

from __future__ import annotations

import re
import unicodedata

Presentation = str  # "m" | "f" | "n"
PRESENTATIONS = ("m", "f", "n")

# Türkçe ve yaygın uluslararası adlar (ASCII'ye katlanmış, küçük harf). Gerçekten uniseks adlar `n` listesindedir;
# otomatik havuz (`HIRE_NAMES`) uniseks ad içermez.
MALE = ("mert can ozan efe aras atlas alp kerem emre kaan burak berk tuna kuzey mehmet ahmet mustafa ali "
        "ayhan hasan huseyin ibrahim ismail yusuf omer murat serkan selim tolga umut onur oguz cem baris "
        "cagri eren furkan gokhan hakan halil kadir kemal levent metin necati orhan ramazan sinan taner tarik volkan "
        "yigit zafer arda batu bora doruk ege kutay mirac polat sarp talha tamer ulas utku yavuz "
        "john james robert michael william david richard thomas daniel matthew mark paul peter george jack liam noah "
        "oliver lucas ethan adam alex max leo hugo luca marco carlos diego juan pedro jose")
FEMALE = ("ece zeynep elif aylin nil lara duru mina ipek defne selin naz ada ayse fatma emine hatice merve esra busra "
          "gizem cansu derya dilara damla ebru feyza gamze gul gulsen hande irem kubra melek melis meltem nazli nehir "
          "nur pinar rabia seda sena sibel simge tugba yasemin yildiz zehra asya azra beren buse ceren ela "
          "idil ilayda irmak lale maya mira nisa ozge sila sude tuba yelda "
          "mary patricia jennifer linda elizabeth barbara susan jessica sarah karen emma olivia sophia isabella mia "
          "charlotte amelia anna laura julia maria sofia lucia carmen")
NEUTRAL = "yagmur toprak su deniz bulut ruzgar derin ozgur umit gokce"  # gerçekten uniseks (açıkça nötr)

_TR = str.maketrans({"ı": "i", "İ": "i", "ş": "s", "Ş": "s", "ğ": "g", "Ğ": "g", "ü": "u", "Ü": "u", "ö": "o",
                     "Ö": "o", "ç": "c", "Ç": "c", "â": "a", "î": "i", "û": "u"})


def fold(name: str) -> str:
    s = unicodedata.normalize("NFKC", str(name or "")).translate(_TR).lower()
    s = unicodedata.normalize("NFKD", s)
    return "".join(ch for ch in s if not unicodedata.combining(ch))


def _table() -> dict[str, str]:
    out: dict[str, str] = {}
    for key, words in (("m", MALE), ("f", FEMALE), ("n", NEUTRAL)):
        for w in words.split():
            out[w] = key if out.get(w, key) == key else "n"  # iki farklı listede geçen ad uniseks sayılır
    return out


NAME_PRESENTATION: dict[str, str] = _table()


def presentation_of_name(name: str | None) -> Presentation:
    """Adın ilk sözcüğüne göre `m`/`f`/`n`. Bilinmeyen ya da "Ajan 3" gibi insan-dışı ad `n`."""
    first = re.split(r"[\s_\-.]+", fold(name or "").strip())[0] if name else ""
    return NAME_PRESENTATION.get(first, "n")


def presentation_of(avatar: dict | None, name: str | None) -> Presentation:
    """Açık `avatar.presentation` (`m`/`f`/`n`) kazanır; yoksa addan türetilir."""
    explicit = (avatar or {}).get("presentation")
    return explicit if explicit in PRESENTATIONS else presentation_of_name(name)


# Sunuma göre saç/sakal/kıyafet havuzları (yalnız ücretsiz başlangıç kıyafetleri; `game.catalog.STARTER_COSMETICS`)
HAIR_BY = {"m": ("short", "short", "spiky", "curly", "bald", "bun"),
           "f": ("long", "bob", "bun", "ponytail", "curly", "short"),
           "n": ("short", "long", "bun", "curly", "spiky", "bob", "ponytail", "bald")}
BEARD_BY = {"m": ("none", "none", "stubble", "goatee", "full", "mustache"), "f": ("none",),
           "n": ("none", "none", "stubble", "goatee", "full", "mustache")}  # nötr: eski davranış (sakal olabilir)
OUTFIT_BY = {"m": ("tshirt", "hoodie", "sweater", "overalls", "shirt", "blazer"),
             "f": ("tshirt", "hoodie", "sweater", "shirt", "blazer"),  # kadın: arayüz bunlara etek/elbise kesimi giydirir
             "n": ("tshirt", "hoodie", "sweater", "overalls", "shirt", "blazer")}
