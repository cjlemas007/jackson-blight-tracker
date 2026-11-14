import { describe, expect, it } from "vitest";
import exifr from "exifr";
import sharp from "sharp";
import { readExif } from "@/lib/photos/exif";
import { renderPublic } from "@/lib/photos/render";
import { jpegWithExif } from "./helpers/images";

const JACKSON = { lat: 32.2988, lon: -90.1848 };

describe("readExif", () => {
  it("reads GPS, capture time and camera from the original", async () => {
    const img = await jpegWithExif({ ...JACKSON, takenAt: "2026:11:10 14:32:05" });
    const e = await readExif(img);
    expect(e.lat).toBeCloseTo(JACKSON.lat, 4);
    expect(e.lon).toBeCloseTo(JACKSON.lon, 4);
    expect(e.camera).toBe("TestCam X1");
    // No offset in the file: 14:32 in Jackson in November is CST (UTC-6).
    expect(e.takenAt).toBe("2026-11-10T20:32:05.000Z");
  });

  it("uses CDT in summer", async () => {
    const e = await readExif(await jpegWithExif({ takenAt: "2026:07:04 09:00:00" }));
    expect(e.takenAt).toBe("2026-07-04T14:00:00.000Z");
  });

  it("returns nulls when there is no EXIF", async () => {
    const plain = await sharp({ create: { width: 10, height: 10, channels: 3, background: "#fff" } }).jpeg().toBuffer();
    expect(await readExif(plain)).toEqual({ takenAt: null, lat: null, lon: null, camera: null });
  });
});

describe("renderPublic strips EXIF", () => {
  it("removes GPS, time, camera and every other EXIF field", async () => {
    const original = await jpegWithExif({ ...JACKSON, takenAt: "2026:11:10 14:32:05" });
    expect(await exifr.gps(original)).toBeTruthy(); // sanity: the input really has GPS
    const { buffer } = await renderPublic(original, []);
    expect(await exifr.parse(buffer, true)).toBeUndefined();
    expect(await exifr.gps(buffer).catch(() => undefined)).toBeUndefined();
    const meta = await sharp(buffer).metadata();
    expect(meta.exif).toBeUndefined();
    expect(meta.xmp).toBeUndefined();
    expect(meta.iptc).toBeUndefined();
  });

  it("bakes in orientation before stripping it, so the photo isn't left sideways", async () => {
    const original = await jpegWithExif({ width: 400, height: 300, orientation: 6 });
    const { width, height } = await renderPublic(original, []);
    expect([width, height]).toEqual([300, 400]);
  });

  it("caps the long edge at 2000px", async () => {
    const original = await jpegWithExif({ width: 4000, height: 3000 });
    const { width, height } = await renderPublic(original, []);
    expect([width, height]).toEqual([2000, 1500]);
  });
});

describe("renderPublic blurs boxes", () => {
  it("destroys detail inside a box and leaves the rest alone", async () => {
    const original = await jpegWithExif({ width: 400, height: 300 });
    const plain = await sharp((await renderPublic(original, [])).buffer).raw().toBuffer({ resolveWithObject: true });
    const blurred = await sharp((await renderPublic(original, [{ x: 0.05, y: 0.1, w: 0.3, h: 0.5 }])).buffer)
      .raw()
      .toBuffer({ resolveWithObject: true });
    const { width, channels } = plain.info;
    const px = (buf: Buffer, x: number, y: number) => buf[(y * width + x) * channels];
    // Inside the box, the 10px red/dark stripes are gone: neighbouring columns now look alike.
    // (JPEG chroma subsampling already softens the stripes in the plain copy, hence the margins.)
    const stripeContrast = (buf: Buffer, y: number) =>
      Math.max(...Array.from({ length: 80 }, (_, i) => Math.abs(px(buf, 40 + i, y) - px(buf, 41 + i, y))));
    expect(stripeContrast(plain.data, 100)).toBeGreaterThan(60);
    expect(stripeContrast(blurred.data, 100)).toBeLessThan(15);
    // Far outside the box (bottom right), pixels are unchanged.
    expect(Math.abs(px(plain.data, 380, 280) - px(blurred.data, 380, 280))).toBeLessThan(6);
  });

  it("ignores degenerate and out-of-bounds boxes", async () => {
    const original = await jpegWithExif({});
    await expect(renderPublic(original, [{ x: 2, y: 2, w: 1, h: 1 }, { x: 0.5, y: 0.5, w: 0, h: 0.1 }])).resolves.toBeTruthy();
  });

  it("refuses formats it can't publish", async () => {
    const gif = await sharp({ create: { width: 4, height: 4, channels: 3, background: "#000" } }).gif().toBuffer();
    await expect(renderPublic(gif, [])).rejects.toThrow(/unsupported image format/);
  });
});
