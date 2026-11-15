"""Ontoloji: varlık/ilişki türleri, özellik doğrulama ve kanonik anahtar üretimi.

Graf deposu her yazımı buradan geçirir; ontolojide olmayan tür, ilişki veya özellik reddedilir.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml


class OntologyError(ValueError):
    pass


_PY_TYPES: dict[str, tuple[type, ...]] = {
    "string": (str,),
    "text": (str,),
    "int": (int,),
    "float": (int, float),
    "bool": (bool,),
    "list": (list, tuple),
    "object": (dict,),
}


@dataclass
class PropSpec:
    name: str
    type: str
    required: bool = False
    enum: list[str] | None = None


@dataclass
class EntityType:
    name: str
    key: str
    label: str
    color: str
    description: str
    search: list[str]
    properties: dict[str, PropSpec] = field(default_factory=dict)


@dataclass
class RelationType:
    name: str
    sources: list[str]
    targets: list[str]
    description: str
    same_type: bool = False  # yalnız aynı türden iki düğüm arasında (kaynak türü == hedef türü)


def normalize_key(value: str) -> str:
    """Türkçe duyarlı küçük harf + boşluk sadeleştirme (Concept anahtarları için)."""
    s = str(value).replace("İ", "i").lower()
    s = re.sub(r"\s+", " ", s).strip(" .,:;!?\"'`()[]{}")
    return s


class Ontology:
    def __init__(self, entities: dict[str, EntityType], relations: dict[str, RelationType],
                 name: str = "ontology", version: int = 1):
        self.entities = entities
        self.relations = relations
        self.name = name
        self.version = version

    @classmethod
    def load(cls, path: str | Path) -> "Ontology":
        raw = yaml.safe_load(Path(path).read_text("utf-8"))
        entities: dict[str, EntityType] = {}
        for ename, spec in (raw.get("entities") or {}).items():
            props = {
                pname: PropSpec(pname, p.get("type", "string"), bool(p.get("required")), p.get("enum"))
                for pname, p in (spec.get("properties") or {}).items()
            }
            key = spec["key"]
            if key not in props:
                raise OntologyError(f"{ename}: anahtar özellik tanımsız: {key}")
            # FAZB2: etiket ve arama alanları da tanımlı özellik olmalı (yeni türlerde yazım hatası sessiz kalmasın)
            unknown = [p for p in [spec.get("label", key), *(spec.get("search") or [])] if p not in props]
            if unknown:
                raise OntologyError(f"{ename}: tanımsız etiket/arama özelliği: {', '.join(unknown)}")
            entities[ename] = EntityType(
                name=ename, key=key, label=spec.get("label", key), color=spec.get("color", "#94A3B8"),
                description=spec.get("description", ""), search=list(spec.get("search") or []),
                properties=props)
        relations: dict[str, RelationType] = {}
        for rname, spec in (raw.get("relations") or {}).items():
            src, dst = list(spec["from"]), list(spec["to"])
            for t in src + dst:
                if t not in entities:
                    raise OntologyError(f"{rname}: bilinmeyen tür {t}")
            relations[rname] = RelationType(rname, src, dst, spec.get("description", ""),
                                            bool(spec.get("same_type")))
        return cls(entities, relations, raw.get("name", "ontology"), int(raw.get("version", 1)))

    # ---------- erişim ----------
    def entity(self, name: str) -> EntityType:
        try:
            return self.entities[name]
        except KeyError:
            raise OntologyError(f"Ontolojide olmayan varlık türü: {name}") from None

    def relation(self, name: str) -> RelationType:
        try:
            return self.relations[name]
        except KeyError:
            raise OntologyError(f"Ontolojide olmayan ilişki: {name}") from None

    # ---------- doğrulama ----------
    def validate(self, type_name: str, props: dict[str, Any], partial: bool = False) -> dict[str, Any]:
        et = self.entity(type_name)
        clean: dict[str, Any] = {}
        for k, v in props.items():
            if v is None:
                continue
            spec = et.properties.get(k)
            if spec is None:
                raise OntologyError(f"{type_name}.{k} ontolojide tanımlı değil")
            allowed = _PY_TYPES.get(spec.type, (str,))
            if spec.type in ("int", "float") and isinstance(v, bool):
                raise OntologyError(f"{type_name}.{k} sayı olmalı")
            if not isinstance(v, allowed):
                raise OntologyError(f"{type_name}.{k} türü {spec.type} olmalı (gelen: {type(v).__name__})")
            if spec.enum and v not in spec.enum:
                raise OntologyError(f"{type_name}.{k} şu değerlerden biri olmalı: {', '.join(spec.enum)}")
            clean[k] = list(v) if isinstance(v, tuple) else v
        if not partial:
            for pname, spec in et.properties.items():
                if spec.required and clean.get(pname) in (None, ""):
                    raise OntologyError(f"{type_name}.{pname} zorunlu")
        return clean

    def canonical_key(self, type_name: str, props: dict[str, Any]) -> str:
        et = self.entity(type_name)
        value = props.get(et.key)
        if value in (None, ""):
            raise OntologyError(f"{type_name}: anahtar ({et.key}) boş")
        return normalize_key(value) if type_name == "Concept" else str(value).strip()

    def label_of(self, type_name: str, props: dict[str, Any]) -> str:
        et = self.entity(type_name)
        value = props.get(et.label) or props.get(et.key) or ""
        text = str(value).strip().replace("\n", " ")
        return text[:160] + ("…" if len(text) > 160 else "")

    def search_text(self, type_name: str, props: dict[str, Any]) -> str:
        et = self.entity(type_name)
        parts = [str(props[p]) for p in et.search if props.get(p)]
        return "\n".join(parts)

    def check_relation(self, rel_name: str, src_type: str, dst_type: str) -> None:
        rel = self.relation(rel_name)
        if src_type not in rel.sources or dst_type not in rel.targets:
            raise OntologyError(
                f"{rel_name} ilişkisi {src_type} → {dst_type} için geçersiz "
                f"(izinli: {'/'.join(rel.sources)} → {'/'.join(rel.targets)})")
        if rel.same_type and src_type != dst_type:
            raise OntologyError(f"{rel_name} ilişkisi yalnız aynı türden düğümler arasında kurulur ({src_type} → {dst_type})")

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "version": self.version,
            "entities": [
                {"name": e.name, "key": e.key, "label": e.label, "color": e.color,
                 "description": e.description,
                 "properties": [{"name": p.name, "type": p.type, "required": p.required, "enum": p.enum}
                                for p in e.properties.values()]}
                for e in self.entities.values()
            ],
            "relations": [
                {"name": r.name, "from": r.sources, "to": r.targets, "description": r.description}
                for r in self.relations.values()
            ],
        }
