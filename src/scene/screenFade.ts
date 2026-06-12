import * as THREE from 'three'

// Instrumentation can't paint beyond the glass: reticles fade out as their
// node approaches the viewport border (gone at FADE_GONE px, full at
// FADE_FULL px) and come back when it returns. A fade band instead of a
// hard toggle avoids flicker when a node hovers at the threshold.
export const FADE_GONE = 100
export const FADE_FULL = 140

const projected = new THREE.Vector3()
const toPoint = new THREE.Vector3()
const forward = new THREE.Vector3()

// 0 when pos is behind the camera or within FADE_GONE px of the viewport
// border, 1 beyond FADE_FULL px, smoothstepped between.
export function screenEdgeFactor(
  pos: THREE.Vector3,
  camera: THREE.Camera,
  size: { width: number; height: number },
): number {
  camera.getWorldDirection(forward)
  if (forward.dot(toPoint.copy(pos).sub(camera.position)) < 0) return 0
  projected.copy(pos).project(camera)
  const px = (projected.x * 0.5 + 0.5) * size.width
  const py = (-projected.y * 0.5 + 0.5) * size.height
  const edge = Math.min(px, size.width - px, py, size.height - py)
  const t = THREE.MathUtils.clamp((edge - FADE_GONE) / (FADE_FULL - FADE_GONE), 0, 1)
  return t * t * (3 - 2 * t)
}
