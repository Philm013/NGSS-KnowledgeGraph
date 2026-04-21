from __future__ import annotations

import json
import sqlite3
from contextlib import closing
from pathlib import Path
from typing import Any, Iterable

from .normalization import ChunkRecord, GraphData


SCHEMA = """
PRAGMA foreign_keys = OFF;

CREATE TABLE IF NOT EXISTS nodes (
    node_id TEXT PRIMARY KEY,
    node_type TEXT NOT NULL,
    title TEXT NOT NULL,
    family TEXT,
    description TEXT,
    payload_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS edges (
    edge_id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL,
    target_id TEXT NOT NULL,
    edge_type TEXT NOT NULL,
    payload_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source_id);
CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target_id);
CREATE INDEX IF NOT EXISTS idx_edges_type ON edges(edge_type);

CREATE TABLE IF NOT EXISTS aliases (
    alias_text TEXT NOT NULL,
    normalized_alias TEXT NOT NULL,
    canonical_id TEXT NOT NULL,
    mapping_method TEXT NOT NULL,
    confidence REAL NOT NULL,
    PRIMARY KEY(alias_text, canonical_id)
);

CREATE INDEX IF NOT EXISTS idx_aliases_normalized ON aliases(normalized_alias);

CREATE TABLE IF NOT EXISTS chunks (
    chunk_id TEXT PRIMARY KEY,
    node_id TEXT NOT NULL,
    chunk_type TEXT NOT NULL,
    title TEXT NOT NULL,
    text TEXT NOT NULL,
    payload_json TEXT NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS chunk_fts USING fts5(
    chunk_id UNINDEXED,
    node_id UNINDEXED,
    chunk_type UNINDEXED,
    title,
    text
);

CREATE TABLE IF NOT EXISTS chunk_vectors (
    chunk_id TEXT PRIMARY KEY,
    node_id TEXT NOT NULL,
    vector_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
"""


class SQLiteRepository:
    def __init__(self, db_path: Path):
        self.db_path = db_path

    def connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.db_path)
        connection.row_factory = sqlite3.Row
        return connection

    def initialize(self) -> None:
        with closing(self.connect()) as connection:
            connection.executescript(SCHEMA)
            connection.commit()

    def reset(self) -> None:
        if self.db_path.exists():
            self.db_path.unlink()
        self.initialize()

    def save_graph(self, graph_data: GraphData, vectors: dict[str, list[float]], embedding_meta: dict[str, Any]) -> None:
        with closing(self.connect()) as connection:
            connection.executescript(SCHEMA)
            connection.execute("DELETE FROM nodes")
            connection.execute("DELETE FROM edges")
            connection.execute("DELETE FROM aliases")
            connection.execute("DELETE FROM chunks")
            connection.execute("DELETE FROM chunk_fts")
            connection.execute("DELETE FROM chunk_vectors")
            connection.execute("DELETE FROM settings")

            connection.executemany(
                "INSERT INTO nodes(node_id, node_type, title, family, description, payload_json) VALUES (?, ?, ?, ?, ?, ?)",
                [
                    (
                        node.node_id,
                        node.node_type,
                        node.title,
                        node.family,
                        node.description,
                        json.dumps(node.payload, ensure_ascii=True),
                    )
                    for node in graph_data.nodes
                ],
            )
            connection.executemany(
                "INSERT INTO edges(edge_id, source_id, target_id, edge_type, payload_json) VALUES (?, ?, ?, ?, ?)",
                [
                    (
                        edge.edge_id,
                        edge.source_id,
                        edge.target_id,
                        edge.edge_type,
                        json.dumps(edge.payload, ensure_ascii=True),
                    )
                    for edge in graph_data.edges
                ],
            )
            connection.executemany(
                "INSERT INTO aliases(alias_text, normalized_alias, canonical_id, mapping_method, confidence) VALUES (?, ?, ?, ?, ?)",
                [
                    (
                        alias.alias_text,
                        alias.normalized_alias,
                        alias.canonical_id,
                        alias.mapping_method,
                        alias.confidence,
                    )
                    for alias in graph_data.aliases
                ],
            )
            self._insert_chunks(connection, graph_data.chunks)
            connection.executemany(
                "INSERT INTO chunk_vectors(chunk_id, node_id, vector_json) VALUES (?, ?, ?)",
                [
                    (chunk_id, self._chunk_node_id(graph_data.chunks, chunk_id), json.dumps(vector, ensure_ascii=True))
                    for chunk_id, vector in vectors.items()
                ],
            )
            for key, value in {**graph_data.metadata, **embedding_meta}.items():
                connection.execute(
                    "INSERT INTO settings(key, value) VALUES (?, ?)",
                    (key, json.dumps(value, ensure_ascii=True)),
                )
            connection.commit()

    def _insert_chunks(self, connection: sqlite3.Connection, chunks: Iterable[ChunkRecord]) -> None:
        rows = [
            (
                chunk.chunk_id,
                chunk.node_id,
                chunk.chunk_type,
                chunk.title,
                chunk.text,
                json.dumps(chunk.payload, ensure_ascii=True),
            )
            for chunk in chunks
        ]
        connection.executemany(
            "INSERT INTO chunks(chunk_id, node_id, chunk_type, title, text, payload_json) VALUES (?, ?, ?, ?, ?, ?)",
            rows,
        )
        connection.executemany(
            "INSERT INTO chunk_fts(chunk_id, node_id, chunk_type, title, text) VALUES (?, ?, ?, ?, ?)",
            [(row[0], row[1], row[2], row[3], row[4]) for row in rows],
        )

    @staticmethod
    def _chunk_node_id(chunks: list[ChunkRecord], chunk_id: str) -> str:
        chunk = next(item for item in chunks if item.chunk_id == chunk_id)
        return chunk.node_id

    def load_settings(self) -> dict[str, Any]:
        with closing(self.connect()) as connection:
            rows = connection.execute("SELECT key, value FROM settings").fetchall()
        return {row["key"]: json.loads(row["value"]) for row in rows}

    def get_node(self, node_id: str) -> dict[str, Any] | None:
        with closing(self.connect()) as connection:
            row = connection.execute("SELECT * FROM nodes WHERE node_id = ?", (node_id,)).fetchone()
        return self._decode_row(row)

    def find_node_by_public_id(self, identifier: str) -> dict[str, Any] | None:
        with closing(self.connect()) as connection:
            row = connection.execute(
                """
                SELECT * FROM nodes
                WHERE json_extract(payload_json, '$.public_id') = ?
                OR node_id = ?
                LIMIT 1
                """,
                (identifier, identifier),
            ).fetchone()
        return self._decode_row(row)

    def get_alias_matches(self, normalized_alias: str) -> list[dict[str, Any]]:
        with closing(self.connect()) as connection:
            rows = connection.execute(
                "SELECT * FROM aliases WHERE normalized_alias = ? ORDER BY confidence DESC",
                (normalized_alias,),
            ).fetchall()
        return [dict(row) for row in rows]

    def get_topic(self, topic_id: str) -> dict[str, Any] | None:
        return self.find_node_by_public_id(topic_id)

    def get_edges_for_nodes(self, node_ids: Iterable[str]) -> list[dict[str, Any]]:
        node_ids = list(node_ids)
        if not node_ids:
            return []
        placeholders = ",".join("?" for _ in node_ids)
        query = f"""
            SELECT * FROM edges
            WHERE source_id IN ({placeholders}) OR target_id IN ({placeholders})
        """
        with closing(self.connect()) as connection:
            rows = connection.execute(query, node_ids + node_ids).fetchall()
        return [self._decode_row(row) for row in rows]

    def get_chunks_for_nodes(self, node_ids: Iterable[str]) -> list[dict[str, Any]]:
        node_ids = list(node_ids)
        if not node_ids:
            return []
        placeholders = ",".join("?" for _ in node_ids)
        with closing(self.connect()) as connection:
            rows = connection.execute(
                f"SELECT * FROM chunks WHERE node_id IN ({placeholders}) ORDER BY chunk_type, title",
                node_ids,
            ).fetchall()
        return [self._decode_row(row) for row in rows]

    def load_all_nodes(self) -> list[dict[str, Any]]:
        with closing(self.connect()) as connection:
            rows = connection.execute("SELECT * FROM nodes").fetchall()
        return [self._decode_row(row) for row in rows]

    def load_catalog_nodes(self) -> list[dict[str, Any]]:
        with closing(self.connect()) as connection:
            rows = connection.execute(
                """
                SELECT
                    node_id,
                    node_type,
                    title,
                    family,
                    description,
                    json_extract(payload_json, '$.public_id') AS public_id,
                    json_extract(payload_json, '$.grade_label') AS grade_label,
                    json_extract(payload_json, '$.topic_title') AS topic_title
                FROM nodes
                WHERE json_extract(payload_json, '$.public_id') IS NOT NULL
                ORDER BY
                    CASE node_type
                        WHEN 'performance_expectation' THEN 1
                        WHEN 'topic' THEN 2
                        WHEN 'dimension_concept' THEN 3
                        ELSE 4
                    END,
                    COALESCE(family, ''),
                    public_id,
                    title
                """
            ).fetchall()
        return [dict(row) for row in rows]

    def load_all_edges(self) -> list[dict[str, Any]]:
        with closing(self.connect()) as connection:
            rows = connection.execute("SELECT * FROM edges").fetchall()
        return [self._decode_row(row) for row in rows]

    def load_all_chunks(self) -> list[dict[str, Any]]:
        with closing(self.connect()) as connection:
            rows = connection.execute("SELECT * FROM chunks").fetchall()
        return [self._decode_row(row) for row in rows]

    def load_vectors(self) -> dict[str, list[float]]:
        with closing(self.connect()) as connection:
            rows = connection.execute("SELECT chunk_id, vector_json FROM chunk_vectors").fetchall()
        return {row["chunk_id"]: json.loads(row["vector_json"]) for row in rows}

    def search_fts(self, query: str, limit: int) -> list[dict[str, Any]]:
        with closing(self.connect()) as connection:
            rows = connection.execute(
                """
                SELECT chunk_id, node_id, chunk_type, title, text, bm25(chunk_fts, 5.0, 1.0) AS bm25_score
                FROM chunk_fts
                WHERE chunk_fts MATCH ?
                ORDER BY bm25_score
                LIMIT ?
                """,
                (query, limit),
            ).fetchall()
        return [dict(row) for row in rows]

    @staticmethod
    def _decode_row(row: sqlite3.Row | None) -> dict[str, Any] | None:
        if row is None:
            return None
        payload = dict(row)
        for key in ("payload_json",):
            if key in payload:
                payload[key[:-5]] = json.loads(payload.pop(key))
        return payload
