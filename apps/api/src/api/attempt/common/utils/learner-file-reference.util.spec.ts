import {
  findLearnerFileReferenceDenial,
  LearnerFileReferenceScope,
} from "./learner-file-reference.util";

describe("findLearnerFileReferenceDenial", () => {
  const scope: LearnerFileReferenceScope = {
    assignmentId: 12,
    userId: "learner@example.com",
    questionId: 34,
    allowedBuckets: new Set(["learner-bucket"]),
  };
  const prefix = "12/learner@example.com/34/";

  it("accepts the learner's own upload for the question", () => {
    expect(
      findLearnerFileReferenceDenial(
        [{ bucket: "learner-bucket", key: `${prefix}abc-report.pdf` }],
        scope,
      ),
    ).toBeNull();
  });

  it("refuses a bucket that is not a learner upload bucket", () => {
    expect(
      findLearnerFileReferenceDenial(
        [{ bucket: "author-bucket", key: `${prefix}abc-report.pdf` }],
        scope,
      ),
    ).toBe("bucket_not_allowed");
  });

  it("refuses a key outside the learner's prefix", () => {
    expect(
      findLearnerFileReferenceDenial(
        [{ bucket: "learner-bucket", key: "12/other@example.com/34/a.pdf" }],
        scope,
      ),
    ).toBe("key_outside_learner_prefix");
  });

  it.each([
    ["a parent segment", `${prefix}../../../other@example.com/34/a.pdf`],
    ["a current-directory segment", `${prefix}./a.pdf`],
    ["an empty segment", `${prefix}/a.pdf`],
    ["a trailing slash", `${prefix}folder/`],
    ["a backslash", `${prefix}..\\a.pdf`],
    ["a control character", `${prefix}a\u0000.pdf`],
    ["a C1 control character", `${prefix}a\u0085.pdf`],
  ])("refuses a key with %s even under the prefix", (_label, key) => {
    expect(
      findLearnerFileReferenceDenial(
        [{ bucket: "learner-bucket", key }],
        scope,
      ),
    ).toBe("malformed_key");
  });

  it("refuses when any one of several files is malformed", () => {
    expect(
      findLearnerFileReferenceDenial(
        [
          { bucket: "learner-bucket", key: `${prefix}ok.pdf` },
          { bucket: "learner-bucket", key: `${prefix}x/../../y.pdf` },
        ],
        scope,
      ),
    ).toBe("malformed_key");
  });
});
