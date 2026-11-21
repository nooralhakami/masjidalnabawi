/**
 * Shared 12-bone human skeleton and 9 baked animation clips (16 frames each) in the pure domain
 * layer, packed into an RGBA32F data texture for single-pass GPU vertex skinning (`texelFetch`).
 *
 * Coordinate space matches `crowd-layer.ts`: +X forward, +Y up (`0..1.75 m` rest height), +Z right.
 * Every bone has zero rest rotation (`invBind` is pure `-BONE_REST_POS[b]`), so rotation around
 * `+Z` pitches limbs forward/back: negative `rz` bends an upward torso forward toward `+X`; positive
 * `rz` swings a downward limb forward toward `+X`.
 */

export const BONE_COUNT = 12;
export const CLIP_COUNT = 9;
export const FRAMES_PER_CLIP = 16;

export const CROWD_CLIP = {
  stand: 0,
  walk: 1,
  takbir: 2,
  ruku: 3,
  sujud: 4,
  juloos: 5,
  quran_sitting: 6,
  dua: 7,
  carrying: 8,
} as const;

export type CrowdClipName = keyof typeof CROWD_CLIP;

export const BONE_NAMES = [
  'pelvis',
  'spine_low',
  'spine_high',
  'head',
  'arm_l_upper',
  'arm_l_lower',
  'arm_r_upper',
  'arm_r_lower',
  'leg_l_upper',
  'leg_l_lower',
  'leg_r_upper',
  'leg_r_lower',
] as const;

/** Parent index for each bone (`-1` for pelvis root), guaranteed parent < child for single-pass FK. */
export const BONE_PARENT = [-1, 0, 1, 2, 2, 4, 2, 6, 0, 8, 0, 10] as const;

/** World rest joint pivots at `1.75 m` nominal figure height (`+X` forward, `+Y` up, `+Z` right). */
export const BONE_REST_POS: readonly (readonly [number, number, number])[] = [
  [0.0, 0.92, 0.0], // 0 pelvis
  [0.0, 1.06, 0.0], // 1 spine_low
  [0.0, 1.32, 0.0], // 2 spine_high
  [0.0, 1.5, 0.0], // 3 head
  [0.0, 1.38, -0.2], // 4 arm_l_upper
  [0.0, 1.12, -0.22], // 5 arm_l_lower
  [0.0, 1.38, 0.2], // 6 arm_r_upper
  [0.0, 1.12, 0.22], // 7 arm_r_lower
  [0.0, 0.88, -0.085], // 8 leg_l_upper
  [0.0, 0.46, -0.085], // 9 leg_l_lower
  [0.0, 0.88, 0.085], // 10 leg_r_upper
  [0.0, 0.46, 0.085], // 11 leg_r_lower
];

/** Per-bone local euler angles `[rx, ry, rz]` + optional root pelvis translation `[tx, ty, tz]`. */
interface FramePose {
  rootT: [number, number, number];
  rot: [number, number, number][];
}

function emptyPose(): FramePose {
  return {
    rootT: [0, 0, 0],
    rot: Array.from({ length: BONE_COUNT }, () => [0, 0, 0]),
  };
}

function clipPose(clip: number, frame: number): FramePose {
  const p = emptyPose();
  const phase = (frame / FRAMES_PER_CLIP) * Math.PI * 2;
  const s = Math.sin(phase);
  const c = Math.cos(phase);

  switch (clip) {
    case CROWD_CLIP.stand: {
      // Serene standing with gentle chest breathing
      p.rot[2][2] = -0.02 + 0.012 * s;
      p.rot[4][2] = 0.03;
      p.rot[5][2] = 0.06;
      p.rot[6][2] = 0.03;
      p.rot[7][2] = 0.06;
      break;
    }

    case CROWD_CLIP.walk: {
      // Natural dignified courtyard walking cycle (arms & legs alternate in phase)
      p.rootT[1] = 0.02 * Math.abs(c);
      p.rot[0][1] = 0.04 * s;
      p.rot[2][2] = -0.04;
      p.rot[8][2] = 0.36 * s; // left thigh
      p.rot[9][2] = -0.34 * Math.max(0, -s); // left knee flexes cleanly backward
      p.rot[10][2] = -0.36 * s; // right thigh
      p.rot[11][2] = -0.34 * Math.max(0, s); // right knee flexes cleanly backward
      p.rot[4][2] = -0.3 * s; // left arm counter-swing
      p.rot[5][2] = 0.16 + 0.1 * Math.max(0, -s);
      p.rot[6][2] = 0.3 * s; // right arm counter-swing
      p.rot[7][2] = 0.16 + 0.1 * Math.max(0, s);
      break;
    }

    case CROWD_CLIP.takbir: {
      // Raise hands softly beside ears/shoulders (first half) then place peacefully on chest
      const raise = 0.5 - 0.5 * c;
      p.rot[4][2] = 1.65 * raise;
      p.rot[4][0] = 0.16 * raise;
      p.rot[5][2] = 1.35 * raise;
      p.rot[5][1] = -0.35 * raise;
      p.rot[6][2] = 1.65 * raise;
      p.rot[6][0] = -0.16 * raise;
      p.rot[7][2] = 1.35 * raise;
      p.rot[7][1] = 0.35 * raise;
      break;
    }

    case CROWD_CLIP.ruku: {
      // Respectful ~85-deg bow from the waist with arms hanging down toward the knees
      p.rootT[1] = -0.03;
      p.rot[0][2] = -0.78;
      p.rot[1][2] = -0.45;
      p.rot[2][2] = -0.25 + 0.01 * s; // total torso pitch ≈ -1.48 rad (~85 deg)
      p.rot[3][2] = 0.12;
      p.rot[4][2] = 1.42;
      p.rot[5][2] = -0.08;
      p.rot[6][2] = 1.42;
      p.rot[7][2] = -0.08;
      p.rot[8][2] = 0.78; // thighs stay upright
      p.rot[10][2] = 0.78;
      break;
    }

    case CROWD_CLIP.sujud: {
      // Forehead, palms and knees grounded in prostration (raised hips, vertical thighs, shins flat)
      p.rootT[0] = -0.04;
      p.rootT[1] = -0.49; // pelvis ≈ 0.43 m so vertical thighs place knees cleanly near y ≈ 0.04 m
      p.rot[0][2] = -1.78;
      p.rot[1][2] = -0.15;
      p.rot[2][2] = -0.08 + 0.008 * s; // straight sloped back (~ -2.01 rad / 115 deg)
      p.rot[3][2] = -0.05;
      p.rot[4][2] = 1.25;
      p.rot[5][2] = 0.55;
      p.rot[6][2] = 1.25;
      p.rot[7][2] = 0.55;
      p.rot[8][2] = 1.78; // counteract pelvis pitch so thighs descend vertically to knees
      p.rot[9][2] = -1.58; // shins tucked flat backward on prayer carpet
      p.rot[10][2] = 1.78;
      p.rot[11][2] = -1.58;
      break;
    }

    case CROWD_CLIP.juloos: {
      // Sitting serenely between prostrations / Tashahhud with hands resting on thighs
      p.rootT[1] = -0.54; // pelvis ≈ 0.38 m
      p.rot[0][2] = -0.04;
      p.rot[2][2] = -0.03 + 0.01 * s;
      p.rot[4][2] = 0.25;
      p.rot[5][2] = 0.92;
      p.rot[6][2] = 0.25;
      p.rot[7][2] = 0.92;
      p.rot[8][2] = 1.48; // thighs extend horizontal forward (+X)
      p.rot[9][2] = -2.92; // lower legs folded underneath
      p.rot[10][2] = 1.48;
      p.rot[11][2] = -2.92;
      break;
    }

    case CROWD_CLIP.quran_sitting: {
      // Seated leaning gently toward the wooden rehal reading the Mushaf
      p.rootT[1] = -0.54;
      p.rot[0][2] = -0.14;
      p.rot[1][2] = -0.08;
      p.rot[2][2] = -0.06 + 0.012 * s;
      p.rot[3][2] = -0.18;
      p.rot[4][2] = 0.58;
      p.rot[5][2] = 0.85;
      p.rot[5][1] = -0.22;
      p.rot[6][2] = 0.58;
      p.rot[7][2] = 0.85;
      p.rot[7][1] = 0.22;
      p.rot[8][2] = 1.48;
      p.rot[9][2] = -2.92;
      p.rot[10][2] = 1.48;
      p.rot[11][2] = -2.92;
      break;
    }

    case CROWD_CLIP.dua: {
      // Standing supplication: forearms raised calmly before the upper chest with subtle breathing sway
      p.rot[2][2] = -0.04 + 0.015 * s;
      p.rot[3][2] = -0.06;
      p.rot[4][2] = 0.34;
      p.rot[5][2] = 1.52 + 0.04 * s;
      p.rot[5][1] = -0.24;
      p.rot[6][2] = 0.34;
      p.rot[7][2] = 1.52 + 0.04 * s;
      p.rot[7][1] = 0.24;
      break;
    }

    case CROWD_CLIP.carrying: {
      // Funeral bier bearers / wheelchair pushers: walking gait with arms raised to shoulder height
      p.rootT[1] = 0.015 * Math.abs(c);
      p.rot[2][2] = -0.05;
      p.rot[8][2] = 0.3 * s;
      p.rot[9][2] = -0.28 * Math.max(0, -s);
      p.rot[10][2] = -0.3 * s;
      p.rot[11][2] = -0.28 * Math.max(0, s);
      p.rot[4][2] = 1.25;
      p.rot[5][2] = 0.25;
      p.rot[6][2] = 1.25;
      p.rot[7][2] = 0.25;
      break;
    }
  }

  return p;
}

/** Build a 4x4 column-major affine matrix from Euler XYZ angles `[rx, ry, rz]` + translation `[tx, ty, tz]`. */
function localMatrix(tx: number, ty: number, tz: number, rx: number, ry: number, rz: number): Float32Array {
  const cx = Math.cos(rx);
  const sx = Math.sin(rx);
  const cy = Math.cos(ry);
  const sy = Math.sin(ry);
  const cz = Math.cos(rz);
  const sz = Math.sin(rz);

  // R = Rz * Ry * Rx
  return new Float32Array([
    cy * cz,
    cy * sz,
    -sy,
    0,
    cz * sx * sy - cx * sz,
    cx * cz + sx * sy * sz,
    cy * sx,
    0,
    cx * cz * sy + sx * sz,
    -cz * sx + cx * sy * sz,
    cx * cy,
    0,
    tx,
    ty,
    tz,
    1,
  ]);
}

function mul4(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(16);
  for (let col = 0; col < 4; col++) {
    const b0 = b[col * 4];
    const b1 = b[col * 4 + 1];
    const b2 = b[col * 4 + 2];
    const b3 = b[col * 4 + 3];
    out[col * 4] = a[0] * b0 + a[4] * b1 + a[8] * b2 + a[12] * b3;
    out[col * 4 + 1] = a[1] * b0 + a[5] * b1 + a[9] * b2 + a[13] * b3;
    out[col * 4 + 2] = a[2] * b0 + a[6] * b1 + a[10] * b2 + a[14] * b3;
    out[col * 4 + 3] = a[3] * b0 + a[7] * b1 + a[11] * b2 + a[15] * b3;
  }
  return out;
}

export interface BoneAnimationTexture {
  width: number;
  height: number;
  data: Float32Array;
}

/**
 * Precomputes skinning matrices (`worldMat * invBindMat`) for every clip and frame into a `36 × 144`
 * RGBA32F pixel buffer (3 texels wide per bone: rows 0..2 of a 3×4 transform matrix).
 */
export function buildBoneAnimationTexture(): BoneAnimationTexture {
  const width = BONE_COUNT * 3; // 36 texels
  const height = CLIP_COUNT * FRAMES_PER_CLIP; // 144 rows
  const data = new Float32Array(width * height * 4);

  const world: Float32Array[] = Array.from({ length: BONE_COUNT }, () => new Float32Array(16));

  for (let clip = 0; clip < CLIP_COUNT; clip++) {
    for (let frame = 0; frame < FRAMES_PER_CLIP; frame++) {
      const pose = clipPose(clip, frame);
      const rowY = clip * FRAMES_PER_CLIP + frame;

      for (let b = 0; b < BONE_COUNT; b++) {
        const parent = BONE_PARENT[b];
        const rest = BONE_REST_POS[b];
        const pRest = parent >= 0 ? BONE_REST_POS[parent] : [0, 0, 0];
        const [rx, ry, rz] = pose.rot[b];
        const tx = rest[0] - pRest[0] + (b === 0 ? pose.rootT[0] : 0);
        const ty = rest[1] - pRest[1] + (b === 0 ? pose.rootT[1] : 0);
        const tz = rest[2] - pRest[2] + (b === 0 ? pose.rootT[2] : 0);
        const loc = localMatrix(tx, ty, tz, rx, ry, rz);
        world[b] = parent >= 0 ? mul4(world[parent], loc) : loc;

        // Apply inverse bind translation `-rest` on top of world transform
        const m = world[b];
        const skinTx = m[12] - m[0] * rest[0] - m[4] * rest[1] - m[8] * rest[2];
        const skinTy = m[13] - m[1] * rest[0] - m[5] * rest[1] - m[9] * rest[2];
        const skinTz = m[14] - m[2] * rest[0] - m[6] * rest[1] - m[10] * rest[2];

        // Pack 3 affine matrix rows (vec4 each) into texels `(b*3 + r, rowY)`
        const base = (rowY * width + b * 3) * 4;
        data[base] = m[0];
        data[base + 1] = m[4];
        data[base + 2] = m[8];
        data[base + 3] = skinTx;

        data[base + 4] = m[1];
        data[base + 5] = m[5];
        data[base + 6] = m[9];
        data[base + 7] = skinTy;

        data[base + 8] = m[2];
        data[base + 9] = m[6];
        data[base + 10] = m[10];
        data[base + 11] = skinTz;
      }
    }
  }

  return { width, height, data };
}

/**
 * Evaluates a bind-pose point `[x, y, z]` deformed strictly by `boneIdx` at `(clip, frame)`
 * for unit verification of posture joint positions without WebGL.
 */
export function sampleBonePosition(tex: BoneAnimationTexture, clip: number, frame: number, boneIdx: number, restPos: readonly [number, number, number]): [number, number, number] {
  const rowY = clip * FRAMES_PER_CLIP + (((frame % FRAMES_PER_CLIP) + FRAMES_PER_CLIP) % FRAMES_PER_CLIP);
  const base = (rowY * tex.width + boneIdx * 3) * 4;
  const x = tex.data[base] * restPos[0] + tex.data[base + 1] * restPos[1] + tex.data[base + 2] * restPos[2] + tex.data[base + 3];
  const y = tex.data[base + 4] * restPos[0] + tex.data[base + 5] * restPos[1] + tex.data[base + 6] * restPos[2] + tex.data[base + 7];
  const z = tex.data[base + 8] * restPos[0] + tex.data[base + 9] * restPos[1] + tex.data[base + 10] * restPos[2] + tex.data[base + 11];
  return [x, y, z];
}
