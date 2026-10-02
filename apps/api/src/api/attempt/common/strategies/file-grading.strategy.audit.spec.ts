import { FileGradingStrategy } from "./file-grading.strategy";

async function internallyJudged(
  critiques?: Array<{ approved: boolean; summary: string }>,
) {
  const strategy: any = Object.create(FileGradingStrategy.prototype);
  const validateGrading = jest.fn();
  strategy.gradingJudgeService = { validateGrading };
  const response = {
    totalPoints: 7,
    metadata: { gradingAudit: { judgeCritiques: critiques } },
  };
  const result = await strategy.iterativeGradingWithJudge(
    { id: 1 },
    [],
    response,
    {},
    {},
  );
  expect(validateGrading).not.toHaveBeenCalled();
  expect(result.totalPoints).toBe(7);
  return result.metadata;
}

describe("FileGradingStrategy internal audit metadata", () => {
  it("reports an exhausted rejected audit without claiming approval", async () => {
    const metadata = await internallyJudged([
      { approved: false, summary: "Wrong chart score" },
      { approved: false, summary: "Score remains unsupported" },
    ]);
    expect(metadata).toMatchObject({
      judgeValidated: true,
      judgeApproved: false,
      validationAttempts: 2,
      judgeFeedback: "Score remains unsupported",
    });
  });
  it("reports approval reached after retries and the actual number of audit passes", async () => {
    const metadata = await internallyJudged([
      { approved: false, summary: "Missing evidence" },
      { approved: false, summary: "Correct the rationale" },
      { approved: true, summary: "All issues resolved" },
    ]);
    expect(metadata).toMatchObject({
      judgeValidated: true,
      judgeApproved: true,
      validationAttempts: 3,
      judgeFeedback: "All issues resolved",
    });
  });
  it("does not claim validation when an audit has no verdict", async () => {
    const metadata = await internallyJudged();
    expect(metadata).toMatchObject({
      judgeValidated: false,
      judgeApproved: false,
      validationAttempts: 0,
    });
  });
});
