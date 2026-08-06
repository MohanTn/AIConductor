from .connection import connect, is_vec_available, transaction
from .schema import (
    SCHEMA_VERSION,
    EmbedderMismatch,
    apply_schema,
    dense_config,
    ensure_vec_table,
    get_meta,
    reset_dense,
    schema_version,
    set_meta,
)

__all__ = [
    "SCHEMA_VERSION",
    "EmbedderMismatch",
    "apply_schema",
    "connect",
    "dense_config",
    "ensure_vec_table",
    "get_meta",
    "is_vec_available",
    "reset_dense",
    "schema_version",
    "set_meta",
    "transaction",
]
