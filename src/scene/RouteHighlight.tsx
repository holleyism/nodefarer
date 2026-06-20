// A general "emphasis" — a marked set of nodes + edges, distinct from selection.
// `kind` picks the visual skin: a plotted travel `route` now; neighbourhood
// `nebula` highlights reuse this same shape later. The highlight is applied as
// an OVERLAY on the existing node/edge geometry (Nodes/Edges recolour the route
// members in place) rather than separate floating geometry — so it can't
// parallax to a different apparent elevation as the view zooms or tilts.
export interface Emphasis {
  kind: 'route' | 'nebula'
  nodeIds: string[]
  edgeIds: string[]
}

// Per-kind skin colour. Route = warm amber (a charted flight path), clearly
// apart from the cyan HUD/selection and violet wormholes. Nebula gets its own.
export const EMPHASIS_COLOR: Record<Emphasis['kind'], string> = {
  route: '#ffce7a',
  nebula: '#9af7d0',
}
