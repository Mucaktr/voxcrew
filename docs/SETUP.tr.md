# VoxCrew kurulum ve çalıştırma rehberi

[VoxCrew'a dön](../README.tr.md) · [English](SETUP.md) · **Türkçe**

Bilgisayarındaki Codex CLI veya Claude Code kurulumunu bağlamak için kaynaktan kurulumu kullan. Docker, aşağıda açıklanan ağ ve araç sınırlarıyla API bağlantıları için bir seçenektir. Henüz hazır kurulum paketi yok.

## Kaynaktan kurulum

**Git**, **[uv](https://docs.astral.sh/uv/getting-started/installation/)** ve npm içeren **[Node.js](https://nodejs.org/) 20+** gerekir. Sunucu Python 3.11+ ister; uv gerektiğinde uyumlu bir Python indirebilir. İlk kurulumda bağımlılıkları indirmek için internet bağlantısı gerekir.

Başlatma betiği bağımlılıkları kilit dosyalarından kurar (`uv sync --locked`, `npm ci`), arayüzü derler ve **http://127.0.0.1:7420** adresinde sunar. İlk kurulum ve derleme birkaç dakika sürebilir.

### Windows (PowerShell)

Yalnızca bilgisayarında bulunmayan araçları kur:

```powershell
winget install --id Git.Git -e
winget install --id astral-sh.uv -e
winget install --id OpenJS.NodeJS.LTS -e
```

Araçların PATH'e eklenmesi için **yeni bir PowerShell penceresi aç**, ardından çalıştır:

```powershell
git clone https://github.com/Mucaktr/voxcrew.git "$HOME\voxcrew"
powershell -NoProfile -ExecutionPolicy Bypass -File "$HOME\voxcrew\start.ps1" -Open
```

### macOS

[Homebrew](https://brew.sh/) kullanıyorsan gereksinimleri ilk komutla kurabilirsin. Zaten kurulu paketleri atla.

```sh
brew install git uv node
git clone https://github.com/Mucaktr/voxcrew.git ~/voxcrew
sh ~/voxcrew/start.sh --open
```

### Linux

Git'i dağıtımının paket yöneticisiyle, **Node.js 20+** ve npm'i uygun kurulum yöntemiyle kur. `node --version` ile sürümü denetle; bazı dağıtımlar daha eski sürüm sunar. Seçenekler için [Node.js indirmeleri](https://nodejs.org/en/download) sayfasına bak.

uv'yi [resmî kurulum adımlarıyla](https://docs.astral.sh/uv/getting-started/installation/) veya kurulum betiğiyle yükle:

```sh
curl -LsSf https://astral.sh/uv/install.sh | sh
```

Yeni bir terminal aç, ardından çalıştır:

```sh
git clone https://github.com/Mucaktr/voxcrew.git ~/voxcrew
sh ~/voxcrew/start.sh --open
```

## İlk açılış

1. 18 yaşında veya daha büyük olduğunu onayla. Bu bilgi bilgisayarında saklanır.
2. Kurulum sihirbazında kullanılabilir bağlantıları gör ve bir sahne seç. Başlangıç ekibinde bir yazılımcı ile bir araştırmacı bulunur; varsayılan görünen adları arayüz diline göre gösterilir.
3. Kullanılabilir beyin yoksa **Bağlantılar**'ı aç. Yerel bir Ollama modeli, uyumlu bir API uç noktası veya kurulu bir CLI bağla. Farklar ve maliyetler için [beyin seçeneklerine](../README.tr.md#kullanabileceğin-beyinler) bak.
4. Ajanına bir beyin seç, **Ctrl+K**'ya bas ve küçük bir ilk görev ver.

Bağlı beyin olmadan arayüz açılabilir; ajanların görev tamamlayabilmesi için bir bağlantı gerekir. Bulut sağlayıcıları istemlerini alabilir ve kullanım ücreti doğurabilir. Yerel Ollama modeli, model çıkarımını bilgisayarında yapar; etkinleştirdiğin araçlar yine de dış hizmetlere bağlanabilir.

## Durdurma, güncelleme ve port değiştirme

VoxCrew'u durdurmak için terminalde **Ctrl+C**'ye bas. Betikler servis kurmaz, otomatik başlatma ayarlamaz.

| İşlem | Windows (depo kökünde) | macOS / Linux (depo kökünde) |
|---|---|---|
| Başlat | `powershell -NoProfile -ExecutionPolicy Bypass -File .\start.ps1 -Open` | `sh ./start.sh --open` |
| Başka port kullan | `powershell -NoProfile -ExecutionPolicy Bypass -File .\start.ps1 -Port 7430` | `sh ./start.sh --port 7430` |
| Arayüzü yeniden derle | `powershell -NoProfile -ExecutionPolicy Bypass -File .\start.ps1 -Rebuild` | `sh ./start.sh --rebuild` |

Güncellemek için uygulamayı durdur, depo içinde `git pull` çalıştır ve **`-Rebuild` / `--rebuild`** ile başlat. Bu seçenek verilmezse mevcut arayüz derlemesi kendiliğinden yenilenmez; başlatıcı eski çıktı saptadığında uyarır.

Bir adım başarısız olursa başlatıcı `ERROR:` / `HATA:` iletisi gösterir. Eksik araç hatasında ilgili gereksinimi kurup yeni terminal açmak genellikle yeterlidir. Port kullanımda hatasında diğer örneği durdur veya başka port seç. Normal başlatma betikleri uzaktan erişim için host seçeneği sunmaz.

Başlatıcı iletilerinin dilini `VOXCREW_LANG=tr` veya `VOXCREW_LANG=en` ile seçebilirsin; ayarlanmazsa iki dil birlikte gösterilir. Bu ayar uygulamanın arayüz dilini değiştirmez.

<a name="docker"></a>
## Docker ile çalıştırma

**Git**, Docker ve Docker Compose gerekir:

```sh
git clone https://github.com/Mucaktr/voxcrew.git
cd voxcrew
docker compose up --build
```

Derleme bitince **http://localhost:7420** adresini aç. **Ctrl+C** ile durdur. `docker compose up -d --build` kullandıysan `docker compose down` ile durdur.

Veriler `/data` yoluna bağlanan `voxcrew-data` adlı birimde saklanır. **`docker compose down -v` bu birimi ve içindeki verileri siler.** Yeniden başlatma politikası yoktur; bilgisayar açıldığında uygulamayı elle başlatırsın.

### Ana makinedeki portu yerel tut

Hazır gelen **`127.0.0.1:7420:7420`** eşlemesini koru. VoxCrew'da çok kullanıcılı giriş yoktur; kendi bilgisayarından erişim için tasarlanmıştır. Yalnızca `7420:7420` yazmak veya ana makineyi `0.0.0.0` adresine bağlamak uygulamayı diğer makinelere açar. *Kapsayıcının içinde* tüm arayüzleri dinlemek hazır Docker yapılandırmasının parçasıdır; Host ve Origin denetimleri uygulanmaya devam eder.

### Ana makinedeki Ollama'ya bağlanma

Docker'dan ana makinedeki Ollama'ya bağlantı yolu **uçtan uca doğrulanmış değildir**. Daha basit bir yerel Ollama kurulumu için yukarıdaki kaynaktan kurulumu kullan.

Kapsayıcının `127.0.0.1` adresi, kapsayıcının kendisidir. Docker Desktop'ta (Windows/macOS), hazır Compose dosyasındaki şu yorum satırını etkinleştirebilirsin:

```yaml
environment:
  OLLAMA_HOST: "http://host.docker.internal:11434"
```

Linux Docker Engine'de ayrıca hazır `extra_hosts` altındaki `host.docker.internal:host-gateway` girdisini etkinleştir. Bu adres tek başına yalnızca loopback üzerinden dinleyen Ollama'yı erişilebilir yapmaz; Ollama'nın kapsayıcıdan bağlantı kabul etmesi gerekir. Dinleme adresini genişletmek model sunucusunu yerel ağına açabilir. Böyle bir değişiklikten önce ağ sınırını değerlendir ve erişimi güvenlik duvarıyla kısıtla. İki hizmeti de herkese açık internete açma.

**Bağlantılar** üzerinden erişilebilir bir OpenAI uyumlu uç nokta da tanımlayabilirsin; bu durumda ilgili hizmetin kimlik doğrulama ve veri işleme kuralları geçerlidir.

### Kapsayıcı sınırları

- İmajda Claude Code, Codex, Gemini CLI veya Hermes bulunmaz. Ana makinedeki CLI programlarını çağıramaz. Bu bağlantılar için kaynaktan kurulumu kullan.
- Kurulum sihirbazı kapsayıcı içinden ana makineye Ollama kuramaz veya ana makinedeki Ollama'yı başlatamaz.
- Ana makineden gelen webhook ve içeri alma istekleri Docker içinde yerel olmayan istekler gibi görünebilir. Erişim anahtarı olmadan yalnızca yerel çağıranları kabul eden uç noktalarda bu bağlantı için anahtar tanımlanmalıdır.

<a name="veri-ve-ortam-degiskenleri"></a>
## Veri konumları ve ortam değişkenleri

Yeni bir kaynak kurulumunda varsayılan veri klasörleri:

| Sistem | Klasör |
|---|---|
| Windows | `%LOCALAPPDATA%\VoxCrew` |
| macOS | `~/Library/Application Support/VoxCrew` |
| Linux | `$XDG_DATA_HOME/voxcrew`; değişken yoksa `~/.local/share/voxcrew` |

`STUDIO_DATA_DIR` varsayılanı değiştirir. Geriye uyumluluk için, bu değişken ayarlı değilse depo kökündeki mevcut bir `data/` klasörü platform varsayılanından önce kullanılır. Uygulama bu klasörü kendiliğinden taşımaz.

| Değişken | Varsayılan | Ne işe yarar |
|---|---|---|
| `STUDIO_PORT` | `7420` | Sunucu portu; başlatıcıya açıkça verilen port önceliklidir |
| `STUDIO_DATA_DIR` | Yukarıda açıklanan veri klasörü | Graf veritabanı, ayarlar, kullanıcı iş akışları ve çalışma klasörü |
| `STUDIO_WORKDIR` | `<veri klasörü>/workspace` | Ajanların dosya okuyup yazdığı klasör |
| `STUDIO_STATE_DIR` | Platform durum klasörü | Veri klasöründen ayrı tutulan graf denetim durumu |
| `HERMES_HOME` | `~/.hermes` | İsteğe bağlı Hermes Agent ana klasörü |
| `OLLAMA_HOST` | `http://127.0.0.1:11434` | Ollama adresi |
| `STUDIO_ALLOWED_HOSTS` | Boş | Virgülle ayrılmış ek güvenilir yerel Host adları; gerekmedikçe boş bırak |
| `STUDIO_MAX_BODY_BYTES` | `4194304` | Bayt cinsinden istek gövdesi sınırı |
| `VOXCREW_LANG` | İki dil birlikte | Başlatıcı iletileri: `en` veya `tr` |

Ortam değişkenlerini başlatmadan önce terminalde ayarla. Veri klasörünü değiştirirken mutlak yol kullanmayı tercih et. Ayrı bir geliştirme kurulumu için veri ve durum klasörlerini de ayır; böylece normal kurulumunun kayıtları etkilenmez.

Geliştirme komutları için [CONTRIBUTING.tr.md](../CONTRIBUTING.tr.md), yerel erişim güvenlik modeli ve gizli güvenlik açığı bildirimi için [SECURITY.md](../SECURITY.md) dosyasına bak.
