# Üçüncü taraf bildirimleri / Third-party notices

VoxCrew'un bu sürümü [PolyForm Shield License 1.0.0](https://polyformproject.org/licenses/shield/1.0.0) ile lisanslıdır (bkz. [LICENSE](LICENSE)). Aşağıdaki bileşenler kendi lisanslarıyla kullanılır. Depo,
bağımlılıkların kendisini içermez; paket yöneticileri (`uv`, `npm`) kurulumda indirir. Derlenmiş arayüz
(`frontend/dist`) ya da bir sürüm arşivi dağıtılırsa bu dosya ve aşağıdaki font bildirimleri yanında bulunmalıdır.

## Fontlar (SIL Open Font License 1.1)

Arayüze gömülen fontlar [Fontsource](https://fontsource.org/) paketlerinden gelir ve değiştirilmeden kullanılır.
OFL-1.1 tam metni: https://openfontlicense.org/open-font-license-official-text/ (ayrıca her paketin `LICENSE`
dosyasında).

| Font | Paket | Telif |
|---|---|---|
| Inter | `@fontsource-variable/inter` | Copyright 2016 The Inter Project Authors (https://github.com/rsms/inter) |
| Bricolage Grotesque | `@fontsource-variable/bricolage-grotesque` | Copyright 2022 The Bricolage Grotesque Project Authors (https://github.com/ateliertriay/bricolage) |
| JetBrains Mono | `@fontsource-variable/jetbrains-mono` | Copyright 2020 The JetBrains Mono Project Authors (https://github.com/JetBrains/JetBrainsMono) |
| Pixelify Sans | `@fontsource-variable/pixelify-sans` | Copyright 2021 The Pixelify Sans Project Authors (https://github.com/eifetx/Pixelify-Sans) |

OFL koşulları özetle: fontlar uygulamayla birlikte dağıtılabilir; tek başına satılamaz; telif bildirimi ve lisans
metni korunmalıdır; değiştirilmiş sürümler "Reserved Font Name" kurallarına uymalıdır.

## Arayüz kütüphaneleri (npm)

| Paket | Lisans |
|---|---|
| react, react-dom | MIT |
| react-router-dom | MIT |
| three | MIT |
| @react-three/fiber, @react-three/drei | MIT |
| @xyflow/react (React Flow) | MIT |
| react-force-graph-2d | MIT |
| react-markdown, remark-gfm | MIT |
| zustand | MIT |
| clsx | MIT |
| lucide-react | ISC |
| vite, @vitejs/plugin-react, tailwindcss, @tailwindcss/vite (derleme) | MIT |
| typescript (derleme) | Apache-2.0 |

Dolaylı bağımlılıklar ağırlıkla MIT, ISC, BSD ve Apache-2.0 lisanslıdır. Yalnızca derleme zamanında kullanılan
`lightningcss` (MPL-2.0) ve `caniuse-lite` (CC-BY-4.0) derlenmiş pakete girmez. GPL, AGPL ya da LGPL lisanslı
bağımlılık yoktur.

## Backend kütüphaneleri (PyPI)

| Paket | Lisans |
|---|---|
| fastapi | MIT |
| starlette | BSD-3-Clause |
| uvicorn | BSD-3-Clause |
| httpx, httpcore | BSD-3-Clause |
| pydantic, pydantic-core | MIT |
| PyYAML | MIT |
| anyio, h11 | MIT |
| opentelemetry-api (fastapi üzerinden) | Apache-2.0 |
| idna, click, colorama | BSD-3-Clause |
| annotated-types, annotated-doc, typing-inspection | MIT |
| typing-extensions | PSF-2.0 |
| certifi | MPL-2.0 (değiştirilmeden kullanılır) |
| pytest (geliştirme) | MIT |
| pytest-asyncio (geliştirme) | Apache-2.0 |

SQLite ve FTS5 kamu malıdır (public domain).

## Birlikte çalışabilirlik

- **Hermes Agent** (Nous Research, MIT lisanslı olarak yayımlanır): stüdyo Hermes'i paketlemez; yalnızca kurulu
  CLI'ını ve HTTP API'sini çağırır. `backend/studio/hermes/caps.py` içindeki küçük araç seti tabloları (adlar,
  açıklamalar, varsayılan kapalı listeler) birlikte çalışabilirlik için hermes-agent kaynağından türetilmiştir.
- **Codex CLI**, **Claude Code** ve **Ollama** paketlenmez; kullanıcının kurduğu sürümler çağrılır.

## Varlıklar

Sesler WebAudio ile kodda üretilir; ses dosyası yoktur. Favicon ve voxel karakterler bu projeye özgüdür. Harici görsel
ya da 3B model kullanılmaz.

## Markalar

Hermes, Codex, ChatGPT, Claude, Claude Code ve Ollama ilgili sahiplerinin markalarıdır. Bu proje bu kuruluşlarla
bağlantılı değildir; adlar yalnızca uyumluluğu belirtmek için kullanılır.
