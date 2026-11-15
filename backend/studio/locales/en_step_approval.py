"""EN karşılıkları: adım başı onay (`workflow/step_gate.py`, `workflow/spec.py`, karar ucu).

Ortak `en.py`'de eşzamanlı düzenleme olmasın diye ayrı dosya (`en_<alan>.py` deseni); `en.py` sonunda katılır.
"""

from __future__ import annotations

MESSAGES: dict[str, str] = {
    "Adım onayı · {}": "Step approval · {}",
    "'{}' adımı çalışmadan önce onayını bekliyor: model çağrılmadı, bütçe ayrılmadı. Gönderilecek istemi incele — "
    "onayla / reddet?":
        "Step '{}' is waiting for your approval before it runs: no model was called and no budget was reserved. "
        "Review the prompt that will be sent — approve / reject?",
    "'{}' adımının çıktısı onayını bekliyor; onaylanmadan sonraki adımlar başlamaz. Onayla / reddet?":
        "The output of step '{}' is waiting for your approval; later steps do not start until it is approved. "
        "Approve / reject?",
    "Kullanıcı adımı çalışmadan önce reddetti": "The user rejected the step before it ran",
    "Kullanıcı adımın çıktısını reddetti": "The user rejected the step's output",
    "Onay bekliyor…": "Waiting for approval…",
    "Adım onayı yalnızca uygulama arayüzünden, kullanıcı tarafından verilebilir":
        "A step approval can only be decided by the user in the studio interface",
    "{}: approval 'before', 'after' ya da 'none' olmalı": "{}: approval must be 'before', 'after' or 'none'",
    "{}: adım başı onay (approval) yalnızca ajan adımında kullanılabilir":
        "{}: per-step approval (approval) can only be used on an agent step",
}
