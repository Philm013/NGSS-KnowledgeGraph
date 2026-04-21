from __future__ import annotations

import json
import tempfile
import unittest
from dataclasses import replace
from pathlib import Path

from ngss_kg_rag.api import create_app
from ngss_kg_rag.answering import AnswerService
from ngss_kg_rag.config import Settings
from ngss_kg_rag.graph import KnowledgeGraph
from ngss_kg_rag.ingest import IngestService
from ngss_kg_rag.retrieval import HybridRetriever
from ngss_kg_rag.storage import SQLiteRepository


class SmokeTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self.tempdir = tempfile.TemporaryDirectory()
        root = Path(__file__).resolve().parents[1]
        self.settings = replace(
            Settings.from_env(),
            project_root=root,
            json_dir=root / "JSON",
            data_dir=Path(self.tempdir.name),
            db_path=Path(self.tempdir.name) / "test.sqlite3",
        )
        self.repository = SQLiteRepository(self.settings.db_path)
        self.ingest = IngestService(self.settings, self.repository)
        self.ingest.rebuild()
        self.retriever = HybridRetriever(self.repository, lexical_limit=20, vector_limit=20)
        self.graph = KnowledgeGraph(self.repository.load_all_nodes(), self.repository.load_all_edges())
        self.answering = AnswerService(self.repository, self.retriever, self.graph, self.settings)

    def tearDown(self) -> None:
        self.tempdir.cleanup()

    def test_ingest_builds_graph(self) -> None:
        stats = self.repository.load_settings()
        self.assertGreater(stats["performance_expectations"], 200)
        self.assertTrue(self.settings.db_path.exists())
        self.assertTrue(self.settings.canonical_graph_path.exists())
        self.assertTrue(self.settings.canonical_manifest_path.exists())
        self.assertTrue(self.settings.canonical_supplements_path.exists())
        self.assertTrue(self.settings.canonical_audit_path.exists())
        self.assertTrue((self.settings.canonical_info_dir / "index.json").exists())
        self.assertTrue((self.settings.canonical_info_dir / "performance_expectations.json").exists())
        node = self.repository.find_node_by_public_id("K-PS2-1")
        self.assertEqual(node["payload"]["source_file"], "ngssK5.json")
        chunks = self.repository.get_chunks_for_nodes([node["node_id"]])
        self.assertTrue(any(chunk["payload"].get("source_file") == "ngssK5.json" for chunk in chunks))
        canonical_graph = json.loads(self.settings.canonical_graph_path.read_text(encoding="utf-8"))
        self.assertEqual(canonical_graph["schema"]["name"], "ngss-canonical-graph")
        self.assertIn("graph", canonical_graph)
        self.assertIn("supplements", canonical_graph)
        self.assertIn("audit", canonical_graph)
        self.assertIn("information", canonical_graph)
        canonical_audit = json.loads(self.settings.canonical_audit_path.read_text(encoding="utf-8"))
        self.assertIn("validations", canonical_audit)
        self.assertIn("summary", canonical_audit)
        canonical_info_index = json.loads((self.settings.canonical_info_dir / "index.json").read_text(encoding="utf-8"))
        self.assertEqual(canonical_info_index["schema"]["name"], "ngss-canonical-graph")
        self.assertIn("performance_expectations.json", canonical_info_index["files"])
        pe_info = json.loads((self.settings.canonical_info_dir / "performance_expectations.json").read_text(encoding="utf-8"))
        self.assertTrue(any(record["public_id"] == "K-PS2-1" for record in pe_info["records"]))

    def test_search_finds_known_pe(self) -> None:
        results = self.retriever.search("K-PS2-1", limit=3)
        self.assertTrue(results)
        self.assertEqual(results[0].node_id, "pe:K-PS2-1")

    def test_answer_returns_citations(self) -> None:
        result = self.answering.answer("What is K-PS2-1?", limit=3, expand_hops=1)
        self.assertIn("K-PS2-1", result.answer)
        self.assertIn("K-PS2-1", result.citations)

    def test_ui_root_serves_frontend(self) -> None:
        app = create_app(self.settings)
        route_paths = {getattr(route, "path", None) for route in app.routes}
        self.assertIn("/", route_paths)
        self.assertIn("/static", route_paths)
        self.assertIn("/catalog/nodes", route_paths)
        static_dir = Path(__file__).resolve().parents[1] / "src" / "ngss_kg_rag" / "static"
        self.assertTrue((static_dir / "index.html").exists())
        self.assertTrue((static_dir / "app.css").exists())
        self.assertTrue((static_dir / "app.js").exists())
        index_text = (static_dir / "index.html").read_text(encoding="utf-8")
        self.assertIn("Explore standards on a full canvas workspace", index_text)
        self.assertIn("Guided unpacking", index_text)
        self.assertIn("Choose and compare", index_text)
        self.assertIn("1. Choose", index_text)
        self.assertIn("2. Explore", index_text)
        self.assertIn("3. Understand", index_text)
        self.assertIn("4. Ask", index_text)
        self.assertIn("Inspector", index_text)
        self.assertIn("Generate a grounded answer", index_text)
        self.assertIn("Copy view link", index_text)
        self.assertIn("Add seed", index_text)
        self.assertIn("Use as only seed", index_text)
        self.assertIn("Active seeds", index_text)
        self.assertIn("Build a grounded question without typing one manually.", index_text)
        self.assertIn("Graph settings", index_text)
        self.assertIn("Canvas", index_text)
        self.assertIn("Graph", index_text)
        self.assertIn("Overview", index_text)
        self.assertIn("Relationships", index_text)
        self.assertIn("Paths", index_text)
        self.assertIn("Provenance", index_text)
        self.assertIn("What these connection boxes mean", index_text)
        self.assertIn("Connections to other DCIs in this grade level", index_text)
        self.assertIn("cdn.jsdelivr.net/npm/mermaid", index_text)
        self.assertIn("vendor/golden-layout", index_text)
        self.assertIn('id="layout-root"', index_text)
        self.assertIn('id="selection-spotlight"', index_text)
        self.assertIn('id="connection-boxes"', index_text)
        self.assertIn('id="seed-picker"', index_text)
        self.assertIn('id="search-category"', index_text)
        self.assertIn('id="answer-template"', index_text)
        app_text = (static_dir / "app.js").read_text(encoding="utf-8")
        self.assertIn("WORKSPACE_STORAGE_KEY", app_text)
        self.assertIn("syncWorkspaceUrl", app_text)
        self.assertIn("mergeNeighborhoods", app_text)
        self.assertIn("inspectGroup", app_text)
        self.assertIn("loadCatalog", app_text)
        self.assertIn("ANSWER_TEMPLATES", app_text)
        self.assertIn("replaceActiveSeeds", app_text)
        self.assertIn("DIAGRAM_VIEWS", app_text)
        self.assertIn("renderMermaidDiagram", app_text)
        self.assertIn("setTabState", app_text)
        self.assertIn("setCurrentStep", app_text)
        self.assertIn("GUIDED_STEPS", app_text)
        self.assertIn("initDockLayout", app_text)
        self.assertIn("loadGoldenLayoutCtor", app_text)
        self.assertIn("defaultDockLayout", app_text)
        self.assertIn('size: "18%"', app_text)
        self.assertIn('size: "64%"', app_text)
        self.assertIn("normalizeDockLayoutConfig", app_text)
        self.assertIn("resolveApiUrl", app_text)
        self.assertIn("NGSS_CONFIG", app_text)
        self.assertIn("renderSelectionSpotlight", app_text)
        self.assertIn("buildOverviewDiagram", app_text)
        self.assertIn("mermaidNodeClick", app_text)
        self.assertIn("logDebug", app_text)
        self.assertIn("applyMermaidTransform", app_text)
        self.assertIn("renderConnectionBoxes", app_text)
        self.assertIn("parseTopicConnectionText", app_text)
        self.assertIn("Articulation of DCIs across grade levels", app_text)
        self.assertIn("Connections to the Common Core State Standards", app_text)
        self.assertNotIn('inspectIds: ["HS-PS1"]', app_text)
        golden_layout_entry = (
            static_dir / "vendor" / "golden-layout" / "dist" / "esm" / "index.js"
        ).read_text(encoding="utf-8")
        self.assertIn("./ts/golden-layout.js", golden_layout_entry)
        self.assertNotIn("./ts/golden-layout'", golden_layout_entry)
        pages_workflow = (Path(__file__).resolve().parents[1] / ".github" / "workflows" / "pages.yml").read_text(encoding="utf-8")
        self.assertIn("actions/deploy-pages@v4", pages_workflow)
        self.assertIn("scripts/build_pages.py", pages_workflow)

    def test_canonical_supplements_capture_normalized_records(self) -> None:
        supplements = json.loads(self.settings.canonical_supplements_path.read_text(encoding="utf-8"))
        self.assertEqual(supplements["schema"]["name"], "ngss-canonical-graph")
        self.assertTrue(supplements["topic_connections"])
        self.assertTrue(supplements["dimension_mappings"])
        self.assertTrue(supplements["crosswalk_records"])


if __name__ == "__main__":
    unittest.main()
