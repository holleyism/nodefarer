// ─────────────────────────────────────────────────────────────────────────────
// Hyperbolic-POC math (throwaway experiment — see memory hyperbolic-poc-plan).
// Points of the Poincaré disk are complex numbers z with |z| < 1; the boundary
// |z| = 1 is the circle at infinity. Isometries of the disk are the Möbius maps
//   f(z) = e^{iθ} (z − a)/(1 − conj(a)·z),  |a| < 1,
// which form SU(1,1); we represent them as 2×2 complex matrices
//   M = [[α, β], [conj(β), conj(α)]],  acting by  f(z) = (α z + β)/(conj(β) z + conj(α)).
// Matrix composition = transform composition, so panning/recentering is just
// matrix multiply. Nothing here depends on the rest of the app.
// ─────────────────────────────────────────────────────────────────────────────

export interface Complex {
  re: number
  im: number
}

export const C = (re: number, im = 0): Complex => ({ re, im })
export const cadd = (a: Complex, b: Complex): Complex => ({ re: a.re + b.re, im: a.im + b.im })
export const csub = (a: Complex, b: Complex): Complex => ({ re: a.re - b.re, im: a.im - b.im })
export const cneg = (a: Complex): Complex => ({ re: -a.re, im: -a.im })
export const cconj = (a: Complex): Complex => ({ re: a.re, im: -a.im })
export const cmul = (a: Complex, b: Complex): Complex => ({
  re: a.re * b.re - a.im * b.im,
  im: a.re * b.im + a.im * b.re,
})
export const cscale = (a: Complex, s: number): Complex => ({ re: a.re * s, im: a.im * s })
export const cabs2 = (a: Complex): number => a.re * a.re + a.im * a.im
export const cabs = (a: Complex): number => Math.hypot(a.re, a.im)
export const cangle = (a: Complex): number => Math.atan2(a.im, a.re)
export const cdiv = (a: Complex, b: Complex): Complex => {
  const d = cabs2(b)
  return { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d }
}
export const fromPolar = (r: number, theta: number): Complex => ({ re: r * Math.cos(theta), im: r * Math.sin(theta) })

// ── Möbius isometries as SU(1,1) matrices ───────────────────────────────────
export interface Mobius {
  a: Complex // α
  b: Complex // β
}

export const IDENTITY: Mobius = { a: C(1), b: C(0) }

// f(z) = (α z + β) / (conj(β) z + conj(α)). Möbius action is scale-invariant in
// the matrix entries, so this is correct even if M isn't normalized.
export function apply(M: Mobius, z: Complex): Complex {
  const num = cadd(cmul(M.a, z), M.b)
  const den = cadd(cmul(cconj(M.b), z), cconj(M.a))
  return cdiv(num, den)
}

// Compose two isometries: (M1 ∘ M2). Normalized to keep |α|²−|β|²=1 stable
// under repeated composition (drag panning multiplies many of these).
export function compose(M1: Mobius, M2: Mobius): Mobius {
  // [[a1,b1],[b1*,a1*]] · [[a2,b2],[b2*,a2*]]
  const a = cadd(cmul(M1.a, M2.a), cmul(M1.b, cconj(M2.b)))
  const b = cadd(cmul(M1.a, M2.b), cmul(M1.b, cconj(M2.a)))
  return normalize({ a, b })
}

// Rescale so det = |α|²−|β|² = 1 (the SU(1,1) constraint).
export function normalize(M: Mobius): Mobius {
  const det = cabs2(M.a) - cabs2(M.b)
  if (det <= 0) return M // degenerate (shouldn't happen for disk isometries)
  const s = 1 / Math.sqrt(det)
  return { a: cscale(M.a, s), b: cscale(M.b, s) }
}

// The isometry g(z) = (z − p)/(1 − conj(p)·z): moves p to the origin (the
// "drag-to-center" / egocentric recenter). Its inverse is recenter(−p).
export function recenter(p: Complex): Mobius {
  return normalize({ a: C(1), b: cneg(p) })
}

// Hyperbolic distance from the origin to z: d(0,z) = 2·atanh(|z|).
export const distFromOrigin = (z: Complex): number => 2 * Math.atanh(Math.min(0.999999, cabs(z)))
// Inverse: the disk radius for a hyperbolic distance r.
export const radiusForDist = (r: number): number => Math.tanh(r / 2)

// ── Geodesics ────────────────────────────────────────────────────────────────
// A geodesic between two interior points is an arc of the circle orthogonal to
// the unit circle through them (a diameter when they're radially aligned). For
// SVG we return a path `d`; the straight chord is the cheap fallback.
export function chordPath(z1: Complex, z2: Complex, cx: number, cy: number, R: number): string {
  const p1 = toScreen(z1, cx, cy, R)
  const p2 = toScreen(z2, cx, cy, R)
  return `M ${p1.x} ${p1.y} L ${p2.x} ${p2.y}`
}

export function toScreen(z: Complex, cx: number, cy: number, R: number): { x: number; y: number } {
  return { x: cx + R * z.re, y: cy + R * z.im }
}

// Geodesic arc as an SVG path. Falls back to a straight chord when the two
// points are (nearly) radially aligned — then the geodesic IS the diameter.
export function geodesicPath(z1: Complex, z2: Complex, cx: number, cy: number, R: number): string {
  // Radial alignment test: cross product of the two position vectors ~ 0.
  const cross = z1.re * z2.im - z1.im * z2.re
  const near = 1e-4
  if (Math.abs(cross) < near || cabs(z1) < near || cabs(z2) < near) {
    return chordPath(z1, z2, cx, cy, R)
  }
  // The orthogonal circle passes through z1, z2 and the inverse point z1* =
  // z1/|z1|². Three points → circumcircle (centre Cc, radius ρ).
  const inv = cscale(z1, 1 / cabs2(z1))
  const circ = circleThrough(z1, z2, inv)
  if (!circ) return chordPath(z1, z2, cx, cy, R)
  const { center, radius } = circ
  const s1 = toScreen(z1, cx, cy, R)
  const s2 = toScreen(z2, cx, cy, R)
  const rPx = radius * R
  // Choose the sweep flag whose arc bows INTO the disk (its midpoint is the one
  // nearer the disk centre). large-arc-flag stays 0 (the inside arc is minor).
  const mid = (sweep: number) => {
    const a1 = Math.atan2(s1.y - (cy + center.im * R), s1.x - (cx + center.re * R))
    let a2 = Math.atan2(s2.y - (cy + center.im * R), s2.x - (cx + center.re * R))
    if (sweep === 1 && a2 < a1) a2 += 2 * Math.PI
    if (sweep === 0 && a2 > a1) a2 -= 2 * Math.PI
    const am = (a1 + a2) / 2
    return { x: cx + center.re * R + rPx * Math.cos(am), y: cy + center.im * R + rPx * Math.sin(am) }
  }
  const d0 = Math.hypot(mid(0).x - cx, mid(0).y - cy)
  const d1 = Math.hypot(mid(1).x - cx, mid(1).y - cy)
  const sweep = d0 < d1 ? 0 : 1
  return `M ${s1.x} ${s1.y} A ${rPx} ${rPx} 0 0 ${sweep} ${s2.x} ${s2.y}`
}

// Circumcircle of three (disk-space) points, or null if collinear.
function circleThrough(p1: Complex, p2: Complex, p3: Complex): { center: Complex; radius: number } | null {
  const ax = p1.re, ay = p1.im, bx = p2.re, by = p2.im, dx = p3.re, dy = p3.im
  const d = 2 * (ax * (by - dy) + bx * (dy - ay) + dx * (ay - by))
  if (Math.abs(d) < 1e-12) return null
  const a2 = ax * ax + ay * ay
  const b2 = bx * bx + by * by
  const c2 = dx * dx + dy * dy
  const ux = (a2 * (by - dy) + b2 * (dy - ay) + c2 * (ay - by)) / d
  const uy = (a2 * (dx - bx) + b2 * (ax - dx) + c2 * (bx - ax)) / d
  const center = C(ux, uy)
  return { center, radius: cabs(csub(p1, center)) }
}
