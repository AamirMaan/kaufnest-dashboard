/**
 * Browser-only text extraction for a receipt file. Nothing leaves the
 * browser except the fetch of the libraries' worker/language files from
 * jsdelivr (pdf.js worker, tesseract core + deu/eng traineddata), which the
 * browser then caches. Both libraries are imported dynamically so they never
 * enter the main bundle — keep them out of top-level imports.
 */

/** A PDF with fewer non-whitespace characters than this is treated as a scan and OCR'd. */
export const MIN_PDF_TEXT_CHARS = 40;

/** Whether a PDF's text layer has enough content to parse (vs. a scanned image). */
export function hasUsablePdfText(text: string): boolean {
  return text.replace(/\s/g, "").length >= MIN_PDF_TEXT_CHARS;
}

export interface ExtractedReceiptText {
  text: string;
  source: "pdf-text" | "ocr";
}

const OCR_LANGUAGES = ["deu", "eng"];
const OCR_RENDER_SCALE = 2;

async function ocr(image: Blob | HTMLCanvasElement): Promise<string> {
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker(OCR_LANGUAGES);
  try {
    const { data } = await worker.recognize(image);
    return data.text;
  } finally {
    await worker.terminate();
  }
}

export async function extractReceiptText(file: Blob, mime: string): Promise<ExtractedReceiptText> {
  if (mime !== "application/pdf") {
    return { text: await ocr(file), source: "ocr" };
  }

  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const doc = await loadingTask.promise;
  try {
    const pages: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const content = await (await doc.getPage(i)).getTextContent();
      pages.push(
        content.items
          .map((item) => ("str" in item ? item.str + (item.hasEOL ? "\n" : " ") : ""))
          .join("")
      );
    }
    const text = pages.join("\n");
    if (hasUsablePdfText(text)) return { text, source: "pdf-text" };

    // Scanned PDF: OCR a render of page 1 only (spec: pages beyond 1 are out of scope).
    const page = await doc.getPage(1);
    const viewport = page.getViewport({ scale: OCR_RENDER_SCALE });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvas, viewport }).promise;
    return { text: await ocr(canvas), source: "ocr" };
  } finally {
    // PDFDocumentProxy has no destroy() of its own (only cleanup()); the
    // loading task returned by getDocument() is what tears down the worker.
    await loadingTask.destroy();
  }
}
