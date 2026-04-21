from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

from .normalization import AliasRecord, ChunkRecord, EdgeRecord, GraphData, NGSSGraphBuilder, NodeRecord


CANONICAL_SCHEMA = {"name": "ngss-canonical-graph", "version": 1}


@dataclass(slots=True)
class CanonicalExportResult:
    graph_data: GraphData
    manifest: dict[str, Any]
    supplements: dict[str, Any]
    audit: dict[str, Any]
    graph_path: Path
    manifest_path: Path
    supplements_path: Path
    audit_path: Path
    info_dir: Path


def _write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2, sort_keys=True, ensure_ascii=True)
        handle.write("\n")


def _node_public_id(node: dict[str, Any]) -> str:
    return str(node.get("payload", {}).get("public_id", node.get("node_id", "unknown")))


def _sorted_records(records: list[dict[str, Any]], key: str) -> list[dict[str, Any]]:
    return sorted(records, key=lambda item: str(item.get(key, "")))


def _sorted_unique(values: list[str | None]) -> list[str]:
    return sorted({str(value) for value in values if value})


def _graph_document(
    graph_data: GraphData,
    manifest: dict[str, Any],
    supplements: dict[str, Any],
    audit: dict[str, Any],
    information: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    return {
        "schema": CANONICAL_SCHEMA,
        "manifest": manifest,
        "graph": {
            "nodes": _sorted_records([asdict(record) for record in graph_data.nodes], "node_id"),
            "edges": _sorted_records([asdict(record) for record in graph_data.edges], "edge_id"),
            "aliases": _sorted_records([asdict(record) for record in graph_data.aliases], "alias_text"),
            "chunks": _sorted_records([asdict(record) for record in graph_data.chunks], "chunk_id"),
            "metadata": graph_data.metadata,
        },
        "supplements": supplements,
        "audit": audit,
        "information": information,
    }


def _derive_topic_connections(nodes: dict[str, dict[str, Any]], edges: list[dict[str, Any]]) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    for edge in edges:
        if edge["edge_type"] not in {"TOPIC_CONNECTS_TO_DCI_IN_GRADE", "TOPIC_ARTICULATES_TO_DCI_ACROSS_GRADES"}:
            continue
        source = nodes.get(edge["source_id"])
        target = nodes.get(edge["target_id"])
        if not source or not target:
            continue
        records.append(
            {
                "topic_id": _node_public_id(source),
                "topic_title": source.get("title"),
                "edge_type": edge["edge_type"],
                "target_public_id": _node_public_id(target),
                "target_family": target.get("family"),
                "target_reference": edge.get("payload", {}).get("target_reference"),
                "target_grade": edge.get("payload", {}).get("target_grade"),
                "supporting_pe_ids": edge.get("payload", {}).get("supporting_pe_ids", []),
                "raw_mapping": edge.get("payload", {}).get("raw_mapping"),
                "source_file": edge.get("payload", {}).get("source_file"),
            }
        )
    return sorted(records, key=lambda item: (item["topic_id"], item["edge_type"], item["target_public_id"]))


def _derive_crosswalk_records(nodes: dict[str, dict[str, Any]], edges: list[dict[str, Any]]) -> list[dict[str, Any]]:
    links_by_crosswalk: dict[str, dict[str, Any]] = {}
    for node in nodes.values():
        if node.get("node_type") != "crosswalk_standard":
            continue
        links_by_crosswalk[node["node_id"]] = {
            "public_id": _node_public_id(node),
            "family": node.get("family"),
            "texts": sorted(set(node.get("payload", {}).get("texts", []))),
            "linked_performance_expectations": [],
            "linked_topics": [],
            "source_files": sorted(
                {
                    text
                    for text in [node.get("payload", {}).get("source_file")]
                    if text
                }
            ),
        }
    for edge in edges:
        if edge["edge_type"] not in {"PE_CROSSWALKS_TO_STANDARD", "TOPIC_CROSSWALKS_TO_STANDARD"}:
            continue
        if edge["target_id"] not in links_by_crosswalk:
            continue
        source = nodes.get(edge["source_id"])
        if not source:
            continue
        payload = links_by_crosswalk[edge["target_id"]]
        source_public_id = _node_public_id(source)
        if edge["edge_type"] == "PE_CROSSWALKS_TO_STANDARD":
            payload["linked_performance_expectations"].append(source_public_id)
        else:
            payload["linked_topics"].append(source_public_id)
        source_file = edge.get("payload", {}).get("source_file")
        if source_file and source_file not in payload["source_files"]:
            payload["source_files"].append(source_file)
    records = []
    for payload in links_by_crosswalk.values():
        payload["linked_performance_expectations"] = sorted(set(payload["linked_performance_expectations"]))
        payload["linked_topics"] = sorted(set(payload["linked_topics"]))
        payload["source_files"] = sorted(set(payload["source_files"]))
        records.append(payload)
    return sorted(records, key=lambda item: (item["family"] or "", item["public_id"]))


def _derive_dimension_mappings(nodes: dict[str, dict[str, Any]], edges: list[dict[str, Any]]) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    for edge in edges:
        if edge["edge_type"] != "PE_ALIGNS_TO_DIMENSION":
            continue
        source = nodes.get(edge["source_id"])
        target = nodes.get(edge["target_id"])
        if not source or not target:
            continue
        records.append(
            {
                "pe_id": _node_public_id(source),
                "target_public_id": _node_public_id(target),
                "target_family": target.get("family"),
                "family_hint": edge.get("payload", {}).get("family_hint"),
                "resolved_family": edge.get("payload", {}).get("resolved_family"),
                "raw_id": edge.get("payload", {}).get("raw_id"),
                "raw_texts": edge.get("payload", {}).get("texts", []),
                "mapping_method": edge.get("payload", {}).get("mapping_method"),
                "confidence": edge.get("payload", {}).get("confidence"),
                "source_file": edge.get("payload", {}).get("source_file"),
                "source_pages": edge.get("payload", {}).get("source_pages", []),
            }
        )
    return sorted(records, key=lambda item: (item["pe_id"], item["target_public_id"]))


def _build_supplements(graph_data: GraphData) -> dict[str, Any]:
    nodes = {node.node_id: asdict(node) for node in graph_data.nodes}
    edges = [asdict(edge) for edge in graph_data.edges]
    return {
        "schema": CANONICAL_SCHEMA,
        "topic_connections": _derive_topic_connections(nodes, edges),
        "crosswalk_records": _derive_crosswalk_records(nodes, edges),
        "dimension_mappings": _derive_dimension_mappings(nodes, edges),
    }


def _build_validation(graph_data: GraphData, supplements: dict[str, Any]) -> list[dict[str, Any]]:
    nodes = [asdict(node) for node in graph_data.nodes]
    edges = [asdict(edge) for edge in graph_data.edges]
    chunks = [asdict(chunk) for chunk in graph_data.chunks]
    validations = [
        {
            "code": "node-count",
            "status": "ok" if len(nodes) > 0 else "error",
            "detail": f"{len(nodes)} canonical nodes exported",
        },
        {
            "code": "edge-count",
            "status": "ok" if len(edges) > 0 else "error",
            "detail": f"{len(edges)} canonical edges exported",
        },
        {
            "code": "chunk-count",
            "status": "ok" if len(chunks) > 0 else "error",
            "detail": f"{len(chunks)} canonical chunks exported",
        },
        {
            "code": "unique-node-ids",
            "status": "ok" if len({node['node_id'] for node in nodes}) == len(nodes) else "error",
            "detail": "Node IDs are unique" if len({node['node_id'] for node in nodes}) == len(nodes) else "Duplicate node IDs detected",
        },
        {
            "code": "unique-edge-ids",
            "status": "ok" if len({edge['edge_id'] for edge in edges}) == len(edges) else "error",
            "detail": "Edge IDs are unique" if len({edge['edge_id'] for edge in edges}) == len(edges) else "Duplicate edge IDs detected",
        },
        {
            "code": "source-provenance",
            "status": "ok"
            if not [node["node_id"] for node in nodes if node["node_type"] != "progression_statement" and not node["payload"].get("source_file")]
            else "warning",
            "detail": "Canonical nodes retain source_file provenance where expected",
        },
        {
            "code": "normalized-topic-connections",
            "status": "ok" if supplements["topic_connections"] else "warning",
            "detail": f"{len(supplements['topic_connections'])} structured topic connection records exported",
        },
        {
            "code": "crosswalk-deduplication",
            "status": "ok" if supplements["crosswalk_records"] else "warning",
            "detail": f"{len(supplements['crosswalk_records'])} canonical crosswalk records exported",
        },
    ]
    return validations


def _build_audit(graph_data: GraphData, supplements: dict[str, Any], manifest: dict[str, Any]) -> dict[str, Any]:
    nodes = [asdict(node) for node in graph_data.nodes]
    aliases = [asdict(alias) for alias in graph_data.aliases]
    synthetic_nodes = [
        {
            "node_id": node["node_id"],
            "public_id": node["payload"].get("public_id"),
            "family": node.get("family"),
            "title": node.get("title"),
            "source_file": node["payload"].get("source_file"),
        }
        for node in nodes
        if node["payload"].get("synthetic")
    ]
    low_confidence_mappings = [
        mapping for mapping in supplements["dimension_mappings"] if float(mapping.get("confidence") or 0.0) < 0.9
    ]
    crosswalk_variants = [
        {
            "public_id": record["public_id"],
            "family": record["family"],
            "text_variants": len(record["texts"]),
        }
        for record in supplements["crosswalk_records"]
        if len(record["texts"]) > 1
    ]
    alias_methods = sorted({alias["mapping_method"] for alias in aliases})
    validations = _build_validation(graph_data, supplements)
    return {
        "schema": CANONICAL_SCHEMA,
        "summary": {
            "synthetic_nodes": len(synthetic_nodes),
            "low_confidence_mappings": len(low_confidence_mappings),
            "crosswalk_variants": len(crosswalk_variants),
            "alias_mapping_methods": alias_methods,
            "validation_errors": sum(1 for item in validations if item["status"] == "error"),
            "validation_warnings": sum(1 for item in validations if item["status"] == "warning"),
        },
        "manifest": manifest,
        "validations": validations,
        "findings": {
            "synthetic_nodes": synthetic_nodes,
            "low_confidence_dimension_mappings": low_confidence_mappings,
            "crosswalk_text_variants": crosswalk_variants,
        },
    }


def _record_summary(node: dict[str, Any]) -> dict[str, Any]:
    return {
        "node_id": node["node_id"],
        "public_id": _node_public_id(node),
        "node_type": node["node_type"],
        "family": node.get("family"),
        "title": node.get("title"),
        "description": node.get("description"),
        "payload": node.get("payload", {}),
    }


def _chunk_summary(chunk: dict[str, Any]) -> dict[str, Any]:
    return {
        "chunk_id": chunk["chunk_id"],
        "chunk_type": chunk["chunk_type"],
        "title": chunk["title"],
        "text": chunk["text"],
        "payload": chunk.get("payload", {}),
    }


def _related_node_summary(node: dict[str, Any], edge: dict[str, Any] | None = None) -> dict[str, Any]:
    payload = {
        "public_id": _node_public_id(node),
        "node_id": node["node_id"],
        "node_type": node["node_type"],
        "family": node.get("family"),
        "title": node.get("title"),
        "description": node.get("description"),
        "payload": node.get("payload", {}),
    }
    if edge is not None:
        payload["edge_type"] = edge["edge_type"]
        payload["edge_payload"] = edge.get("payload", {})
    return payload


def _group_chunks(graph_data: GraphData) -> dict[str, list[dict[str, Any]]]:
    grouped: dict[str, list[dict[str, Any]]] = {}
    for chunk in [asdict(record) for record in graph_data.chunks]:
        grouped.setdefault(chunk["node_id"], []).append(_chunk_summary(chunk))
    for records in grouped.values():
        records.sort(key=lambda item: (item["chunk_type"], item["chunk_id"]))
    return grouped


def _group_edges(graph_data: GraphData) -> tuple[dict[str, list[dict[str, Any]]], dict[str, list[dict[str, Any]]]]:
    outgoing: dict[str, list[dict[str, Any]]] = {}
    incoming: dict[str, list[dict[str, Any]]] = {}
    for edge in [asdict(record) for record in graph_data.edges]:
        outgoing.setdefault(edge["source_id"], []).append(edge)
        incoming.setdefault(edge["target_id"], []).append(edge)
    return outgoing, incoming


def _group_aliases(graph_data: GraphData) -> dict[str, list[dict[str, Any]]]:
    grouped: dict[str, list[dict[str, Any]]] = {}
    for alias in [asdict(record) for record in graph_data.aliases]:
        grouped.setdefault(alias["canonical_id"], []).append(alias)
    for records in grouped.values():
        records.sort(key=lambda item: (item["normalized_alias"], item["alias_text"]))
    return grouped


def _build_information_documents(
    graph_data: GraphData,
    manifest: dict[str, Any],
    supplements: dict[str, Any],
) -> dict[str, dict[str, Any]]:
    nodes = {node.node_id: asdict(node) for node in graph_data.nodes}
    outgoing_edges, incoming_edges = _group_edges(graph_data)
    chunks_by_node = _group_chunks(graph_data)
    aliases_by_node = _group_aliases(graph_data)

    grade_records: list[dict[str, Any]] = []
    topic_records: list[dict[str, Any]] = []
    pe_records: list[dict[str, Any]] = []
    concept_records: list[dict[str, Any]] = []
    crosswalk_records: list[dict[str, Any]] = []

    for node in nodes.values():
        node_type = node["node_type"]
        node_id = node["node_id"]
        outgoing = outgoing_edges.get(node_id, [])
        incoming = incoming_edges.get(node_id, [])
        if node_type == "grade_band":
            topics = []
            for edge in outgoing:
                if edge["edge_type"] != "GRADE_HAS_TOPIC":
                    continue
                topic = nodes.get(edge["target_id"])
                if not topic:
                    continue
                topic_outgoing = outgoing_edges.get(topic["node_id"], [])
                pe_ids = [
                    _node_public_id(nodes[target_edge["target_id"]])
                    for target_edge in topic_outgoing
                    if target_edge["edge_type"] == "TOPIC_HAS_PE" and target_edge["target_id"] in nodes
                ]
                topics.append(
                    {
                        "public_id": _node_public_id(topic),
                        "title": topic["title"],
                        "description": topic.get("description"),
                        "performance_expectation_ids": sorted(pe_ids),
                        "payload": topic.get("payload", {}),
                    }
                )
            grade_records.append(
                {
                    **_record_summary(node),
                    "topics": sorted(topics, key=lambda item: item["public_id"]),
                    "chunks": chunks_by_node.get(node_id, []),
                }
            )
        elif node_type == "topic":
            pes = []
            crosswalks = []
            for edge in outgoing:
                target = nodes.get(edge["target_id"])
                if not target:
                    continue
                if edge["edge_type"] == "TOPIC_HAS_PE":
                    pes.append(_related_node_summary(target, edge))
                elif edge["edge_type"] == "TOPIC_CROSSWALKS_TO_STANDARD":
                    crosswalks.append(_related_node_summary(target, edge))
            grade_refs = [
                _related_node_summary(nodes[edge["source_id"]], edge)
                for edge in incoming
                if edge["edge_type"] == "GRADE_HAS_TOPIC" and edge["source_id"] in nodes
            ]
            topic_records.append(
                {
                    **_record_summary(node),
                    "grades": sorted(grade_refs, key=lambda item: item["public_id"]),
                    "performance_expectations": sorted(pes, key=lambda item: item["public_id"]),
                    "connection_boxes": {
                        "same_grade_dcis": [
                            record for record in supplements["topic_connections"]
                            if record["topic_id"] == _node_public_id(node)
                            and record["edge_type"] == "TOPIC_CONNECTS_TO_DCI_IN_GRADE"
                        ],
                        "articulation_across_grades": [
                            record for record in supplements["topic_connections"]
                            if record["topic_id"] == _node_public_id(node)
                            and record["edge_type"] == "TOPIC_ARTICULATES_TO_DCI_ACROSS_GRADES"
                        ],
                    },
                    "crosswalks": sorted(crosswalks, key=lambda item: item["public_id"]),
                    "chunks": chunks_by_node.get(node_id, []),
                    "aliases": aliases_by_node.get(node_id, []),
                }
            )
        elif node_type == "performance_expectation":
            dimensions = []
            evidence = []
            sources = []
            crosswalks = []
            for edge in outgoing:
                target = nodes.get(edge["target_id"])
                if not target:
                    continue
                if edge["edge_type"] == "PE_ALIGNS_TO_DIMENSION":
                    dimensions.append(_related_node_summary(target, edge))
                elif edge["edge_type"] == "PE_HAS_EVIDENCE":
                    evidence.append(_related_node_summary(target, edge))
                elif edge["edge_type"] == "PE_HAS_SOURCE_PAGE":
                    sources.append(_related_node_summary(target, edge))
                elif edge["edge_type"] == "PE_CROSSWALKS_TO_STANDARD":
                    crosswalks.append(_related_node_summary(target, edge))
            topic_refs = [
                _related_node_summary(nodes[edge["source_id"]], edge)
                for edge in incoming
                if edge["edge_type"] == "TOPIC_HAS_PE" and edge["source_id"] in nodes
            ]
            pe_records.append(
                {
                    **_record_summary(node),
                    "topics": sorted(topic_refs, key=lambda item: item["public_id"]),
                    "aligned_dimensions": sorted(dimensions, key=lambda item: item["public_id"]),
                    "evidence_nodes": sorted(evidence, key=lambda item: item["public_id"]),
                    "source_pages": sorted(sources, key=lambda item: item["public_id"]),
                    "crosswalks": sorted(crosswalks, key=lambda item: item["public_id"]),
                    "chunks": chunks_by_node.get(node_id, []),
                    "aliases": aliases_by_node.get(node_id, []),
                }
            )
        elif node_type == "dimension_concept":
            progressions = []
            linked_pes = []
            for edge in outgoing:
                target = nodes.get(edge["target_id"])
                if target and edge["edge_type"] == "DIMENSION_HAS_PROGRESSION":
                    progressions.append(_related_node_summary(target, edge))
            for edge in incoming:
                source = nodes.get(edge["source_id"])
                if source and edge["edge_type"] == "PE_ALIGNS_TO_DIMENSION":
                    linked_pes.append(_related_node_summary(source, edge))
            concept_records.append(
                {
                    **_record_summary(node),
                    "progression_statements": sorted(progressions, key=lambda item: item["public_id"]),
                    "linked_performance_expectations": sorted(linked_pes, key=lambda item: item["public_id"]),
                    "chunks": chunks_by_node.get(node_id, []),
                    "aliases": aliases_by_node.get(node_id, []),
                }
            )
        elif node_type == "crosswalk_standard":
            linked_pes = []
            linked_topics = []
            for edge in incoming:
                source = nodes.get(edge["source_id"])
                if not source:
                    continue
                if edge["edge_type"] == "PE_CROSSWALKS_TO_STANDARD":
                    linked_pes.append(_related_node_summary(source, edge))
                elif edge["edge_type"] == "TOPIC_CROSSWALKS_TO_STANDARD":
                    linked_topics.append(_related_node_summary(source, edge))
            crosswalk_records.append(
                {
                    **_record_summary(node),
                    "texts": node.get("payload", {}).get("texts", []),
                    "linked_performance_expectations": sorted(linked_pes, key=lambda item: item["public_id"]),
                    "linked_topics": sorted(linked_topics, key=lambda item: item["public_id"]),
                    "aliases": aliases_by_node.get(node_id, []),
                }
            )

    info_docs = {
        "grades.json": {
            "schema": CANONICAL_SCHEMA,
            "manifest": manifest,
            "record_type": "grade_band",
            "records": sorted(grade_records, key=lambda item: item["public_id"]),
        },
        "topics.json": {
            "schema": CANONICAL_SCHEMA,
            "manifest": manifest,
            "record_type": "topic",
            "records": sorted(topic_records, key=lambda item: item["public_id"]),
        },
        "performance_expectations.json": {
            "schema": CANONICAL_SCHEMA,
            "manifest": manifest,
            "record_type": "performance_expectation",
            "records": sorted(pe_records, key=lambda item: item["public_id"]),
        },
        "concepts.json": {
            "schema": CANONICAL_SCHEMA,
            "manifest": manifest,
            "record_type": "dimension_concept",
            "records": sorted(concept_records, key=lambda item: ((item["family"] or ""), item["public_id"])),
        },
        "crosswalks.json": {
            "schema": CANONICAL_SCHEMA,
            "manifest": manifest,
            "record_type": "crosswalk_standard",
            "records": sorted(crosswalk_records, key=lambda item: ((item["family"] or ""), item["public_id"])),
        },
    }

    info_docs["index.json"] = {
        "schema": CANONICAL_SCHEMA,
        "manifest": manifest,
        "summary": {
            "grade_records": len(grade_records),
            "topic_records": len(topic_records),
            "performance_expectation_records": len(pe_records),
            "concept_records": len(concept_records),
            "crosswalk_records": len(crosswalk_records),
        },
        "files": {
            name: {
                "record_type": payload["record_type"],
                "record_count": len(payload["records"]),
            }
            for name, payload in info_docs.items()
            if name != "index.json"
        },
    }
    return info_docs


def export_canonical_artifacts(
    json_dir: Path,
    canonical_graph_path: Path,
    canonical_manifest_path: Path,
    canonical_supplements_path: Path,
    canonical_audit_path: Path,
    canonical_info_dir: Path,
) -> CanonicalExportResult:
    builder = NGSSGraphBuilder(json_dir)
    graph_data = builder.build()
    manifest = {
        "schema": CANONICAL_SCHEMA,
        "source_dir": str(json_dir),
        "source_files": sorted(path.name for path in json_dir.glob("*.json")),
        "counts": {
            "nodes": len(graph_data.nodes),
            "edges": len(graph_data.edges),
            "aliases": len(graph_data.aliases),
            "chunks": len(graph_data.chunks),
            **graph_data.metadata,
        },
    }
    supplements = _build_supplements(graph_data)
    information_docs = _build_information_documents(graph_data, manifest, supplements)
    audit = _build_audit(graph_data, supplements, manifest)
    graph_doc = _graph_document(graph_data, manifest, supplements, audit, information_docs)

    _write_json(canonical_graph_path, graph_doc)
    _write_json(canonical_manifest_path, graph_doc["manifest"])
    _write_json(canonical_supplements_path, graph_doc["supplements"])
    _write_json(canonical_audit_path, graph_doc["audit"])
    for file_name, payload in graph_doc["information"].items():
        _write_json(canonical_info_dir / file_name, payload)

    return CanonicalExportResult(
        graph_data=graph_data,
        manifest=manifest,
        supplements=supplements,
        audit=audit,
        graph_path=canonical_graph_path,
        manifest_path=canonical_manifest_path,
        supplements_path=canonical_supplements_path,
        audit_path=canonical_audit_path,
        info_dir=canonical_info_dir,
    )


def load_canonical_graph(path: Path) -> GraphData:
    with path.open("r", encoding="utf-8") as handle:
        payload = json.load(handle)
    graph = payload["graph"]
    return GraphData(
        nodes=[NodeRecord(**record) for record in graph["nodes"]],
        edges=[EdgeRecord(**record) for record in graph["edges"]],
        aliases=[AliasRecord(**record) for record in graph["aliases"]],
        chunks=[ChunkRecord(**record) for record in graph["chunks"]],
        metadata=graph["metadata"],
    )
