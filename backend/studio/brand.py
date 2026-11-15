"""Marka bilgisi — tek kaynak (ön yüzdeki karşılığı: frontend/src/lib/brand.ts).

Ad değişikliği kararı kullanıcıdadır; değiştirilirse bu dosya ile `frontend/src/lib/brand.ts`, `frontend/index.html`
(başlık ve açıklama) ve README'ler birlikte güncellenir. CLI komut adı (`voxcrew`) ve paket adı ayrıca
`pyproject.toml` içindedir.
"""

from __future__ import annotations

from studio._edition import EDITION

NAME = "VoxCrew"
NAME_EN = "VoxCrew"
SLUG = "voxcrew"
TAGLINE = "ajan dünyası"
DESCRIPTION = "Yerel yapay zekâ ajanları için voxel dünya, görev ve iş akışı stüdyosu"
DESCRIPTION_EN = "A local voxel world, task and workflow studio for AI agents"

# GitHub deposu (eklenti pazarı ve "GitHub'dan kur" komutları için). Yerel klasörün adı farklı olabilir;
# depo adı tek doğru kaynaktır. REPO_PUBLIC: depo herkese açılınca True yapılır (arayüz GitHub yolunu önerir).
GITHUB_REPO = "Mucaktr/voxcrew"
REPO_PUBLIC = False

# S40 — yönetici / test modu (derleme anı anahtarı, yalnız tam sürüm). False iken hiçbir ayar, ortam değişkeni ya da API
# çağrısı modu açamaz ve arayüz hiçbir şey göstermez. Ön yüzdeki karşılığı: brand.ts `adminModeAvailable`.
ADMIN_MODE_AVAILABLE = True
if EDITION != "full":
    ADMIN_MODE_AVAILABLE = False

if EDITION == "full":  # barındırılan hesap servisi adresi (studio/full/cloud.py); free sürümde bulut hesabı yok
    from studio.full.cloud import CLOUD_BASE_URL  # noqa: F401

LICENSE = "PolyForm Shield License 1.0.0"
COPYRIGHT = "Copyright (c) 2026 Mustafa Uçak <mustafa.ucak@gmail.com>"

# Ad benzerliğinden doğabilecek karışıklığa karşı (README'de de yer alır).
DISCLAIMER = ("Nous Research, OpenAI, Anthropic ya da Ollama ile bağlantılı değildir; adlar ilgili sahiplerinin "
              "markalarıdır.")


def as_dict() -> dict[str, str]:
    return {"name": NAME, "name_en": NAME_EN, "slug": SLUG, "tagline": TAGLINE, "description": DESCRIPTION,
            "license": LICENSE, "copyright": COPYRIGHT, "github_repo": GITHUB_REPO, "repo_public": REPO_PUBLIC}
