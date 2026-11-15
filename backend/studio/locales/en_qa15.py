""" düzeltmelerinin sunucu iletileri (EN): ayrılmış ajan adları (görünen ad ve kısa ad; yazılan değer anılır)."""

from __future__ import annotations

MESSAGES: dict[str, str] = {
    "“{}” ayrılmış bir ajan adı: Kullanıcı / User, Sistem / System ve Stüdyo / Studio (ve benzer yazımları) kullanıcı "
    "ve sistem kayıtlarına ayrılmıştır; ad ya da kısa ad olarak kullanılamaz, başka bir ad seç":
        "“{}” is a reserved agent name: Kullanıcı / User, Sistem / System and Stüdyo / Studio (and similar spellings) "
        "are reserved for user and system records and can't be used as a name or short name; choose another name",
}
