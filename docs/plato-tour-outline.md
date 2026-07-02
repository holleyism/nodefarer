# Tour draft: "Plato's Problem" (the wormhole tour)

Scratch outline — **not loaded by the app**. This is the working plan; beats move
into `public/tours/plato.json` one at a time as you validate them (tour JSON can't
hold comments, so future beats live here, not there).

> **STATUS (2026-07-01): all 10 beats built in `plato.json`.** Pending a browser
> smoke of the crossing + far-side bloom. Decisions resolved below.

Replaces the four originals (s1–s4) with one tour. Complements `convergence`:
- **convergence** = many fields flow *in* → the transformer (synthesis).
- **this** = follow one idea until a wormhole flings you *out* to an unexpected
  field (serendipity). Showcase capability: the **semantic wormhole**.

## Meta
- **id:** `plato`
- **title:** "Plato's Problem — the leap no citation would show you"
- **subtitle:** "Follow concept-learning until a semantic wormhole leaps clean out of the field."
- **entry:** park on the origin (PDP), `maxNodes ~40`
- **bundle:** `bundle.json`

## The spine (all real nodes, verified in bundle.json)
| ref | id | name | field | role |
|---|---|---|---|---|
| origin | `W2127770685` | Parallel Distributed Processing at 25 | Computer Science | start (connectionism) |
| mid | `W1488309867` | Semantic Cognition (PDP approach) | Psychology | how a net represents meaning |
| wormhole-source | `W2112939431` | A modular neural network model of concept acquisition | Computer Science | where the conduits bloom |
| (stays in ML) | `W2170014483` | SUSTAIN: A Network Model of Category Learning | Computer Science | the conduit that *doesn't* surprise |
| **destination** | `W4252434862` | A solution to Plato's Problem (LSA) | Arts & Humanities | the leap |
| landing | `A5112868485` | Thomas K. Landauer (author) | — | the human on the far side |
| landing | `S35223124` | Psychological Review (venue) | — | far-field scholarship |
| landing | `C170133592` | Latent semantic analysis (concept) | — | the shared idea |

## Beat outline (≈10 steps; **nodes explored: 6**)

1. **land** — *"Cognition from connections"*
   `inspect W2127770685`. Connectionism: thinking emerges from networks of simple
   units. We'll follow ONE idea — how a network comes to *know* things — and see
   where it leads. → explores **PDP**

2. **fields** — *"The sky resolves into fields"* — *(echoes convergence; see Q1)*
   `nebula on, watch, fold:distant`. Group every paper by discipline into glowing
   galaxies; distant fields fold away — we can't see inside them from here. We're
   in CS/ML. Note the faint threads leaving the field.

3. **meaning** — *"Where does meaning come from?"*
   `travel W1488309867 inspect`. One citation to *Semantic Cognition* — how a
   network gradually comes to represent concepts (what a robin is, vs a rose).
   Still one idea: how a network comes to know. → explores **Semantic Cognition**

4. **acquire** — *"Acquiring a concept"*
   `travel W2112939431 inspect`. A 1991 model — how a network *learns a new concept
   at all*. We've stayed inside one idea the whole way. This is where it gets
   strange. → explores **concept acquisition**

5. **wormhole** — *"Not every link is a citation"*
   `expand W2112939431 rule{semantic, limit:2} face:W4252434862`. Two violet
   conduits bloom — semantic kin, not citations. One reaches another category-
   learning network (SUSTAIN — still ML). The other leaps clean out. Follow the far
   one. → reveals **SUSTAIN** + the far end

6. **surprise** — *"Plato's Problem"*
   `inspect W4252434862 focus`. The humanities. *A solution to Plato's problem*
   (1997) — latent semantic analysis — answering a question Plato asked 2,400 years
   ago: how do we know so much from so little? Same idea — meaning from co-occurrence
   — that a neural net uses to acquire a concept. The citation graph would never
   have shown you this.

7. **cross** — *"Through the wormhole"* — **BUILT**
   `travel W4252434862 inspect`, `camera{altitude:6}`. Direct hop across the semantic
   edge (Q2 → direct; it's one revealed edge, no plot needed). Kinship found by
   *meaning*, not reference. → explores **Plato's Problem / LSA**

8. **landing** — *"A world of its own"* — **BUILT**
   `expand W4252434862 rule{limit:12}` (NO relType), `camera{altitude:'fit'}`.
   ⚠️ Gotcha: `expand` ranks candidates by **pagerank**, and this node's authors /
   venue / concepts are all pr 0 — so a small limit surfaces only the connected
   *works* + noise concepts, never the people. `limit:12` blooms the whole
   neighbourhood (11 new nodes) to reach Landauer (rank 10). Also NO edge has
   `rel === 'structural'` (that's `kind`; `rel` is `cites`/`authored_by`/…), so the
   outline's original `rule{structural}` would have matched nothing. Hopfield's 1982
   paper (convergence's origin) rides along in the bloom — the Q4 easter egg, left
   unremarked. → reveals the neighborhood

9. **who** — *"Who was asking"* — **BUILT**
   `inspect A5112868485` (Landauer), `camera{altitude:'fit', face:A5112868485}`.
   Q3 → Landauer (the human reads better than the venue; both are in the bloom, so
   the venue is still visible/name-checked in the narration). A real psychologist, in
   a 1997 psychology venue — serious scholarship in a field the ML trail never
   pointed at. → explores **Landauer**

10. **recap** — *"Found by exploring"* — **BUILT**
    `overview`. Pull back over the whole trail: connectionism → semantic cognition →
    concept learning → a wormhole clean out of ML into a 2,400-year-old question. The
    point: you don't *search* for the surprise — you explore until it finds you.

## Nodes explored (tally → 6)
PDP · Semantic Cognition · concept acquisition · Plato's Problem/LSA · (SUSTAIN, shown not landed) · Landauer **or** Psychological Review

## Decisions (resolved)
- **Q1 — nebula beat (step 2):** KEPT (`fold:'none'` — group into fields but don't
  fold the distant ones away, so the wormhole's far galaxy stays visible to leap to).
- **Q2 — cross via course or direct (step 7):** DIRECT `travel` across the one
  revealed semantic edge — no plot/course.
- **Q3 — step 9 target:** LANDAUER (the human). Psych Review also blooms in step 8,
  so it's on screen and name-checked in the narration.
- **Q4 — easter egg:** LEFT unremarked — Hopfield's 1982 paper is in the step-8 bloom
  (structural neighbor of LSA), there for the curious.
- **Q5 — anchors vs raw ids:** RAW `W…`/`A…` ids (self-contained tour).
- **Q6 — catalog (STILL OPEN):** plato + convergence now cover the catalog; s1–s4 are
  redundant. Remaining: drop s1–s4 from `manifest.json`, and delete the four JSON
  files (only on explicit say-so). Not done yet.
