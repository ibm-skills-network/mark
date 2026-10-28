import { htmlFileToParts } from "./html-file";

const PNG_BASE64 = Buffer.alloc(4096, 7).toString("base64");

function notebookExport(exercises: number): string {
  const style = `<style>${".jp-Cell { margin: 0 } ".repeat(20_000)}</style>`;
  const script = `<script>${"window.x = 1;".repeat(5000)}</script>`;
  const cells = Array.from(
    { length: exercises },
    (_, index) =>
      `<div class="jp-Cell"><pre>exercise_${index + 1} = train(model_${index + 1})</pre><div class="output">accuracy ${index + 1}</div></div>`,
  ).join("");
  const plot = `<img src="data:image/png;base64,${PNG_BASE64}">`;
  return `<html><head>${style}${script}</head><body><h1>Rainfall</h1>${cells}${plot}</body></html>`;
}

describe("htmlFileToParts", () => {
  it("drops styles and scripts so every exercise of a notebook export is sent", () => {
    const parts = htmlFileToParts("Project.html", notebookExport(14));
    const text = parts.find((part) => part.kind === "text")?.text ?? "";
    for (let index = 1; index <= 14; index += 1) {
      expect(text).toContain(`exercise_${index} = train(model_${index})`);
    }
    expect(text).not.toContain(".jp-Cell");
    expect(text).not.toContain("window.x");
  });

  it("sends embedded images as image parts and marks where they were", () => {
    const parts = htmlFileToParts("Project.html", notebookExport(1));
    const images = parts.filter((part) => part.kind === "image");
    expect(images).toEqual([
      {
        name: "Project.html › image 1",
        kind: "image",
        mimeType: "image/png",
        base64: PNG_BASE64,
      },
    ]);
    expect(parts[0].text).toContain("[image 1]");
  });

  it("caps embedded images and says how many were left out", () => {
    const img = `<img src="data:image/png;base64,${PNG_BASE64}">`;
    const parts = htmlFileToParts("page.html", `<p>x</p>${img.repeat(3)}`, {
      maxImages: 2,
    });
    expect(parts.filter((part) => part.kind === "image")).toHaveLength(2);
    expect(parts[0].text).toContain("1 more embedded image(s) not sent");
  });

  it("skips tiny embedded images such as icons", () => {
    const icon = Buffer.alloc(100, 1).toString("base64");
    const parts = htmlFileToParts(
      "page.html",
      `<p>x</p><img src="data:image/png;base64,${icon}">`,
    );
    expect(parts.filter((part) => part.kind === "image")).toHaveLength(0);
  });
});
