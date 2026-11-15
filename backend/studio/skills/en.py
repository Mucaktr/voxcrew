"""İngilizce katalog — G1-D skill sabitleme (`studio/skills` snapshot/binding/importplan). `locales/en.py` katar."""

from __future__ import annotations

MESSAGES: dict[str, str] = {
    "Bu skill ajana atanmamış; önce ata": "This skill is not assigned to the agent; assign it first",
    "Onaylı sürüm yok; önce içe aktarma önizlemesini onayla":
        "No approved version; approve the import preview first",
    "Geçersiz sürüm özeti": "Invalid version digest",
    "Bu sürüm onaylanmamış; önce içe aktarma önizlemesini onayla":
        "This version is not approved; approve the import preview first",
    "bindings.json okunamadı; elle incele (üzerine yazılmaz)":
        "bindings.json could not be read; inspect it manually (it is not overwritten)",
    "id (kütüphane kimliği ya da atama anahtarı) gerekli": "id (library id or assignment key) is required",
    "Onaylamak için açık onay (confirm: true) gerekli": "Explicit confirmation (confirm: true) is required to approve",
    "Önizlemede güvenlik bulgusu var; onaylamak için bulguları gördüğünü belirt (accept_risk: true)":
        "The preview has security findings; confirm that you have seen them to approve (accept_risk: true)",
    "Kaynak önizlemeden sonra değişti; önizlemeyi yenile": "The source changed after the preview; refresh the preview",
    "SKILL.md okunamadı": "SKILL.md could not be read",
    "Geçersiz anlık görüntü içeriği": "Invalid snapshot content",
    "Bu sürümün kayıtlı kopyası bozulmuş; elle incele (üzerine yazılmaz)":
        "The stored copy of this version is corrupted; inspect it manually (it is not overwritten)",
    "Anlık görüntü yazılamadı: {}": "Snapshot could not be written: {}",
}
