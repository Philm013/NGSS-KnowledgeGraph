from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from starlette.staticfiles import StaticFiles

from .answering import AnswerService
from .config import Settings
from .graph import KnowledgeGraph
from .ingest import IngestService
from .retrieval import HybridRetriever
from .storage import SQLiteRepository


class SearchRequest(BaseModel):
    query: str = Field(min_length=1)
    limit: int = Field(default=10, ge=1, le=25)


class AnswerRequest(BaseModel):
    query: str = Field(min_length=1)
    limit: int = Field(default=5, ge=1, le=15)
    expand_hops: int = Field(default=1, ge=0, le=3)


@dataclass(slots=True)
class AppServices:
    settings: Settings
    repository: SQLiteRepository
    ingest: IngestService
    retriever: HybridRetriever
    graph: KnowledgeGraph
    answering: AnswerService


def build_services(settings: Settings) -> AppServices:
    settings.ensure_directories()
    repository = SQLiteRepository(settings.db_path)
    repository.initialize()
    ingest = IngestService(settings, repository)
    if not repository.load_all_nodes():
        ingest.rebuild()
    retriever = HybridRetriever(repository, settings.lexical_limit, settings.vector_limit)
    graph = KnowledgeGraph(repository.load_all_nodes(), repository.load_all_edges())
    answering = AnswerService(repository, retriever, graph, settings)
    return AppServices(
        settings=settings,
        repository=repository,
        ingest=ingest,
        retriever=retriever,
        graph=graph,
        answering=answering,
    )


def create_app(settings: Settings | None = None) -> FastAPI:
    app = FastAPI(title="NGSS Knowledge Graph RAG", version="0.1.0")
    services = build_services(settings or Settings.from_env())
    app.state.services = services
    static_dir = Path(__file__).with_name("static")
    app.mount("/static", StaticFiles(directory=static_dir), name="static")

    @app.get("/", include_in_schema=False)
    def ui() -> FileResponse:
        return FileResponse(static_dir / "index.html")

    @app.get("/health")
    def health() -> dict[str, Any]:
        stats = services.repository.load_settings()
        return {"status": "ok", "database": str(services.settings.db_path), "stats": stats}

    @app.get("/catalog/nodes")
    def catalog_nodes() -> dict[str, Any]:
        return {"items": services.repository.load_catalog_nodes()}

    @app.post("/ingest/rebuild")
    def rebuild() -> dict[str, Any]:
        result = services.ingest.rebuild()
        services.retriever.refresh()
        services.graph = KnowledgeGraph(services.repository.load_all_nodes(), services.repository.load_all_edges())
        services.answering = AnswerService(services.repository, services.retriever, services.graph, services.settings)
        app.state.services = services
        return {"status": "rebuilt", "nodes": result.nodes, "edges": result.edges, "aliases": result.aliases, "chunks": result.chunks}

    @app.get("/standards/{identifier}")
    def get_standard(identifier: str) -> dict[str, Any]:
        node = services.repository.find_node_by_public_id(identifier)
        if node is None:
            raise HTTPException(status_code=404, detail="Standard not found")
        neighbors = services.graph.neighbors(node["node_id"], max_hops=1)
        chunks = services.repository.get_chunks_for_nodes([node["node_id"]])
        return {"node": node, "neighbors": neighbors, "chunks": chunks}

    @app.get("/topics/{topic_id}")
    def get_topic(topic_id: str) -> dict[str, Any]:
        node = services.repository.find_node_by_public_id(topic_id)
        if node is None or node["node_type"] != "topic":
            raise HTTPException(status_code=404, detail="Topic not found")
        neighbors = services.graph.neighbors(node["node_id"], max_hops=1)
        chunks = services.repository.get_chunks_for_nodes([node["node_id"]])
        return {"node": node, "neighbors": neighbors, "chunks": chunks}

    @app.post("/search")
    def search(request: SearchRequest) -> dict[str, Any]:
        results = services.retriever.search(request.query, limit=request.limit)
        return {
            "query": request.query,
            "results": [
                {
                    "node_id": result.node_id,
                    "title": result.title,
                    "node_type": result.node_type,
                    "family": result.family,
                    "description": result.description,
                    "score": result.score,
                    "reasons": result.reasons,
                    "chunk_ids": result.chunk_ids,
                    "payload": result.payload,
                }
                for result in results
            ],
        }

    @app.post("/answer")
    def answer(request: AnswerRequest) -> dict[str, Any]:
        result = services.answering.answer(request.query, limit=request.limit, expand_hops=request.expand_hops)
        return {
            "query": request.query,
            "answer": result.answer,
            "citations": result.citations,
            "retrieved_nodes": result.retrieved_nodes,
            "traversal_edges": result.traversal_edges,
            "provider": result.provider,
        }

    @app.get("/graph/neighbors/{node_id}")
    def graph_neighbors(node_id: str, max_hops: int = 1) -> dict[str, Any]:
        resolved = services.repository.find_node_by_public_id(node_id)
        actual_id = resolved["node_id"] if resolved is not None else node_id
        neighborhood = services.graph.neighbors(actual_id, max_hops=max_hops)
        if not neighborhood["nodes"]:
            raise HTTPException(status_code=404, detail="Node not found")
        return neighborhood

    return app


app = create_app()
