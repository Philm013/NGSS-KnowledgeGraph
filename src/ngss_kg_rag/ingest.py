from __future__ import annotations

from dataclasses import dataclass

from .canonical import export_canonical_artifacts, load_canonical_graph
from .config import Settings
from .retrieval import HashedEmbeddingStore
from .storage import SQLiteRepository


@dataclass(slots=True)
class IngestResult:
    nodes: int
    edges: int
    aliases: int
    chunks: int
    canonical_graph_path: str
    canonical_audit_path: str
    canonical_info_dir: str


class IngestService:
    def __init__(self, settings: Settings, repository: SQLiteRepository):
        self.settings = settings
        self.repository = repository

    def rebuild(self) -> IngestResult:
        self.settings.ensure_directories()
        export_result = export_canonical_artifacts(
            self.settings.json_dir,
            self.settings.canonical_graph_path,
            self.settings.canonical_manifest_path,
            self.settings.canonical_supplements_path,
            self.settings.canonical_audit_path,
            self.settings.canonical_info_dir,
        )
        graph_data = load_canonical_graph(self.settings.canonical_graph_path)
        embedder = HashedEmbeddingStore(self.settings.vector_dimensions)
        vectors, embedding_meta = embedder.build(graph_data.chunks)
        self.repository.reset()
        self.repository.save_graph(graph_data, vectors, embedding_meta)
        return IngestResult(
            nodes=len(graph_data.nodes),
            edges=len(graph_data.edges),
            aliases=len(graph_data.aliases),
            chunks=len(graph_data.chunks),
            canonical_graph_path=str(export_result.graph_path),
            canonical_audit_path=str(export_result.audit_path),
            canonical_info_dir=str(export_result.info_dir),
        )
