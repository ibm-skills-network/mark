import { PromptTemplate } from "@langchain/core/prompts";
import {
  CriterionEvidenceResponse,
  CriterionGrade,
  RubricCriterion,
} from "../types/criterion-evidence.types";

interface CriterionJudgePromptInputs {
  question: string;
  criteria: RubricCriterion[];
  grades: CriterionGrade[];
  evidence: CriterionEvidenceResponse[];
  formatInstructions: string;
}

export function buildCriterionJudgePrompt(
  inputs: CriterionJudgePromptInputs,
): PromptTemplate {
  return new PromptTemplate({
    template: `You are a grading judge. Review rubric criteria, grader outputs, and evidence citations.

QUESTION:
{question}

RUBRIC:
{rubric}

CRITERION OUTPUTS:
{outputs}

EVIDENCE SUMMARY:
{evidence}

CHECKS (flag issues for any of these):
- Cited quote must exist verbatim in the evidence chunks, not in the question or rubric text.
- Citation must semantically satisfy the criterion, not merely restate it or repeat prompt/rubric language.
- Score must be one of the allowed point levels for that criterion.
- Rationale must not rely on metadata, boilerplate, page labels, or copied question/rubric text.
- If evidence is only restatement_only or boilerplate_only, credit above minimum is not justified.

Return issues per criterionId if any. Approve only if all checks pass.

{format_instructions}`,
    inputVariables: [],
    partialVariables: {
      question: () => inputs.question,
      rubric: () =>
        inputs.criteria
          .map(
            (c) =>
              `${c.id}: ${c.rubricQuestion} (${c.maxPoints} pts, allowed: ${c.criteria.map((l) => l.points).join(", ")})`,
          )
          .join("\n"),
      outputs: () =>
        inputs.grades
          .map(
            (g) =>
              `${g.criterionId}: ${g.pointsAwarded}/${g.maxPoints} | citations: ${g.citations.join(", ")} | rationale: ${g.rationale}`,
          )
          .join("\n"),
      evidence: () =>
        inputs.evidence
          .map((item) => {
            const citations = item.evidence
              .map((e) => `${e.chunkId}: ${e.quote}`)
              .slice(0, 3)
              .join(" | ");
            return `${item.criterionId}: ${citations}`;
          })
          .join("\n"),
      format_instructions: () => inputs.formatInstructions,
    },
  });
}
