from __future__ import annotations

import json
import re
import urllib.request
from dataclasses import dataclass
from typing import Any

from .config import Settings
from .graph import KnowledgeGraph
from .retrieval import HybridRetriever, SearchResult
from .storage import SQLiteRepository


@dataclass(slots=True)
class AnswerResult:
    answer: str
    citations: list[str]
    retrieved_nodes: list[dict[str, Any]]
    traversal_edges: list[dict[str, Any]]
    provider: str


class OpenAICompatibleClient:
    def __init__(self, settings: Settings):
        self.base_url = settings.llm_base_url
        self.api_key = settings.llm_api_key
        self.model = settings.llm_model

    def enabled(self) -> bool:
        return bool(self.base_url and self.api_key and self.model)

    def complete(self, prompt: str) -> str | None:
        if not self.enabled():
            return None
        payload = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": "Answer using only the supplied NGSS context. Cite every factual claim with [ID]."},
                {"role": "user", "content": prompt},
            ],
            "temperature": 0.1,
        }
        request = urllib.request.Request(
            url=self.base_url.rstrip("/") + "/chat/completions",
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
            },
            method="POST",
        )
        with urllib.request.urlopen(request, timeout=30) as response:
            body = json.loads(response.read().decode("utf-8"))
        choices = body.get("choices", [])
        if not choices:
            return None
        return choices[0]["message"]["content"].strip()


class AnswerService:
    def __init__(
        self,
        repository: SQLiteRepository,
        retriever: HybridRetriever,
        graph: KnowledgeGraph,
        settings: Settings,
    ):
        self.repository = repository
        self.retriever = retriever
        self.graph = graph
        self.llm = OpenAICompatibleClient(settings)

    def answer(self, query: str, limit: int = 5, expand_hops: int = 1) -> AnswerResult:
        results = self.retriever.search(query, limit=limit)
        if not results:
            return AnswerResult(
                answer="No matching NGSS standards were found.",
                citations=[],
                retrieved_nodes=[],
                traversal_edges=[],
                provider="extractive",
            )

        seed_ids = [result.node_id for result in results[: min(3, len(results))]]
        neighborhoods = [self.graph.neighbors(node_id, max_hops=expand_hops) for node_id in seed_ids]
        retrieved_nodes = self._merge_nodes(results, neighborhoods)
        traversal_edges = self._merge_edges(neighborhoods)
        citations = self._collect_citations(retrieved_nodes)

        prompt = self._prompt(query, results, retrieved_nodes, traversal_edges)
        llm_answer = self.llm.complete(prompt)
        if llm_answer:
            citations = self._citations_from_text(llm_answer) or citations
            return AnswerResult(
                answer=llm_answer,
                citations=citations,
                retrieved_nodes=retrieved_nodes,
                traversal_edges=traversal_edges,
                provider="openai-compatible",
            )
        answer_text = self._extractive_answer(query, results, retrieved_nodes)
        citations = self._citations_from_text(answer_text) or citations
        return AnswerResult(
            answer=answer_text,
            citations=citations,
            retrieved_nodes=retrieved_nodes,
            traversal_edges=traversal_edges,
            provider="extractive",
        )

    def _merge_nodes(self, results: list[SearchResult], neighborhoods: list[dict[str, Any]]) -> list[dict[str, Any]]:
        ranked = {result.node_id: result.score for result in results}
        merged: dict[str, dict[str, Any]] = {}
        for neighborhood in neighborhoods:
            for node in neighborhood["nodes"]:
                payload = dict(node)
                payload["seed_score"] = ranked.get(node["node_id"], 0.0)
                merged[node["node_id"]] = payload
        for result in results:
            node = self.repository.get_node(result.node_id)
            if node is not None:
                node["seed_score"] = result.score
                node.setdefault("distance", 0)
                node.setdefault("path_from_seed", [result.node_id])
                merged[result.node_id] = node
        return sorted(merged.values(), key=lambda item: (-item.get("seed_score", 0.0), item["node_id"]))

    def _merge_edges(self, neighborhoods: list[dict[str, Any]]) -> list[dict[str, Any]]:
        merged: dict[str, dict[str, Any]] = {}
        for neighborhood in neighborhoods:
            for edge in neighborhood["edges"]:
                merged[edge["edge_id"]] = edge
        return sorted(merged.values(), key=lambda item: item["edge_id"])

    @staticmethod
    def _collect_citations(retrieved_nodes: list[dict[str, Any]]) -> list[str]:
        citations = []
        for node in retrieved_nodes:
            public_id = node.get("payload", {}).get("public_id")
            if public_id:
                citations.append(str(public_id))
        return sorted(dict.fromkeys(citations))

    @staticmethod
    def _citations_from_text(answer_text: str) -> list[str]:
        return sorted(dict.fromkeys(re.findall(r"\[([^\]]+)\]", answer_text)))

    def _prompt(
        self,
        query: str,
        results: list[SearchResult],
        retrieved_nodes: list[dict[str, Any]],
        traversal_edges: list[dict[str, Any]],
    ) -> str:
        chunks = self.repository.get_chunks_for_nodes(result.node_id for result in results[:5])
        context_lines = [f"Query: {query}", "", "Top retrievals:"]
        for result in results[:5]:
            context_lines.append(f"- {result.node_id}: {result.title} | reasons={'; '.join(result.reasons)}")
        context_lines.append("")
        context_lines.append("Context chunks:")
        for chunk in chunks[:8]:
            context_lines.append(f"[{chunk['node_id']}] {chunk['text']}")
        context_lines.append("")
        context_lines.append("Graph paths:")
        for node in retrieved_nodes[:10]:
            path = node.get("path_from_seed")
            if path:
                context_lines.append(f"- {' -> '.join(path)}")
        context_lines.append("")
        context_lines.append("Edges:")
        for edge in traversal_edges[:20]:
            context_lines.append(f"- {edge['source_id']} -{edge['edge_type']}-> {edge['target_id']}")
        context_lines.append("")
        context_lines.append("Answer clearly and cite every factual sentence with [ID].")
        return "\n".join(context_lines)

    def _extractive_answer(self, query: str, results: list[SearchResult], retrieved_nodes: list[dict[str, Any]]) -> str:
        top = results[0]
        top_node = self.repository.get_node(top.node_id) or {"payload": {}}
        public_id = top_node.get("payload", {}).get("public_id", top.node_id)
        description = top_node.get("description") or top.description or top.title
        lines = [f"Top match: {top.title} - {description} [{public_id}]"]

        related_concepts = [
            node
            for node in retrieved_nodes
            if node.get("node_type") == "dimension_concept" and node.get("distance", 0) <= 1
        ][:5]
        if related_concepts:
            concept_text = ", ".join(
                f"{node.get('payload', {}).get('public_id', node['title'])} ({node['title']})"
                for node in related_concepts
            )
            lines.append(f"Closest linked concepts: {concept_text} [{public_id}]")

        nearby_topics = [node for node in retrieved_nodes if node.get("node_type") == "topic"][:3]
        if nearby_topics:
            topic_text = ", ".join(
                f"{node.get('payload', {}).get('public_id', node['node_id'])} ({node['title']})"
                for node in nearby_topics
            )
            lines.append(f"Relevant topics in the graph: {topic_text} [{public_id}]")

        if "compare" in query.lower() or "across" in query.lower():
            compare_nodes = [
                node
                for node in retrieved_nodes
                if node.get("node_type") in {"performance_expectation", "topic"}
            ][:5]
            if compare_nodes:
                compare_text = "; ".join(
                    f"{node.get('payload', {}).get('public_id', node['node_id'])}: {node.get('description', node['title'])}"
                    for node in compare_nodes
                )
                lines.append(f"Comparison context: {compare_text} [{public_id}]")

        return "\n".join(lines)
