# Tour draft: "Plato's Problem" (the wormhole tour)

Scratch outline — **not loaded by the app**. This is the working plan; beats move
into `public/tours/plato.json` one at a time as you validate them (tour JSON can't
hold comments, so future beats live here, not there).

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

7. **cross** — *"Through the wormhole"*
   `travelCourse inspect` **(or** `travel W4252434862 inspect`**; see Q2)**. Cross
   the semantic edge into the humanities — kinship found by *meaning*, not reference.
   → explores **Plato's Problem / LSA**

8. **landing** — *"A world of its own"*
   `expand W4252434862 rule{structural, limit ~6}`. The humanities paper has its own
   world: it blooms into its authors, its venue, its ideas — a living far side, not a
   dead end. → reveals the neighborhood

9. **who** — *"Who was asking"*
   `inspect A5112868485` (Landauer) **or** `inspect S35223124` (Psychological Review).
   A real psychologist, in a 1997 psychology venue — this is serious scholarship in a
   field the ML trail never pointed at. → explores **Landauer / Psych Review**

10. **recap** — *"Found by exploring"*
    `overview`. Pull back over the whole trail: connectionism → semantic cognition →
    concept learning → a wormhole clean out of ML into a 2,400-year-old question. The
    point: you don't *search* for the surprise — you explore until it finds you.

## Nodes explored (tally → 6)
PDP · Semantic Cognition · concept acquisition · Plato's Problem/LSA · (SUSTAIN, shown not landed) · Landauer **or** Psychological Review

## Decisions to confirm before I build
- **Q1 — nebula beat (step 2):** keep it? It strengthens the "leapt to a hidden,
  distant galaxy" surprise, but it's also convergence's signature move. Keep (shared
  visual language) / cut (keep this tour distinct) / keep but reframe.
- **Q2 — cross via course or direct (step 7):** `travelCourse` after a `plot`, or a
  direct `travel` across the semantic edge? Direct is simpler for a one-hop jump;
  plot+course matches convergence but is heavier here. (Leaning direct.)
- **Q3 — step 9 target:** Landauer (the human) or Psychological Review (the venue)?
- **Q4 — easter egg:** Hopfield's 1982 paper (convergence's origin) is a neighbor of
  the LSA node. Add a wink to it, or leave it for the curious to find? (Leaning leave.)
- **Q5 — anchors vs raw ids:** use raw `W…` ids in the JSON (like old s4), or add
  `plato.*` anchors to `manifest.json` for readability? (Leaning raw ids — it's one
  self-contained tour.)
- **Q6 — catalog:** drop s1–s4 from `manifest.json` when this lands; delete the four
  JSON files only on your say-so.
