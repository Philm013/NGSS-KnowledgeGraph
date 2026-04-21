from __future__ import annotations

import hashlib
import math
import re
from collections import Counter, defaultdict
from dataclasses import dataclass
from typing import Any

from .normalization import normalize_lookup
from .storage import SQLiteRepository


TOKEN_RE = re.compile(r"[a-z0-9]+(?:[.-][a-z0-9]+)*")
PUBLIC_ID_RE = re.compile(r"\b(?:K|MS|HS|[1-5])-[A-Z]{2,4}\d?-\d+\b|\b[A-Z]{2,4}\d?\.[A-Z]\b|\b[A-Z]{2,4}\.\d+\b")


def tokenize(text: str) -> list[str]:
    normalized = normalize_lookup(text)
    tokens = TOKEN_RE.findall(normalized)
    for raw_token in list(tokens):
        if len(raw_token) >= 4:
            tokens.extend(raw_token[index : index + 3] for index in range(0, len(raw_token) - 2))
    return tokens


def cosine_similarity(left: list[float], right: list[float]) -> float:
    numerator = sum(a * b for a, b in zip(left, right, strict=False))
    left_norm = math.sqrt(sum(value * value for value in left))
    right_norm = math.sqrt(sum(value * value for value in right))
    if left_norm == 0.0 or right_norm == 0.0:
        return 0.0
    return numerator / (left_norm * right_norm)


@dataclass(slots=True)
class SearchResult:
    node_id: str
    title: str
    node_type: str
    family: str | None
    description: str | None
    score: float
    reasons: list[str]
    chunk_ids: list[str]
    payload: dict[str, Any]


class HashedEmbeddingStore:
    def __init__(self, dimensions: int):
        self.dimensions = dimensions

    def build(self, chunks: list[dict[str, Any]] | list[Any]) -> tuple[dict[str, list[float]], dict[str, Any]]:
        docs = {}
        doc_freq: Counter[str] = Counter()
        for chunk in chunks:
            chunk_id = chunk["chunk_id"] if isinstance(chunk, dict) else chunk.chunk_id
            text = chunk["text"] if isinstance(chunk, dict) else chunk.text
            tokens = tokenize(text)
            docs[chunk_id] = tokens
            doc_freq.update(set(tokens))
        total_docs = max(len(docs), 1)
        idf = {token: math.log((1 + total_docs) / (1 + count)) + 1.0 for token, count in doc_freq.items()}
        vectors = {chunk_id: self._vectorize(tokens, idf) for chunk_id, tokens in docs.items()}
        return vectors, {"embedding_idf": idf, "embedding_dimensions": self.dimensions}

    def query_vector(self, query: str, idf: dict[str, float]) -> list[float]:
        return self._vectorize(tokenize(query), idf)

    def _vectorize(self, tokens: list[str], idf: dict[str, float]) -> list[float]:
        counts = Counter(tokens)
        vector = [0.0] * self.dimensions
        if not counts:
            return vector
        max_count = max(counts.values())
        for token, count in counts.items():
            index = int(hashlib.blake2b(token.encode("utf-8"), digest_size=8).hexdigest(), 16) % self.dimensions
            tf = count / max_count
            vector[index] += tf * idf.get(token, 1.0)
        norm = math.sqrt(sum(value * value for value in vector))
        if norm == 0.0:
            return vector
        return [value / norm for value in vector]


class HybridRetriever:
    def __init__(self, repository: SQLiteRepository, lexical_limit: int, vector_limit: int):
        self.repository = repository
        self.lexical_limit = lexical_limit
        self.vector_limit = vector_limit
        self.refresh()

    def refresh(self) -> None:
        self.nodes = {node["node_id"]: node for node in self.repository.load_all_nodes()}
        self.chunks = {chunk["chunk_id"]: chunk for chunk in self.repository.load_all_chunks()}
        self.vectors = self.repository.load_vectors()
        settings = self.repository.load_settings()
        self.idf = settings.get("embedding_idf", {})
        self.embedding_dimensions = int(settings.get("embedding_dimensions", 512))

    def search(self, query: str, limit: int = 10) -> list[SearchResult]:
        aggregated: dict[str, dict[str, Any]] = defaultdict(lambda: {"score": 0.0, "reasons": [], "chunk_ids": set()})
        normalized_query = normalize_lookup(query)

        for alias in self.repository.get_alias_matches(normalized_query):
            node = self.nodes.get(alias["canonical_id"])
            if node is None:
                continue
            self._add_score(
                aggregated,
                node["node_id"],
                3.0 * alias["confidence"],
                f"exact alias match: {alias['alias_text']}",
                chunk_id=None,
            )

        exact_node = self.repository.find_node_by_public_id(query)
        if exact_node is not None:
            self._add_score(aggregated, exact_node["node_id"], 4.0, "exact public id match", None)
        for candidate in PUBLIC_ID_RE.findall(query.upper()):
            exact_candidate = self.repository.find_node_by_public_id(candidate)
            if exact_candidate is not None:
                self._add_score(aggregated, exact_candidate["node_id"], 4.5, f"identifier mention: {candidate}", None)

        fts_query = self._fts_query(query)
        if fts_query:
            try:
                lexical_hits = self.repository.search_fts(fts_query, self.lexical_limit)
            except Exception:
                lexical_hits = []
            for hit in lexical_hits:
                lexical_score = 1.0 / (1.0 + abs(float(hit["bm25_score"])))
                self._add_score(aggregated, hit["node_id"], lexical_score, "keyword retrieval", hit["chunk_id"])

        query_vector = HashedEmbeddingStore(self.embedding_dimensions).query_vector(query, self.idf)
        vector_hits = sorted(
            (
                (chunk_id, cosine_similarity(query_vector, vector))
                for chunk_id, vector in self.vectors.items()
            ),
            key=lambda item: item[1],
            reverse=True,
        )[: self.vector_limit]
        for chunk_id, similarity in vector_hits:
            if similarity <= 0:
                continue
            chunk = self.chunks[chunk_id]
            self._add_score(aggregated, chunk["node_id"], similarity, "vector retrieval", chunk_id)

        results = []
        for node_id, item in aggregated.items():
            node = self.nodes.get(node_id)
            if node is None:
                continue
            results.append(
                SearchResult(
                    node_id=node_id,
                    title=node["title"],
                    node_type=node["node_type"],
                    family=node.get("family"),
                    description=node.get("description"),
                    score=item["score"],
                    reasons=item["reasons"],
                    chunk_ids=sorted(item["chunk_ids"]),
                    payload=node.get("payload", {}),
                )
            )
        results.sort(key=lambda item: item.score, reverse=True)
        return results[:limit]

    def _add_score(
        self,
        aggregated: dict[str, dict[str, Any]],
        node_id: str,
        score: float,
        reason: str,
        chunk_id: str | None,
    ) -> None:
        aggregated[node_id]["score"] += score
        aggregated[node_id]["reasons"].append(reason)
        if chunk_id:
            aggregated[node_id]["chunk_ids"].add(chunk_id)

    @staticmethod
    def _fts_query(query: str) -> str:
        terms = [term for term in TOKEN_RE.findall(normalize_lookup(query)) if len(term) > 1]
        return " OR ".join(f'"{term}"*' for term in terms[:8])
