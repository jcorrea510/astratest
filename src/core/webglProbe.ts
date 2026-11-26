/** Capability probe for WebGL2. The probe context is released at once: browsers cap live contexts per page
 *  (and per headless browser in the e2e suite), so a leaked probe context competes with the renderer's own. */
export function probeWebgl2(makeCanvas: () => { getContext(id: string): unknown } = () => document.createElement('canvas')): boolean {
  try {
    const gl = makeCanvas().getContext('webgl2') as { getExtension(n: string): { loseContext(): void } | null } | null;
    if (!gl) return false;
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch { return false; }
}
