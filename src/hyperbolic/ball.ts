// ─────────────────────────────────────────────────────────────────────────────
// Poincaré BALL math — the 3D analog of the disk (memory hyperbolic-poc-plan).
// Points are vectors x ∈ ℝ³ with |x| < 1; the boundary sphere |x| = 1 is the
// sphere at infinity. Isometries are Möbius transformations of the ball, which
// we drive with Ungar's gyrovector / Möbius addition — the SAME closed form as
// the disk's (z−a)/(1−āz), just written for n-vectors so it works in 3D without
// quaternions. Travel ("bring node a to the centre") is the left translation by
// −a; geodesics use gyro interpolation. Standalone; no app coupling.
// ─────────────────────────────────────────────────────────────────────────────

export interface V3 {
  x: number
  y: number
  z: number
}

export const v3 = (x: number, y: number, z: number): V3 => ({ x, y, z })
export const ZERO: V3 = { x: 0, y: 0, z: 0 }
export const vadd = (a: V3, b: V3): V3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z })
export const vsub = (a: V3, b: V3): V3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z })
export const vscale = (a: V3, s: number): V3 => ({ x: a.x * s, y: a.y * s, z: a.z * s })
export const vdot = (a: V3, b: V3): number => a.x * b.x + a.y * b.y + a.z * b.z
export const vlen2 = (a: V3): number => vdot(a, a)
export const vlen = (a: V3): number => Math.sqrt(vlen2(a))
export const vneg = (a: V3): V3 => ({ x: -a.x, y: -a.y, z: -a.z })
export const vcross = (a: V3, b: V3): V3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
})
export const vnorm = (a: V3): V3 => {
  const l = vlen(a)
  return l < 1e-12 ? { x: 0, y: 0, z: 1 } : vscale(a, 1 / l)
}

// Möbius (gyrovector) addition in the ball:
//   a ⊕ b = [ (1 + 2⟨a,b⟩ + |b|²) a + (1 − |a|²) b ] / (1 + 2⟨a,b⟩ + |a|²|b|²)
// At a = 0 it's the identity (0 ⊕ b = b). The left translation x ↦ a ⊕ x is an
// isometry; (−a) ⊕ a = 0, so it recentres a to the origin.
export function madd(a: V3, b: V3): V3 {
  const ab = vdot(a, b)
  const a2 = vlen2(a)
  const b2 = vlen2(b)
  const ca = 1 + 2 * ab + b2
  const cb = 1 - a2
  const den = 1 + 2 * ab + a2 * b2
  const inv = 1 / (Math.abs(den) < 1e-12 ? 1e-12 : den)
  return {
    x: (ca * a.x + cb * b.x) * inv,
    y: (ca * a.y + cb * b.y) * inv,
    z: (ca * a.z + cb * b.z) * inv,
  }
}

// Recenter the whole ball so `a` lands at the origin: x ↦ (−a) ⊕ x.
export const recenterBall = (a: V3, x: V3): V3 => madd(vneg(a), x)

export const radiusForDist = (r: number): number => Math.tanh(r / 2)
export const distFromOrigin = (x: V3): number => 2 * Math.atanh(Math.min(0.999999, vlen(x)))

// Gyro scalar multiply: the point a fraction t along the geodesic ray from the
// origin through v.  t ⊗ v = tanh(t·atanh|v|) · v/|v|.
export function gyroScale(t: number, v: V3): V3 {
  const l = vlen(v)
  if (l < 1e-12) return ZERO
  const r = Math.tanh(t * Math.atanh(Math.min(0.999999, l)))
  return vscale(v, r / l)
}

// A point a fraction t∈[0,1] along the geodesic from x to y:
//   x ⊕ ( t ⊗ ( (−x) ⊕ y ) ).
export function geodesicLerp(x: V3, y: V3, t: number): V3 {
  return madd(x, gyroScale(t, madd(vneg(x), y)))
}

// Sample a geodesic between two ball points into a polyline (for arc rendering).
export function geodesicSamples(x: V3, y: V3, n: number): V3[] {
  const out: V3[] = []
  for (let i = 0; i <= n; i++) out.push(geodesicLerp(x, y, i / n))
  return out
}

// Step out from P by hyperbolic distance `step` along tangent direction `dir`
// (unit): P ⊕ (dir · tanh(step/2)).
export function stepFrom(P: V3, dir: V3, step: number): V3 {
  return madd(P, vscale(vnorm(dir), radiusForDist(step)))
}

// ── Direction sampling on the sphere ─────────────────────────────────────────
// Even spread of k directions over the WHOLE sphere (root children).
export function fibonacciSphere(k: number): V3[] {
  if (k === 1) return [{ x: 0, y: 0, z: 1 }]
  const out: V3[] = []
  const ga = Math.PI * (3 - Math.sqrt(5)) // golden angle
  for (let i = 0; i < k; i++) {
    const y = 1 - (2 * (i + 0.5)) / k // -1..1
    const r = Math.sqrt(Math.max(0, 1 - y * y))
    const t = ga * i
    out.push({ x: Math.cos(t) * r, y, z: Math.sin(t) * r })
  }
  return out
}

// k directions inside a spherical CAP of angular radius `half` around `axis`
// (non-root children — the outgoing cone). Area-uniform rings + golden-angle
// azimuth, in the orthonormal frame around the axis.
export function capDirections(axis: V3, half: number, k: number): V3[] {
  const w = vnorm(axis)
  if (k === 1) return [w]
  // Build a frame (w, u, v).
  const seed = Math.abs(w.z) < 0.9 ? v3(0, 0, 1) : v3(1, 0, 0)
  const u = vnorm(vcross(seed, w))
  const v = vcross(w, u)
  const ga = Math.PI * (3 - Math.sqrt(5))
  const out: V3[] = []
  for (let i = 0; i < k; i++) {
    const frac = (i + 0.5) / k
    const phi = half * Math.sqrt(frac) // polar angle from axis (area-uniform)
    const psi = ga * i
    const cp = Math.cos(phi)
    const sp = Math.sin(phi)
    out.push(vadd(vscale(w, cp), vscale(vadd(vscale(u, Math.cos(psi)), vscale(v, Math.sin(psi))), sp)))
  }
  return out
}
