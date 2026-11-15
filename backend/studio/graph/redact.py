"""MCP'ye çıkan graf okumalarında tür başına gizlilik süzgeci.

Bazı düğüm türleri yerel ayrıntı taşır (teslim kaydı: yerel yol, klasör, dal, `file:` bağlantısı). bunları MCP'ye
`/api/deliverables/{id}/deliveries` ucunda süzer; aynı düğüm `/api/graph` ve `/api/graph/node/{id}` ile de okunabildiği
için süzgeç burada türe bağlı bir kanca olarak tutulur: bir tür `register(tür, fn)` ile "MCP görünümü"nü bildirir
(`fn(props) -> props`, girdiyi değiştirmez). Yeni düğüm türleri hassas özelliklerini aynı yolla bildirir.
Arayüz ve başlıksız yerel istekler süzülmez (MCP'yi yalnız `X-Studio-Client: mcp/…` başlığı ayırt eder).
"""

from __future__ import annotations

from typing import Any, Callable

PropsHook = Callable[[dict[str, Any]], dict[str, Any]]
_HOOKS: dict[str, PropsHook] = {}


def register(type_name: str, fn: PropsHook) -> None:
    _HOOKS[type_name] = fn


def registered() -> frozenset[str]:
    return frozenset(_HOOKS)


def mcp_props(type_name: str, props: dict[str, Any] | None) -> dict[str, Any]:
    fn = _HOOKS.get(type_name)
    p = dict(props or {})
    return fn(p) if fn else p


def mcp_node(node: dict[str, Any]) -> dict[str, Any]:
    """Düğümün MCP görünümü (kancası olmayan tür aynen döner)."""
    if node.get("type") not in _HOOKS:
        return node
    return {**node, "props": mcp_props(str(node["type"]), node.get("props"))}


def _ensure_builtin() -> None:
    """Yerleşik kancalar tembel yüklenir (içe aktarma sırasına bağlı kalmaz)."""
    if "Delivery" not in _HOOKS:
        try:
            from studio.delivery.api import _mcp_record  # noqa: PLC0415
        except ImportError:  # teslim modülü yok: süzülecek düğüm de yok
            return
        register("Delivery", _mcp_record)


def for_mcp(node: dict[str, Any]) -> dict[str, Any]:
    _ensure_builtin()
    return mcp_node(node)
