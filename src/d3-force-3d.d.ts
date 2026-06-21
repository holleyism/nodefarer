declare module 'd3-force-3d' {
  export function forceSimulation(nodes?: object[], numDimensions?: number): any
  export function forceLink(links?: object[]): any
  export function forceManyBody(): any
  export function forceCenter(x?: number, y?: number, z?: number): any
  export function forceCollide(radius?: number): any
  type Accessor = number | ((d: any, i: number, data: any[]) => number)
  export function forceX(x?: Accessor): any
  export function forceY(y?: Accessor): any
  export function forceZ(z?: Accessor): any
}
