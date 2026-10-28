import JSZip from "jszip";
import { bytesToParts } from "../materialize";
import { pptxToParts } from "./pptx";

const NS = `xmlns:a="a" xmlns:p="p" xmlns:r="r"`;

function shape(text: string, placeholder?: string): string {
  const ph = placeholder
    ? `<p:nvPr><p:ph type="${placeholder}"/></p:nvPr>`
    : "";
  const paragraphs = text
    .split("\n")
    .map((line) => `<a:p><a:r><a:t>${line}</a:t></a:r></a:p>`)
    .join("");
  return `<p:sp><p:nvSpPr>${ph}</p:nvSpPr><p:txBody>${paragraphs}</p:txBody></p:sp>`;
}

function table(rows: string[][]): string {
  const body = rows
    .map(
      (row) =>
        `<a:tr>${row.map((cell) => `<a:tc><a:txBody><a:p><a:r><a:t>${cell}</a:t></a:r></a:p></a:txBody></a:tc>`).join("")}</a:tr>`,
    )
    .join("");
  return `<p:graphicFrame><a:graphic><a:graphicData><a:tbl>${body}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`;
}

function slideXml(content: string): string {
  return `<p:sld ${NS}><p:cSld><p:spTree>${content}</p:spTree></p:cSld></p:sld>`;
}

interface SlideSpec {
  content: string;
  notes?: string;
  images?: Array<{ file: string; bytes: number }>;
}

async function deck(
  slides: SlideSpec[],
  reverseFileOrder = false,
): Promise<Buffer> {
  const zip = new JSZip();
  const ids = slides.map(
    (_, index) => `<p:sldId id="${256 + index}" r:id="rId${index + 1}"/>`,
  );
  zip.file(
    "ppt/presentation.xml",
    `<p:presentation ${NS}><p:sldIdLst>${ids.join("")}</p:sldIdLst></p:presentation>`,
  );
  // File numbers need not follow presentation order.
  const fileNumber = (index: number) =>
    reverseFileOrder ? slides.length - index : index + 1;
  zip.file(
    "ppt/_rels/presentation.xml.rels",
    `<Relationships>${slides
      .map(
        (_, index) =>
          `<Relationship Id="rId${index + 1}" Type="x/slide" Target="slides/slide${fileNumber(index)}.xml"/>`,
      )
      .join("")}</Relationships>`,
  );
  for (const [index, slide] of slides.entries()) {
    const number = fileNumber(index);
    zip.file(`ppt/slides/slide${number}.xml`, slideXml(slide.content));
    const rels: string[] = [];
    if (slide.notes !== undefined) {
      rels.push(
        `<Relationship Id="rIdN" Type="x/notesSlide" Target="../notesSlides/notesSlide${number}.xml"/>`,
      );
      zip.file(
        `ppt/notesSlides/notesSlide${number}.xml`,
        `<p:notes ${NS}><p:cSld><p:spTree>${shape("", "sldImg")}${shape(slide.notes, "body")}${shape(String(number), "sldNum")}</p:spTree></p:cSld></p:notes>`,
      );
    }
    for (const [imageIndex, image] of (slide.images ?? []).entries()) {
      rels.push(
        `<Relationship Id="rIdI${imageIndex}" Type="x/image" Target="../media/${image.file}"/>`,
      );
      zip.file(`ppt/media/${image.file}`, Buffer.alloc(image.bytes, 7));
    }
    zip.file(
      `ppt/slides/_rels/slide${number}.xml.rels`,
      `<Relationships>${rels.join("")}</Relationships>`,
    );
  }
  return zip.generateAsync({ type: "nodebuffer" });
}

describe("pptxToParts", () => {
  it("gives every slide its number, title, body, tables and speaker notes", async () => {
    const buffer = await deck([
      {
        content: `${shape("Quarterly review", "title")}${shape("Revenue grew\nCosts fell")}`,
        notes: "Mention the churn numbers",
      },
      {
        content: `${shape("Results", "title")}${table([
          ["Region", "Sales"],
          ["East", "12"],
        ])}`,
      },
    ]);
    const parts = await pptxToParts("talk.pptx", buffer);
    expect(parts).toHaveLength(1);
    const text = parts[0].text ?? "";
    expect(text).toContain("2 slide(s)");
    expect(text).toContain("## Slide 1: Quarterly review");
    expect(text).toContain("Revenue grew\nCosts fell");
    expect(text).toContain("Speaker notes:\nMention the churn numbers");
    expect(text).toContain("## Slide 2: Results");
    expect(text).toContain("Region | Sales\nEast | 12");
    // Notes placeholders for the slide image and slide number are not text.
    expect(text).not.toMatch(/Speaker notes:[\S\s]*\n1\n/);
  });

  it("follows presentation order, not slide file numbers", async () => {
    const buffer = await deck(
      [
        { content: shape("First", "title") },
        { content: shape("Second", "title") },
      ],
      true,
    );
    const text = (await pptxToParts("deck.pptx", buffer))[0].text ?? "";
    expect(text.indexOf("Slide 1: First")).toBeGreaterThan(-1);
    expect(text.indexOf("Slide 2: Second")).toBeGreaterThan(
      text.indexOf("Slide 1: First"),
    );
  });

  it("brings a 30-slide deck through whole", async () => {
    const buffer = await deck(
      Array.from({ length: 30 }, (_, index) => ({
        content: `${shape(`Topic ${index + 1}`, "title")}${shape(`Point for slide ${index + 1}`)}`,
      })),
    );
    const text = (await pptxToParts("long.pptx", buffer))[0].text ?? "";
    for (let number = 1; number <= 30; number += 1) {
      expect(text).toContain(`## Slide ${number}: Topic ${number}`);
      expect(text).toContain(`Point for slide ${number}`);
    }
  });

  it("sends embedded images as image parts, skipping small ones, up to 20 per deck", async () => {
    const big = 12 * 1024;
    const slides: SlideSpec[] = Array.from({ length: 22 }, (_, index) => ({
      content: shape(`S${index + 1}`, "title"),
      images: [{ file: `image${index + 1}.png`, bytes: big }],
    }));
    slides[0].images?.push({ file: "icon.png", bytes: 2000 });
    slides[1].images?.push({ file: "diagram.emf", bytes: big });
    const parts = await pptxToParts("pics.pptx", await deck(slides));
    const images = parts.filter((part) => part.kind === "image");
    expect(images).toHaveLength(20);
    expect(images[0]).toMatchObject({
      name: "pics.pptx › slide 1 › image1.png",
      mimeType: "image/png",
    });
    const text = parts[0].text ?? "";
    expect(text).toContain(
      '[image image1.png: sent as part "pics.pptx › slide 1 › image1.png"]',
    );
    expect(text).toContain("[image icon.png: under 10 KB, not sent]");
    expect(text).toContain("[image diagram.emf: emf format, not sent]");
    expect(text).toContain(
      "[image image21.png: not sent, over the 20-image cap]",
    );
  });

  it("is what bytesToParts returns for a .pptx file", async () => {
    const buffer = await deck([{ content: shape("Hello", "title") }]);
    const parts = await bytesToParts("a.pptx", undefined, buffer);
    expect(parts[0].text).toContain("## Slide 1: Hello");
  });

  it("reports an unreadable deck instead of throwing", async () => {
    const parts = await bytesToParts(
      "broken.pptx",
      undefined,
      Buffer.from("not a zip"),
    );
    expect(parts[0].text).toMatch(/^could not read broken\.pptx \(pptx\)/);
  });
});
