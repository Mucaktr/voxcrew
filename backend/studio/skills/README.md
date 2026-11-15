# Skill kütüphanesi (Ekip S14) — kaynaklar, kimlikler ve `skill.json` paket biçimi

Bu modül `/api/skills` uç noktalarını, üç kaynağı birleştiren kütüphaneyi ve `skills` istem aşamasını (order 30)
içerir. Skill paketleri için aşağıdaki biçimi kullanır.

## Kaynaklar

| Kaynak | Konum | Yazılabilir | Çalışma anı |
|---|---|---|---|
| `voxcrew` | `<veri dizini>/skills/<id>/SKILL.md` + `skill.json` | evet | istem aşaması (her beyin) |
| `hermes` | `<HERMES_HOME>/skills/**/SKILL.md` (profil başına; `studio.hermes.caps`) | hayır | Hermes ajanı: `-s` bayrağı · diğer beyinler: istem aşaması |
| `claude` | `~/.claude/skills/*/SKILL.md`, proje `.claude/skills` (`skills.claude_dirs` ile değiştirilebilir) | hayır | istem aşaması |

Salt okunur kaynaklara hiçbir uç nokta yazmaz. "VoxCrew'a kopyala" (`POST /api/skills/{id}/copy`) kaynaktan veri
dizinine kopya alır; kopya düzenlenebilir.

## Kimlikler

- **Kütüphane kimliği (`id`)** — URL'de kullanılır: `vox:<id>` · `hermes:<yükleme adı>` · `claude:<kapsam>/<klasör>`.
- **Atama anahtarı (`key`)** — `agents.skills` içinde saklanır ve graf `Skill.name` anahtarıdır:
  VoxCrew → `<id>`, Hermes → yükleme adı (mevcut `-s` davranışı değişmez), Claude → `claude:<ad>`.
- Çözümleme sırası: Hermes ajanı → profildeki Hermes skill'i, sonra VoxCrew, sonra diğer profiller/Claude.
  Diğer beyinler → VoxCrew, sonra Hermes (herhangi bir profil), sonra Claude.

## `skill.json` (paket manifesti, `voxcrew-skill/1`)

```json
{
  "format": "voxcrew-skill/1",
  "id": "rapor-ozeti",
  "name": "Rapor özeti",
  "version": "1.0.0",
  "author": "Takma ad ya da kuruluş",
  "license": "MIT",
  "tags": ["yazım", "rapor"],
  "description": "Uzun raporları karar odaklı özete çevirir.",
  "permissions": ["files:read"],
  "source": { "kind": "voxcrew", "ref": "" }
}
```

| Alan | Zorunlu | Açıklama |
|---|---|---|
| `format` | evet | Sabit `voxcrew-skill/1`. |
| `id` | evet | `^[a-z0-9][a-z0-9_-]{0,63}$`; klasör adıyla aynı. |
| `name` | evet | Görünen ad (≤ 120). SKILL.md frontmatter `name` ile aynı tutulur. |
| `version` | evet | Anlamsal sürüm önerilir (`1.0.0`). |
| `author`, `license` | hayır | Metin. Lisans için SPDX kimliği önerilir. |
| `tags` | hayır | ≤ 20 etiket, her biri ≤ 40 karakter. |
| `description` | evet | ≤ 1024 karakter; katalogda ve istem kataloğunda görünür. |
| `permissions` | hayır | Beyan edici izin listesi: `files:read`, `files:write`, `shell`, `network`, `browser`, `mcp`. Stüdyo bunları yalnızca GÖSTERİR; skill içeriği hiçbir koşulda çalıştırılmaz. |
| `source` | hayır | Köken: `{"kind": "voxcrew" \| "hermes" \| "claude" \| "import" \| "market", "ref": "<kaynak kimliği, yol ya da URL>"}`. Pazar yeri kurulumunda `kind: market`, `ref: <paket kimliği>` yazılır. |

Tek doğruluk kaynağı `SKILL.md` frontmatter'ıdır (name, description, version, author, license, tags); `skill.json`
bunları yansıtır ve `permissions` + `source` alanlarını ekler. Çakışmada frontmatter kazanır.

### SKILL.md

```markdown
---
name: rapor-ozeti
description: Uzun raporları karar odaklı özete çevirir.
version: 1.0.0
tags: [yazım, rapor]
---

# Rapor özeti
## Ne zaman kullanılır
…
```

Frontmatter toleranslı okunur: eksikse ad klasörden, açıklama ilk paragraftan türetilir; bozuk YAML satır satır
`anahtar: değer` olarak çözülür. Alt klasörler (`references/`, `templates/`, `scripts/`) kopyalanır ama çalıştırılmaz.

## İçe aktarma kuralları

- Zip: ≤ 3 MB sıkıştırılmış, ≤ 12 MB açılmış, ≤ 200 dosya, dosya başına ≤ 4 MB. Mutlak yol, `..`, sürücü harfi ve
  sembolik bağ içeren girdiler reddedilir. `SKILL.md` kökte ya da tek bir üst klasörde olmalı.
- Çalıştırılabilir ikililer (`.exe .dll .msi .scr .com .bat .cmd .vbs .jar .so .dylib …`) kabul edilmez; betikler
  (`.py .sh .ps1 .js …`) kopyalanır, ayrıntıda `scripts` olarak listelenir ve asla çalıştırılmaz.
- Klasör içe aktarma aynı filtrelerle kopyalar; kütüphanenin kendi dizini içe aktarılamaz.

## İstem aşaması (`stage.py`)

Hermes dışı beyinlerde (ve Hermes'e verilemeyen VoxCrew/Claude atamalarında) isteme şu bölüm eklenir:

```
# SKILL'LER (YETENEK PAKETLERİ)
Sana atanmış skill'ler aşağıda. …
Katalog:
- <key>: <açıklama>
## Skill: <ad> (<key>)
<SKILL.md gövdesi>
```

Bütçe `skills.max_chars` (varsayılan 6000). Aşılırsa en son atananlar önceliklidir; sığmayan gövde kırpılır ya da
yalnızca katalogda kalır. Rapor: `step.prompt` olayında `{stage: "skills", injected, truncated, omitted, chars,
via_flags, missing}`. `skills.inject=false` aşamayı kapatır.

## Uç noktalar

| Yöntem | Yol | Açıklama |
|---|---|---|
| GET | `/api/skills?source=&q=&tag=&agent=` | Birleşik liste (kullanan ajanlarla) |
| GET | `/api/skills/sources` | Kaynak sayıları, kökler, etiketler, bütçe ayarı |
| GET | `/api/skills/{id}` | Ayrıntı: gövde, ham içerik, frontmatter, dosyalar, manifest |
| POST | `/api/skills` | VoxCrew skill'i oluştur |
| PUT / DELETE | `/api/skills/{id}` | Düzenle / sil (yalnızca VoxCrew; diğerleri 403) |
| POST | `/api/skills/import` | `{kind: paste, content}` ya da `{kind: folder, path}` |
| POST | `/api/skills/import/zip` | Ham zip gövdesi (`application/zip`) |
| POST | `/api/skills/{id}/copy` | Hermes/Claude skill'ini VoxCrew'a kopyala |
| POST | `/api/skills/assign` | `{agents, skills, mode: add\|remove\|set}` — ajan başına sonuç |
| GET | `/api/skills/agents/{slug}` | Ajanın skill'leri, uygulanma yolu ve bağlam bütçesi önizlemesi |
