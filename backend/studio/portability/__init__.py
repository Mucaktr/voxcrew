"""Taşınabilirlik: iptal ya da plan düşürmede "hepsini dışa aktar" — tek yerel zip.

Hiçbir şey silinmez; paket yalnız okur. Ayrıntı: `service.py` (içerik, hariç tutulanlar, boyut sınırları) ve `api.py`.
"""

from .service import FORMAT, VERSION, PortabilityService, service_for

__all__ = ["FORMAT", "VERSION", "PortabilityService", "service_for"]
