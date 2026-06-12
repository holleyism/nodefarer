import * as THREE from 'three'

// The ship's live pose, written by ShipCamera every frame and read by HUD
// instruments (radar) that render in their own canvas. A mutable singleton
// keeps the 60fps pose out of React state.
export const shipBus = {
  position: new THREE.Vector3(),
  quaternion: new THREE.Quaternion(),
}
