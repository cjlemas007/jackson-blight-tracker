import type { Box } from "./render";

export interface Detection {
  detector: string; // model name(s), or "unavailable"
  boxes: Box[];
}

/**
 * Face + license-plate detection. The ONNX detectors (src/lib/photos/onnx.ts) register
 * themselves on first use when their model files are on disk (`npm run models`). Without
 * them this reports "unavailable", and the review screen tells admins to box everything by hand.
 * DISABLE_DETECTORS=1 turns them off (used by workflow tests for speed).
 */
export interface Detector {
  name: string;
  detect(uprightImage: Buffer, width: number, height: number): Promise<Box[]>;
}

const detectors: Detector[] = [];
let autoloaded = false;

export function registerDetector(d: Detector) {
  if (!detectors.some((x) => x.name === d.name)) detectors.push(d);
}

async function autoload() {
  if (autoloaded) return;
  autoloaded = true;
  if (process.env.DISABLE_DETECTORS === "1") return;
  const onnx = await import("./onnx");
  if (onnx.modelsAvailable()) {
    registerDetector(onnx.faceDetector);
    registerDetector(onnx.plateDetector);
  }
}

export async function detectSensitive(buf: Buffer, width: number, height: number): Promise<Detection> {
  await autoload();
  if (!detectors.length) return { detector: "unavailable", boxes: [] };
  const boxes: Box[] = [];
  for (const d of detectors) boxes.push(...(await d.detect(buf, width, height)));
  return { detector: detectors.map((d) => d.name).join("+"), boxes };
}
