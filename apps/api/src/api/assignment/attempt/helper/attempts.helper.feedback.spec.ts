import { FileBasedQuestionResponseModel } from "../../../llm/model/file.based.question.response.model";
import { CreateQuestionResponseAttemptResponseDto } from "../dto/question-response/create.question.response.attempt.response.dto";
import { AttemptHelper } from "./attempts.helper";

describe("AttemptHelper learner feedback", () => {
  it("uses structured feedback for rubric-based file grading", () => {
    const model = new FileBasedQuestionResponseModel(
      2,
      "Score: 2/3. Areas for Improvement: (e.g., p1b65)",
      undefined,
      undefined,
      undefined,
      undefined,
      [
        {
          rubricQuestion: "Interpret the regression model",
          pointsAwarded: 2,
          maxPoints: 3,
          justification:
            "The model is built, but the coefficient is not interpreted in the context of exam scores. (p1b65)",
          nextStep:
            "State how much the predicted exam score changes for each additional hour studied.",
          evidence: ["p1:p1b65 model = LinearRegression()"],
          status: "partial",
        },
      ],
    );
    const response = new CreateQuestionResponseAttemptResponseDto();

    AttemptHelper.assignFeedbackToResponse(model, response);

    const feedback = response.feedback?.[0];
    expect(feedback).toMatchObject({
      structuredFeedback: {
        criteria: [
          expect.objectContaining({
            name: "Interpret the regression model",
            nextStep:
              "State how much the predicted exam score changes for each additional hour studied.",
          }),
        ],
      },
    });
    expect(JSON.stringify(feedback)).not.toContain("p1b65");
  });
});
