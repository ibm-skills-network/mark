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
    template: `You are grading a single rubric criterion using ONLY the provided evidence chunks.

QUESTION:
{question}

CRITERION:
{criterion}

ALLOWED POINTS:
{allowed_points}

EVIDENCE CHUNKS:
{evidence}

JUDGE FEEDBACK (if any):
{judge_feedback}

OUTPUT RULES:
- Choose EXACTLY one of the allowed points.
- Provide rationale grounded in the cited chunkIds.
- Cite chunkIds in citations array.
- Confidence must be high, medium, or low.
- Do NOT award points based on restatement of the question, rubric language, or boilerplate content.

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
