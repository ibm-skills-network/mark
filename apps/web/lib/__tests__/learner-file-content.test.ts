import {
  fileContentAsText,
  withTextFileContent,
} from "../learner-file-content";

describe("learner file content", () => {
  const notebook = { cells: [{ cell_type: "code", source: ["x = 1"] }] };

  it("turns a parsed notebook back into its JSON text", () => {
    const file = withTextFileContent({
      filename: "lab.ipynb",
      githubUrl: "https://github.com/learner/repo/blob/main/lab.ipynb",
      content: notebook as unknown as string,
    });
    expect(typeof file.content).toBe("string");
    expect(JSON.parse(file.content)).toEqual(notebook);
    expect(file.githubUrl).toContain("lab.ipynb");
  });

  it("keeps string content, including the storage marker", () => {
    const file = { filename: "a.py", content: "InCos" };
    expect(withTextFileContent(file)).toBe(file);
    expect(fileContentAsText("print(1)")).toBe("print(1)");
  });

  it("serializes arrays and leaves missing content missing", () => {
    expect(fileContentAsText([1, 2])).toBe("[1,2]");
    expect(fileContentAsText(undefined)).toBeUndefined();
    expect(fileContentAsText(null)).toBeUndefined();
  });
});
