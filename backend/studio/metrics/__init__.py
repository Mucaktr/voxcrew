"""Yerel ölçüm defteri ve kuzey yıldızı (G1-A METRICS).

- `ledger.py`: `<veri>/metrics.sqlite`; yalnız kimlik ve sayı taşıyan olaylar (istem, çıktı, dosya ya da ajan adı yok).
- `service.py`: graftan filigranlı (watermark) artımlı doldurma + olay yolu abonesi; ölçü hesapları.
- `api.py`: `/api/metrics` (özet, maliyet dağılımı, dışa aktarma; silme yalnız kullanıcıdan).

Ağ çağrısı yoktur (mimari test: `tests/test_metrics.py`). Telemetri G7'dedir ve rızaya bağlıdır.
"""
