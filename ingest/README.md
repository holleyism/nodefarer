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
| 0 | **Seed resolution** | ✅ `resolve_seeds.py` | anywhere | Resolve canonical seeds by verified external id. OpenAlex *search is unreliable* — duplicate/variant records, mis-dated metadata, DOI gaps (the canonical "Attention Is All You Need" record is unreachable by title/DOI). Pin IDs by hand; dedup. |
| 1 | **Capped snowball pull** | ✅ `pull_openalex.py` | 64 GB box | Citation backbone + typed enrichment (authors/concepts/venues/institutions, typed edges). See below. |
| 2 | **Neo4j load** | ✅ `load_neo4j.py` | 64 GB box | JSONL → Neo4j. `--wipe` for a clean reload. |
| 3 | **GDS analytics** | ✅ `gds_analyze.py` | 64 GB box | Louvain `communityId` + PageRank centrality. (Multi-resolution / degree-by-type / cluster quotient still to extend.) |
| 4 | **Text embeddings** | ✅ `embed.py` | 64 GB + GPU box | Work title+abstract → vectors on the RTX 5060 Ti (bge-large default); per-node semantic kNN for offline wormholes. Reads the JSONL directly (no Neo4j dependency); sidecar outputs. See below. |
| 5 | **Bundle export** | ✅ `export_bundle.py` | 64 GB box | Bounded demo slice → self-contained JSON the app eats: nodes+props, edges with `kind: structural\|semantic`, community assignments + per-community stats, semantic wormholes from the kNN sidecar. See below. |

## Connecting to Neo4j (stages 2+)

Connection settings come from the environment — host **and** port live in the
URI, so pointing at another box/port is just a different `NEO4J_URI`, no code
change. Copy `.env.example` to `.env` (gitignored) and fill it in, or export the
vars:

| Variable | Example | |
|---|---|---|
| `NEO4J_URI` | `bolt://gpubox.lan:7688` | host + port; `neo4j://` for routing/cluster |
| `NEO4J_USER` | `neo4j` | |
| `NEO4J_PASSWORD` | *(in `.env`/shell only)* | never committed; never logged |
| `NEO4J_DATABASE` | `neo4j` | optional |

`config.py` loads these (real env vars override `.env`) and exposes
`neo4j_settings()`; the password is read at runtime and never printed. The
Neo4j Python driver (`neo4j`) is added, pinned, in `requirements.txt` when we
build the loader.

## Stage 1 — capped snowball pull

Stdlib only (urllib + sqlite3), resumable, polite-pool (`mailto`). Each node is
expanded by its references (outgoing, capped) and its top-N most-cited citing
works (incoming) to a bounded depth and node budget — the same capped expansion
the app does at runtime, so the slice stays connected and navigable.

Seeds come from `seeds.json` (stage 0). Pinned: Hopfield 1982, the Ramsauer 2021
bridge, and the transformer (`W2626778328`, recovered despite OpenAlex's broken
record for it).

```bash
# smoke (safe, ~two dozen calls)
python3 ingest/pull_openalex.py

# full run (hours; on the 64GB + GPU box) — --reset starts a fresh DB
python3 ingest/pull_openalex.py --reset --in-cap 150 --out-cap 200 \
    --max-depth 3 --max-works 200000 --rps 9
```

Resumable: re-running continues from the sqlite frontier; `--reset` discards an
existing pull to start over (needed when going from the smoke DB to a full run,
since a completed snowball has an empty frontier). Outputs
`ingest/data/openalex.sqlite` and `*.nodes.jsonl` / `*.edges.jsonl` (gitignored).

Schema (heterogeneous; props vary by type):
- Node types: `work | author | concept | venue | institution`
- Edge kinds: `cites | authored_by | has_concept | published_in | affiliated_work | affiliated_author`
- Edge props (now-or-re-crawl captures): `has_concept.score`, `authored_by.{position, corresponding, institution_ids}`.
  Institutions are first-class nodes with work/author affiliation edges; the
  `institution_ids` array on `authored_by` preserves the precise per-authorship
  binding (reifiable into Authorship nodes later without a re-crawl).
- Derived edge props (computed later at load/GDS, no re-crawl): cross-community
  "bridge" citations, temporal reach (year delta), field-crossing, edge betweenness.

## Stage 4 — text embeddings + semantic kNN

Embeds **work** title+abstract into a unit-norm vector space (default
`BAAI/bge-large-en-v1.5`, 1024-dim) and computes exact cosine kNN per work — the
offline "wormhole" candidates (the Hopfield→attention link is work↔work). Reads
`*.nodes.jsonl` directly, so it doesn't care whether Neo4j is loaded; outputs are
sidecar files under `ingest/data/` (gitignored).

Runs on the GPU box. Install torch from the CUDA-matched index first (the RTX
5060 Ti is Blackwell — needs cu128+), then the rest:

```bash
pip install torch --index-url https://download.pytorch.org/whl/cu128
pip install -r ingest/requirements-embed.txt

python3 ingest/embed.py --device cuda --batch-size 64 --knn 15
```

Outputs (`<base>` = `ingest/data/openalex`):
- `<base>.embeddings.f32.npy` — float32 `[N, dim]`, L2-normalised (memmap)
- `<base>.embeddings.ids.json` — node ids parallel to the matrix rows
- `<base>.embeddings.meta.json` — model / dim / count / types
- `<base>.knn.jsonl` — per node `{"id", "neighbors": [[id, sim], …]}`

Embedding is **resumable** (pre-sized memmap + `.progress` marker; re-run to
continue). kNN is recomputed from the vectors (`--knn-only` to skip re-embedding).
Pushing vectors into a Neo4j vector index is deliberately a later, separate step.

## Stage 5 — bundle export (bounded demo slice)

The store is 6-digit; the browser scene is always bounded. This bakes a
*session/tour snapshot* — not the whole graph. Slice growth: **best-first BFS
over CITES ordered by PageRank** from the pinned seeds (so it follows the
high-signal citation backbone, not the 19k low-value Hopfield citers), then
folds in incident attribute nodes (authors capped per work; concepts/venues/
institutions kept), induces the structural subgraph, and adds semantic
"wormhole" edges from the stage-4 `*.knn.jsonl` (both endpoints in-slice, cosine
≥ threshold, not already a citation). Zero backend — the app fetches one file.

Reads Neo4j (so run it after load + GDS) + `ingest/data/openalex.knn.jsonl`.

```bash
ingest/.venv/bin/python ingest/export_bundle.py --max-works 2000
```

Output `ingest/data/bundle.json` (gitignored): `{meta, nodes[], edges[],
communities[]}`. Knobs: `--max-works` / `--max-hops` (slice size), `--authors-
per-work` (0 to skip authors), `--abstract-chars` (0=omit, -1=full), `--sem-
threshold` / `--sem-per-node` (wormhole density). The app-wiring step copies the
bundle into the served dir.
