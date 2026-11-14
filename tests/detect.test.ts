import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import sharp from "sharp";
import * as ort from "onnxruntime-web";
import {
  FACE_MODEL, PLATE_MODEL, decodePlates, decodeYuNet, faceDetector, nms, plateDetector, runTiled, tilesFor,
} from "@/lib/photos/onnx";

const haveModels = existsSync(`models/${FACE_MODEL}`) && existsSync(`models/${PLATE_MODEL}`);

describe("tiling", () => {
  it("uses the whole frame alone for small photos", () => {
    expect(tilesFor(640, 480)).toEqual([{ left: 0, top: 0, width: 640, height: 480 }]);
  });
  it("adds four overlapping tiles that cover a big photo", () => {
    const t = tilesFor(2000, 1500);
    expect(t).toHaveLength(5);
    expect(t[1]).toEqual({ left: 0, top: 0, width: 1200, height: 900 });
    expect(t[4]).toEqual({ left: 800, top: 600, width: 1200, height: 900 });
    for (const x of t) {
      expect(x.left + x.width).toBeLessThanOrEqual(2000);
      expect(x.top + x.height).toBeLessThanOrEqual(1500);
    }
  });
});

describe("nms", () => {
  it("merges the same object seen in several tiles, keeps separate objects", () => {
    const kept = nms([
      { x1: 100, y1: 100, x2: 200, y2: 200, score: 0.9 },
      { x1: 105, y1: 102, x2: 205, y2: 198, score: 0.8 }, // same face, other tile
      { x1: 120, y1: 120, x2: 180, y2: 180, score: 0.7 }, // inside the first
      { x1: 500, y1: 500, x2: 560, y2: 560, score: 0.6 }, // different face
    ]);
    expect(kept.map((k) => k.score)).toEqual([0.9, 0.6]);
  });
});

describe("decoders", () => {
  it("decodes the plate model's end2end rows and applies the threshold", () => {
    const data = new Float32Array([0, 10, 20, 110, 60, 0, 0.9, 0, 300, 300, 340, 320, 0, 0.1]);
    expect(decodePlates(new ort.Tensor("float32", data, [2, 7]), 0.25)).toEqual([
      { x1: 10, y1: 20, x2: 110, y2: 60, score: expect.closeTo(0.9, 5) },
    ]);
  });

  it("decodes a YuNet anchor into a box (stride 32, cell row 2 col 3)", () => {
    const t = (n: number, w: number) => new ort.Tensor("float32", new Float32Array(n * w), [1, n, w]);
    const out: Record<string, ort.Tensor> = {};
    for (const s of [8, 16, 32]) {
      const n = (640 / s) ** 2;
      out[`cls_${s}`] = t(n, 1);
      out[`obj_${s}`] = t(n, 1);
      out[`bbox_${s}`] = t(n, 4);
    }
    const idx = 2 * 20 + 3; // stride 32 grid is 20x20
    (out.cls_32.data as Float32Array)[idx] = 0.81;
    (out.obj_32.data as Float32Array)[idx] = 1;
    (out.bbox_32.data as Float32Array).set([0.5, 0.5, Math.log(2), Math.log(3)], idx * 4);
    const [b] = decodeYuNet(out, 0.6);
    // center = ((3+0.5)*32, (2+0.5)*32) = (112, 80); size = (2*32, 3*32) = (64, 96)
    expect(b).toEqual({ x1: expect.closeTo(80, 4), y1: expect.closeTo(32, 4), x2: expect.closeTo(144, 4), y2: expect.closeTo(128, 4), score: expect.closeTo(0.9, 5) });
  });
});

describe("tile coordinates map back to the photo", () => {
  it("undoes the centred letterbox for the whole frame", async () => {
    const img = await sharp({ create: { width: 1280, height: 640, channels: 3, background: "#777" } }).png().toBuffer();
    // In 640-space a 1280x640 photo is scaled by 0.5 and padded 160px top and bottom.
    // A box at 640-space (100,200)-(200,260) is photo (200,80)-(400,200).
    let calls = 0;
    const boxes = await runTiled(img, 1280, 640, async () => (calls++ === 0 ? [{ x1: 100, y1: 200, x2: 200, y2: 260, score: 0.9 }] : []), true, 114);
    expect(boxes[0]).toEqual({ x1: 200, y1: 80, x2: 400, y2: 200, score: 0.9 });
  });

  it("offsets boxes found in a tile by the tile's position", async () => {
    const img = await sharp({ create: { width: 2000, height: 1500, channels: 3, background: "#777" } }).png().toBuffer();
    // Tile 4 is (800,600) 1200x900: scale 640/1200, top-left placement (YuNet style).
    let call = 0;
    const boxes = await runTiled(img, 2000, 1500, async () => (call++ === 4 ? [{ x1: 64, y1: 32, x2: 128, y2: 96, score: 0.8 }] : []), false, 0);
    const r = 640 / 1200;
    expect(boxes[0].x1).toBeCloseTo(800 + 64 / r, 0);
    expect(boxes[0].y1).toBeCloseTo(600 + 32 / r, 0);
  });
});

describe.skipIf(!haveModels)("models (requires `npm run models`)", () => {
  it("both load and run, and find nothing in a blank wall", async () => {
    const img = await sharp({ create: { width: 1600, height: 1200, channels: 3, background: "#b9b3a8" } }).jpeg().toBuffer();
    const t0 = Date.now();
    const faces = await faceDetector.detect(img, 1600, 1200);
    const plates = await plateDetector.detect(img, 1600, 1200);
    expect(faces).toEqual([]);
    expect(plates).toEqual([]);
    expect(Date.now() - t0).toBeLessThan(20000);
  }, 60000);
});
