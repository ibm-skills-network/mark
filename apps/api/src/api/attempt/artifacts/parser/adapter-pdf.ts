import type { ParserDocument, ParserLimits } from "./parser.types";

export async function extractPdf(
  bytes: Buffer,
  limits: ParserLimits,
): Promise<ParserDocument> {
  // Keep native import intact when Nest compiles this worker to CommonJS.
  // Fixed specifier only; native ESM import must survive the CommonJS Nest build.
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const load = new Function("specifier", "return import(specifier)") as (
    specifier: string,
  ) => Promise<typeof import("pdfjs-dist/legacy/build/pdf.mjs")>;
  const pdfjs = await load("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    useSystemFonts: false,
    disableFontFace: true,
    useWasm: false,
    stopAtErrors: true,
    verbosity: 0,
  });
  const document = await task.promise;
  try {
    if (document.numPages > limits.pages) throw new Error("expansion_limit");
    let expandedBytes = 0;
    const pages: {
      page: number;
      text: string;
      visual: boolean;
      annotations: boolean;
    }[] = [];
    for (let number = 1; number <= document.numPages; number++) {
      const page = await document.getPage(number);
      const content = await page.getTextContent();
      let text = "";
      for (const item of content.items) {
        if (!("str" in item)) continue;
        text += item.str + (item.hasEOL ? "\n" : " ");
        expandedBytes += Buffer.byteLength(item.str, "utf8") + 1;
        if (expandedBytes > limits.expandedBytes)
          throw new Error("expansion_limit");
      }
      const operators = await page.getOperatorList();
      const visualOps = new Set([
        pdfjs.OPS.paintImageXObject,
        pdfjs.OPS.paintInlineImageXObject,
        pdfjs.OPS.paintImageMaskXObject,
        pdfjs.OPS.paintImageMaskXObjectGroup,
        pdfjs.OPS.paintImageXObjectRepeat,
        pdfjs.OPS.paintImageMaskXObjectRepeat,
        pdfjs.OPS.shadingFill,
        pdfjs.OPS.constructPath,
      ]);
      const annotations = await page.getAnnotations();
      pages.push({
        page: number,
        text: text.trimEnd(),
        visual: operators.fnArray.some((operator: number) =>
          visualOps.has(operator),
        ),
        annotations: annotations.length > 0,
      });
      page.cleanup();
    }
    const attachments = await document.getAttachments();
    const javascript = await document.getJSActions();
    const blocks: ParserDocument["blocks"] = [];
    const omissions: ParserDocument["omissions"] = [];
    for (const page of pages) {
      if (page.text)
        blocks.push({
          kind: "text",
          text: page.text,
          location: { page: page.page },
        });
      if (page.visual)
        omissions.push({
          code: "missing_visual_evidence",
          location: { page: page.page },
          detail: "PDF images or vector graphics require visual extraction.",
        });
      if (page.annotations)
        omissions.push({
          code: "unsupported_feature",
          location: { page: page.page },
          detail: "PDF annotations are not represented by text extraction.",
        });
    }
    if (attachments)
      omissions.push({
        code: "unsupported_feature",
        detail: "Embedded PDF attachments are not extracted.",
      });
    if (javascript)
      omissions.push({
        code: "unsupported_feature",
        detail: "PDF scripts are never executed.",
      });
    return {
      blocks,
      omissions,
      expandedBytes,
      empty: blocks.length === 0 && omissions.length === 0,
    };
  } finally {
    await task.destroy();
  }
}
