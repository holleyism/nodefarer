# Nodefarer backend (`ApiSource`) — Plan C

Go/Chi service over Neo4j: the **live** data source behind the exploration
contract (`docs/exploration-design.md`). Runs **co-located with Neo4j on the
GPU box** — bounded, PageRank-ranked queries; responses are **bundle-shaped**
(same JSON `ingest/export_bundle.py` emits) so the web client reuses one render
mapping for both the static demo and the live graph.

## Layout (cmd/internal)

```
cmd/api/main.go            entry point — wiring, router, graceful shutdown
internal/config            env config (Neo4j contract, CORS, rate, auth)
internal/models            wire shapes (Node/Edge/View/Candidate) = bundle JSON
internal/services          graph queries over Neo4j (the meat)
internal/handlers          thin HTTP handlers + health probes
internal/middleware        Prometheus telemetry + optional bearer auth gate
```

## Run on the GPU box

Prereqs: Go 1.25+, and the graph loaded with stages 0–6 (incl.
`load_embeddings.py` for `/similar`).

```bash
cd backend
cp .env.example .env        # fill NEO4J_PASSWORD; URI is localhost on the box
go run ./cmd/api            # or: go build -o nodefarer-api ./cmd/api && ./nodefarer-api
```

Config (env or `.env`): `NEO4J_URI/USER/PASSWORD/DATABASE` (same as ingest),
`VECTOR_INDEX` (default `work_embedding`), `PORT` (8080), `CORS_ORIGINS`,
`RATE_RPS`, `AUTH_TOKEN` (optional static bearer — empty disables it; Firebase
validation swaps in here later). The password is read at runtime, never logged.

## Endpoints

| Method | Path | Body / query | Returns |
|---|---|---|---|
| POST | `/api/v1/entry` | `{mode:"node"\|"search", id?, query?, maxNodes?}` | `View` (anchor + ranked neighborhood) |
| POST | `/api/v1/expand` | `{id, have:[ids], rel?, limit?}` | `View` delta (new nodes + edges touching them) |
| GET | `/api/v1/search` | `?q=&limit=` | `Candidate[]` (text name match over works) |
| GET | `/api/v1/similar` | `?id=&limit=` | `Candidate[]` (vector-index semantic neighbors) |
| GET | `/api/v1/neighbors` | `?id=&rel=&limit=` | `Candidate[]` (preview) |
| GET | `/healthz` `/readyz` | — | liveness / Neo4j readiness |
| GET | `/metrics` | — | Prometheus |

Queries match by OpenAlex id prefix (`W/A/C/S/I` → label) so they hit the
per-label id index instead of scanning. Every result is bounded and ranked by
PageRank, mirroring `StaticBundleSource`. `collapse` and `filter` stay
client-side (operate on the in-hand view), so they need no endpoint.

### Quick check (on the box, once running)

```bash
curl -s localhost:8080/readyz
curl -s -XPOST localhost:8080/api/v1/entry \
  -H 'content-type: application/json' \
  -d '{"mode":"node","id":"W2128084896","maxNodes":50}' | head -c 400
```

## Notes / deferred

- **Free-text semantic search** needs a query-vector embedder (the bge model);
  `/similar` works today (queries by a node's own stored embedding). Wire the
  embedder as a sidecar later for text→vector search.
- **Text search** is a `CONTAINS` scan; add a full-text index for scale.
- **k8s manifests** (probes + scrape annotations) are deferred — this runs
  directly on the GPU box for now (co-located with Neo4j). The `/healthz`,
  `/readyz`, `/metrics` endpoints are already probe/scrape ready.
- **Auth** is a static-bearer stub; Firebase Admin validation replaces the
  `middleware.Auth` body when accounts arrive.
