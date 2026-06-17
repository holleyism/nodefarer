# Nodefarer

An egocentric 3D navigator for large graphs. Instead of drawing the whole graph,
you *park* on a node — like a ship at a star — and explore outward: inspect
neighbours, travel along edges, bound the view with filters, and jump across
"wormhole" links to distant-but-related regions.

The bundled demo flies through a slice of the [OpenAlex](https://openalex.org)
scholarly graph, tracing the lineage from **Hopfield's 1982 associative-memory
paper to modern attention / transformer models**.

> Status: early. The navigation spine (camera, travel, inspect, search, filter,
> expand/collapse) works; the nebula overview, guided tours, and agent copilot
> are planned. See `docs/exploration-design.md`.

---

## The bundled data

The demo loads a self-contained `public/bundle.json` — a bounded slice baked from
OpenAlex by the ingest pipeline:

- **Nodes** — *works* (papers), plus the *authors*, *concepts*, *venues*, and
  *institutions* attached to them. Works carry `year`, `cited_by`, `field`,
  a Louvain `community` (their "galaxy" colour), and a `pagerank` centrality
  (their brightness).
- **Edges** — **structural**: `cites`, `authored_by`, `has_concept`,
  `published_in`, `affiliated_with`; and **semantic** "**wormholes**"
  (`similar_to`) inferred from embedding similarity — links between papers that
  are about the same thing but don't cite each other.
- The slice is grown from seed papers by best-first search over citations,
  ranked by PageRank, so you get the high-signal backbone rather than a hairball.

If `public/bundle.json` is absent the app falls back to a small synthetic graph,
so it always runs. (The bundle is gitignored; regenerate it with the ingest
pipeline — see below.)

---

## Walkthrough — what the UX does today

Open the app and you start **parked on a node** (the highest-PageRank work, or a
seed). The scene is a bounded neighbourhood around you; reticles tag the
brightest nearby bodies with their titles.

**Moving the camera**

| Gesture | Action |
|---|---|
| Drag | Look around |
| Right-drag / Shift-drag / two-finger drag | Orbit the current node |
| Scroll / pinch | Zoom |
| Click a node | Inspect it |
| Double-click a node | Travel to it |

**Travel.** Double-click any node and the ship flies there along the
graph-shortest path; the **blast doors** shut while the universe re-lays-out, then
part to reveal the settled scene. The route's edges stay lit during the flight.

**The activation rail** (left edge) — click an icon and a panel deploys with a
staged animation; one is open at a time:

- **⬡ Current node** — where you're parked; jump into the full inspector.
- **⊙ Inspector** — the selected node's properties and its **links** list. Each
  link can be pinned (bracketed in the viewport), shown/hidden, or travelled.
  Wormhole links show their similarity and a "jump to" action.
- **⌕ Scanner** — text-search any node in the dataset and land on it.
- **▽ Filter** — *schema-driven* bounds, split into **Nodes** and **Edges**: toggle
  types, and constrain properties (PageRank, year, field, …) discovered from the
  data. It's a reversible mask — the node you're on is always kept.
- **▤ Ship console** — view mode, **edges-per-node budget** (declutter a hub down
  to its strongest links), the **sort/clip property**, edge & wormhole
  visibility, and a manual blast-doors toggle.

**Expand / collapse.** From the inspector, *expand* a node to pull in its top
neighbours, or *collapse* to prune everything beyond it back down — both happen
behind the blast doors so the layout never visibly thrashes.

**Wormholes.** Semantic links render as violet conduits. Crossing one is the
payoff of the Hopfield demo: from the early associative-memory backbone, jump the
wormhole into the modern attention lineage in a visibly distant community.

---

## Run it

Requires Node and npm.

```bash
npm install
npm run dev        # http://localhost:5173
```

That runs the offline demo over the bundled (or synthetic) graph — no backend
needed.

### Live backend (optional)

Point the client at the Go/Chi + Neo4j backend (`backend/`) to explore a live
store instead of the static bundle:

```bash
VITE_API_URL=http://<host>:8080 npm run dev
```

The app speaks one `GraphSource` interface with two implementations
(`StaticBundleSource` over the bundle, `ApiSource` over the backend), so the same
UX drives either source.

---

## Regenerating the demo bundle

The bundle is produced by the Python ingest pipeline (OpenAlex → Neo4j →
embeddings → bundle). See [`ingest/README.md`](ingest/README.md) for the full
pipeline; the last step is:

```bash
ingest/.venv/bin/python ingest/export_bundle.py --max-works 2000
# then copy ingest/data/bundle.json -> public/bundle.json
```

Backend setup lives in [`backend/README.md`](backend/README.md).

---

## Tech

React + TypeScript + Vite, [react-three-fiber](https://github.com/pmndrs/react-three-fiber)
/ three.js for the scene, d3-force-3d for layout, MUI for the HUD. Backend is Go
(Chi) over Neo4j with a vector index for semantic search.

## License

[Apache 2.0](LICENSE).
