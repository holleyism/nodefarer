import { useMemo, useRef } from 'react'
import { Box, Typography } from '@mui/material'
import { Canvas, useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { GraphNode } from '../types'
import { shipBus } from '../scene/shipBus'
import { BAR_HEIGHT } from './BottomBar'

const HUD = '#7fd4ff'
const MONO = '10px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace'

const invQuat = new THREE.Quaternion()
const dir = new THREE.Vector3()

// Blips ride the unit sphere: each target's world direction from the ship,
// rotated into view space. Ahead = front of the sphere (toward the viewer),
// behind = far side, dimmed. Positions update per frame from shipBus without
// touching React. Reticle-locked targets render bigger, whiter, and resist
// the depth dimming — the instruments agree on what's locked.
function Blips({ targets, lockedIds }: { targets: GraphNode[]; lockedIds: string[] }) {
  const group = useRef<THREE.Group>(null)
  const blipGeo = useMemo(() => new THREE.SphereGeometry(0.06, 8, 8), [])
  const locked = useMemo(() => new Set(lockedIds), [lockedIds])

  useFrame(() => {
    const g = group.current
    if (!g) return
    invQuat.copy(shipBus.quaternion).invert()
    targets.forEach((node, i) => {
      const mesh = g.children[i] as THREE.Mesh | undefined
      if (!mesh) return
      dir
        .set(node.x!, node.y!, node.z!)
        .sub(shipBus.position)
        .normalize()
        .applyQuaternion(invQuat)
      // Camera space looks down -Z; flip so "ahead" faces the radar viewer.
      mesh.position.set(dir.x, dir.y, -dir.z)
      const mat = mesh.material as THREE.MeshBasicMaterial
      const depth = 0.3 + 0.7 * ((mesh.position.z + 1) / 2)
      mat.opacity = locked.has(node.id) ? Math.max(depth, 0.85) : depth
    })
  })

  return (
    <group ref={group}>
      {targets.map((t) => {
        const isLocked = locked.has(t.id)
        return (
          <mesh key={t.id} geometry={blipGeo} scale={isLocked ? 1.5 : 1}>
            <meshBasicMaterial color={isLocked ? '#e8f7ff' : HUD} transparent />
          </mesh>
        )
      })}
    </group>
  )
}

interface Props {
  label: string
  targets: GraphNode[]
  lockedIds: string[]
}

// The radar: a sphere of nearby space drawn by the window, bottom right.
// Not an input device — purely instrumentation. `targets` is whatever the
// active radar source emits (immediate neighbors today; search results,
// clusters, semantic matches later).
export function Radar({ label, targets, lockedIds }: Props) {
  return (
    <Box
      sx={{
        position: 'absolute',
        right: 28,
        bottom: BAR_HEIGHT + 16,
        width: 150,
        pointerEvents: 'none',
        textAlign: 'center',
      }}
    >
      <Box
        sx={{
          width: 150,
          height: 150,
          borderRadius: '50%',
          border: '1px solid rgba(127, 212, 255, 0.3)',
          bgcolor: 'rgba(4, 14, 28, 0.55)',
          backdropFilter: 'blur(3px)',
          overflow: 'hidden',
        }}
      >
        <Canvas
          camera={{ position: [0, 0.85, 2.45], fov: 42 }}
          gl={{ alpha: true, antialias: true }}
          onCreated={({ camera }) => camera.lookAt(0, 0, 0)}
        >
          {/* sphere shell */}
          <mesh>
            <sphereGeometry args={[1, 24, 16]} />
            <meshBasicMaterial color={HUD} wireframe transparent opacity={0.08} />
          </mesh>
          {/* equator ring */}
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[1, 0.006, 6, 64]} />
            <meshBasicMaterial color={HUD} transparent opacity={0.35} />
          </mesh>
          {/* boresight: where the ship is pointing */}
          <mesh position={[0, 0, 1]}>
            <sphereGeometry args={[0.035, 8, 8]} />
            <meshBasicMaterial color="#ffffff" transparent opacity={0.9} />
          </mesh>
          <Blips targets={targets} lockedIds={lockedIds} />
        </Canvas>
      </Box>
      <Typography sx={{ font: MONO, letterSpacing: 1.5, color: 'text.secondary', mt: 0.5 }}>
        {label} · {targets.length}
      </Typography>
    </Box>
  )
}
