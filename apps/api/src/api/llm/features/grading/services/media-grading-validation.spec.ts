import { z } from "zod";
import {
  mediaGradeSchema,
  validateMediaGrade,
  assertUsableMediaEvidence,
} from "./media-grading-validation";
import { VideoPresentationGradingService } from "./video-grading.service";

const scoring = {
  rubrics: [
    {
      rubricQuestion: "Evidence",
      criteria: [
        { description: "No example", points: 0 },
        { description: "Explain a concrete example", points: 2 },
      ],
    },
    {
      rubricQuestion: "Conclusion",
      criteria: [
        { description: "Absent", points: 0 },
        { description: "State the conclusion", points: 1 },
      ],
    },
  ],
};
const sources = {
  transcript:
    "For example, costs fell by 20%. Therefore we recommend adoption.",
};
const grade = () => ({
  points: 3,
  feedback: "Supported by the example and conclusion.",
  rubricScores: [
    {
      criterionId: "rubric-1",
      pointsAwarded: 2,
      assessmentStatus: "assessed" as const,
      justification: "Concrete example",
      evidence: [{ source: "transcript", quote: "costs fell by 20%" }],
    },
    {
      criterionId: "rubric-2",
      pointsAwarded: 1,
      assessmentStatus: "assessed" as const,
      justification: "Conclusion",
      evidence: [{ source: "transcript", quote: "we recommend adoption" }],
    },
  ],
});
const schema = mediaGradeSchema(
  z.object({ points: z.number(), feedback: z.string() }),
  3,
  scoring,
);

describe("Presentation grading evidence and score validation", () => {
  it("accepts supported rubric scores and a matching total", () => {
    expect(() =>
      validateMediaGrade(schema.parse(grade()), scoring, sources),
    ).not.toThrow();
  });
  it.each([-1, 4, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid total %s",
    (points) => {
      expect(schema.safeParse({ ...grade(), points }).success).toBe(false);
    },
  );
  it("rejects omitted rubric criteria", () => {
    expect(
      schema.safeParse({ ...grade(), rubricScores: [grade().rubricScores[0]] })
        .success,
    ).toBe(false);
  });
  it.each([
    "duplicate",
    "unknown",
    "interpolated",
    "sum",
    "invented",
    "missing",
    "source",
  ])("rejects %s rubric evidence/scores", (defect) => {
    const result = grade();
    if (defect === "duplicate") result.rubricScores[1].criterionId = "rubric-1";
    if (defect === "unknown") result.rubricScores[1].criterionId = "rubric-99";
    if (defect === "interpolated") result.rubricScores[0].pointsAwarded = 1;
    if (defect === "sum") result.points = 2;
    if (defect === "invented")
      result.rubricScores[0].evidence[0].quote = "excellent eye contact";
    if (defect === "missing") result.rubricScores[0].evidence = [];
    if (defect === "source")
      result.rubricScores[0].evidence[0].source = "unseenVideo";
    expect(() => validateMediaGrade(result, scoring, sources)).toThrow();
  });
  it("allows minimum scores with no evidence", () => {
    const result = grade();
    result.points = 0;
    result.rubricScores.forEach((s) => {
      s.pointsAwarded = 0;
      s.evidence = [];
    });
    expect(() => validateMediaGrade(result, scoring, sources)).not.toThrow();
  });
  it("rejects absent extracted evidence rather than fabricating a grade", () => {
    expect(() =>
      assertUsableMediaEvidence({ transcript: " ", slidesData: "[]" }),
    ).toThrow("No usable presentation evidence");
    expect(() => assertUsableMediaEvidence(sources)).not.toThrow();
  });
  it("does not turn an unassessable criterion into a learner deduction", () => {
    const result = schema.parse(grade());
    result.rubricScores[0].assessmentStatus = "insufficient_evidence";
    expect(() => validateMediaGrade(result, scoring, sources)).toThrow(
      "insufficient",
    );
  });
  it("keeps bounds for non-rubric grading", () => {
    const nonRubric = mediaGradeSchema(z.object({ points: z.number() }), 5, {});
    expect(nonRubric.safeParse({ points: 6 }).success).toBe(false);
    expect(nonRubric.safeParse({ points: 3 }).success).toBe(true);
  });

  it("enforces validation at the video service boundary and sends complete evidence", async () => {
    const logger = { child: () => logger, error: jest.fn(), warn: jest.fn() };
    const processor = {
      processStructuredPromptForFeature: jest.fn().mockResolvedValue(grade()),
    };
    const service = new VideoPresentationGradingService(
      processor as never,
      {
        assessContent: jest.fn().mockResolvedValue({ action: "allow" }),
      } as never,
      logger as never,
    );
    const request = {
      question: "Explain your recommendation",
      learnerResponse: {
        ...sources,
        slidesData: [
          {
            slideNumber: 1,
            slideText: "Costs fell by 20%",
            slideImage: "data:image/png;base64,UNREADABLE_IMAGE_DATA",
          },
        ],
      },
      totalPoints: 3,
      scoringCriteria: scoring,
      scoringCriteriaType: "CRITERIA_BASED",
      videoPresentationConfig: { evaluateSlidesQuality: true },
    };
    expect(
      (await service.gradeVideoPresentationQuestion(request as never, 1))
        .points,
    ).toBe(3);
    const prompt =
      await processor.processStructuredPromptForFeature.mock.calls[0][0].format(
        {},
      );
    expect(prompt).toContain("Explain a concrete example");
    expect(prompt).toContain(sources.transcript);
    expect(prompt).toContain("Costs fell by 20%");
    expect(prompt).not.toContain("UNREADABLE_IMAGE_DATA");
    expect(prompt).toContain("A transcript alone does not establish");
    processor.processStructuredPromptForFeature.mockResolvedValue({
      ...grade(),
      points: 999,
    });
    await expect(
      service.gradeVideoPresentationQuestion(request as never, 1),
    ).rejects.toThrow("Failed to parse grading response");
  });
});
