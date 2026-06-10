import { FileRef, pickFileRefs } from "./job-file-refs";

describe("pickFileRefs", () => {
  describe("grading-shaped payloads", () => {
    it("extracts file refs from a real grading payload (updateDto -> responsesForQuestions -> learnerFileResponse)", () => {
      const payload: Record<string, unknown> = {
        gradingJobId: "grade:42",
        attemptId: 42,
        assignmentId: 7,
        // userId must never appear in the output, even nested here.
        userSession: { userId: "student@example.com", role: "learner" },
        updateDto: {
          submitted: true,
          responsesForQuestions: [
            {
              id: 1,
              question: "Upload your essay",
              learnerTextResponse: "see attached",
              learnerFileResponse: [
                {
                  filename: "essay.pdf",
                  mimeType: "application/pdf",
                  bucket: "mark-cos",
                  key: "attempts/42/q1/essay.pdf",
                  content: "BASE64-CONTENT-SHOULD-NOT-LEAK",
                },
              ],
            },
            {
              id: 2,
              question: "Upload diagram",
              learnerFileResponse: [
                {
                  filename: "diagram.png",
                  mimeType: "image/png",
                  bucket: "mark-cos",
                  key: "attempts/42/q2/diagram.png",
                },
              ],
            },
          ],
        },
      };

      expect(pickFileRefs(payload)).toEqual<FileRef[]>([
        {
          filename: "essay.pdf",
          mimeType: "application/pdf",
          bucket: "mark-cos",
          storageKey: "attempts/42/q1/essay.pdf",
        },
        {
          filename: "diagram.png",
          mimeType: "image/png",
          bucket: "mark-cos",
          storageKey: "attempts/42/q2/diagram.png",
        },
      ]);
    });

    it("never surfaces learner content, userId, or other non-file fields", () => {
      const payload: Record<string, unknown> = {
        userSession: { userId: "student@example.com" },
        updateDto: {
          responsesForQuestions: [
            {
              id: 1,
              learnerFileResponse: [
                {
                  filename: "essay.pdf",
                  mimeType: "application/pdf",
                  bucket: "mark-cos",
                  key: "k/essay.pdf",
                  content: "SECRET-CONTENT",
                  extractedText: "the whole essay text",
                  owner: "student@example.com",
                },
              ],
            },
          ],
        },
      };

      const refs = pickFileRefs(payload);
      expect(refs).toHaveLength(1);
      const serialized = JSON.stringify(refs);
      expect(serialized).not.toContain("SECRET-CONTENT");
      expect(serialized).not.toContain("the whole essay text");
      expect(serialized).not.toContain("student@example.com");
      expect(Object.keys(refs[0]).sort()).toEqual([
        "bucket",
        "filename",
        "mimeType",
        "storageKey",
      ]);
    });

    it("collects files across multiple responses and multiple files per response", () => {
      const payload: Record<string, unknown> = {
        updateDto: {
          responsesForQuestions: [
            {
              id: 1,
              learnerFileResponse: [
                { filename: "a.pdf", key: "k/a", bucket: "b" },
                { filename: "b.pdf", key: "k/b", bucket: "b" },
              ],
            },
            {
              id: 2,
              learnerFileResponse: [
                { filename: "c.pdf", key: "k/c", bucket: "b" },
              ],
            },
          ],
        },
      };

      expect(pickFileRefs(payload).map((r) => r.filename)).toEqual([
        "a.pdf",
        "b.pdf",
        "c.pdf",
      ]);
    });

    it("emits a ref when only a storage key is present (bucket optional)", () => {
      const payload: Record<string, unknown> = {
        updateDto: {
          responsesForQuestions: [
            {
              id: 1,
              learnerFileResponse: [
                {
                  filename: "keyed.pdf",
                  key: "k/keyed",
                  mimeType: "application/pdf",
                },
              ],
            },
          ],
        },
      };

      expect(pickFileRefs(payload)).toEqual<FileRef[]>([
        {
          filename: "keyed.pdf",
          mimeType: "application/pdf",
          storageKey: "k/keyed",
        },
      ]);
    });

    it("emits a ref when only a bucket is present (storageKey optional)", () => {
      const payload: Record<string, unknown> = {
        updateDto: {
          responsesForQuestions: [
            {
              id: 1,
              learnerFileResponse: [{ filename: "bucketed.pdf", bucket: "b" }],
            },
          ],
        },
      };

      expect(pickFileRefs(payload)).toEqual<FileRef[]>([
        { filename: "bucketed.pdf", bucket: "b" },
      ]);
    });
  });

  describe("direct file arrays (AssignmentFile-shaped)", () => {
    it("extracts from root files[] using storageKey/storageBucket/size", () => {
      const payload: Record<string, unknown> = {
        files: [
          {
            filename: "syllabus.pdf",
            mimeType: "application/pdf",
            size: 20480,
            storageKey: "assignments/9/syllabus.pdf",
            storageBucket: "mark-cos",
          },
        ],
      };

      expect(pickFileRefs(payload)).toEqual<FileRef[]>([
        {
          filename: "syllabus.pdf",
          mimeType: "application/pdf",
          sizeBytes: 20480,
          bucket: "mark-cos",
          storageKey: "assignments/9/syllabus.pdf",
        },
      ]);
    });

    it("extracts from root assignmentFiles[]", () => {
      const payload: Record<string, unknown> = {
        assignmentFiles: [
          {
            filename: "rubric.docx",
            storageKey: "assignments/9/rubric.docx",
            storageBucket: "mark-cos",
          },
        ],
      };

      expect(pickFileRefs(payload).map((r) => r.filename)).toEqual([
        "rubric.docx",
      ]);
    });

    it("combines grading files and direct files in one payload", () => {
      const payload: Record<string, unknown> = {
        updateDto: {
          responsesForQuestions: [
            {
              id: 1,
              learnerFileResponse: [
                { filename: "essay.pdf", key: "k/e", bucket: "b" },
              ],
            },
          ],
        },
        files: [
          { filename: "syllabus.pdf", storageKey: "s/k", storageBucket: "b" },
        ],
      };

      expect(pickFileRefs(payload).map((r) => r.filename)).toEqual([
        "essay.pdf",
        "syllabus.pdf",
      ]);
    });
  });

  describe("empty payloads", () => {
    it("returns [] for an empty object", () => {
      expect(pickFileRefs({})).toEqual([]);
    });

    it("returns [] for a grading payload with no file responses", () => {
      const payload: Record<string, unknown> = {
        updateDto: {
          submitted: true,
          responsesForQuestions: [
            { id: 1, learnerTextResponse: "text-only answer" },
            { id: 2, learnerChoices: ["A", "B"] },
          ],
        },
      };

      expect(pickFileRefs(payload)).toEqual([]);
    });

    it("returns [] for a non-file payload (e.g. translation job)", () => {
      const payload: Record<string, unknown> = {
        parentJobId: "p1",
        assignmentId: 5,
        questionId: 9,
        question: { id: 9, question: "What is 2+2?" },
      };

      expect(pickFileRefs(payload)).toEqual([]);
    });
  });

  describe("malformed / defensive cases", () => {
    it.each([
      ["null", null],
      ["undefined", undefined],
      ["a string", "not-an-object"],
      ["a number", 123],
      ["an array", [{ filename: "x.pdf", key: "k", bucket: "b" }]],
    ])("returns [] for %s", (_label, input) => {
      expect(pickFileRefs(input as unknown as Record<string, unknown>)).toEqual(
        [],
      );
    });

    it("tolerates updateDto that is not an object", () => {
      expect(pickFileRefs({ updateDto: "nope" })).toEqual([]);
      expect(pickFileRefs({ updateDto: 42 })).toEqual([]);
      expect(pickFileRefs({ updateDto: null })).toEqual([]);
    });

    it("tolerates responsesForQuestions that is not an array", () => {
      expect(
        pickFileRefs({ updateDto: { responsesForQuestions: "x" } }),
      ).toEqual([]);
      expect(
        pickFileRefs({ updateDto: { responsesForQuestions: {} } }),
      ).toEqual([]);
    });

    it("tolerates learnerFileResponse that is not an array", () => {
      const payload: Record<string, unknown> = {
        updateDto: {
          responsesForQuestions: [{ id: 1, learnerFileResponse: "oops" }],
        },
      };
      expect(pickFileRefs(payload)).toEqual([]);
    });

    it("skips non-object and null entries inside arrays", () => {
      const payload: Record<string, unknown> = {
        updateDto: {
          responsesForQuestions: [
            null,
            "garbage",
            42,
            {
              id: 1,
              learnerFileResponse: [
                null,
                "garbage",
                { filename: "good.pdf", key: "k/good", bucket: "b" },
              ],
            },
          ],
        },
        files: [
          null,
          7,
          { filename: "ok.pdf", storageKey: "s/k", storageBucket: "b" },
        ],
      };

      expect(pickFileRefs(payload).map((r) => r.filename)).toEqual([
        "good.pdf",
        "ok.pdf",
      ]);
    });

    it("skips files missing a usable filename", () => {
      const payload: Record<string, unknown> = {
        updateDto: {
          responsesForQuestions: [
            {
              id: 1,
              learnerFileResponse: [
                { key: "k/1", bucket: "b" },
                { filename: "", key: "k/2", bucket: "b" },
                { filename: 123, key: "k/3", bucket: "b" },
                { filename: "valid.pdf", key: "k/4", bucket: "b" },
              ],
            },
          ],
        },
      };

      expect(pickFileRefs(payload).map((r) => r.filename)).toEqual([
        "valid.pdf",
      ]);
    });

    it("skips files with no storage coordinates (nothing to download)", () => {
      const payload: Record<string, unknown> = {
        updateDto: {
          responsesForQuestions: [
            {
              id: 1,
              learnerFileResponse: [
                // No key/storageKey and no bucket/storageBucket — undownloadable.
                {
                  filename: "orphan.pdf",
                  mimeType: "application/pdf",
                  content: "x",
                },
                { filename: "downloadable.pdf", key: "k", bucket: "b" },
              ],
            },
          ],
        },
      };

      expect(pickFileRefs(payload).map((r) => r.filename)).toEqual([
        "downloadable.pdf",
      ]);
    });

    it("ignores non-string storage/mime fields and negative or non-finite sizes", () => {
      const payload: Record<string, unknown> = {
        files: [
          {
            filename: "weird.pdf",
            mimeType: 999,
            size: -10,
            storageKey: "s/k",
            storageBucket: "b",
          },
          {
            filename: "weird2.pdf",
            size: Number.NaN,
            storageKey: 12345,
            storageBucket: "b",
          },
        ],
      };

      expect(pickFileRefs(payload)).toEqual<FileRef[]>([
        { filename: "weird.pdf", bucket: "b", storageKey: "s/k" },
        // storageKey 12345 is non-string so dropped; bucket "b" keeps it downloadable.
        { filename: "weird2.pdf", bucket: "b" },
      ]);
    });

    it("accepts a zero-byte size", () => {
      const payload: Record<string, unknown> = {
        files: [
          {
            filename: "empty.txt",
            size: 0,
            storageKey: "s/k",
            storageBucket: "b",
          },
        ],
      };

      expect(pickFileRefs(payload)[0]).toEqual<FileRef>({
        filename: "empty.txt",
        sizeBytes: 0,
        bucket: "b",
        storageKey: "s/k",
      });
    });
  });
});
