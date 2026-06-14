import { shaderMaterial } from '@react-three/drei'
import * as THREE from 'three'

// A glowing "beam" for edges. The key trick is the alpha fade at *both* ends
// (vUv.y runs 0→1 along the cylinder's length): edges dissolve into the node
// glow instead of butting hard against the sphere. The near-camera end (the
// ship hovers right over the current node) fades to nothing too, so a wide tube
// can't fill the viewport — which retires the old taper hack.
//
// uFlow > 0 adds a slow shimmer travelling along the tube, used only by the
// handful of semantic "wormhole" edges so structural lanes stay calm.
const BeamMaterial = shaderMaterial(
  { uColor: new THREE.Color('#ffffff'), uOpacity: 0.3, uFlow: 0, uTime: 0, uFadeA: 0.18, uFadeB: 0.18 },
  /* glsl */ `
    varying vec2 vUv;
    varying float vFacing;
    void main() {
      vUv = uv;
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      // How directly this bit of surface faces the camera (1 = head-on,
      // 0 = grazing/silhouette). abs() so the double-sided back faces match.
      vec3 n = normalize(normalMatrix * normal);
      vFacing = abs(dot(n, normalize(-mv.xyz)));
      gl_Position = projectionMatrix * mv;
    }
  `,
  /* glsl */ `
    varying vec2 vUv;
    varying float vFacing;
    uniform vec3 uColor;
    uniform float uOpacity;
    uniform float uFlow;
    uniform float uTime;
    uniform float uFadeA;
    uniform float uFadeB;
    void main() {
      // Dissolve each end into its node glow. uFadeA/uFadeB are sized per node
      // radius so the beam disappears before it reaches the node surface.
      float fade = smoothstep(0.0, uFadeA, vUv.y) * smoothstep(1.0, 1.0 - uFadeB, vUv.y);
      float a = uOpacity * fade;
      if (uFlow > 0.5) {
        a *= 0.6 + 0.4 * sin(vUv.y * 9.0 - uTime * 1.5);
      }
      // Fake cylindrical shading (no lights): bright spine down the middle
      // falling off to the silhouette so the tube reads as round, not flat.
      float round = smoothstep(0.0, 1.0, vFacing);
      a *= mix(0.35, 1.0, round);
      vec3 col = uColor * (0.65 + 0.55 * round);
      if (a < 0.002) discard;
      gl_FragColor = vec4(col, a);
    }
  `,
)

export type BeamMaterialImpl = THREE.ShaderMaterial & {
  uColor: THREE.Color
  uOpacity: number
  uFlow: number
  uTime: number
  uFadeA: number
  uFadeB: number
}

// One instance per edge — same shader program, so no extra GPU cost. uFadeA/B
// are the fraction of each end (source/target) that dissolves into the node
// glow — set per node radius so the beam stops short of the node surface.
export function makeBeamMaterial(
  color: string,
  opacity: number,
  flow: number,
  fadeA = 0.18,
  fadeB = fadeA,
): BeamMaterialImpl {
  const m = new BeamMaterial() as BeamMaterialImpl
  m.uColor = new THREE.Color(color)
  m.uOpacity = opacity
  m.uFlow = flow
  m.uFadeA = fadeA
  m.uFadeB = fadeB
  m.transparent = true
  m.blending = THREE.AdditiveBlending
  m.depthWrite = false
  m.side = THREE.DoubleSide
  m.toneMapped = false
  return m
}
