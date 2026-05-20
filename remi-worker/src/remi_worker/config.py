"""Environment-variable driven configuration for remi-worker."""

import os
from dataclasses import dataclass, field
from typing import List


@dataclass
class Config:
    # ── Database ──────────────────────────────────────────────────────────
    db_host: str = field(default_factory=lambda: os.getenv("DB_HOST", "postgres-primary"))
    db_port: int = field(default_factory=lambda: int(os.getenv("DB_PORT", "5432")))
    db_user: str = field(default_factory=lambda: os.getenv("DB_USER", "remi_user"))
    db_password: str = field(default_factory=lambda: os.getenv("DB_PASSWORD", "remi_password"))
    db_name: str = field(default_factory=lambda: os.getenv("DB_NAME", "remi_db"))
    db_pool_min: int = field(default_factory=lambda: int(os.getenv("DB_POOL_MIN", "5")))
    db_pool_max: int = field(default_factory=lambda: int(os.getenv("DB_POOL_MAX", "20")))
    db_pool_acquire_timeout: int = field(default_factory=lambda: int(os.getenv("DB_POOL_ACQUIRE_TIMEOUT", "5")))
    db_statement_timeout_ms: int = field(default_factory=lambda: int(os.getenv("DB_STATEMENT_TIMEOUT_MS", "30000")))

    # ── Kafka ─────────────────────────────────────────────────────────────
    kafka_brokers: List[str] = field(
        default_factory=lambda: os.getenv("KAFKA_BROKERS", "kafka:29092").split(",")
    )
    kafka_group_id: str = field(
        default_factory=lambda: os.getenv("KAFKA_GROUP_ID", "remi-worker-group")
    )
    kafka_event_topic: str = field(
        default_factory=lambda: os.getenv("KAFKA_EVENT_TOPIC", "remi-events")
    )
    kafka_session_topic: str = field(
        default_factory=lambda: os.getenv("KAFKA_SESSION_TOPIC", "remi-sessions")
    )
    # How many Kafka messages to accumulate before flushing to DB
    # Issue #8: Reduced from 100 to 50 for 256KB event safety (256KB * 50 = 12.8MB max batch)
    batch_size: int = field(
        default_factory=lambda: int(os.getenv("KAFKA_BATCH_SIZE", "50"))
    )
    # Max seconds between flushes (keeps DB in sync with SSE fanout)
    batch_timeout_s: float = field(
        default_factory=lambda: float(os.getenv("KAFKA_BATCH_TIMEOUT", "1.0"))
    )

    # ── Logging ───────────────────────────────────────────────────────────
    log_level: str = field(default_factory=lambda: os.getenv("LOG_LEVEL", "INFO"))

    def __post_init__(self) -> None:
        """Validate configuration values."""
        if self.db_pool_min <= 0:
            raise ValueError(f"db_pool_min must be > 0, got {self.db_pool_min}")
        if self.db_pool_max < self.db_pool_min:
            raise ValueError(
                f"db_pool_max ({self.db_pool_max}) must be >= db_pool_min ({self.db_pool_min})"
            )
        if self.db_pool_acquire_timeout <= 0:
            raise ValueError(
                f"db_pool_acquire_timeout must be > 0, got {self.db_pool_acquire_timeout}"
            )
        if self.db_statement_timeout_ms <= 0:
            raise ValueError(
                f"db_statement_timeout_ms must be > 0, got {self.db_statement_timeout_ms}"
            )
        if self.batch_size <= 0:
            raise ValueError(f"batch_size must be > 0, got {self.batch_size}")
        if self.batch_timeout_s <= 0:
            raise ValueError(f"batch_timeout_s must be > 0, got {self.batch_timeout_s}")
