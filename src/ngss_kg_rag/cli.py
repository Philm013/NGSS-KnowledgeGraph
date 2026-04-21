from __future__ import annotations

import argparse
from dataclasses import asdict
import json

import uvicorn

from .answering import AnswerService
from .api import build_services
from .benchmarks import run_benchmarks
from .canonical import export_canonical_artifacts
from .config import Settings
from .graph import KnowledgeGraph


def main() -> None:
    parser = argparse.ArgumentParser(prog="ngss-rag", description="NGSS knowledge graph RAG explorer")
    subparsers = parser.add_subparsers(dest="command", required=True)

    serve_parser = subparsers.add_parser("serve", help="Run the FastAPI service")
    serve_parser.add_argument("--host", default="127.0.0.1")
    serve_parser.add_argument("--port", type=int, default=8000)

    search_parser = subparsers.add_parser("search", help="Run hybrid search")
    search_parser.add_argument("query")
    search_parser.add_argument("--limit", type=int, default=10)

    answer_parser = subparsers.add_parser("answer", help="Answer a question with graph-aware retrieval")
    answer_parser.add_argument("query")
    answer_parser.add_argument("--limit", type=int, default=5)
    answer_parser.add_argument("--expand-hops", type=int, default=1)

    ingest_parser = subparsers.add_parser("ingest", help="Rebuild the local graph and indexes")
    ingest_parser.add_argument("--json", action="store_true", help="Emit JSON output")

    canonicalize_parser = subparsers.add_parser("canonicalize", help="Generate canonical normalized artifacts")
    canonicalize_parser.add_argument("--json", action="store_true", help="Emit JSON output")

    topic_parser = subparsers.add_parser("neighbors", help="Inspect a node neighborhood")
    topic_parser.add_argument("node_id")
    topic_parser.add_argument("--max-hops", type=int, default=1)

    benchmark_parser = subparsers.add_parser("benchmark", help="Run the built-in benchmark set")
    benchmark_parser.add_argument("--top-k", type=int, default=5)

    args = parser.parse_args()
    settings = Settings.from_env()
    services = build_services(settings)

    if args.command == "serve":
        uvicorn.run("ngss_kg_rag.api:app", host=args.host, port=args.port, reload=False)
        return

    if args.command == "ingest":
        result = services.ingest.rebuild()
        if args.json:
            print(json.dumps(asdict(result), indent=2))
        else:
            print(
                "rebuilt index: "
                f"nodes={result.nodes} edges={result.edges} aliases={result.aliases} chunks={result.chunks} "
                f"canonical_graph={result.canonical_graph_path} canonical_audit={result.canonical_audit_path}"
            )
        return

    if args.command == "canonicalize":
        export_result = export_canonical_artifacts(
            settings.json_dir,
            settings.canonical_graph_path,
            settings.canonical_manifest_path,
            settings.canonical_supplements_path,
            settings.canonical_audit_path,
            settings.canonical_info_dir,
        )
        payload = {
            "graph_path": str(export_result.graph_path),
            "manifest_path": str(export_result.manifest_path),
            "supplements_path": str(export_result.supplements_path),
            "audit_path": str(export_result.audit_path),
            "info_dir": str(export_result.info_dir),
            "counts": export_result.manifest["counts"],
            "audit_summary": export_result.audit["summary"],
        }
        if args.json:
            print(json.dumps(payload, indent=2))
        else:
            print(
                "generated canonical artifacts: "
                f"graph={payload['graph_path']} manifest={payload['manifest_path']} "
                f"supplements={payload['supplements_path']} audit={payload['audit_path']} info_dir={payload['info_dir']}"
            )
        return

    if args.command == "search":
        for result in services.retriever.search(args.query, limit=args.limit):
            public_id = result.payload.get("public_id", result.node_id)
            print(f"{public_id}\t{result.node_type}\t{result.score:.3f}\t{result.title}")
            if result.reasons:
                print(f"  reasons: {', '.join(result.reasons[:3])}")
        return

    if args.command == "answer":
        answer_service = AnswerService(
            services.repository,
            services.retriever,
            KnowledgeGraph(services.repository.load_all_nodes(), services.repository.load_all_edges()),
            settings,
        )
        result = answer_service.answer(args.query, limit=args.limit, expand_hops=args.expand_hops)
        print(result.answer)
        print()
        print("citations:", ", ".join(result.citations))
        return

    if args.command == "neighbors":
        neighborhood = services.graph.neighbors(args.node_id, max_hops=args.max_hops)
        print(json.dumps(neighborhood, indent=2))
        return

    if args.command == "benchmark":
        answer_service = AnswerService(
            services.repository,
            services.retriever,
            KnowledgeGraph(services.repository.load_all_nodes(), services.repository.load_all_edges()),
            settings,
        )
        metrics = run_benchmarks(settings.project_root / "benchmarks" / "queries.json", services.retriever, answer_service, top_k=args.top_k)
        print(json.dumps(metrics, indent=2))
