from __future__ import annotations

import argparse
import shutil
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
STATIC_DIR = ROOT / "src" / "ngss_kg_rag" / "static"


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
        f"window.NGSS_CONFIG = {{ apiBaseUrl: {api_base_url!r} }};\n",
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
