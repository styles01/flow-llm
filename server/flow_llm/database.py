"""SQLAlchemy models for the Flow LLM model registry."""

from datetime import datetime
from pathlib import Path
from typing import Optional

from sqlalchemy import (
    Column,
    DateTime,
    Float,
    Integer,
    String,
    Text,
    create_engine,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker


class Base(DeclarativeBase):
    pass


class Model(Base):
    """A locally available model (downloaded or added)."""

    __tablename__ = "models"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    hf_id: Mapped[Optional[str]] = mapped_column(String, nullable=True)  # e.g. "google/gemma-4-26b-it"
    backend: Mapped[str] = mapped_column(String, nullable=False)  # "gguf" or "mlx"

    # File paths
    gguf_file: Mapped[Optional[str]] = mapped_column(String, nullable=True)  # path to .gguf
    mlx_path: Mapped[Optional[str]] = mapped_column(String, nullable=True)  # path to MLX model dir

    # Model info
    quantization: Mapped[Optional[str]] = mapped_column(String, nullable=True)  # e.g. "Q4_K_M"
    size_gb: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    memory_gb: Mapped[Optional[float]] = mapped_column(Float, nullable=True)

    # Template validation
    chat_template: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    template_valid: Mapped[Optional[bool]] = mapped_column(nullable=True, default=None)
    template_errors: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    supports_tools: Mapped[Optional[bool]] = mapped_column(nullable=True, default=None)

    # Runtime status
    status: Mapped[str] = mapped_column(String, default="available")  # available, loading, running, error, unloading
    port: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    pid: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    # Timestamps
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class Telemetry(Base):
    """Inference request telemetry."""

    __tablename__ = "telemetry"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    model_id: Mapped[str] = mapped_column(String, nullable=False)
    timestamp: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    ttft_ms: Mapped[Optional[float]] = mapped_column(Float, nullable=True)  # time to first token
    tokens_per_sec: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    input_tokens: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    output_tokens: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    total_tokens: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    backend: Mapped[str] = mapped_column(String, nullable=False)  # "gguf" or "mlx"
    error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)


def init_db(db_path: Path):
    """Initialize the database and return a session factory."""
    engine = create_engine(f"sqlite:///{db_path}", echo=False)
    Base.metadata.create_all(engine)
    return sessionmaker(engine, expire_on_commit=False)
