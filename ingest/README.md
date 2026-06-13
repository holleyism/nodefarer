# Nodefarer ingest pipeline

Bakes a navigable OpenAlex slice into a graph store, runs analytics, and emits
data the app consumes. **Neo4j is an offline kitchen, not a runtime dependency**
— for the portable demo we export bounded *session/tour snapshots* as JSON; the
full live path (seeded queries + on-demand expansion) is for arbitrary scale.

Scale stance: the **store** is 6-digit (a real slice), the **rendered scene** is
always bounded (egocentric + nebulae/LOD). We do not ship the whole graph to the
browser — that only works at toy scale.

## Hardware placement

The GPU (RTX 5060 Ti, 16 GB VRAM) and the 64 GB system RAM are on the **same box**,
so the whole pipeline co-locates there — no LAN shuffling between Neo4j and the
embedding job. The other box (8 GB, no GPU) is free to serve the static app /
JSON snapshots later.

- **Neo4j + GDS** (Louvain/Leiden communities, centrality, structural embeddings) —
  CPU + RAM bound; the GPU gives them nothing. The 64 GB handles a low-6-digit graph.
- **Text embeddings** — the 16 GB VRAM comfortably runs a strong local embedder
  (bge-large-en / e5-large, ~1024-dim) at good batch sizes; vectors written straight
  to the co-located Neo4j vector index.

## Stages

| # | Stage | Status | Runs on | Notes |
|---|---|---|---|---|
| 0 | **Seed resolution** | TODO | anywhere | Resolve canonical seeds by verified external id. OpenAlex *search is unreliable* — duplicate/variant records, mis-dated metadata, DOI gaps (the canonical "Attention Is All You Need" record is unreachable by title/DOI). Pin IDs by hand; dedup. |
| 1 | **Capped snowball pull** | ✅ `pull_openalex.py` | 64 GB box | Citation backbone. See below. |
| 1b | **Typed enrichment** | TODO | 64 GB box | Add author / concept / venue nodes + typed edges (`authored_by`, `has_concept`, `published_in`) so the graph is multi-relational — required for typed/filtered expansion (the shown/unshown-by-type UX). |
| 2 | **Neo4j load** | TODO | 64 GB box | JSONL → Neo4j via `LOAD CSV`/`apoc`. |
| 3 | **GDS analytics** | TODO | 64 GB box | Louvain/Leiden community ids (multi-resolution → nebula hierarchy), centrality, degree-by-type, cluster quotient + per-community stats. |
| 4 | **Text embeddings** | TODO | 64 GB + GPU box | Abstracts → vectors on the RTX 5060 Ti (bge-large/e5-large); per-node semantic kNN (for offline wormholes); vectors into Neo4j's vector index. |
| 5 | **Bundle export** | TODO | 64 GB box | Self-contained JSON the app eats: nodes+props, edges with `kind: structural\|semantic`, degree-by-type, community assignments + quotient + per-community stats, semantic kNN. |

## Stage 1 — capped snowball pull

Stdlib only (urllib + sqlite3), resumable, polite-pool (`mailto`). Each node is
expanded by its references (outgoing, capped) and its top-N most-cited citing
works (incoming) to a bounded depth and node budget — the same capped expansion
the app does at runtime, so the slice stays connected and navigable.

Seeds are **pinned verified IDs** in `SEEDS` (never search). Confirmed so far:
`W2128084896` (Hopfield 1982), `W3127151792` (Ramsauer 2021 bridge). Transformer
seed pending stage 0.

```bash
# smoke (safe, ~two dozen calls)
python3 ingest/pull_openalex.py

# full run (hours; on the 64 GB box)
python3 ingest/pull_openalex.py --in-cap 150 --out-cap 200 \
    --max-depth 3 --max-nodes 200000 --rps 9
```

Resumable: re-running continues from the sqlite frontier. Outputs
`ingest/data/openalex.sqlite` and `*.nodes.jsonl` / `*.edges.jsonl` (gitignored).

Node JSONL: `{id, type, title, year, cited_by, field, depth}`
Edge JSONL: `{src, dst, kind}` (citing → cited, `kind="cites"`).
