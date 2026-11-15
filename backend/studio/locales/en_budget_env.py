"""EN kataloğu — karar 1 (MCP sunucu başına ortam değişkeni başvuruları) ve karar 13 (günlük toplam bütçe tavanı)."""

from __future__ import annotations

MESSAGES: dict[str, str] = {
    # karar 13: günlük bütçe
    "Günlük bütçe doldu (dolar: ${} / ${}). Yeni koşu başlatılamaz; tavanı bugün için Koşular sayfasından "
    "yükseltebilir ya da gün dönümünü (04:00) bekleyebilirsin.":
        "Daily budget reached (dollars: ${} / ${}). No new run can start; raise the cap for today on the Runs page "
        "or wait for the day to turn over (04:00).",
    "Günlük bütçe doldu (token: {} / {}). Yeni koşu başlatılamaz; tavanı bugün için Koşular sayfasından "
    "yükseltebilir ya da gün dönümünü (04:00) bekleyebilirsin.":
        "Daily budget reached (tokens: {} / {}). No new run can start; raise the cap for today on the Runs page "
        "or wait for the day to turn over (04:00).",
    "Günlük bütçe tavanı yalnızca uygulama arayüzünden, kullanıcı tarafından değiştirilebilir":
        "Only the user can change the daily budget cap, from the studio UI",
    "Günlük bütçe tavanı kapalı; yükseltilecek bir sınır yok": "The daily budget cap is off; there is no limit to raise",
    "Bugün için tavan yalnızca yükseltilebilir": "The cap for today can only be raised",
    "Günlük bütçe tavanı yalnızca /api/budget/daily üzerinden değiştirilebilir":
        "The daily budget cap can only be changed through /api/budget/daily",
    "Günlük bütçe bir sözlük olmalı (cost_usd, tokens)": "The daily budget must be an object (cost_usd, tokens)",
    "Günlük bütçede yalnızca cost_usd ve tokens olabilir": "The daily budget may only contain cost_usd and tokens",
    "Günlük bütçe alanı sayı olmalı: {}": "Daily budget field must be a number: {}",
    "Günlük bütçe alanı negatif olamaz: {}": "Daily budget field cannot be negative: {}",
    "Günlük bütçe alanı çok büyük: {}": "Daily budget field is too large: {}",
    # karar 1: MCP ortam değişkeni başvuruları
    "MCP sunucuları yalnızca /api/tools/servers üzerinden değiştirilebilir":
        "MCP servers can only be changed through /api/tools/servers",
    "Ortam değişkeni aktarımı yalnızca uygulama arayüzünden, kullanıcı tarafından değiştirilebilir":
        "Only the user can change environment variable passing, from the studio UI",
    "Ortam değişkeni aktarımı için açık onay gerekli: {} — bu adların değerleri sunucu sürecine verilecek":
        "Passing environment variables needs explicit confirmation: {} — the values of these names will be given "
        "to the server process",
    "Ortam değişkeni adı büyük harf, rakam ve _ içermeli (en çok 64 karakter): {}":
        "Environment variable names must use capital letters, digits and _ (up to 64 characters): {}",
    "{} aktarılamaz: süreç yollarını, yükleyiciyi, ağ yönünü, araç yapılandırmasını ya da uygulamanın kendi "
    "ayarlarını değiştirebilir":
        "{} cannot be passed: it can change process paths, the loader, network routing, tool configuration or the "
        "studio's own settings",
    "env_refs yalnızca ad alır; değer yazılmaz (AD=değer biçimi kabul edilmez)":
        "env_refs takes names only; values are never written (NAME=value is not accepted)",
    "env_refs bir ad listesi olmalı": "env_refs must be a list of names",
    "env_refs yalnızca ortam değişkeni adları içerebilir": "env_refs may only contain environment variable names",
    "En çok {} ortam değişkeni aktarılabilir": "At most {} environment variables can be passed",
    "Ortam değişkeni aktarımı yalnızca stdio sunucuları içindir": "Environment variable passing is for stdio servers only",
    # düzeltmeleri
    "Ortam değişkeni aktarımı için açık onay gerekli: {} — sunucu komutu değişti; bu adların değerleri yeni komuta "
    "verilecek: {}":
        "Passing environment variables needs explicit confirmation: {} — the server command changed; the values of "
        "these names will be given to the new command: {}",
    "Günlük bütçe doldu; çıktı şeması düzeltme turu yapılmadı":
        "Daily budget reached; the output schema repair round was skipped",
    "Düzenli ifade zaman sınırını aştı ({} sn); kalıp felaket geri izleme yapıyor olabilir":
        "The regular expression ran past its time limit ({} s); the pattern may backtrack catastrophically",
    "Düzenli ifade çok uzun (en çok {} karakter)": "The regular expression is too long (at most {} characters)",
    "Düzenli ifade iç içe niceleyici içeriyor (felaket geri izleme riski): {}":
        "The regular expression has nested quantifiers (catastrophic backtracking risk): {}",
    "Düzenli ifade değerlendirilemedi": "The regular expression could not be evaluated",
}
