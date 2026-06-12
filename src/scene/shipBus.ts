import * as THREE from 'three'

// The ship's live pose, written by ShipCamera every frame and read by HUD
// instruments (radar) that render in their own canvas. A mutable singleton
// keeps the 60fps pose out of React state.
export const shipBus = {
  position: new THREE.Vector3(),
  quaternion: new THREE.Quaternion(),
}

// Live reticle visibility (screen-edge fade factor, 0..1) per node id,
// written by each mounted Reticle every frame. Lets the radar highlight
// only nodes that actually have a reticle on the glass right now —
// membership in the tag set alone isn't enough (faded ≠ locked).
export const reticleVisibility = new Map<string, number>()
