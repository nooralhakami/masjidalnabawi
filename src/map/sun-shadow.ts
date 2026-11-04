/**
 * The sun's shadow map of the 3D view, shared by the layers that cast or receive it: the Mosque's
 * models render their depth as the sun sees them (`glb-layer.ts`), and the models themselves and the
 * plazas' floor (`plaza-layer.ts`) look it up. Everything is in the models' metres (X east, Y up,
 * Z south). The scene is still, so the map is drawn again only when the sun moves (once a minute)
 * or a file arrives, never per frame.
 */

/** Texels on a side: about 0.6 m each over the Haram and its plazas. */
export const SHADOW_SIZE = 2048;

/** The Haram and all its plazas, round which the sun's view is framed (models' metres). */
const CENTRE: [number, number, number] = [-240, 0, -160];
const HALF = 620;
const DISTANCE = 1500;

export interface SunShadow {
  /** Depth texture with comparison on, or null until the models' layer creates it. */
  texture: WebGLTexture | null;
  /** From the models' metres to the shadow map's clip space. */
  matrix: Float32Array;
  /** 0 at night (no sun, no shadows) to 1 in full sun. */
  strength: number;
}

export const sunShadow: SunShadow = { texture: null, matrix: new Float32Array(16), strength: 0 };

/** The sun's view and projection of the scene, column-major (`clip = matrix × world`). */
export function sunMatrix([dx, dy, dz]: readonly [number, number, number]): Float64Array {
  const len = Math.hypot(dx, dy, dz) || 1;
  const dir = [dx / len, dy / len, dz / len];
  const eye = [CENTRE[0] + dir[0] * DISTANCE, CENTRE[1] + dir[1] * DISTANCE, CENTRE[2] + dir[2] * DISTANCE];
  // Looking from the sun to the centre; "up" is north unless the sun stands nearly overhead.
  const f = [-dir[0], -dir[1], -dir[2]];
  const up = Math.abs(dir[1]) > 0.99 ? [0, 0, -1] : [0, 1, 0];
  let s = [f[1] * up[2] - f[2] * up[1], f[2] * up[0] - f[0] * up[2], f[0] * up[1] - f[1] * up[0]];
  const sl = Math.hypot(s[0], s[1], s[2]);
  s = [s[0] / sl, s[1] / sl, s[2] / sl];
  const u = [s[1] * f[2] - s[2] * f[1], s[2] * f[0] - s[0] * f[2], s[0] * f[1] - s[1] * f[0]];
  const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const view = [s[0], u[0], -f[0], 0, s[1], u[1], -f[1], 0, s[2], u[2], -f[2], 0, -dot(s, eye), -dot(u, eye), dot(f, eye), 1];
  const near = DISTANCE - 1200;
  const far = DISTANCE + 1200;
  const proj = [1 / HALF, 0, 0, 0, 0, 1 / HALF, 0, 0, 0, 0, -2 / (far - near), 0, 0, 0, -(far + near) / (far - near), 1];
  const out = new Float64Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      out[c * 4 + r] = proj[r] * view[c * 4] + proj[4 + r] * view[c * 4 + 1] + proj[8 + r] * view[c * 4 + 2] + proj[12 + r] * view[c * 4 + 3];
    }
  }
  return out;
}

/** A depth texture that a `sampler2DShadow` can read (comparison on, filtered for soft edges). */
export function createShadowTexture(gl: WebGL2RenderingContext, size: number): WebGLTexture {
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT24, size, size);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
  return tex;
}

/**
 * GLSL for a receiver: `sunLit(shadowPos, bias)` is 1 in sunlight and 0 in shadow, softened over a
 * few texels, and 1 outside the map. Needs `uniform highp sampler2DShadow u_shadowMap;`.
 */
export const SHADOW_GLSL = `
float sunLit(vec4 shadowPos, float bias) {
  vec3 c = shadowPos.xyz / shadowPos.w * 0.5 + 0.5;
  if (c.x <= 0.0 || c.x >= 1.0 || c.y <= 0.0 || c.y >= 1.0 || c.z >= 1.0) return 1.0;
  float t = 1.0 / ${SHADOW_SIZE.toFixed(1)};
  float sum = 0.0;
  for (int i = -1; i <= 1; i++) {
    for (int j = -1; j <= 1; j++) sum += texture(u_shadowMap, vec3(c.xy + vec2(float(i), float(j)) * t * 1.2, c.z - bias));
  }
  return sum / 9.0;
}
`;
