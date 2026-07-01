# Tour-step model (confirmed)

A guided-tour step is **four orthogonal parts**, composed by the engine:

    step = action + transition + camera + panel

## 1. Action (`op`)
The data/view change. Existing op kinds, all first-class steps:
`travel` · `travelCourse` · `plot` · `expand` (neighbours by rule) · **`add`** (reveal
specific node ids — distinct from expand) · `collapse` · `filter` · `nebula{on}`
(collapse-into-nebulae) · `nebula{fold}` (fold/unfold) · `look` · `overview` · `inspect`.

## 2. Transition (`doors?: boolean`)
Governs the WHOLE transition — action swap *and* camera move:
- **`doors: true`** → both resolve behind the closed blast doors; they open onto the
  settled result (what the tour ENTRY does today). No motion seen.
- **`doors: false`** → action plays live (added nodes fade in / removed fade out) and
  the camera eases visibly.
- **Fade rule:** the enter/exit fade applies to `expand`/`add` (smooth reveal) but is
  SUPPRESSED for nebula regroup/fold — there the reform itself is the motion (snap).

## 3. Camera (`camera?: { altitude?, face? }`) — never inherited, always eased
The **camera-continuity invariant**: a step never snaps; it EASES to a defined pose.
- `altitude`: `number` (explicit orbit height) | `'fit'` (frame the op's points) |
  omitted → default viewing distance (`ORBIT_R`). **Fixes "stays zoomed out."**
- `face`: nodeId to look toward. Orbit is DERIVED from it (layouts are
  non-deterministic, so orbit is never hardcoded). Omitted → neutral/forward.
- Flow: ease current → start pose; animate the action's move → target pose; optional
  post-landing adjustment. (Entry is the one baseline, reached by easing behind doors.)

## 4. Panel (`panel?: { kind, target? }`)
Which HUD panel ends open on landing: `inspector` (node) · `nebula` · `filter` ·
`course` · `none`, with an optional target id.

## Migration
Only Convergence + Plato use tours — migrate both to the clean fields and DROP the
redundant op hints (`inspect.focus` → `camera.face`; `travel.inspect` → `panel`;
`nebula.watch/fold` → `doors`/action; `nebula.look` → `camera.face`).

## Phasing
1. **Camera engine + per-step `camera` + per-op altitude defaults** — fixes the
   reported "altitude stays out". Folds in the (uncommitted) continuity work.
2. **`doors` per step** — unify behind-doors vs live; suppress fade on fold.
3. **`panel` on landing.**
4. **Nebula bugs:** Highlight (lights field regardless of fold + per-nebula state);
   select-unfolded-nebula (give unfolded clouds a hit-sphere BEHIND the nodes — nodes
   win hover/click, empty cloud space selects the nebula).
