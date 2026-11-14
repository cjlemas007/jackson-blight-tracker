import type { Box } from "./render";

export interface Detection {
  detector: string; // model name(s), or "unavailable"
  boxes: Box[];
}

/**
 * Face + license-plate detection. Pluggable so the ONNX models (pending approval to download)
 * can be added without touching the pipeline. Until then this reports "unavailable", and the
 * review screen tells admins that every face and plate must be boxed by hand.
 */
export interface Detector {
  name: string;
  detect(uprightJpeg: Buffer, width: number, height: number): Promise<Box[]>;
}

const detectors: Detector[] = [];

export function registerDetector(d: Detector) {
  detectors.push(d);
}

export async function detectSensitive(buf: Buffer, width: number, height: number): Promise<Detection> {
  if (!detectors.length) return { detector: "unavailable", boxes: [] };
  const boxes: Box[] = [];
  for (const d of detectors) boxes.push(...(await d.detect(buf, width, height)));
  return { detector: detectors.map((d) => d.name).join("+"), boxes };
}
