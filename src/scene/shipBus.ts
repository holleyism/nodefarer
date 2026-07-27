import * as THREE from 'three'

// The ship's live pose, written by ShipCamera every frame and read by HUD
// instruments (radar) that render in their own canvas. A mutable singleton
// keeps the 60fps pose out of React state.
export const shipBus = {
  position: new THREE.Vector3(),
  quaternion: new THREE.Quaternion(),
  // Lens, so readers outside the canvas can work out what's actually in frame.
  fov: 60, // vertical, degrees
  aspect: 1,
}

// The ship's live forward axis (unit). Together with `position`/`fov` this is
// enough to answer "is that thing on screen right now?" from outside the canvas —
// the demo script uses it to lock onto the nebula the viewer is looking at.
const FWD = new THREE.Vector3()
export function shipForward(): [number, number, number] {
  FWD.set(0, 0, -1).applyQuaternion(shipBus.quaternion)
  return [FWD.x, FWD.y, FWD.z]
}

// Live reticle visibility (screen-edge fade factor, 0..1) per node id,
// written by each mounted Reticle every frame. Lets the radar highlight
// only nodes that actually have a reticle on the glass right now —
// membership in the tag set alone isn't enough (faded ≠ locked).
export const reticleVisibility = new Map<string, number>()
