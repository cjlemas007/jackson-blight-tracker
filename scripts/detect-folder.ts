/**
 * Try face/plate detection on your own photos:
 *   npm run detect -- ~/Desktop/test-photos
 * Writes <folder>/detected/<name>.jpg with red boxes for faces and blue boxes for plates
 * (plus the blurred version beside it), and prints what was found. Nothing is uploaded anywhere.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { upright, renderPublic } from "../src/lib/photos/render";
import { detectSensitive } from "../src/lib/photos/detect";

const dir = process.argv[2];
if (!dir) throw new Error("usage: npm run detect -- <folder of photos>");
const out = path.join(dir, "detected");
mkdirSync(out, { recursive: true });

for (const name of readdirSync(dir).filter((f) => /\.(jpe?g|png|webp)$/i.test(f))) {
  const original = readFileSync(path.join(dir, name));
  const t0 = Date.now();
  const up = await upright(original);
  const { boxes } = await detectSensitive(up.buf, up.width, up.height);
  const ms = Date.now() - t0;
  const rects = boxes
    .map((b) => {
      const c = b.kind === "face" ? "#ff2d2d" : "#2d7dff";
      return `<rect x="${b.x * up.width}" y="${b.y * up.height}" width="${b.w * up.width}" height="${b.h * up.height}" fill="none" stroke="${c}" stroke-width="4"/>
        <text x="${b.x * up.width}" y="${Math.max(14, b.y * up.height - 4)}" fill="${c}" font-size="18" font-family="sans-serif">${b.kind} ${b.score}</text>`;
    })
    .join("");
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${up.width}" height="${up.height}">${rects}</svg>`);
  const base = name.replace(/\.[^.]+$/, "");
  await sharp(up.buf).composite([{ input: svg }]).jpeg({ quality: 85 }).toFile(path.join(out, `${base}.boxes.jpg`));
  writeFileSync(path.join(out, `${base}.blurred.jpg`), (await renderPublic(original, boxes)).buffer);
  const faces = boxes.filter((b) => b.kind === "face").length;
  const plates = boxes.filter((b) => b.kind === "plate").length;
  console.log(`${name}: ${faces} face(s), ${plates} plate(s) in ${ms} ms`);
}
console.log(`annotated copies in ${out}`);
