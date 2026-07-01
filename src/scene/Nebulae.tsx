import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Billboard, Html } from '@react-three/drei'
import { AdditiveBlending, BackSide, DoubleSide, IcosahedronGeometry, Mesh, MeshBasicMaterial } from 'three'

// A nebula rendered as a volumetric body (Plan H2): a soft translucent glow
// enclosing a group's members, so a field reads as one luminous cloud. The body
// is an organic lumpy BLOB (two-octave noise-displaced icosphere), not a sphere.
// No floating labels — the name lives in the rail inspector (H2b). A FOLDED body
// is denser and clickable to lock/inspect it; the focused/hovered body brightens
// and the focused one gets a lock reticle.
export interface NebulaBody {
  key: string
  label: string
  color: string
  center: [number, number, number]
  radius: number
  count: number
  folded: boolean
  focused: boolean
  hovered: boolean
}

const DETAIL = 4
const AMP = 0.5
const AMP2 = 0.22

function hashSeed(key: string): number {
  let h = 0
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0
  return (Math.abs(h) % 1000) / 7.3
}

function makeBlob(seed: number): IcosahedronGeometry {
  const g = new IcosahedronGeometry(1, DETAIL)
  const p = g.attributes.position
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i)
    const y = p.getY(i)
    const z = p.getZ(i)
    const lump =
      (Math.sin(x * 1.7 + seed) * Math.cos(y * 1.3 - seed * 1.1) +
        Math.sin(y * 2.1 + z * 1.5 + seed * 0.7) +
        Math.sin(z * 1.9 - x * 1.1 + seed * 1.3)) /
      3
    const bump =
      (Math.sin(x * 4.3 + seed * 1.7) + Math.sin(y * 3.7 - seed * 0.9) + Math.sin(z * 4.1 + seed * 0.5)) / 3
    const f = Math.max(0.35, 1 + AMP * lump + AMP2 * bump)
    p.setXYZ(i, x * f, y * f, z * f)
  }
  g.computeVertexNormals()
  return g
}

// A lock-on for a nebula, mirroring the node reticle locks: a camera-facing ring
// that flashes in (big→tight) plus a name pill on a short leader line, anchored
// at the cloud. Shown on hover or focus — instrumentation near the lock, NOT a
// label floating in space.
function NebulaLock({ radius, color, label }: { radius: number; color: string; label: string }) {
  const ref = useRef<Mesh>(null)
  const t = useRef(0)
  useFrame((_, dt) => {
    const m = ref.current
    if (!m) return
    t.current = Math.min(1, t.current + dt / 0.35)
    const e = t.current * t.current * (3 - 2 * t.current)
    const s = radius * (1.5 - 0.5 * e)
    m.scale.set(s, s, s)
    ;(m.material as MeshBasicMaterial).opacity = 0.25 + 0.6 * e
  })
  return (
    <>
      <Billboard>
        <mesh ref={ref} raycast={() => null} renderOrder={999}>
          <ringGeometry args={[0.93, 1.0, 56]} />
          <meshBasicMaterial
            color={color}
            transparent
            depthWrite={false}
            depthTest={false}
            side={DoubleSide}
          />
        </mesh>
      </Billboard>
      {/* Leader line + name pill — same shape as the node tags. */}
      <Html center zIndexRange={[40, 0]} style={{ pointerEvents: 'none' }}>
        <div style={{ position: 'relative' }}>
          <svg width="30" height="26" style={{ position: 'absolute', left: 6, top: -28, overflow: 'visible' }}>
            <line x1="2" y1="24" x2="28" y2="2" stroke={color} strokeOpacity={0.6} strokeWidth={1} />
          </svg>
          <div
            style={{
              position: 'absolute',
              left: 34,
              top: -46,
              whiteSpace: 'nowrap',
              font: '11px/1.7 ui-monospace, SFMono-Regular, Menlo, monospace',
              letterSpacing: 1.2,
              textTransform: 'uppercase',
              color: '#dfeaff',
              background: 'rgba(4, 14, 28, 0.72)',
              border: `1px solid ${color}`,
              borderRadius: 999,
              padding: '1px 10px',
              backdropFilter: 'blur(2px)',
            }}
          >
            {label}
          </div>
        </div>
      </Html>
    </>
  )
}

function NebulaBlob({
  body,
  onSelect,
  onHover,
}: {
  body: NebulaBody
  onSelect: (key: string) => void
  onHover: (key: string | null) => void
}) {
  const geo = useMemo(() => makeBlob(hashSeed(body.key)), [body.key])
  useEffect(() => () => geo.dispose(), [geo])
  const lit = body.focused || body.hovered
  const outerOp = (body.folded ? 0.12 : 0.05) + (lit ? 0.08 : 0)
  const innerOp = (body.folded ? 0.14 : 0.06) + (lit ? 0.08 : 0)
  return (
    <group position={body.center}>
      <mesh geometry={geo} scale={body.radius} raycast={() => null}>
        <meshBasicMaterial
          color={body.color}
          transparent
          opacity={outerOp}
          depthWrite={false}
          blending={AdditiveBlending}
          side={BackSide}
        />
      </mesh>
      <mesh geometry={geo} scale={body.radius * 0.62} raycast={() => null}>
        <meshBasicMaterial
          color={body.color}
          transparent
          opacity={innerOp}
          depthWrite={false}
          blending={AdditiveBlending}
          side={BackSide}
        />
      </mesh>

      {(body.focused || body.hovered) && (
        <NebulaLock radius={body.radius} color={body.color} label={body.label} />
      )}

      {/* Folded clouds are the click/hover targets (members are hidden, so no
          conflict with node picking). A fresh FrontSide hit-sphere takes the
          interaction reliably. */}
      {body.folded && (
        <mesh
          scale={body.radius}
          onClick={(e) => {
            e.stopPropagation()
            onSelect(body.key)
          }}
          onPointerOver={(e) => {
            e.stopPropagation()
            onHover(body.key)
            document.body.style.cursor = 'pointer'
          }}
          onPointerOut={() => {
            onHover(null)
            document.body.style.cursor = 'default'
          }}
        >
          <sphereGeometry args={[1, 16, 16]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
      )}
    </group>
  )
}

export function Nebulae({
  bodies,
  onSelect,
  onHover,
}: {
  bodies: NebulaBody[]
  onSelect: (key: string) => void
  onHover: (key: string | null) => void
}) {
  return (
    <>
      {bodies.map((b) => (
        <NebulaBlob key={b.key} body={b} onSelect={onSelect} onHover={onHover} />
      ))}
    </>
  )
}
