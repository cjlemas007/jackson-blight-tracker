// Downloads the face/plate detection models into ./models and verifies size + SHA-256.
// Run on install/build (it skips files already present and verified). See docs/STEP3_NOTES.md.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

export const MODELS = [
  {
    file: "face_detection_yunet_2023mar.onnx",
    url: "https://huggingface.co/opencv/face_detection_yunet/resolve/main/face_detection_yunet_2023mar.onnx",
    bytes: 232589,
    // Hugging Face LFS oid (SHA-256) published for this file.
    sha256: "8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4",
    license: "MIT (Shiqi Yu), OpenCV Zoo",
  },
  {
    file: "yolo-v9-t-640-license-plates-end2end.onnx",
    url: "https://github.com/ankandrew/open-image-models/releases/download/assets/yolo-v9-t-640-license-plates-end2end.onnx",
    bytes: 7835770,
    // GitHub publishes no digest; pinned from the first verified-size download on 2026-11-13.
    sha256: "c3c1026ca7d0585dd88084d68182dd897113712fa734ae1557ca70174440c076",
    license: "MIT (open-image-models repo); YOLOv9 training lineage not stated",
  },
];

const dir = path.resolve(process.env.MODELS_DIR ?? "models");
mkdirSync(dir, { recursive: true });
const sha = (b) => createHash("sha256").update(b).digest("hex");

for (const m of MODELS) {
  const dest = path.join(dir, m.file);
  if (existsSync(dest)) {
    const b = readFileSync(dest);
    if (b.length === m.bytes && (m.sha256 === "PIN_ME" || sha(b) === m.sha256)) {
      console.log(`ok       ${m.file}`);
      continue;
    }
    console.log(`refetch  ${m.file} (failed verification)`);
  }
  const res = await fetch(m.url, { redirect: "follow" });
  if (!res.ok) throw new Error(`${m.file}: HTTP ${res.status}`);
  const b = Buffer.from(await res.arrayBuffer());
  if (b.length !== m.bytes) throw new Error(`${m.file}: expected ${m.bytes} bytes, got ${b.length}`);
  const got = sha(b);
  if (m.sha256 !== "PIN_ME" && got !== m.sha256) throw new Error(`${m.file}: SHA-256 mismatch (${got})`);
  writeFileSync(`${dest}.part`, b);
  renameSync(`${dest}.part`, dest);
  console.log(`fetched  ${m.file} ${b.length} bytes sha256=${got}`);
}
