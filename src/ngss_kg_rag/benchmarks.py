from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .answering import AnswerService
from .retrieval import HybridRetriever


def load_benchmarks(path: Path) -> list[dict[str, Any]]:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def run_benchmarks(path: Path, retriever: HybridRetriever, answer_service: AnswerService, top_k: int = 5) -> dict[str, Any]:
    cases = load_benchmarks(path)
    hits = 0
    citation_hits = 0
    citation_total = 0
    for case in cases:
        results = retriever.search(case["query"], limit=top_k)
        result_ids = {item.node_id for item in results}
        expected = set(case["expected_node_ids"])
        if result_ids & expected:
            hits += 1
        answer = answer_service.answer(case["query"], limit=top_k, expand_hops=case.get("expand_hops", 1))
        citation_total += len(answer.citations)
        citation_hits += len(set(answer.citations) & set(case.get("expected_citations", [])))
    total = max(len(cases), 1)
    return {
        "cases": len(cases),
        "recall_at_k": hits / total,
        "citation_precision": citation_hits / citation_total if citation_total else 0.0,
    }
