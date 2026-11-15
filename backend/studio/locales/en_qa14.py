""" düzeltmelerinin sunucu iletileri (EN): ayrılmış ajan adları ve booster/ayar yazımlarında katı mantıksal değer."""

from __future__ import annotations

MESSAGES: dict[str, str] = {
    "'{}' ayrılmış bir ajan adı: 'user', 'kullanici', 'system' ve 'studio' (ve benzer yazımları) kullanıcı ve sistem "
    "kayıtlarına ayrılmıştır; başka bir ad seç":
        "'{}' is a reserved agent name: 'user', 'kullanici', 'system' and 'studio' (and similar spellings) are reserved "
        "for user and system records; choose another name",
    "enabled true ya da false olmalı": "enabled must be true or false",
    "boost bir nesne olmalı": "boost must be an object",
    "boost.enabled true ya da false olmalı": "boost.enabled must be true or false",
    "boost.profile bir metin olmalı": "boost.profile must be a string",
    "boost.{} booster kimliklerinin listesi olmalı": "boost.{} must be a list of booster ids",
}
