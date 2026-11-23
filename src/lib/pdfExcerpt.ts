/**
 * Copy selected pages of a PDF into a new, smaller PDF. Used to keep only the pages of a council
 * meeting's minutes that hold the nuisance orders: whole minutes run to hundreds of scanned pages,
 * and the free storage plan holds 1 GB.
 */
import { PDFDocument } from "pdf-lib";

/** `pages` are 1-based; out-of-range pages are ignored. */
export async function excerptPages(buf: Uint8Array, pages: number[]): Promise<{ bytes: Uint8Array; pages: number[] }> {
  const src = await PDFDocument.load(buf, { ignoreEncryption: true, updateMetadata: false });
  const keep = [...new Set(pages)].filter((p) => p >= 1 && p <= src.getPageCount()).sort((a, b) => a - b);
  if (!keep.length) throw new Error("No pages to keep.");
  const out = await PDFDocument.create();
  const copied = await out.copyPages(src, keep.map((p) => p - 1));
  for (const p of copied) out.addPage(p);
  return { bytes: await out.save({ useObjectStreams: true }), pages: keep };
}

/** "3, 4, 5, 9" -> "3–5, 9" */
export function pageRanges(pages: number[]): string {
  const out: string[] = [];
  for (let i = 0; i < pages.length; i++) {
    let j = i;
    while (j + 1 < pages.length && pages[j + 1] === pages[j] + 1) j++;
    out.push(i === j ? `${pages[i]}` : `${pages[i]}–${pages[j]}`);
    i = j;
  }
  return out.join(", ");
}
