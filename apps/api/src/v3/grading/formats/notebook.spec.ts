import { estimateTextTokens } from "../limits";
import { notebookToParts } from "./notebook";

const PNG = Buffer.from("fake-png-bytes").toString("base64");

function notebook(cells: unknown[]): string {
  return JSON.stringify({ cells, nbformat: 4 });
}

function code(source: string, outputs: unknown[] = []) {
  return { cell_type: "code", source, outputs };
}

function stream(text: string) {
  return { output_type: "stream", name: "stdout", text };
}

describe("notebookToParts", () => {
  it("keeps cells in order with their text outputs", () => {
    const { text, images } = notebookToParts(
      "nb.ipynb",
      notebook([
        { cell_type: "markdown", source: ["# Title\n", "intro"] },
        code("print(2+2)", [stream("4\n")]),
        code("df.head()", [
          {
            output_type: "execute_result",
            data: { "text/plain": ["   a  b\n", "0  1  2"] },
          },
        ]),
        code("1/0", [
          {
            output_type: "error",
            ename: "ZeroDivisionError",
            evalue: "division by zero",
            traceback: ["\u001B[31mTraceback\u001B[0m"],
          },
        ]),
      ]),
      40_000,
    );
    expect(images).toEqual([]);
    expect(text.indexOf("# Title")).toBeLessThan(text.indexOf("print(2+2)"));
    expect(text.indexOf("print(2+2)")).toBeLessThan(text.indexOf("df.head()"));
    expect(text).toContain("4\n");
    expect(text).toContain("0  1  2");
    expect(text).toContain("ZeroDivisionError: division by zero");
    expect(text).not.toContain("\u001B");
    expect(text).not.toContain("abridged");
  });

  it("sends image outputs as image parts, up to the cap", () => {
    const image = {
      output_type: "display_data",
      data: { "image/png": PNG, "text/plain": "<Figure>" },
    };
    const { text, images } = notebookToParts(
      "nb.ipynb",
      notebook([
        code("plot(a)", [image]),
        code("plot(b)", [image]),
        code("plot(c)", [image]),
      ]),
      40_000,
      { maxImages: 2 },
    );
    expect(images.map((part) => [part.name, part.kind, part.mimeType])).toEqual(
      [
        ["nb.ipynb › output image 1 (cell 1)", "image", "image/png"],
        ["nb.ipynb › output image 2 (cell 2)", "image", "image/png"],
      ],
    );
    expect(text).toContain(
      '[image output sent as part "nb.ipynb › output image 1 (cell 1)"]',
    );
    expect(text).toContain(
      "[image output (image/png) not included: over the 2-image cap]",
    );
    expect(text).not.toContain(PNG);
  });

  it("over the cap, shortens long outputs first and keeps every cell's source", () => {
    const longOutput = Array.from(
      { length: 5000 },
      (_, index) => `epoch ${index} loss 0.${index}`,
    ).join("\n");
    const cells = [
      code("import pandas as pd", []),
      code("train(model)", [stream(longOutput)]),
      { cell_type: "markdown", source: "## Conclusion: the model converged" },
      code("evaluate(model)", [stream("accuracy 0.93\n")]),
    ];
    const { text } = notebookToParts("nb.ipynb", notebook(cells), 3000);
    expect(estimateTextTokens(text)).toBeLessThanOrEqual(3000);
    for (const source of [
      "import pandas as pd",
      "train(model)",
      "## Conclusion: the model converged",
      "evaluate(model)",
    ]) {
      expect(text).toContain(source);
    }
    expect(text).toContain("accuracy 0.93");
    expect(text).toContain("epoch 0 loss");
    expect(text).toContain("epoch 39 loss");
    expect(text).not.toContain("epoch 40 loss");
    expect(text).toContain("epoch 4999 loss");
    expect(text).toMatch(/\[\.\.\. 4950 output lines omitted \.\.\.\]/);
    expect(text.split("\n")[0]).toMatch(/^\[notebook abridged: /);
  });

  it("drops whole outputs, largest first, when shortening is not enough", () => {
    const wide = (label: string) =>
      Array.from({ length: 50 }, () => `${label} ${"x".repeat(200)}`).join(
        "\n",
      );
    const cells = [
      code("step_one()", [stream(wide("big"))]),
      code("step_two()", [stream("small result\n")]),
    ];
    const { text } = notebookToParts("nb.ipynb", notebook(cells), 1000);
    expect(estimateTextTokens(text)).toBeLessThanOrEqual(1000);
    expect(text).toContain("step_one()");
    expect(text).toContain("step_two()");
    expect(text).toContain("small result");
    expect(text).toMatch(/\[output omitted: 50 lines/);
  });

  it("falls back to abridging only when the sources alone are over the cap", () => {
    const cells = Array.from({ length: 400 }, (_, index) =>
      code(`value_${index} = ${"1 + ".repeat(50)}1`),
    );
    const { text } = notebookToParts("nb.ipynb", notebook(cells), 2000);
    expect(estimateTextTokens(text)).toBeLessThanOrEqual(2000);
    expect(text).toContain("value_0 =");
    expect(text).toContain("value_399 =");
    expect(text).toMatch(/characters omitted/);
  });

  it("throws on invalid notebook JSON so the caller can report it", () => {
    expect(() => notebookToParts("nb.ipynb", "{not json", 1000)).toThrow();
  });
});
