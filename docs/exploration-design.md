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

## 2. The Atlas — datasets are self-describing  🔜

**Problem this solves.** The demos, the colors, the meaning of "wormhole" and
"nebula" were all implicitly bound to *one* dataset (the Hopfield→attention
OpenAlex slice). Swap the data and the demos break, the legend is wrong, and the
lens semantics no longer apply. The engine shouldn't *know* what a nebula means;
the **dataset** should declare it.

**The object.** An **Atlas** is the top-order metadata object that makes a
dataset self-describing and self-demoing. It is a *parameterized lens over a
source* — the source is **not** the Atlas:

```
Atlas {
  id, name, description, schemaVersion, provenance, license
  source:   { kind: 'bundle' | 'api', url, params, auth? }   // where the data lives
  capabilities: { embeddings, betweenness, communities, ... } // what the data can support
  legend:   { wormhole: <edgeLens>, nebula: <groupingLens>, nodeTypes, colors, propertyDisplay }
  anchors:  { <name>: NodeId | Query }                        // named handles, e.g. origin → W2128084896
  tours:    Tour[]                                            // declarative, bound to THIS dataset
}
```

- **`legend` is the keystone.** What a nebula or a wormhole *means* is config,
  not code. The engine implements the *mechanic*; the legend says *which set /
  which edges* for this dataset. The "is a nebula semantic or community?" debate
  collapses to one field in the grouping-lens spec, chosen per Atlas (see §4.4).
  - `wormhole` = an **edge lens**: `{ basis: 'edgeKind', kind: 'semantic', minSimilarity }`
    — or on another dataset `{ basis: 'crossCommunity', relType: 'cites' }`.
  - `nebula` = a **grouping + layout lens** (§4.4) — not an overlay.
  - **Lenses are optional, two ways.** Each lens carries an `enabled` default in
    the legend so a **simple dataset** can ship with wormholes and/or nebulae off
    entirely; and the user gets a **console toggle** for each, so someone easing
    into the mental model can start with a plain graph and turn the lenses on
    when ready. (Disabled nebula ⇒ pure edge-weight layout, `groupStrength` 0.)
- **`tours` belong to the Atlas, hard-bound to the dataset.** A tour about
  Hopfield→attention is *about that data*; it does not port to another corpus
  (the semantics might transfer but the specifics break — so we don't pretend).
  Tours are declarative Steps over the op vocabulary (narration + selection +
  view change + travel + nebula reveal/collapse); a future authoring UI emits
  them; the agent (Plan F) can generate them. `anchors` give tours named handles
  *within* an Atlas — for reuse and load-time validation, **not** portability.
  **Tour ops are node-relative by contract** — they reference node ids/anchors
  and frame the camera *relative to nodes*, never absolute coordinates, because
  the force layout is non-deterministic and positions differ per run.
- **`capabilities`** gate engine feasibility only (e.g. no embeddings → the
  wormhole lens can't function), not tour visibility (tours don't port, so
  there's nothing to gate).

**One Atlas per backend — and that's not a limit.** A backend ships one
canonical Atlas (`GET /atlas`); a `GET /atlases` catalog returns a one-element
list, leaving room to grow. Multiple Atlases can point at the *same* backend
with different `params`/`legend`/`tours` → two "worlds" over one store. Atlases
are **portable documents**: the static track carries `manifest.json` beside
`bundle.json` (co-resident — same schema, different transport).

**UI.** A "choose your universe" entry surface picks an Atlas (from a backend
catalog or a bundle URL/file) and persists it (localStorage) — retiring the
build-time `VITE_API_URL` coupling for runtime selection.

---

## 3. The `GraphSource` / `View` contract  🔜

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

## 4. Core mechanics

### 4.1 Entry modes (the "initial query")
There isn't one initial query — there are **three entry modes**, and each story
picks one:
- **Land-on-node (ego)** — arrive *on* a node; show a bounded, ranked N-hop
  neighborhood. (The egocentric camera + travel are ✅ already built.)
- **Nebula overview** — communities as volumetric, clickable LOD bodies; pick
  one, drill in. (🔜 needs the nebula primitive + multi-resolution communities.)
- **Search** — text (name) or **semantic** (vector kNN over abstracts) → a
  candidate list → pick → land.

### 4.2 Expansion / collapse + the corridor
- **Expansion** is typed, ranked, capped (`ExpandRule`). Incremental layout:
  pin shown nodes, settle only the new ones; the blast-doors cover the recompute
  (their real functional job). ✅
- **Collapse** is the clean inverse of expand, anchored to the **true shortest
  path** from the current node (the same `path()` travel uses, computed over the
  whole dataset — `collapseAlongPath`). For `collapse(X)`:
  1. Ensure X's shortest-path edge is present (it *reappears* if a prior collapse
     removed it); the node is kept and re-anchored, so it's always re-expandable.
  2. Remove all of X's *other* edges.
  3. Prune any node now unreachable (in the visible view) from the current node.
  A node with an alternate visible path stays; one that depended on X folds away.
  Because the anchor is the *dataset* shortest path (not the visible graph), it
  doesn't drift to longer alternates, and it's symmetric with travel (collapse
  folds along the shortest path, travel re-unfolds along it). In a tree (no
  alternate paths) this reduces to the familiar "collapse hides the subtree." ✅
- **Corridor** = the visited path (breadcrumbs). It's the memory of the journey.
- **Auto-collapse (your idea):** as the universe expands and you advance, the
  off-corridor regions — *places not visited, paths not taken* — **summarize
  back into nebulae** rather than cluttering the scene. They persist as collapsed
  markers (reopenable via breadcrumbs), not deletions. Collapse is **context-
  weighted**: nodes matching the active story's filter/relType stay salient
  longer. This is the concrete expression of "journeys-as-memory."

### 4.3 Filtering
- **Node:** type, year range, field, community, centrality (pagerank; later
  betweenness for brokers).
- **Edge:** relType, concept score, similarity threshold.
- Same `predicate` both ways: `ApiSource` re-queries; `StaticBundleSource`
  masks the in-memory bundle.

### 4.4 Nebulae — a grouping is a **layout control point**  🔜
A nebula is **not** a glow painted on top of a force layout. It is a grouping
that **decides where nodes go** — change the grouping parameter and the universe
**re-spatializes** into clouds. Three roles compose:

1. **Spatialization authority** *(the heart)* — the grouping acts as a layout
   force: members of a nebula attract to a shared centroid. Layout is a
   **continuum**, not a mode switch — a `groupStrength` parameter blends it with
   the existing edge-weight force: `0` = today's pure force-directed layout, `1`
   = a near-hard spatial partition by group (edges barely pull, clean clouds),
   mid = both. Centroids arrange by group kind: a **ring/grid** for categorical
   groups, an **axis** for an ordered parameter (age, income, year) so the cloud
   sequence reads left→right. This is what makes "drag a parameter, watch the
   graph reorganize" possible, and it's qualitatively different from force layout.
2. **Rendering / LOD** — how a group looks: individuals clustered tightly, or
   (zoomed out / collapsed) folded into one volumetric **cloud body** standing
   in for N nodes, reopenable.
3. **Highlight** — mark a group without moving anything. This is the only role
   the existing `Emphasis` overlay (`RouteHighlight.tsx`, `kind:'nebula'`)
   covers; it's the smallest of the three and no longer the definition.

**Legend spec (per Atlas):** `nebula: { enabled, basis: 'property'|'community'|'semanticKnn',
key, bucketing?, centroidArrangement: 'ring'|'axis', groupStrength, lod }`. The
"what is a nebula" choice is now one field here, and `groupStrength`/the grouping
parameter can be a **live UI control**. Nebulae (like wormholes) can be **disabled
per-dataset** (`enabled: false` ⇒ pure edge-weight layout) and **toggled off by
the user** from the console — so a simple dataset, or someone new to the mental
model, can start with a plain graph and switch the lens on when ready.

**Animated relayout + optional blast-doors.** Relayout on a parameter change runs
behind the blast doors by default (their real job). But a console toggle can
**leave the doors open** so you *watch the cosmos reform*. For that to be
mesmerizing rather than jittery, the relayout must **interpolate** node positions
(and ease the camera) old→new, not expose raw force-tick noise.

`collapseNebula` / `revealNebula` are tour ops (§4.2 vocabulary) — tours
orchestrate which nebulae are folded at each narrative beat.

---

## 5. Story catalog

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
Hopfield 1982 → modern attention. Shows entry, filter, expand/collapse, the
**field nebulae**, and a semantic edge — all offline.*

**The point the old tour hid:** the wonder is *distance* — an idea born in
neuroscience ends up structurally light-years away in CS/engineering, and the
connection is surprising and hard-won. Three tidy hops and ~15 unlabeled
community colors erased that. **Field nebulae restore it** — the hero Atlas
groups nebulae by **`field`** (named, legible — not raw Louvain community, which
is too granular and unnamed), so crossing a boundary becomes a visible, earned
act. (This makes the hero Atlas itself the layout-nebula showcase; no second
dataset required.)

1. **Land inside the Neuroscience cloud** on *Hopfield 1982* (W2128084896) — its
   field-mates are visibly spatially together. *Engineering* and *Computer
   Science* sit at a felt distance as **collapsed nebulae** — you can see
   something is over there, but it's folded.
2. **Bound the view:** filter the noisy local cloud — `relType = cites`,
   `pagerank ≥ p`, `year ≤ 1995` — to the high-signal early backbone.
   (Demonstrates **filtering**.)
3. **Diffuse forward:** travel along citations toward the present; the corridor
   extends and off-corridor branches fold into faint nebulae. (Demonstrates
   **expand + corridor auto-collapse**.)
4. **Cross a boundary:** as the journey discovers the bridge node, the
   destination nebula **blooms** — the CS cloud opens from a folded blob into
   individual papers. *You watched yourself cross the gulf.* (Demonstrates
   **nebula reveal as the narrative beat** + **the wormhole** to the transformer
   lineage lighting up — violet conduit, ✅ already built.)
5. **Cross the wormhole:** land on the transformer lineage in a visibly distant
   cloud. The NodePanel's wormhole sub-panel shows similarity + basis.
   (Demonstrates the **semantic edge** + the payoff "why things this far apart
   are actually related.")
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

## 6. Scale stance
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

## 7. Agent-readiness (Plan F, later)
`GraphSource` is the agent's action space. Roles when we add it: NL → `View`/
`ExpandRule`; **explain-this-wormhole** (semantic basis + connecting chain);
**name/summarize a nebula**; **suggest next hop / surface serendipity**;
**generate a tour** from a question (auto-author future walk-throughs). Build
the API agent-addressable from day one; ship the agent as a later layer. It
augments — manual navigation stays the spine.

## 8. The plans (split)
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
- **G — the Atlas** (§2): datasets self-describe via a top-order object
  (source + legend + anchors + tours). Phased:
  - **G0** — define the Atlas schema (`src/data/atlas.ts`) + a hand-written
    `manifest.json` for the current Hopfield bundle that *reproduces today's
    behavior* (legend = current hardcoded colors/wormhole/property display). No
    behavior change — validate the model against reality.
  - **G1** — load it (static track): the legend drives colors / wormhole
    detection / property display currently hardcoded in `viewBuilder.ts`.
  - **G2** — externalize tours: move S1 + the wormhole tours from `tour.ts`
    constants into Atlas `tours` (declarative Steps over the op vocabulary +
    symbolic `anchors`); `tour.ts` becomes the interpreter.
  - **G3** — backend APIs: `GET /atlas` + `GET /atlases` (catalog stub); the Go
    server serves its Atlas co-resident with the Neo4j data; `ApiSource` fetches it.
  - **G4** — UI "choose your universe" picker; runtime source selection
    (persisted; `VITE_API_URL` demoted to a bootstrap default).
  - **G5** — a bundled demo is a **directory** (manifest + data + tours), so we
    can ship several and a user can load their own. A `demos.json` catalog lists
    the shipped ones; a user points at a **hosted directory URL** or a **local
    folder** (File System Access / `webkitdirectory`); the chosen directory is
    **validated** (manifest parses, data file reachable, listed tours exist)
    before it loads. `BundleStore` (`src/data/bundleStore.ts`) abstracts where
    files come from (url / dir-handle / file-map) so the rest of the app reads a
    universe the same way.
- **H — nebulae as layout** (§4.4): a grouping that controls spatialization.
  Depends on G (legend defines the grouping lens). Phased:
  - **H0** ✅ — layout subsystem: a centroid clustering force in
    `runForceLayout` (via d3 `forceX/Y/Z`, per-node strength), `groupStrength`
    continuum, ring/axis centroid arrangement (`src/layout/grouping.ts`), and a
    **visible animated relayout** (`buildSimulation` ticked over rAF, viewpoint
    node pinned) for the doors-open "watch the cosmos reform" path.
  - **H1** ✅ — legend → layout binding: the Atlas `nebula` lens drives the
    grouping (hero groups by `field`); a NEBULAE console section (on/off +
    grouping-strength slider + "watch layout reform" toggle); relayout runs
    behind the (fully-closed) blast doors by default, or visibly when watch is on.
  - **H2a** ✅ — volumetric **cloud bodies**: each group renders as a soft
    additive translucent sphere (centre/radius from member positions) with a DOM
    label (`src/scene/Nebulae.tsx`); colour hashed per group key. So a field
    reads as a luminous cloud-object, not just regrouped points.
  - **H2b** ✅ — fold/expand + inspect a nebula. Folding is a pure visibility
    mask over the clustered layout (`maskFoldedGroups`, no relayout).
    "Fold distant nebulae" is a one-shot **action** (collapse all but the
    current). **Click a folded cloud to select it** → lock reticle + a rail
    **Nebula inspector** (`NebulaPanel`: members, composition, year range,
    brightest, and a fold/unfold button). Arriving in a field blooms it open
    (the hero "watched yourself cross the gulf" beat). Nebula labels live in the
    HUD now — a **hover name readout** + the reticle — not floating `<Html>` in
    space (that broke the ship-viewport immersion).
  - **H3** ✅ — in-place highlight overlay (the `Emphasis` role): a toggle in the
    Nebula inspector tints the inspected nebula's visible members/edges with the
    nebula colour, layered with the route highlight (the scene's highlight
    channel is now per-id colour maps, so route amber + nebula teal coexist).

Dependencies: A unblocks C/D/F; B unblocks C. **A + B run in parallel now**;
both converge into C/D. D can start against `StaticBundleSource` before C exists.
**G is the next build** (foundation for configurable lenses); **H builds on G** —
H0 (layout) is the load-bearing piece, and the hero S1 story (§5 walk-through i)
is the first consumer.
