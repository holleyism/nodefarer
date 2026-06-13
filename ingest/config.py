"""Shared config for the ingest pipeline.

Connection settings come from the environment (optionally a gitignored
`ingest/.env`). Secrets never live in code or git: the password is read from
the environment at runtime and is never logged. Host and port both live in
`NEO4J_URI`, so pointing at another box/port is just a URI change.
"""
import os
from pathlib import Path


def _load_dotenv(path: Path) -> None:
    """Minimal stdlib .env loader. Real environment variables win over .env."""
    if not path.exists():
        return
    for raw in path.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, val = line.split("=", 1)
        os.environ.setdefault(key.strip(), val.strip().strip('"').strip("'"))


_load_dotenv(Path(__file__).parent / ".env")

NEO4J_URI = os.environ.get("NEO4J_URI", "bolt://localhost:7687")
NEO4J_USER = os.environ.get("NEO4J_USER", "neo4j")
NEO4J_PASSWORD = os.environ.get("NEO4J_PASSWORD")  # required; no default
NEO4J_DATABASE = os.environ.get("NEO4J_DATABASE", "neo4j")


def neo4j_settings() -> dict:
    """Driver kwargs. Fails loudly (without echoing the secret) if unset."""
    if not NEO4J_PASSWORD:
        raise SystemExit(
            "NEO4J_PASSWORD is not set. Put it in ingest/.env (gitignored) "
            "or export it. See ingest/.env.example."
        )
    return {
        "uri": NEO4J_URI,
        "auth": (NEO4J_USER, NEO4J_PASSWORD),
        "database": NEO4J_DATABASE,
    }


def describe() -> str:
    """Safe one-line summary for logs — never includes the password."""
    return f"{NEO4J_USER}@{NEO4J_URI} db={NEO4J_DATABASE}"
