## Ne değişti? / What changed?

<!-- Kısa özet ve gerekçe. İlgili issue: #… / Short summary and why. Related issue: #… -->

## Nasıl denendi? / How was it tested?

- [ ] `cd backend && uv run pytest -q`
- [ ] `cd frontend && npm run typecheck && npm run build && npm run contrast`
- [ ] `node --test "integrations/mcp/test/*.test.mjs"` (MCP ya da hook değiştiyse / if MCP or hooks changed)
- [ ] `python scripts/scan_secrets.py` temiz / clean (sır, kişisel yol, kullanıcı adı yok / no secrets, personal paths or user names)
- [ ] Arayüz değiştiyse: açık/koyu tema, 375 px genişlik, klavye ve iki dil denendi / If the UI changed: light/dark theme, 375 px width, keyboard and both languages checked

## Kontrol listesi / Checklist

- [ ] Yeni arayüz metinleri TR ve EN kataloglarına eklendi / New UI strings added to both the TR and EN catalogs
- [ ] Kullanıcı ayarı ya da dosyası yazılıyorsa değişiklik servisi (önizle → onayla → yedekle) kullanıldı / User config writes go through the change service (preview → confirm → backup)
- [ ] Hermes'e bağımlı olmayan yol çalışıyor (Hermes isteğe bağlıdır) / Works without Hermes (Hermes is optional)
- [ ] Yeni bağımlılık eklenmedi (eklendiyse gerekçesi ve lisansı yazıldı, THIRD_PARTY_NOTICES güncellendi) / No new dependency (or: reason and license given, THIRD_PARTY_NOTICES updated)
