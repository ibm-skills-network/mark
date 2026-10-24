import {
  toSubmittedFileReference,
  toSubmittedFileReferences,
} from "../learner-file-response";

const upload = {
  filename: "report.pdf",
  key: "42/learner@example.com/7/report.pdf",
  bucket: "learner-bucket",
  fileType: "application/pdf",
};

describe("toSubmittedFileReference", () => {
  it("keeps exactly the reference fields and marks the content as stored", () => {
    expect(
      toSubmittedFileReference({
        ...upload,
        content: "full text ".repeat(100),
        imageUrl: "https://example.com/x.png",
        imageAnalysisResult: { width: 1 },
      }),
    ).toEqual({ ...upload, content: "InCos" });
  });

  it("omits fileType when it is missing or unusable", () => {
    const withoutType = {
      filename: upload.filename,
      key: upload.key,
      bucket: upload.bucket,
    };
    expect(toSubmittedFileReference(withoutType)).toEqual({
      ...withoutType,
      content: "InCos",
    });
    expect(
      toSubmittedFileReference({ ...upload, fileType: "x".repeat(256) }),
    ).not.toHaveProperty("fileType");
  });

  it("drops a repository entry saved by an older client", () => {
    expect(
      toSubmittedFileReference({
        filename: "main.py",
        githubUrl: "https://github.com/o/r/blob/main/main.py",
        owner: "o",
        repo: "r",
        path: "main.py",
        content: "print('hi')",
      }),
    ).toBeNull();
  });

  it.each([
    ["no key", { ...upload, key: undefined }],
    ["no bucket", { ...upload, bucket: undefined }],
    ["a blank key", { ...upload, key: "  " }],
    ["a non-string bucket", { ...upload, bucket: 7 }],
    ["an oversized key", { ...upload, key: "k".repeat(1025) }],
    ["an oversized bucket", { ...upload, bucket: "b".repeat(256) }],
  ])("drops an entry with %s", (_label, entry) => {
    expect(toSubmittedFileReference(entry)).toBeNull();
  });

  it.each([null, undefined, "report.pdf", 7])("drops %p", (entry) => {
    expect(toSubmittedFileReference(entry)).toBeNull();
  });

  it("names a file from its key when the name is missing and caps long names", () => {
    expect(
      toSubmittedFileReference({ ...upload, filename: "" })?.filename,
    ).toBe("report.pdf");
    expect(
      toSubmittedFileReference({ ...upload, filename: "n".repeat(300) })
        ?.filename,
    ).toHaveLength(255);
  });
});

describe("toSubmittedFileReferences", () => {
  it("keeps usable references in order and drops the rest", () => {
    const second = { ...upload, filename: "b.pdf", key: "42/u/7/b.pdf" };
    expect(
      toSubmittedFileReferences([
        upload,
        { filename: "repo.py", githubUrl: "https://github.com/o/r" },
        second,
      ]),
    ).toEqual([
      { ...upload, content: "InCos" },
      { ...second, content: "InCos" },
    ]);
  });

  it("returns an empty list for anything that is not a list", () => {
    expect(toSubmittedFileReferences(undefined)).toEqual([]);
    expect(toSubmittedFileReferences({ ...upload })).toEqual([]);
  });
});
