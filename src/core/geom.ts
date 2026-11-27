import type * as THREE from 'three';

/**
 * Non-indexed copy of a geometry. Three's toNonIndexed() logs a console warning when the geometry
 * has no index (and returns it unchanged); those warnings made every e2e "clean console" check fail.
 * Always returns a new geometry, so callers may mutate the result.
 */
export function flatCopy(g: THREE.BufferGeometry): THREE.BufferGeometry {
  return g.index ? g.toNonIndexed() : g.clone();
}
