import asyncio
import sqlite3
from pathlib import Path

from flow_llm.config import Settings
from flow_llm.database import Model, init_db, migrate_legacy_registry
from flow_llm.main import scan_local_models, settings as app_settings
import flow_llm.main as main


def test_settings_persist_models_dir(tmp_path):
    settings = Settings()
    settings.data_dir = tmp_path / "flow-data"
    settings.models_dir = tmp_path / "models-a"
    settings.save_to_disk()

    settings.models_dir = tmp_path / "models-b"
    settings.load_from_disk()

    assert settings.models_dir == tmp_path / "models-a"


def test_migrate_legacy_registry_imports_and_enriches_models(tmp_path):
    current_db = tmp_path / "flow.db"
    legacy_db = tmp_path / "james.db"

    session_factory = init_db(current_db)
    session = session_factory()
    session.add(
        Model(
            id="gemma-4-26B-A4B-it-UD-Q4_K_M",
            name="gemma-4-26B-A4B-it-UD-Q4_K_M",
            backend="gguf",
            status="available",
        )
    )
    session.commit()
    session.close()

    conn = sqlite3.connect(legacy_db)
    conn.execute(
        """
        CREATE TABLE models (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            hf_id TEXT,
            backend TEXT NOT NULL,
            gguf_file TEXT,
            mlx_path TEXT,
            quantization TEXT,
            size_gb REAL,
            memory_gb REAL,
            chat_template TEXT,
            template_valid BOOLEAN,
            template_errors TEXT,
            supports_tools BOOLEAN,
            status TEXT,
            port INTEGER,
            pid INTEGER
        )
        """
    )
    gguf_path = str(tmp_path / "models" / "gemma4-26b-q4" / "gemma-4-26B-A4B-it-UD-Q4_K_M.gguf")
    conn.execute(
        """
        INSERT INTO models (
            id, name, hf_id, backend, gguf_file, mlx_path, quantization, size_gb,
            memory_gb, chat_template, template_valid, template_errors, supports_tools,
            status, port, pid
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            "gemma-4-26B-A4B-it-UD-Q4_K_M",
            "gemma-4-26B-A4B-it-UD-Q4_K_M.gguf",
            None,
            "gguf",
            gguf_path,
            None,
            "Q4_K_M",
            15.2,
            None,
            None,
            1,
            None,
            1,
            "running",
            8081,
            None,
        ),
    )
    mlx_path = str(tmp_path / "models" / "mlx-community__Phi-3.5-mini-instruct-4bit")
    conn.execute(
        """
        INSERT INTO models (
            id, name, hf_id, backend, gguf_file, mlx_path, quantization, size_gb,
            memory_gb, chat_template, template_valid, template_errors, supports_tools,
            status, port, pid
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            "mlx-community__Phi-3.5-mini-instruct-4bit",
            "Phi-3.5-mini-instruct-4bit",
            None,
            "mlx",
            None,
            mlx_path,
            None,
            2.3,
            None,
            None,
            1,
            None,
            1,
            "available",
            None,
            None,
        ),
    )
    conn.commit()
    conn.close()

    changes = migrate_legacy_registry(session_factory, legacy_db)
    assert changes == 2

    session = session_factory()
    try:
        gemma = session.query(Model).filter(Model.id == "gemma-4-26B-A4B-it-UD-Q4_K_M").first()
        phi = session.query(Model).filter(Model.id == "mlx-community__Phi-3.5-mini-instruct-4bit").first()
        assert gemma is not None
        assert gemma.gguf_file == gguf_path
        assert gemma.quantization == "Q4_K_M"
        assert gemma.status == "running"
        assert phi is not None
        assert phi.backend == "mlx"
        assert phi.mlx_path == mlx_path
    finally:
        session.close()


def test_scan_local_models_finds_gguf_and_mlx(tmp_path):
    models_dir = tmp_path / "models"
    gguf_dir = models_dir / "gemma4-26b-q4"
    mlx_dir = models_dir / "mlx-community__Phi-3.5-mini-instruct-4bit"
    gguf_dir.mkdir(parents=True)
    mlx_dir.mkdir(parents=True)

    (gguf_dir / "gemma-4-26B-A4B-it-UD-Q4_K_M.gguf").write_bytes(b"gguf")
    (mlx_dir / "config.json").write_text("{}")
    (mlx_dir / "tokenizer.json").write_text("{}")
    (mlx_dir / "model.safetensors").write_bytes(b"mlx")

    session_factory = init_db(tmp_path / "flow.db")
    main.db_session_factory = session_factory
    app_settings.models_dir = models_dir

    result = asyncio.run(scan_local_models())

    assert result["total"] == 2
    backends = sorted((entry["backend"], entry["id"]) for entry in result["found"])
    assert backends == [
        ("gguf", "gemma-4-26B-A4B-it-UD-Q4_K_M"),
        ("mlx", "mlx-community__Phi-3.5-mini-instruct-4bit"),
    ]

    session = session_factory()
    try:
        assert session.query(Model).count() == 2
    finally:
        session.close()
