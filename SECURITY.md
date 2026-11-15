# Güvenlik politikası / Security policy

## Desteklenen sürümler

Proje henüz 0.x aşamasındadır. Güvenlik düzeltmeleri yalnızca `main` dalının en son hâline yapılır.

## Açık bildirimi

**Güvenlik açıklarını herkese açık issue olarak açma.** GitHub'ın gizli bildirim özelliğini kullan: depo sayfasında
**Security → Report a vulnerability** ([nasıl yapılır](https://docs.github.com/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)).

Bildirime şunları ekle: etkilenen sürüm ya da commit, işletim sistemi, yeniden üretme adımları ve olası etki.
Sır, API anahtarı ya da kişisel yol paylaşma; gerekiyorsa maskele. İlk yanıt hedefi 7 gündür. Düzeltme yayımlanınca
bildirene (istersen) teşekkür edilir.

*English: please report vulnerabilities privately via GitHub's "Report a vulnerability" button on the repository's
Security tab, not as a public issue.*

## Tehdit modeli

VoxCrew **tek kullanıcılı, yerel** bir uygulamadır. Ajanlar senin aboneliklerinle ve senin dosya izinlerinle
çalışır; bu yüzden yerel API'ye erişebilen herkes pratikte ajan çalıştırabilir.

| Risk | Önlem |
|---|---|
| Ağdan erişim | Kaynak kurulumunda sunucu `127.0.0.1`'e bağlanır. Docker imajı kapsayıcı içinde tüm arayüzleri dinler; hazır Compose yapılandırması ana makinede yalnızca `127.0.0.1:7420` portunu açar. Uzaktan erişim desteklenmez. |
| DNS rebinding (kötü niyetli bir sitenin `127.0.0.1:7420`'ye kendi adıyla erişmesi) | Host başlığı yalnızca loopback adları olabilir (`127.0.0.1`, `localhost`, `::1`). Ek adlar `STUDIO_ALLOWED_HOSTS` ile, bilinçli olarak eklenir. |
| CSRF (başka bir sitenin tarayıcın üzerinden istek atması) | Durum değiştiren isteklerde (POST/PUT/PATCH/DELETE) loopback dışı `Origin`, `Origin: null` ya da `Sec-Fetch-Site: cross-site` reddedilir. JSON gövdeleri `Content-Type` ister. |
| Aşırı büyük istekler | Gövde sınırı (varsayılan 4 MiB, `STUDIO_MAX_BODY_BYTES`); daha sıkı sınır isteyen uç noktalar (ör. Claude Code alımı) kendi sınırını uygular. |
| Kullanıcı ayar dosyalarının bozulması | Hermes, Claude ve Codex dosyalarına yazım yalnızca değişiklik servisi üzerinden olur: önizle → açıkça onayla → `<dosya>.bak-<zaman>` yedeği → atomik yaz → geri al. Var olan ayar satırları (ör. Codex `notify`) ezilmez. |
| Ajanların fazla yetki alması | Başlangıç Yazılımcı ajanı yazma, Araştırmacı ajanı okuma izniyle oluşturulur. Codex izin düzeyine göre `read-only` veya `workspace-write` sandbox kullanır. Claude Code'a araç kısıtları iletilir; diğer bağlayıcılarda sınırlar farklıdır. Ayrıntılar README'deki beyin tablosundadır. MCP istemcileri varsayılan olarak onay kararı veremez. |
| İstem enjeksiyonu | Görev metni, web içeriği, dosyalar ve ajan çıktısı veri olarak ele alınır; uygulamanın yetkisini genişletemez. Araç onayları arayüzde kullanıcıya sorulur. |
| Sır sızıntısı | Sırları depoya eklemeyin. Veri dizini, `.env*`, veritabanları, günlükler ve yedekler `.gitignore` kapsamındadır; bu kurallar önceden izlenen dosyalardaki sırları kaldırmaz. Anahtarlar arayüz ve günlüklerde maskelenir. Bu herkese açık depo, commit öncesi veya CI sır taraması yapılandırması içermez; değişiklikleri paylaşmadan önce sır içermediğini kontrol edin. |
| Gizlilik | Claude Code ve Codex oturum izlemede ham istem ve araç girdisi varsayılan olarak saklanmaz; transcript okuma varsayılan olarak kapalıdır. |

## Kapsam dışı

- Yerel makineye zaten yönetici ya da kullanıcı olarak erişebilen bir saldırgan.
- Üçüncü taraf CLI'ların (Hermes Agent, Codex, Claude Code, Ollama) kendi açıkları — ilgili projelere bildirin.
- Kullanıcının bilerek `STUDIO_ALLOWED_HOSTS` ile güvenilmeyen adlar eklemesi ya da sunucuyu bir vekil üzerinden ağa açması.
