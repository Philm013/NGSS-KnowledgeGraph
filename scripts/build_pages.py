from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
STATIC_DIR = ROOT / "src" / "ngss_kg_rag" / "static"
CANONICAL_GRAPH_PATH = ROOT / "data" / "canonical" / "graph.json"


def _build_catalog(nodes: list[dict[str, object]]) -> list[dict[str, object]]:
    catalog = []
    for node in nodes:
        payload = node.get("payload", {}) or {}
        public_id = payload.get("public_id")
        if not public_id:
            continue
        catalog.append(
            {
                "node_id": node["node_id"],
                "node_type": node.get("node_type"),
                "title": node.get("title"),
                "family": node.get("family"),
                "description": node.get("description"),
                "public_id": public_id,
                "grade_label": payload.get("grade_label"),
                "topic_title": payload.get("topic_title"),
            }
        )
    type_order = {
        "performance_expectation": 1,
        "topic": 2,
        "dimension_concept": 3,
    }
    return sorted(
        catalog,
        key=lambda item: (
            type_order.get(str(item.get("node_type")), 4),
            str(item.get("family") or ""),
            str(item.get("public_id") or ""),
            str(item.get("title") or ""),
        ),
    )


def _build_pages_data() -> dict[str, object]:
    canonical_graph = json.loads(CANONICAL_GRAPH_PATH.read_text(encoding="utf-8"))
    graph = canonical_graph["graph"]
    return {
        "schema": canonical_graph["schema"],
        "manifest": canonical_graph["manifest"],
        "graph": {
            "nodes": graph["nodes"],
            "edges": graph["edges"],
            "chunks": graph["chunks"],
            "metadata": graph["metadata"],
        },
        "catalog": _build_catalog(graph["nodes"]),
    }


def build_pages_site(output_dir: Path, api_base_url: str) -> None:
    if output_dir.exists():
        shutil.rmtree(output_dir)
    shutil.copytree(STATIC_DIR, output_dir)

    index_path = output_dir / "index.html"
    index_text = index_path.read_text(encoding="utf-8")
    index_text = index_text.replace('href="/static/vendor/golden-layout/dist/css/goldenlayout-base.css"', 'href="./vendor/golden-layout/dist/css/goldenlayout-base.css"')
    index_text = index_text.replace(
        'href="/static/vendor/golden-layout/dist/css/themes/goldenlayout-light-theme.css"',
        'href="./vendor/golden-layout/dist/css/themes/goldenlayout-light-theme.css"',
    )
    index_text = index_text.replace('href="/static/app.css"', 'href="./app.css"')
    index_text = index_text.replace(
        '<script src="/static/app.js" defer></script>',
        '<script src="./site-config.js"></script>\n    <script src="./app.js" defer></script>',
    )
    index_path.write_text(index_text, encoding="utf-8")

    output_dir.joinpath("site-config.js").write_text(
        "window.NGSS_CONFIG = "
        + json.dumps(
            {
                "apiBaseUrl": api_base_url,
                "pagesDataUrl": "./pages-data.json",
            },
            ensure_ascii=True,
        )
        + ";\n",
        encoding="utf-8",
    )
    output_dir.joinpath("pages-data.json").write_text(
        json.dumps(_build_pages_data(), ensure_ascii=True, separators=(",", ":")),
        encoding="utf-8",
    )
    output_dir.joinpath(".nojekyll").write_text("", encoding="utf-8")
    shutil.copy2(index_path, output_dir / "404.html")


def main() -> None:
    parser = argparse.ArgumentParser(description="Build a GitHub Pages bundle for the NGSS frontend.")
    parser.add_argument("--output-dir", default="dist/pages", help="Directory to write the built site into.")
    parser.add_argument("--api-base-url", default="", help="Optional API base URL for the deployed Pages frontend.")
    args = parser.parse_args()
    build_pages_site((ROOT / args.output_dir).resolve(), args.api_base_url.strip())


if __name__ == "__main__":
    main()
