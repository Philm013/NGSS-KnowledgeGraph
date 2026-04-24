from __future__ import annotations

import re
import unicodedata
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .models import (
    CommonCoreEntry,
    DimensionGroupModel,
    DimensionReference,
    GradeModel,
    TopicModel,
    load_dimension_file,
    load_grade_file,
)


PE_CODE_RE = re.compile(r"\b(?:K|MS|HS|[1-5])-[A-Z]{2,4}\d?-\d+\b")


def normalize_text(value: str) -> str:
    text = value.replace("’", "'").replace("–", "-").replace("—", "-")
    text = unicodedata.normalize("NFKD", text)
    text = text.lower()
    text = re.sub(r"\s+", " ", text).strip()
    return text


def normalize_lookup(value: str) -> str:
    text = normalize_text(value)
    text = text.replace("&", "and")
    text = re.sub(r"\s*\(secondary\)", "", text)
    text = text.replace("nature of science", "the nature of science")
    text = text.replace("universe and its stars", "universe and the stars")
    text = text.replace("earth materials and system", "earth materials and systems")
    text = text.replace("earth’s", "earth's")
    text = text.replace(
        "influence of engineering, technology, and science, on society and the natural world",
        "influence of science, engineering, and technology on society and the natural world",
    )
    # Expand abbreviated CCC concept names used in PE tables to their full inventory names.
    # PE tables often omit the subtitle (e.g. "Cause and Effect" instead of the inventory
    # title "Cause and Effect: Mechanism and Explanation").
    if text == "cause and effect":
        text = "cause and effect: mechanism and explanation"
    if text == "energy and matter":
        text = "energy and matter: flows, cycles, and conservation"
    text = re.sub(r"\s+", " ", text).strip()
    return text


def slugify(value: str) -> str:
    base = normalize_text(value)
    base = re.sub(r"[^a-z0-9]+", "-", base).strip("-")
    return base or "item"


def split_prefixed_name(value: str) -> tuple[str, str]:
    if ":" in value:
        prefix, title = value.split(":", 1)
        return prefix.strip(), title.strip()
    return slugify(value).upper(), value.strip()


def ensure_list(value: str | list[str]) -> list[str]:
    if isinstance(value, list):
        return value
    return [value]


def detect_pe_codes(value: str) -> list[str]:
    return PE_CODE_RE.findall(value)


def extract_code_and_title(value: str) -> tuple[str | None, str]:
    match = re.match(r"^([A-Z]{2,}[0-9]\.[A-Z])(?::|\s+)(.+)$", value.strip())
    if match:
        return match.group(1).strip(), match.group(2).strip()
    return None, value.strip()


def public_id_from_node_id(node_id: str) -> str:
    return node_id.split(":")[-1] if ":" in node_id else node_id


@dataclass(slots=True)
class NodeRecord:
    node_id: str
    node_type: str
    title: str
    family: str | None = None
    description: str | None = None
    payload: dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class EdgeRecord:
    edge_id: str
    source_id: str
    target_id: str
    edge_type: str
    payload: dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class AliasRecord:
    alias_text: str
    normalized_alias: str
    canonical_id: str
    mapping_method: str
    confidence: float


@dataclass(slots=True)
class ChunkRecord:
    chunk_id: str
    node_id: str
    chunk_type: str
    title: str
    text: str
    payload: dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class GraphData:
    nodes: list[NodeRecord]
    edges: list[EdgeRecord]
    aliases: list[AliasRecord]
    chunks: list[ChunkRecord]
    metadata: dict[str, Any]


@dataclass(slots=True)
class ResolvedConcept:
    node_id: str
    family: str
    canonical_label: str
    mapping_method: str
    confidence: float


class NGSSGraphBuilder:
    def __init__(self, json_dir: Path):
        self.json_dir = json_dir
        self.nodes: dict[str, NodeRecord] = {}
        self.edges: list[EdgeRecord] = []
        self.aliases: dict[tuple[str, str], AliasRecord] = {}
        self.chunks: dict[str, ChunkRecord] = {}
        self._edge_counter = 0
        self.concept_by_lookup: dict[str, str] = {}
        self.dci_by_code: dict[str, str] = {}
        self.topic_to_pe_ids: dict[str, list[str]] = defaultdict(list)

    def build(self) -> GraphData:
        grade_files = [
            self.json_dir / "ngssK5.json",
            self.json_dir / "ngss68.json",
            self.json_dir / "ngss912.json",
        ]
        dimensions = load_dimension_file(self.json_dir / "ngss3DElements.json")

        self._build_dimension_inventory(dimensions, "ngss3DElements.json")
        for path in grade_files:
            for grade in load_grade_file(path):
                self._add_grade(grade, path.name)
        self._build_concept_chunks()

        return GraphData(
            nodes=list(self.nodes.values()),
            edges=self.edges,
            aliases=list(self.aliases.values()),
            chunks=list(self.chunks.values()),
            metadata={
                "source_files": ["ngss3DElements.json", "ngss68.json", "ngss912.json", "ngssK5.json"],
                "grades": len([n for n in self.nodes.values() if n.node_type == "grade_band"]),
                "topics": len([n for n in self.nodes.values() if n.node_type == "topic"]),
                "performance_expectations": len(
                    [n for n in self.nodes.values() if n.node_type == "performance_expectation"]
                ),
                "concepts": len([n for n in self.nodes.values() if n.node_type == "dimension_concept"]),
            },
        )

    def _add_node(self, record: NodeRecord) -> None:
        existing = self.nodes.get(record.node_id)
        if existing is None:
            self.nodes[record.node_id] = record
            return
        if not existing.description and record.description:
            existing.description = record.description
        existing.payload.update(record.payload)

    def _add_edge(self, source_id: str, target_id: str, edge_type: str, payload: dict[str, Any] | None = None) -> None:
        self._edge_counter += 1
        self.edges.append(
            EdgeRecord(
                edge_id=f"edge:{self._edge_counter}",
                source_id=source_id,
                target_id=target_id,
                edge_type=edge_type,
                payload=payload or {},
            )
        )

    def _add_alias(self, alias_text: str, canonical_id: str, mapping_method: str, confidence: float) -> None:
        key = (alias_text, canonical_id)
        if key in self.aliases:
            return
        self.aliases[key] = AliasRecord(
            alias_text=alias_text,
            normalized_alias=normalize_lookup(alias_text),
            canonical_id=canonical_id,
            mapping_method=mapping_method,
            confidence=confidence,
        )

    def _add_chunk(self, record: ChunkRecord) -> None:
        self.chunks[record.chunk_id] = record

    def _register_concept_lookup(self, *labels: str, node_id: str) -> None:
        for label in labels:
            self.concept_by_lookup[normalize_lookup(label)] = node_id

    def _build_dimension_inventory(self, groups: list[DimensionGroupModel], source_file: str) -> None:
        for group in groups:
            family = "DCI" if group.code.startswith("DCI-") else group.code
            if group.elements:
                for element in group.elements:
                    short_code, display_title = split_prefixed_name(element.name)
                    node_id = f"concept:{family}:{short_code}"
                    self._add_node(
                        NodeRecord(
                            node_id=node_id,
                            node_type="dimension_concept",
                            title=display_title,
                            family=family,
                            description=group.dimension,
                            payload={
                                "public_id": short_code,
                                "family": family,
                                "dimension_group": group.code,
                                "full_name": element.name,
                                "source_file": source_file,
                                "source_kind": "dimension-inventory",
                            },
                        )
                    )
                    self._register_concept_lookup(element.name, display_title, node_id=node_id)
                    self._add_alias(element.name, node_id, "inventory-name", 1.0)
                    self._add_alias(display_title, node_id, "inventory-title", 1.0)
                    for band, items in element.progressions.items():
                        for item in items:
                            progression_id = f"progression:{family}:{item.code}"
                            self._add_node(
                                NodeRecord(
                                    node_id=progression_id,
                                    node_type="progression_statement",
                                    title=item.code,
                                    family=family,
                                    description=item.text,
                                    payload={
                                        "public_id": item.code,
                                        "band": band,
                                        "text": item.text,
                                        "family": family,
                                        "source_file": source_file,
                                    },
                                )
                            )
                            self._add_edge(node_id, progression_id, "DIMENSION_HAS_PROGRESSION", {"band": band, "source_file": source_file})
            for core_idea in group.core_ideas:
                for component in core_idea.components:
                    code, display_title = extract_code_and_title(component.name)
                    canonical_code = code or slugify(component.name).upper()
                    node_id = f"concept:DCI:{canonical_code}"
                    self._add_node(
                        NodeRecord(
                            node_id=node_id,
                            node_type="dimension_concept",
                            title=display_title,
                            family="DCI",
                            description=core_idea.name,
                            payload={
                                "public_id": canonical_code,
                                "family": "DCI",
                                "dimension_group": group.code,
                                "core_idea": core_idea.name,
                                "full_name": component.name,
                                "source_file": source_file,
                                "source_kind": "dimension-inventory",
                            },
                        )
                    )
                    self.dci_by_code[canonical_code] = node_id
                    self._register_concept_lookup(component.name, display_title, canonical_code, node_id=node_id)
                    self._add_alias(component.name, node_id, "inventory-name", 1.0)
                    self._add_alias(display_title, node_id, "inventory-title", 1.0)
                    self._add_alias(canonical_code, node_id, "inventory-code", 1.0)
                    for band, items in component.progressions.items():
                        for item in items:
                            progression_id = f"progression:DCI:{item.code}"
                            self._add_node(
                                NodeRecord(
                                    node_id=progression_id,
                                    node_type="progression_statement",
                                    title=item.code,
                                    family="DCI",
                                    description=item.text,
                                    payload={
                                        "public_id": item.code,
                                        "band": band,
                                        "text": item.text,
                                        "family": "DCI",
                                        "source_file": source_file,
                                    },
                                )
                            )
                            self._add_edge(node_id, progression_id, "DIMENSION_HAS_PROGRESSION", {"band": band, "source_file": source_file})

    def _add_grade(self, grade: GradeModel, source_file: str) -> None:
        grade_node_id = f"grade:{grade.gradeId}"
        self._add_node(
            NodeRecord(
                node_id=grade_node_id,
                node_type="grade_band",
                title=grade.gradeLabel,
                description=f"NGSS grade or grade band {grade.gradeId}",
                payload={"public_id": grade.gradeId, "toc_page": grade.tocPage, "source_file": source_file},
            )
        )
        self._add_alias(grade.gradeId, grade_node_id, "raw-grade-id", 1.0)
        self._add_alias(grade.gradeLabel, grade_node_id, "grade-label", 1.0)
        for topic in grade.topics:
            self._add_topic(grade, topic, source_file)

    def _add_topic(self, grade: GradeModel, topic: TopicModel, source_file: str) -> None:
        grade_node_id = f"grade:{grade.gradeId}"
        topic_node_id = f"topic:{topic.topicId}"
        self._add_node(
            NodeRecord(
                node_id=topic_node_id,
                node_type="topic",
                title=topic.topicTitle,
                description=f"Topic {topic.topicId} for {grade.gradeLabel}",
                payload={
                    "public_id": topic.topicId,
                    "grade_id": grade.gradeId,
                    "grade_label": grade.gradeLabel,
                    "toc_page": topic.tocPage,
                    "source_file": source_file,
                    "source_kind": "topic",
                },
            )
        )
        self._add_alias(topic.topicId, topic_node_id, "topic-id", 1.0)
        self._add_alias(topic.topicTitle, topic_node_id, "topic-title", 1.0)
        self._add_alias(f"{grade.gradeLabel} {topic.topicTitle}", topic_node_id, "grade-topic-title", 0.98)
        self._add_alias(f"{grade.gradeId} {topic.topicTitle}", topic_node_id, "grade-topic-id-title", 0.95)
        self._add_edge(grade_node_id, topic_node_id, "GRADE_HAS_TOPIC", {"source_file": source_file, "source_kind": "topic-membership"})

        for pe in topic.performanceExpectations:
            self._add_pe(grade, topic, pe, source_file)

        self._add_connection_edges(topic_node_id, topic.connections.connectionsToOtherDcisInGradeLevel, "TOPIC_CONNECTS_TO_DCI_IN_GRADE", source_file)
        self._add_connection_edges(
            topic_node_id,
            topic.connections.articulationOfDcisAcrossGradeLevels,
            "TOPIC_ARTICULATES_TO_DCI_ACROSS_GRADES",
            source_file,
        )
        self._add_connection_edges(topic_node_id, topic.connections.connectionsToETSdci, "TOPIC_CONNECTS_TO_DCI_IN_GRADE", source_file)
        self._add_crosswalk_edges(topic_node_id, topic, source_file)
        self._add_topic_chunk(topic_node_id, grade, topic, source_file)

    def _add_pe(self, grade: GradeModel, topic: TopicModel, pe: Any, source_file: str) -> None:
        topic_node_id = f"topic:{topic.topicId}"
        pe_node_id = f"pe:{pe.id}"
        self.topic_to_pe_ids[topic_node_id].append(pe_node_id)
        details = pe.details
        self._add_node(
            NodeRecord(
                node_id=pe_node_id,
                node_type="performance_expectation",
                title=pe.id,
                description=pe.description,
                payload={
                    "public_id": pe.id,
                    "grade_id": grade.gradeId,
                    "grade_label": grade.gradeLabel,
                    "topic_id": topic.topicId,
                    "topic_title": topic.topicTitle,
                    "clarification_statement": details.clarificationStatement,
                    "assessment_boundary": details.assessmentBoundary,
                    "source_pages": pe.sourcePages,
                    "source_file": source_file,
                    "source_kind": "performance-expectation",
                },
            )
        )
        self._add_alias(pe.id, pe_node_id, "pe-id", 1.0)
        self._add_edge(topic_node_id, pe_node_id, "TOPIC_HAS_PE", {"source_file": source_file, "source_kind": "topic-membership"})

        for page in pe.sourcePages:
            source_page_id = f"source_page:{grade.gradeId}:{page}"
            self._add_node(
                NodeRecord(
                    node_id=source_page_id,
                    node_type="source_page",
                    title=f"Page {page}",
                    description=f"Source page {page} in the {grade.gradeId} NGSS document",
                    payload={"public_id": f"{grade.gradeId}:{page}", "grade_id": grade.gradeId, "page": page, "source_file": source_file},
                )
            )
            self._add_edge(pe_node_id, source_page_id, "PE_HAS_SOURCE_PAGE", {"page": page, "source_file": source_file})

        for index, statement in enumerate(details.evidenceStatements, start=1):
            evidence_id = f"evidence:{pe.id}:{index}"
            self._add_node(
                NodeRecord(
                    node_id=evidence_id,
                    node_type="evidence_statement",
                    title=f"{pe.id} evidence {index}",
                    description=statement,
                    payload={"public_id": evidence_id, "pe_id": pe.id, "index": index, "source_file": source_file, "source_pages": pe.sourcePages},
                )
            )
            self._add_edge(pe_node_id, evidence_id, "PE_HAS_EVIDENCE", {"index": index, "source_file": source_file, "source_pages": pe.sourcePages})

        for family_hint, references in (
            ("SEP", details.sep),
            ("DCI", details.dci),
            ("CCC", details.ccc),
        ):
            for reference in references:
                resolved = self._resolve_dimension_reference(reference, family_hint)
                self._add_edge(
                    pe_node_id,
                    resolved.node_id,
                    "PE_ALIGNS_TO_DIMENSION",
                    {
                        "family_hint": family_hint,
                        "resolved_family": resolved.family,
                        "raw_id": reference.id,
                        "mapping_method": resolved.mapping_method,
                        "confidence": resolved.confidence,
                        "texts": reference.text,
                        "source_file": source_file,
                        "source_pages": pe.sourcePages,
                    },
                )
                self._add_alias(reference.id, resolved.node_id, resolved.mapping_method, resolved.confidence)
                if reference.text:
                    self._add_alias(reference.text[0], resolved.node_id, f"{resolved.mapping_method}-text", min(resolved.confidence, 0.95))

        self._add_pe_chunk(pe_node_id, grade, topic, pe, source_file)

    def _resolve_dimension_reference(self, reference: DimensionReference, family_hint: str) -> ResolvedConcept:
        code, _ = extract_code_and_title(reference.id)
        if family_hint == "DCI" or code:
            canonical_code = code or reference.id.split(" ", 1)[0].strip()
            node_id = self.dci_by_code.get(canonical_code)
            if node_id is None:
                title = reference.id.split(":", 1)[-1].strip() if ":" in reference.id else reference.id[len(canonical_code) :].strip()
                node_id = f"concept:DCI:{canonical_code}"
                self._add_node(
                    NodeRecord(
                        node_id=node_id,
                        node_type="dimension_concept",
                        title=title or canonical_code,
                        family="DCI",
                        description="Synthetic DCI node created from PE references",
                        payload={"public_id": canonical_code, "family": "DCI", "synthetic": True},
                    )
                )
                self.dci_by_code[canonical_code] = node_id
                self._register_concept_lookup(reference.id, canonical_code, node_id=node_id)
            return ResolvedConcept(node_id=node_id, family="DCI", canonical_label=self.nodes[node_id].title, mapping_method="dci-code", confidence=1.0)

        raw_lookup = normalize_lookup(reference.id)
        if raw_lookup in self.concept_by_lookup:
            node_id = self.concept_by_lookup[raw_lookup]
            return ResolvedConcept(node_id=node_id, family=self.nodes[node_id].family or family_hint, canonical_label=self.nodes[node_id].title, mapping_method="normalized-id", confidence=0.98)

        for text_item in reference.text:
            candidate = normalize_lookup(re.sub(r"\s*\((?:K|MS|HS|[1-5]).*$", "", text_item).strip())
            if candidate in self.concept_by_lookup:
                node_id = self.concept_by_lookup[candidate]
                return ResolvedConcept(node_id=node_id, family=self.nodes[node_id].family or family_hint, canonical_label=self.nodes[node_id].title, mapping_method="normalized-text", confidence=0.92)

        fallback_id = f"concept:{family_hint}:{slugify(reference.id).upper()}"
        if fallback_id not in self.nodes:
            self._add_node(
                NodeRecord(
                    node_id=fallback_id,
                    node_type="dimension_concept",
                    title=reference.id,
                    family=family_hint,
                    description="Synthetic concept created from unresolved PE reference",
                    payload={"public_id": public_id_from_node_id(fallback_id), "family": family_hint, "synthetic": True},
                )
            )
            self._register_concept_lookup(reference.id, node_id=fallback_id)
        return ResolvedConcept(node_id=fallback_id, family=family_hint, canonical_label=reference.id, mapping_method="fallback", confidence=0.5)

    def _add_connection_edges(self, topic_node_id: str, raw_value: str | dict[str, str] | None, edge_type: str, source_file: str) -> None:
        if not raw_value:
            return
        if isinstance(raw_value, dict):
            for dci_code, raw_mapping in raw_value.items():
                concept_node_id = self.dci_by_code.get(dci_code)
                if concept_node_id is None:
                    concept_node_id = f"concept:DCI:{dci_code}"
                    self._add_node(
                        NodeRecord(
                            node_id=concept_node_id,
                            node_type="dimension_concept",
                            title=dci_code,
                            family="DCI",
                            description="Synthetic DCI node created from ETS connections",
                            payload={"public_id": dci_code, "family": "DCI", "synthetic": True, "source_file": source_file},
                        )
                    )
                    self.dci_by_code[dci_code] = concept_node_id
                    self._register_concept_lookup(dci_code, node_id=concept_node_id)
                self._add_alias(dci_code, concept_node_id, "topic-ets-target", 0.95)
                self._add_edge(
                    topic_node_id,
                    concept_node_id,
                    edge_type,
                    {
                        "target_reference": dci_code,
                        "raw_mapping": raw_mapping,
                        "supporting_pe_ids": detect_pe_codes(raw_mapping),
                        "source_file": source_file,
                    },
                )
            return
        parts = [part.strip() for part in raw_value.split(";") if part.strip()]
        for part in parts:
            match = re.match(r"^([A-Z0-9]+\.[A-Z0-9.]+)\s+\(([^)]*)\)$", part)
            if not match:
                continue
            raw_target = match.group(1)
            pe_ids = [item.strip() for item in match.group(2).split(",") if item.strip()]
            if "." not in raw_target:
                continue
            grade_prefix, dci_code = raw_target.split(".", 1)
            concept_node_id = self.dci_by_code.get(dci_code)
            if concept_node_id is None:
                concept_node_id = f"concept:DCI:{dci_code}"
                self._add_node(
                    NodeRecord(
                        node_id=concept_node_id,
                            node_type="dimension_concept",
                            title=dci_code,
                            family="DCI",
                            description="Synthetic DCI node created from topic connections",
                            payload={"public_id": dci_code, "family": "DCI", "synthetic": True, "source_file": source_file},
                        )
                    )
                self.dci_by_code[dci_code] = concept_node_id
                self._register_concept_lookup(dci_code, node_id=concept_node_id)
            self._add_alias(raw_target, concept_node_id, "topic-connection-target", 0.9)
            self._add_edge(
                topic_node_id,
                concept_node_id,
                edge_type,
                    {
                        "target_grade": grade_prefix,
                        "target_reference": raw_target,
                        "supporting_pe_ids": pe_ids,
                        "source_file": source_file,
                    },
                )

    def _add_crosswalk_edges(self, topic_node_id: str, topic: TopicModel, source_file: str) -> None:
        standards = topic.connections.commonCoreStateStandards
        if standards is None:
            return
        for family, entries in (("ELA", standards.elaLiteracy), ("MATH", standards.mathematics)):
            for entry in entries:
                self._add_crosswalk_entry(topic_node_id, family, entry, source_file)

    def _add_crosswalk_entry(self, topic_node_id: str, family: str, entry: CommonCoreEntry, source_file: str) -> None:
        texts = ensure_list(entry.text)
        node_id = f"crosswalk:{family}:{entry.id}"
        existing = self.nodes.get(node_id)
        existing_texts = existing.payload.get("texts", []) if existing is not None else []
        merged_texts = sorted(set(existing_texts + texts))
        self._add_node(
            NodeRecord(
                node_id=node_id,
                node_type="crosswalk_standard",
                title=entry.id,
                family=family,
                description=" ".join(merged_texts),
                payload={"public_id": entry.id, "family": family, "texts": merged_texts, "source_file": source_file, "source_kind": "crosswalk"},
            )
        )
        self._add_alias(entry.id, node_id, "crosswalk-id", 1.0)
        for text in texts:
            self._add_alias(text, node_id, "crosswalk-text", 0.9)
            pe_ids = detect_pe_codes(text)
            if pe_ids:
                for pe_id in pe_ids:
                    self._add_edge(
                        f"pe:{pe_id}",
                        node_id,
                        "PE_CROSSWALKS_TO_STANDARD",
                        {"text": text, "family": family, "source_file": source_file},
                    )
            else:
                self._add_edge(topic_node_id, node_id, "TOPIC_CROSSWALKS_TO_STANDARD", {"text": text, "family": family, "source_file": source_file})

    def _add_pe_chunk(self, pe_node_id: str, grade: GradeModel, topic: TopicModel, pe: Any, source_file: str) -> None:
        details = pe.details
        dimension_lines: list[str] = []
        for label, references in (("SEP", details.sep), ("DCI", details.dci), ("CCC", details.ccc)):
            if references:
                joined = "; ".join(ref.id for ref in references)
                dimension_lines.append(f"{label}: {joined}")
        text_parts = [
            f"Performance Expectation {pe.id}",
            pe.description,
            f"Grade band: {grade.gradeLabel} ({grade.gradeId})",
            f"Topic: {topic.topicTitle} ({topic.topicId})",
        ]
        if details.clarificationStatement:
            text_parts.append(f"Clarification statement: {details.clarificationStatement}")
        if details.assessmentBoundary:
            text_parts.append(f"Assessment boundary: {details.assessmentBoundary}")
        if dimension_lines:
            text_parts.append("Linked dimensions: " + " | ".join(dimension_lines))
        if details.evidenceStatements:
            text_parts.append("Evidence statements: " + " ".join(details.evidenceStatements))
        self._add_chunk(
            ChunkRecord(
                chunk_id=f"chunk:pe:{pe.id}",
                node_id=pe_node_id,
                chunk_type="performance_expectation",
                title=f"{pe.id} {topic.topicTitle}",
                text="\n".join(text_parts),
                payload={
                    "public_id": pe.id,
                    "grade_id": grade.gradeId,
                    "topic_id": topic.topicId,
                    "source_file": source_file,
                    "source_pages": pe.sourcePages,
                    "clarification_statement": details.clarificationStatement,
                    "assessment_boundary": details.assessmentBoundary,
                    "evidence_statements": details.evidenceStatements,
                },
            )
        )

    def _add_topic_chunk(self, topic_node_id: str, grade: GradeModel, topic: TopicModel, source_file: str) -> None:
        pe_summaries = [f"{pe.id}: {pe.description}" for pe in topic.performanceExpectations]
        connections = []
        if topic.connections.connectionsToOtherDcisInGradeLevel:
            connections.append(f"In-grade DCI links: {topic.connections.connectionsToOtherDcisInGradeLevel}")
        if topic.connections.articulationOfDcisAcrossGradeLevels:
            connections.append(f"Across-grade articulation: {topic.connections.articulationOfDcisAcrossGradeLevels}")
        self._add_chunk(
            ChunkRecord(
                chunk_id=f"chunk:topic:{topic.topicId}",
                node_id=topic_node_id,
                chunk_type="topic",
                title=f"{topic.topicId} {topic.topicTitle}",
                text="\n".join(
                    [
                        f"Topic {topic.topicId}: {topic.topicTitle}",
                        f"Grade band: {grade.gradeLabel} ({grade.gradeId})",
                        "Performance expectations: " + " | ".join(pe_summaries),
                        " ".join(connections),
                    ]
                ),
                payload={
                    "public_id": topic.topicId,
                    "grade_id": grade.gradeId,
                    "source_file": source_file,
                    "connections_to_other_dcis": topic.connections.connectionsToOtherDcisInGradeLevel,
                    "articulation_of_dcis_across_grade_levels": topic.connections.articulationOfDcisAcrossGradeLevels,
                },
            )
        )

    def _build_concept_chunks(self) -> None:
        grouped_aliases: dict[str, list[str]] = defaultdict(list)
        grouped_progressions: dict[str, list[NodeRecord]] = defaultdict(list)
        for alias in self.aliases.values():
            grouped_aliases[alias.canonical_id].append(alias.alias_text)
        for node in self.nodes.values():
            if node.node_type != "progression_statement":
                continue
            for edge in self.edges:
                if edge.target_id == node.node_id and edge.edge_type == "DIMENSION_HAS_PROGRESSION":
                    grouped_progressions[edge.source_id].append(node)
        for node in self.nodes.values():
            if node.node_type != "dimension_concept":
                continue
            aliases = sorted(set(grouped_aliases.get(node.node_id, [])))
            progressions = sorted(grouped_progressions.get(node.node_id, []), key=lambda item: item.title)
            progression_lines = [f"{item.payload.get('band', 'unknown')}: {item.description}" for item in progressions[:12]]
            lines = [
                f"Concept {node.payload.get('public_id', node.node_id)}",
                f"Family: {node.family}",
                f"Title: {node.title}",
            ]
            if node.description:
                lines.append(f"Context: {node.description}")
            if aliases:
                lines.append("Aliases: " + " | ".join(aliases[:12]))
            if progression_lines:
                lines.append("Progressions: " + " | ".join(progression_lines))
            self._add_chunk(
                ChunkRecord(
                    chunk_id=f"chunk:concept:{node.payload.get('public_id', slugify(node.title))}",
                    node_id=node.node_id,
                    chunk_type="dimension_concept",
                    title=f"{node.payload.get('public_id', node.title)} {node.title}",
                    text="\n".join(lines),
                    payload={
                        "public_id": node.payload.get("public_id", node.title),
                        "family": node.family,
                        "source_file": node.payload.get("source_file"),
                        "dimension_group": node.payload.get("dimension_group"),
                        "core_idea": node.payload.get("core_idea"),
                    },
                )
            )
