# VoxCrew'a katkı

[English](CONTRIBUTING.md) · **Türkçe**

Katkın için teşekkürler! Bu rehber geliştirme ortamını, proje kurallarını ve iyi bir PR'ın nasıl olduğunu anlatır. Issue ve PR'ları Türkçe ya da İngilizce yazabilirsin.

## İlk katkı için iyi fikirler

- **Hata bildirimi.** Adımları, işletim sistemini ve kurulu beyinleri net yaz (issue formunu kullan).
- **Dünyalar ve sahneler.** Dünya yapıcıyla kurup `.voxcrew-world.json` olarak dışa aktardığın dünyalar.
- **Çeviri.** Kulağa tuhaf gelen İngilizce metinler veya yalnızca Türkçe kalan sunucu iletileri. Başlangıç ajanlarının adları ve hazır iş akışlarının İngilizce karşılıkları zaten bulunur; iki dilde de düzeltme yapabilirsin.
- **Belgeler.** README'de yazıldığı gibi çalışmayan her şey.

Büyük değişikliklerde yaklaşım üzerinde anlaşmak için önce bir issue aç.

## Geliştirme ortamı

Gereksinimler: Python 3.11+ ve [uv](https://docs.astral.sh/uv/), Node.js 20+ ve npm. Uygulamayı derlemek ve gezmek için beyin (Ollama, Codex CLI ya da Claude Code) gerekmez.

Bunları depo kökünden çalıştır:

```sh
(cd backend && uv sync --locked)
(cd frontend && npm ci && npm run typecheck && npm run build)
```

Geliştirirken backend'i `cd backend && uv run voxcrew --port 7431`, arayüzü `cd frontend && npm run dev` (http://localhost:5173) ile başlat. Vite vekili `/api` isteklerini 7420'de çalışıyor olabilecek kendi örneğine değil, geliştirme backend'ine göndersin diye iki tarafta da `STUDIO_PORT=7431` ayarla. Gerçek verini korumak için depo dışında ayrı bir veri dizini kullan, ör. `STUDIO_DATA_DIR=~/voxcrew-dev-data` (PowerShell: `$env:STUDIO_DATA_DIR = "$HOME\voxcrew-dev-data"`). Göreli bir yol, sunucuyu başlattığın klasöre göre çözülür.

[Derleme ve başlangıç kontrolü](.github/workflows/ci.yml), Windows ve Ubuntu'da bağımlılıkları kilit dosyalarından kurar, arayüzü derler ve ayrı bir yerel sunucu başlatır. Sağlık yanıtını, derlenmiş HTML'i ve ona bağlı bir JavaScript dosyasını denetler. Model çalıştırmaz; sağlayıcıların uçtan uca uyumluluğunu kanıtlamaz. Derlemeden sonra aynı kontrolü çalıştırabilirsin: `uv run --project backend --no-sync python scripts/ci_smoke.py`.

Bu depoda projenin tam uygulama test paketi yok. PR'da değişikliği nasıl denediğini yaz (tip denetimi, derleme, arayüzde nerelere tıkladığın).

## Dosya düzeni

| Yol | İçerik |
|---|---|
| `backend/studio/` | FastAPI uygulaması: `api.py` (çekirdek rotalar), `workflow/` (motor, kontrol noktaları, bütçeler, politika), `connectors/` (hermes, ollama, codex, claude, openai_compat), `connections/` (keşif ve kurulum sihirbazı), `graph/` (SQLite graf ve bellek), `office/`, `goals/`, `game/`, `skills/`, `worlds/`, `trace/`, `clients/`, `security.py`, `config.py`, `brand.py`, `locales/` |
| `backend/ontology/` | Graf ontolojisi (YAML) |
| `frontend/src/` | React arayüzü: `pages/`, `components/` (ortak primitifler `components/ui.tsx`), `lib/` (API, zustand depoları, `i18n.ts`, `brand.ts`), `locales/` (TR + EN ileti katalogları), `voxel/` (three.js dünyası) |
| `workflows/` | Örnek iş akışları (kullanıcı akışları veri dizinine yazılır) |

## Kurallar

- **Sır ve kişisel bilgi yok.** Kodda ve belgede API anahtarı, jeton, gerçek oturum kimliği, kişisel yol, kullanıcı adı ya da e-posta bulunmaz. Yer tutucu kullan: `~`, `%USERPROFILE%`, `<HERMES_HOME>`, `<WORKDIR>`.
- **İki dil.** Arayüz metinleri `frontend/src/locales/` altındaki ileti kataloglarındadır. Kaynak dil Türkçedir ve her yeni anahtarın İngilizce karşılığı da eklenir. Kullanıcıya ulaşan sunucu iletilerinin İngilizcesi `backend/studio/locales/en.py` dosyasına yazılır. Kod tanımlayıcıları İngilizcedir.
- **Kullanıcı dosyalarına doğrudan yazma yok.** Hermes, Claude ya da Codex dosyalarını değiştiren her özellik değişiklik servisini kullanır (`studio.changes`: plan → açık onay → yedek → atomik yazma → geri alma). Uç noktalar önce plan döner, var olan ayar satırları ezilmez.
- **Hermes isteğe bağlıdır.** Yeni özellikler Hermes kurulu değilken de çalışmalı ya da kendini düzgünce kapatmalıdır.
- **Yalnızca yerel, otomatik başlatma yok.** Sunucu `127.0.0.1`'e bağlanır. Dış süreçler yalnızca kullanıcı tıklayınca başlar.
- **Backend:** olay yayınlayan rotalar `async def` olur, uzun ya da engelleyici dosya işleri `asyncio.to_thread` ile yapılır. Süreçleri `connectors/base.py` yardımcılarıyla başlat ve durdur (`group_popen_kwargs`, `mark_group`, `kill_tree`). Windows, macOS ve Linux desteklenir, `.exe` varsayma.
- **Arayüz:** `components/ui.tsx` primitiflerini ve `index.css` içindeki `@theme` belirteçlerini kullan. `text-[Npx]` ve `font-extrabold/black` kullanma. Başlıklar Bricolage (`font-display`), gövde metni Inter; Pixelify yalnızca logo ve dünya etiketleri içindir. Açık ve koyu temada AA kontrastı, 375 px'te yatay taşma olmamasını, `prefers-reduced-motion` desteğini, klavye erişimini ve `aria` etiketlerini denetle. zustand seçicileri her çağrıda yeni dizi ya da nesne döndürmez.
- **Marka:** ürün adı yalnızca `backend/studio/brand.py` ve `frontend/src/lib/brand.ts` içinde durur, arayüz koduna metin olarak kopyalanmaz.
- **Bağımlılık:** yeni paket eklemeden önce issue aç. Lisansı proje lisansıyla ([PolyForm Shield License 1.0.0](https://polyformproject.org/licenses/shield/1.0.0)) uyumlu olmalı ve `THIRD_PARTY_NOTICES.md` güncellenmeli. Kilit dosyalarını (`uv.lock`, `package-lock.json`) değişiklikle birlikte commit'le.

## Commit ve PR

- PR'lar küçük ve odaklı olsun. Neyi değiştirdiğini ve nasıl denediğini yaz; PR şablonu ikisini de sorar.
- Commit mesajı: Türkçe ya da İngilizce kısa bir özet satırı, gerekirse gövdede gerekçe.
- Herkese açık bir depoda commit e-postan kalıcıdır, GitHub'ın `noreply` adresini kullanmanı öneririz.

## Güvenlik

Güvenlik açıklarını herkese açık issue olarak bildirme. [SECURITY.md](SECURITY.md) dosyasındaki gizli bildirim yolunu kullan. Diğer sorular: mustafa.ucak@gmail.com.

## Davranış kuralları

Bu projeye katılan herkes [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) belgesine uyar.
