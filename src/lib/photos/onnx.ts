/**
 * Face (YuNet, OpenCV Zoo) and license-plate (YOLOv9-t 640, open-image-models) detection with
 * onnxruntime-web (WebAssembly: no native binaries, so it fits Netlify functions).
 * Models are fetched + verified by scripts/fetch-models.mjs into MODELS_DIR (default ./models).
 *
 * Small faces and distant plates vanish when a 2000px photo is shrunk to 640px, so each photo is
 * run whole and as four overlapping tiles, and the detections are merged. Thresholds are low on
 * purpose: blurring a false positive is harmless; missing a face is not.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import * as ort from "onnxruntime-web";
import type { Box } from "./render";
import type { Detector } from "./detect";

ort.env.wasm.numThreads = 1;

const SIZE = 640;
export const FACE_MODEL = "face_detection_yunet_2023mar.onnx";
export const PLATE_MODEL = "yolo-v9-t-640-license-plates-end2end.onnx";
export const FACE_THRESHOLD = 0.6; // OpenCV's default is 0.9; lower = more recall
export const PLATE_THRESHOLD = 0.25;

const modelsDir = () => path.resolve(process.env.MODELS_DIR ?? "models");

interface PxBox {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  score: number;
}

interface Tile {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Whole frame plus 2x2 tiles with 20% overlap (when the photo is bigger than the model input). */
export function tilesFor(width: number, height: number): Tile[] {
  const tiles: Tile[] = [{ left: 0, top: 0, width, height }];
  if (Math.max(width, height) <= SIZE) return tiles;
  const tw = Math.round(width * 0.6);
  const th = Math.round(height * 0.6);
  for (const [fx, fy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
    tiles.push({ left: fx ? width - tw : 0, top: fy ? height - th : 0, width: tw, height: th });
  }
  return tiles;
}

/**
 * Resize a tile into SIZE x SIZE keeping aspect ratio and pad the rest.
 * Returns HWC RGB bytes plus the transform back to tile pixels.
 */
async function letterbox(img: Buffer, t: Tile, centred: boolean, pad: number) {
  const r = Math.min(SIZE / t.width, SIZE / t.height);
  const w = Math.max(1, Math.round(t.width * r));
  const h = Math.max(1, Math.round(t.height * r));
  const left = centred ? Math.floor((SIZE - w) / 2) : 0;
  const top = centred ? Math.floor((SIZE - h) / 2) : 0;
  const { data } = await sharp(img)
    .extract(t)
    .resize(w, h, { fit: "fill" })
    .removeAlpha()
    .extend({ left, top, right: SIZE - w - left, bottom: SIZE - h - top, background: { r: pad, g: pad, b: pad } })
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { rgb: data, r, left, top };
}

/** HWC uint8 -> NCHW float32, optionally BGR order and/or scaled to 0..1. */
function toTensor(rgb: Buffer, bgr: boolean, scale: number): ort.Tensor {
  const n = SIZE * SIZE;
  const out = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) {
    const R = rgb[i * 3], G = rgb[i * 3 + 1], B = rgb[i * 3 + 2];
    out[i] = (bgr ? B : R) * scale;
    out[n + i] = G * scale;
    out[2 * n + i] = (bgr ? R : B) * scale;
  }
  return new ort.Tensor("float32", out, [1, 3, SIZE, SIZE]);
}

const iou = (a: PxBox, b: PxBox) => {
  const ix = Math.max(0, Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1));
  const iy = Math.max(0, Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1));
  const inter = ix * iy;
  const union = (a.x2 - a.x1) * (a.y2 - a.y1) + (b.x2 - b.x1) * (b.y2 - b.y1) - inter;
  return union > 0 ? inter / union : 0;
};

/** Greedy non-maximum suppression; also drops a box mostly contained in a higher-scoring one. */
export function nms(boxes: PxBox[], threshold = 0.3): PxBox[] {
  const sorted = [...boxes].sort((a, b) => b.score - a.score);
  const kept: PxBox[] = [];
  for (const b of sorted) {
    const area = (b.x2 - b.x1) * (b.y2 - b.y1);
    const overlaps = kept.some((k) => {
      if (iou(k, b) > threshold) return true;
      const ix = Math.max(0, Math.min(k.x2, b.x2) - Math.max(k.x1, b.x1));
      const iy = Math.max(0, Math.min(k.y2, b.y2) - Math.max(k.y1, b.y1));
      return area > 0 && (ix * iy) / area > 0.7;
    });
    if (!overlaps) kept.push(b);
  }
  return kept;
}

/** YuNet 2023mar head decoding (as in OpenCV's FaceDetectorYN). Coordinates in 640-space. */
export function decodeYuNet(out: Record<string, ort.Tensor>, threshold: number): PxBox[] {
  const boxes: PxBox[] = [];
  for (const stride of [8, 16, 32]) {
    const cols = SIZE / stride;
    const cls = out[`cls_${stride}`].data as Float32Array;
    const obj = out[`obj_${stride}`].data as Float32Array;
    const bb = out[`bbox_${stride}`].data as Float32Array;
    for (let idx = 0; idx < cls.length; idx++) {
      const score = Math.sqrt(Math.min(1, Math.max(0, cls[idx])) * Math.min(1, Math.max(0, obj[idx])));
      if (score < threshold) continue;
      const r = Math.floor(idx / cols);
      const c = idx % cols;
      const cx = (c + bb[idx * 4]) * stride;
      const cy = (r + bb[idx * 4 + 1]) * stride;
      const w = Math.exp(bb[idx * 4 + 2]) * stride;
      const h = Math.exp(bb[idx * 4 + 3]) * stride;
      boxes.push({ x1: cx - w / 2, y1: cy - h / 2, x2: cx + w / 2, y2: cy + h / 2, score });
    }
  }
  return boxes;
}

/** open-image-models end2end output: rows of [batch, x1, y1, x2, y2, class, score]. */
export function decodePlates(out: ort.Tensor, threshold: number): PxBox[] {
  const d = out.data as Float32Array;
  const boxes: PxBox[] = [];
  for (let i = 0; i + 6 < d.length; i += 7) {
    if (d[i + 6] >= threshold) boxes.push({ x1: d[i + 1], y1: d[i + 2], x2: d[i + 3], y2: d[i + 4], score: d[i + 6] });
  }
  return boxes;
}

const sessions = new Map<string, Promise<ort.InferenceSession>>();
function session(file: string) {
  if (!sessions.has(file)) {
    sessions.set(file, ort.InferenceSession.create(new Uint8Array(readFileSync(path.join(modelsDir(), file)))));
  }
  return sessions.get(file)!;
}

export async function runTiled(
  img: Buffer,
  width: number,
  height: number,
  run: (rgb: Buffer) => Promise<PxBox[]>,
  centred: boolean,
  pad: number,
): Promise<PxBox[]> {
  const all: PxBox[] = [];
  for (const t of tilesFor(width, height)) {
    const lb = await letterbox(img, t, centred, pad);
    for (const b of await run(lb.rgb)) {
      // 640-space -> tile pixels -> photo pixels
      all.push({
        x1: (b.x1 - lb.left) / lb.r + t.left,
        y1: (b.y1 - lb.top) / lb.r + t.top,
        x2: (b.x2 - lb.left) / lb.r + t.left,
        y2: (b.y2 - lb.top) / lb.r + t.top,
        score: b.score,
      });
    }
  }
  return nms(all);
}

function normalize(b: PxBox, width: number, height: number, kind: "face" | "plate"): Box | null {
  const x1 = Math.max(0, b.x1), y1 = Math.max(0, b.y1);
  const x2 = Math.min(width, b.x2), y2 = Math.min(height, b.y2);
  if (x2 - x1 < 2 || y2 - y1 < 2) return null;
  return { x: x1 / width, y: y1 / height, w: (x2 - x1) / width, h: (y2 - y1) / height, kind, score: Math.round(b.score * 1000) / 1000 };
}

export const faceDetector: Detector = {
  name: "yunet-2023mar",
  async detect(img, width, height) {
    const s = await session(FACE_MODEL);
    const boxes = await runTiled(
      img, width, height,
      async (rgb) => decodeYuNet(await s.run({ input: toTensor(rgb, true, 1) }), FACE_THRESHOLD),
      false, 0, // YuNet: BGR 0..255, image at top-left, zero padding
    );
    return boxes.map((b) => normalize(b, width, height, "face")).filter((b): b is Box => b !== null);
  },
};

export const plateDetector: Detector = {
  name: "yolov9t640-plates",
  async detect(img, width, height) {
    const s = await session(PLATE_MODEL);
    const boxes = await runTiled(
      img, width, height,
      async (rgb) => decodePlates((await s.run({ images: toTensor(rgb, false, 1 / 255) })).output0, PLATE_THRESHOLD),
      true, 114, // YOLOv9: RGB 0..1, centred letterbox padded with grey 114
    );
    return boxes.map((b) => normalize(b, width, height, "plate")).filter((b): b is Box => b !== null);
  },
};

/** Both models present on disk? */
export function modelsAvailable(): boolean {
  return [FACE_MODEL, PLATE_MODEL].every((f) => existsSync(path.join(modelsDir(), f)));
}
