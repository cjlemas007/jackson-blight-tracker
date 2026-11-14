import sharp, { type OverlayOptions } from "sharp";

/** Normalized box (0..1) in the upright (orientation-corrected) image. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
  kind?: "face" | "plate" | "manual";
  score?: number;
}

export const MAX_EDGE = 2000;
export const ACCEPTED_FORMATS = new Set(["jpeg", "png", "webp"]);

/** Upright, size-capped pixels (still carrying no metadata of their own beyond what sharp keeps in memory). */
export async function upright(original: Buffer): Promise<{ buf: Buffer; width: number; height: number; format: string }> {
  const meta = await sharp(original).metadata();
  if (!meta.format || !ACCEPTED_FORMATS.has(meta.format)) {
    throw new Error(`unsupported image format: ${meta.format ?? "unknown"} (use JPEG, PNG or WebP)`);
  }
  const { data, info } = await sharp(original)
    .rotate() // apply EXIF orientation before it's stripped
    .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: "inside", withoutEnlargement: true })
    .toBuffer({ resolveWithObject: true });
  return { buf: data, width: info.width, height: info.height, format: meta.format };
}

export function clampBox(b: Box): Box | null {
  const x = Math.max(0, Math.min(1, b.x));
  const y = Math.max(0, Math.min(1, b.y));
  const w = Math.max(0, Math.min(1 - x, b.w));
  const h = Math.max(0, Math.min(1 - y, b.h));
  return w > 0.002 && h > 0.002 ? { ...b, x, y, w, h } : null;
}

/**
 * Publishable copy: upright, capped at MAX_EDGE, every box pixelated then blurred (not
 * reversible), JPEG with ALL metadata dropped (sharp writes none unless asked).
 */
export async function renderPublic(original: Buffer, boxes: Box[]): Promise<{ buffer: Buffer; width: number; height: number }> {
  const { buf, width, height } = await upright(original);
  const composites: OverlayOptions[] = [];
  for (const raw of boxes) {
    const b = clampBox(raw);
    if (!b) continue;
    // 15% padding so edges of a face or plate aren't left sharp.
    const pad = 0.15;
    const left = Math.max(0, Math.floor((b.x - b.w * pad) * width));
    const top = Math.max(0, Math.floor((b.y - b.h * pad) * height));
    const right = Math.min(width, Math.ceil((b.x + b.w * (1 + pad)) * width));
    const bottom = Math.min(height, Math.ceil((b.y + b.h * (1 + pad)) * height));
    const w = right - left;
    const h = bottom - top;
    if (w < 2 || h < 2) continue;
    const block = Math.max(4, Math.round(Math.max(w, h) / 10));
    const tile = await sharp(buf)
      .extract({ left, top, width: w, height: h })
      .resize(Math.max(1, Math.round(w / block)), Math.max(1, Math.round(h / block)), { kernel: "nearest" })
      .resize(w, h, { kernel: "nearest" })
      .blur(Math.max(2, block / 2))
      .toBuffer();
    composites.push({ input: tile, left, top });
  }
  const out = await sharp(buf).composite(composites).jpeg({ quality: 82, mozjpeg: true }).toBuffer();
  return { buffer: out, width, height };
}
