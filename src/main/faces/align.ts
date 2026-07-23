/**
 * Face alignment onto the canonical ArcFace template.
 *
 * Every InsightFace recognition model — w600k_mbf, w600k_r50, all of them — is
 * trained on 112x112 crops produced by warping the five detected landmarks onto
 * a fixed template. Feeding it an axis-aligned box instead (which ignores head
 * roll, and distorts the aspect ratio if it is squashed to a square) hands the
 * model a face unlike anything in its training distribution, and the embedding
 * it returns is correspondingly unreliable. This step is worth more accuracy
 * than the choice of model.
 *
 * The warp is done here by explicit inverse mapping rather than through an
 * imaging library's affine operator: two earlier attempts failed on library
 * conventions rather than on the maths — sharp's `.affine()` places the output
 * origin at the transformed bounding box (extracting at 0,0 renders pure
 * black), and a rotate-then-extract decomposition has to agree with sharp's
 * rotation direction to frame the crop correctly. Sampling each output pixel
 * directly has no conventions to get wrong and is trivially verifiable.
 */

export const ALIGN_SIZE = 112

/** Left eye, right eye, nose tip, left mouth corner, right mouth corner. */
export const ARCFACE_TEMPLATE: Array<[number, number]> = [
  [38.2946, 51.6963],
  [73.5318, 51.5014],
  [56.0252, 71.7366],
  [41.5493, 92.3655],
  [70.7299, 92.2041]
]

/** out = [[a, -b], [b, a]] . p + [tx, ty] */
export interface Similarity {
  a: number
  b: number
  tx: number
  ty: number
}

/**
 * Least-squares similarity transform (uniform scale + rotation + translation)
 * carrying the detected landmarks onto the template.
 *
 * Solved in complex form: with a_i and b_i the mean-centred source and target
 * points, the optimal multiplier is w = sum(conj(a_i) * b_i) / sum(|a_i|^2),
 * whose real and imaginary parts give scale*cos and scale*sin directly.
 */
export function similarityTransform(src: Array<[number, number]>): Similarity {
  const n = src.length
  let sx = 0
  let sy = 0
  let dx = 0
  let dy = 0
  for (let i = 0; i < n; i++) {
    sx += src[i][0]
    sy += src[i][1]
    dx += ARCFACE_TEMPLATE[i][0]
    dy += ARCFACE_TEMPLATE[i][1]
  }
  sx /= n
  sy /= n
  dx /= n
  dy /= n

  // real = sum(ax*bx + ay*by), imag = sum(ax*by - ay*bx)
  let real = 0
  let imag = 0
  let srcVar = 0
  for (let i = 0; i < n; i++) {
    const ax = src[i][0] - sx
    const ay = src[i][1] - sy
    const bx = ARCFACE_TEMPLATE[i][0] - dx
    const by = ARCFACE_TEMPLATE[i][1] - dy
    real += ax * bx + ay * by
    imag += ax * by - ay * bx
    srcVar += ax * ax + ay * ay
  }

  if (srcVar <= 0) return { a: 1, b: 0, tx: dx - sx, ty: dy - sy }

  const a = real / srcVar
  const b = imag / srcVar
  return { a, b, tx: dx - (a * sx - b * sy), ty: dy - (b * sx + a * sy) }
}

/**
 * Warp an RGB image onto the template, returning a tightly packed
 * ALIGN_SIZE*ALIGN_SIZE*3 buffer.
 *
 * Inverse mapping: for each output pixel, find where it came from in the
 * source and sample bilinearly. M = [[a,-b],[b,a]] has determinant a^2+b^2,
 * so its inverse is [[a,b],[-b,a]] / (a^2+b^2).
 */
export function warpToTemplate(
  src: Buffer | Uint8Array,
  srcW: number,
  srcH: number,
  channels: number,
  m: Similarity
): Uint8Array {
  const out = new Uint8Array(ALIGN_SIZE * ALIGN_SIZE * 3)
  const det = m.a * m.a + m.b * m.b
  if (det <= 0) return out
  const ia = m.a / det
  const ib = m.b / det

  for (let v = 0; v < ALIGN_SIZE; v++) {
    const oy = v + 0.5 - m.ty
    for (let u = 0; u < ALIGN_SIZE; u++) {
      const ox = u + 0.5 - m.tx
      const px = ia * ox + ib * oy - 0.5
      const py = -ib * ox + ia * oy - 0.5

      const o = (v * ALIGN_SIZE + u) * 3
      if (px < 0 || py < 0 || px > srcW - 1 || py > srcH - 1) continue

      const x0 = Math.floor(px)
      const y0 = Math.floor(py)
      const x1 = Math.min(x0 + 1, srcW - 1)
      const y1 = Math.min(y0 + 1, srcH - 1)
      const fx = px - x0
      const fy = py - y0

      const i00 = (y0 * srcW + x0) * channels
      const i10 = (y0 * srcW + x1) * channels
      const i01 = (y1 * srcW + x0) * channels
      const i11 = (y1 * srcW + x1) * channels

      for (let c = 0; c < 3; c++) {
        const top = src[i00 + c] * (1 - fx) + src[i10 + c] * fx
        const bot = src[i01 + c] * (1 - fx) + src[i11 + c] * fx
        out[o + c] = top * (1 - fy) + bot * fy
      }
    }
  }
  return out
}
