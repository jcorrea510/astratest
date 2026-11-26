/**
 * Person shader, FACE: faceDetail() refines the skin of the head (ri == 0) after skin.ts has coloured it (lips, cheeks,
 * nose, brows, eye sockets, ears; vHn = head-space position: x right, y up (0 at brow, ~-1 at chin), z forward).
 * EYES_GLSL is part 9 (eyeballs): write col / rough / flatN. FACE_PARS goes in the fragment header.
 */
export const FACE_PARS = /* glsl */ `void faceDetail(inout vec3 col, inout float rough, vec3 hn, vec3 atlas) { }
`;

export const EYES_GLSL = /* glsl */ `col = tx.rgb; rough = 0.12; flatN = 0.0;
`;
