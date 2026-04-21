from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


@dataclass(slots=True)
class Settings:
    project_root: Path
    json_dir: Path
    data_dir: Path
    db_path: Path
    canonical_dir: Path
    canonical_graph_path: Path
    canonical_manifest_path: Path
    canonical_supplements_path: Path
    canonical_audit_path: Path
    canonical_info_dir: Path
    vector_dimensions: int = 512
    lexical_limit: int = 20
    vector_limit: int = 20
    default_expand_hops: int = 1
    llm_base_url: str | None = None
    llm_api_key: str | None = None
    llm_model: str | None = None

    @classmethod
    def from_env(cls) -> "Settings":
        project_root = Path(os.getenv("NGSS_PROJECT_ROOT", Path(__file__).resolve().parents[2]))
        json_dir = Path(os.getenv("NGSS_JSON_DIR", project_root / "JSON"))
        data_dir = Path(os.getenv("NGSS_APP_DATA_DIR", project_root / "data"))
        db_path = Path(os.getenv("NGSS_DB_PATH", data_dir / "ngss_graph.sqlite3"))
        canonical_dir = Path(os.getenv("NGSS_CANONICAL_DIR", data_dir / "canonical"))
        return cls(
            project_root=project_root,
            json_dir=json_dir,
            data_dir=data_dir,
            db_path=db_path,
            canonical_dir=canonical_dir,
            canonical_graph_path=Path(os.getenv("NGSS_CANONICAL_GRAPH_PATH", canonical_dir / "graph.json")),
            canonical_manifest_path=Path(os.getenv("NGSS_CANONICAL_MANIFEST_PATH", canonical_dir / "manifest.json")),
            canonical_supplements_path=Path(os.getenv("NGSS_CANONICAL_SUPPLEMENTS_PATH", canonical_dir / "supplements.json")),
            canonical_audit_path=Path(os.getenv("NGSS_CANONICAL_AUDIT_PATH", canonical_dir / "audit.json")),
            canonical_info_dir=Path(os.getenv("NGSS_CANONICAL_INFO_DIR", canonical_dir / "info")),
            vector_dimensions=int(os.getenv("NGSS_VECTOR_DIMENSIONS", "512")),
            lexical_limit=int(os.getenv("NGSS_LEXICAL_LIMIT", "20")),
            vector_limit=int(os.getenv("NGSS_VECTOR_LIMIT", "20")),
            default_expand_hops=int(os.getenv("NGSS_DEFAULT_EXPAND_HOPS", "1")),
            llm_base_url=os.getenv("NGSS_LLM_BASE_URL"),
            llm_api_key=os.getenv("NGSS_LLM_API_KEY"),
            llm_model=os.getenv("NGSS_LLM_MODEL"),
        )

    def ensure_directories(self) -> None:
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.canonical_dir.mkdir(parents=True, exist_ok=True)
        self.canonical_info_dir.mkdir(parents=True, exist_ok=True)
