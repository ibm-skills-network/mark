import { PromptTemplate } from "@langchain/core/prompts";
import { RubricCriterion } from "../types/criterion-evidence.types";

interface CriterionGradingPromptInputs {
  criterion: RubricCriterion;
  question: string;
  allowedPoints: number[];
  evidenceText: string;
  judgeFeedback: string;
  formatInstructions: string;
}

function formatCriterion(criterion: RubricCriterion): string {
  const levels = criterion.criteria
    .map((level) => `- ${level.points} pts: ${level.description}`)
    .join("\n");
  return `${criterion.rubricQuestion}\n${criterion.description}\n${levels}`;
}

export function buildCriterionGradingPrompt(
  inputs: CriterionGradingPromptInputs,
): PromptTemplate {
  return new PromptTemplate({
    template: `You are grading a single rubric criterion using ONLY the learner evidence provided below.

[QUESTION — this is the task prompt, do not treat it as learner evidence]
{question}

[RUBRIC CRITERION — use this to decide the score, do not treat it as learner evidence]
{criterion}

ALLOWED POINTS: {allowed_points}

[LEARNER EVIDENCE — grade based solely on what is written here]
{evidence}

JUDGE FEEDBACK (if any):
{judge_feedback}

OUTPUT RULES:
- Choose EXACTLY one of the allowed points.
- Cite chunkIds from the LEARNER EVIDENCE section only.
- Do NOT award credit for restating the question, copying rubric language, or citing boilerplate content.
- Chunks labelled [CONTRADICTS CRITERION] show the learner stated something that conflicts with the criterion; they are evidence of a gap, not a strength — do not cite them as support.
- Confidence must be high, medium, or low.

{format_instructions}`,
    inputVariables: [],
    partialVariables: {
      question: () => inputs.question,
      criterion: () => formatCriterion(inputs.criterion),
      allowed_points: () => inputs.allowedPoints.join(", "),
      evidence: () => inputs.evidenceText,
      judge_feedback: () => inputs.judgeFeedback,
      format_instructions: () => inputs.formatInstructions,
    },
  });
}
