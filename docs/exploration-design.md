# Nodefarer — Exploration Design & Story Catalog (Plan A)

Living design doc. Defines the spine (one client, two data sources), the
`GraphSource`/`View` contract, the core mechanics (entry, expand/collapse,
filter, corridor), and a catalog of exploration **stories** — two expanded into
full walk-throughs, the rest captured as stubs to expand later.

Status legend: ✅ built · 🔜 planned · 💭 idea/open.

---

## 1. Two tracks, one client

Nodefarer is **not** a viewer for a pre-baked graph. It's a way to *dynamically
explore a much larger dataset, bounded by parameters/views*. The pre-baked
bundle is one **data source**, not the product.

| | Track A — self-running demo | Track B — live product |
|---|---|---|
| Source | `StaticBundleSource` (in-browser, over a bundled subset) | `ApiSource` (Go/Chi → Neo4j) |
| Backend | none | Go/Chi + Neo4j (+ vector index) |
| Scale | a few-thousand-node bundle, **starts as a subset** and grows via query/expand | 7-digit target (~10M); 8-digit aspirational |
| Purpose | ship the concept anywhere, offline; still demonstrates query/filter/expand | the real thing: navigate millions, live |

**The key move:** both tracks run the **same client, the same stories, the same
expand/filter UX** — they differ only in which `GraphSource` is plugged in. We
build the exploration UX once, demo it offline, scale it live. The agent
(Plan F) also speaks `GraphSource`, so it slots in without rework.

---

## 2. The `GraphSource` / `View` contract  🔜

The interface both sources satisfy, the Go API serves, and the agent emits.

### View — a bounded, parameterized lens
```
View {
  nodes: Node[]            // the bounded scene currently materialized
  edges: Edge[]
  bounds: {                // the parameters that produced this view
    anchor:   NodeId | CommunityId | SearchQuery
    relTypes: RelType[]    // which edge kinds are in play
    nodeTypes: NodeType[]
    ranges:   { year?: [lo,hi], pagerank?: >=x, similarity?: >=s, ... }
    maxNodes: N            // hard scene bound (egocentric + LOD)
  }
  corridor: NodeId[]       // the visited path — drives breadcrumbs + auto-collapse
}
```

### GraphSource — the action space
| Method | Meaning |
|---|---|
| `entry(mode, params) → View` | the **initial query**. modes: `node` (land on id), `overview` (nebula map), `search` (text/semantic → land) |
| `expand(view, nodeId, rule) → ViewDelta` | pull bounded neighbors per `rule` |
| `collapse(view, nodeId \| region) → ViewDelta` | remove or summarize back into a nebula |
| `filter(view, predicate) → View` | node/edge property filtering |
| `search(query, kind) → Candidate[]` | `kind`: `text` (name) or `semantic` (vector kNN) |
| `neighbors(nodeId, rule) → Candidate[]` | previews (reticles/radar) without committing |
| `explain(edgeId \| path) → Explanation` | 💭 agent-backed (Plan F) |

`ExpandRule = { relType, rank: pagerank|recency|similarity|degree, limit, direction }`

This is the whole contract. `StaticBundleSource` implements it client-side over
an in-memory bundle; `ApiSource` implements it as Go/Chi endpoints over Neo4j;
the agent generates `View`/`ExpandRule` objects from natural language.

---

## 3. Core mechanics

### 3.1 Entry modes (the "initial query")
There isn't one initial query — there are **three entry modes**, and each story
picks one:
- **Land-on-node (ego)** — arrive *on* a node; show a bounded, ranked N-hop
  neighborhood. (The egocentric camera + travel are ✅ already built.)
- **Nebula overview** — communities as volumetric, clickable LOD bodies; pick
  one, drill in. (🔜 needs the nebula primitive + multi-resolution communities.)
- **Search** — text (name) or **semantic** (vector kNN over abstracts) → a
  candidate list → pick → land.

### 3.2 Expansion / collapse + the corridor
- **Expansion** is typed, ranked, capped (`ExpandRule`). Incremental layout:
  pin shown nodes, settle only the new ones; the blast-doors cover the recompute
  (their real functional job). ✅ camera/travel exist; 🔜 incremental relayout.
- **Corridor** = the visited path (breadcrumbs). It's the memory of the journey.
- **Auto-collapse (your idea):** as the universe expands and you advance, the
  off-corridor regions — *places not visited, paths not taken* — **summarize
  back into nebulae** rather than cluttering the scene. They persist as collapsed
  markers (reopenable via breadcrumbs), not deletions. Collapse is **context-
  weighted**: nodes matching the active story's filter/relType stay salient
  longer. This is the concrete expression of "journeys-as-memory."

### 3.3 Filtering
- **Node:** type, year range, field, community, centrality (pagerank; later
  betweenness for brokers).
- **Edge:** relType, concept score, similarity threshold.
- Same `predicate` both ways: `ApiSource` re-queries; `StaticBundleSource`
  masks the in-memory bundle.

---

## 4. Story catalog

All five archetypes captured. Each lists the question, entry mode, expand/
collapse mechanic, the dataset features it leans on, and any **new analytics**
it requires that we don't have yet. Walk-throughs (i) and (ii) are expanded
below; the rest are stubs to expand when we build more demos.

| # | Story | Entry | Expand / collapse | Needs (beyond current) | Status |
|---|---|---|---|---|---|
| S1 | **Idea genealogy & diffusion** — where did an idea come from, where did it go (Hopfield→attention hero) | land-on-node | citations back (origins) / forward (diffusion); cross-field jumps highlighted; off-path folds | — (have cites, year, field, community, kNN) | **walk-through (i)** |
| S2 | **Shape of a field & its load-bearing bridges** | nebula overview → drill | community → brokers (high betweenness) → cross-field wormhole | **betweenness centrality**; **multi-resolution communities** (nebula LOD) | **walk-through (ii)** |
| S3 | **Why are these two distant things related?** (wormhole + the chain that explains it) | semantic link / one endpoint | expand the bridge corridor; explain-why | `explain` (agent) | 🔜 stub |
| S4 | **What converged to make this breakthrough?** | land-on-node (the breakthrough) | inbound lineages; watch independent threads meet | — | 🔜 stub |
| S5 | **Live branch vs. dead end** — whatever happened to idea X? | land-on-node | live branches stay; dead ends auto-collapse (temporal + degree) | temporal diffusion scoring | 🔜 stub |

> Backlog feeders surfaced by the catalog: **GDS betweenness** (S2 brokers),
> **multi-resolution Louvain** (nebula hierarchy / overview LOD), **temporal
> diffusion scoring** (S5). These feed Plans C/E.

---

### Walk-through (i) — Demo bundle: "Idea genealogy & the wormhole"
*Source: `StaticBundleSource` over the demo bundle. Hero narrative:
Hopfield 1982 → modern attention. Shows entry, filter, expand/collapse, and a
semantic edge — all offline.*

1. **Land** on *Hopfield 1982* (W2128084896) — egocentric camera parks on the
   node; reticles tag the brightest neighbors.
2. **Bound the view:** the raw ego-net is noisy, so apply a filter —
   `relType = cites`, `pagerank ≥ p`, `year ≤ 1995` — collapsing to the
   high-signal early backbone. (Demonstrates **filtering** on the bundle.)
3. **Diffuse forward:** travel along citations toward the present; at each hop
   the corridor extends and off-corridor branches fold into faint nebulae.
   (Demonstrates **expand + corridor auto-collapse**.)
4. **The bridge:** arrive at *Ramsauer 2021* ("Hopfield Networks is All You
   Need"). Its **wormhole** edge to the transformer lineage lights up (violet
   conduit — ✅ already built).
5. **Cross it:** jump the wormhole into the ML galaxy; land on the transformer
   lineage in a visibly distant community. The NodePanel's wormhole sub-panel
   shows similarity + basis. (Demonstrates the **semantic edge** + the payoff
   "why a graph this far apart is actually related.")
6. **Look back:** breadcrumbs render the whole corridor; "paths not taken" sit
   collapsed and reopenable. (Demonstrates **journeys-as-memory**.)
7. *(Plan F later)* the agent narrates the wormhole and offers "replay as tour."

### Walk-through (ii) — Big graph: "The shape of a field & its bridges"
*Source: `ApiSource` over the 7-digit live graph. Shows what only scale makes
possible: overview → drill, live query, brokers, serendipity.*

1. **Overview:** open on the **nebula map** — thousands of communities as LOD
   bodies, sized/brightened by mass and centrality. No node is individually
   visible yet; this is the 10M-graph "from orbit."
2. **Drill:** fly into the "attention / transformers" nebula; it blows up into
   its sub-communities, then its papers (multi-resolution LOD).
3. **Find the load-bearing bridges:** highlight **brokers** (high betweenness)
   — the works that hold this field to vision, RL, neuroscience, biology.
   (Needs GDS betweenness.)
4. **Expand a broker** with `rule = {relType: cites, rank: betweenness, dir:
   out}`; a cross-field **wormhole** to a distant nebula surfaces.
5. **Cross + bound by recency:** jump it, then filter `year ≥ 2023` to watch the
   live diffusion front in the destination field.
6. **Scale felt, not described:** the same primitives (land/expand/filter/
   corridor) that ran on the bundle now move through millions — the point of
   Track B.

---

## 5. Scale stance
- **7-digit (~1–10M)** via an **OpenAlex bulk snapshot** ingest (not API
  snowball) — feasible on the current 64 GB + GPU box. Embeddings at 10M works
  ≈ ~40 GB of vectors + many GPU-hours; Neo4j + vector index at 10M / ~100M
  edges is workable with care.
- **8-digit (100M+)** likely exceeds one box (~1B edges) — sharding / bigger
  store / heavier pre-aggregation; revisit hardware before committing.
- **The UX is scale-invariant:** bounded views, expand, filter, corridor behave
  identically at 200k or 10M — so **build & demo Track B against the current
  200k store now**; the bulk ingest (Plan E) runs in parallel and never blocks
  the UX.

## 6. Agent-readiness (Plan F, later)
`GraphSource` is the agent's action space. Roles when we add it: NL → `View`/
`ExpandRule`; **explain-this-wormhole** (semantic basis + connecting chain);
**name/summarize a nebula**; **suggest next hop / surface serendipity**;
**generate a tour** from a question (auto-author future walk-throughs). Build
the API agent-addressable from day one; ship the agent as a later layer. It
augments — manual navigation stays the spine.

## 7. The plans (split)
- **A — this doc** (stories + contract). ✅ drafted.
- **B — embeddings/kNN → Neo4j** (vector index + `SIMILAR_TO`), works-only, on
  the 200k store. 🔜 script ready (`ingest/load_embeddings.py`); run when
  embedding completes.
- **C — Go/Chi serving layer** = `ApiSource`: entry/expand/filter/search over
  Neo4j; `View` as the core abstraction; telemetry + auth per stack.
- **D — live exploration client**: rewire R3F app onto `GraphSource`;
  incremental expand/collapse; filter UI; breadcrumbs + corridor auto-collapse.
- **E — data scaling**: OpenAlex bulk-snapshot ingest → 7-digit; betweenness +
  multi-resolution communities; 8-digit hardware assessment.
- **F — agent co-pilot**: NL→View, explain, name, tour. API made agent-ready now.

Dependencies: A unblocks C/D/F; B unblocks C. **A + B run in parallel now**;
both converge into C/D. D can start against `StaticBundleSource` before C exists.
