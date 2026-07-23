import { RubricScore } from "../../../model/file.based.question.response.model";

export interface LearnerCriterionFeedback {
  name: string;
  pointsAwarded: number;
  maxPoints: number;
  status: "full" | "partial" | "none";
  evidence: string;
  feedback: string;
  nextStep?: string;
}

export interface LearnerStructuredFeedback {
  summary: string;
  criteria: LearnerCriterionFeedback[];
  guidance: string;
}

const INTERNAL_REFERENCE_PATTERNS = [
  /\(\s*(?:e\.g\.,?\s*)?p\d+b\d+\s*\)/gi,
  /\bp\d+:p\d+b\d+\b/gi,
  /\bp\d+b\d+\b/gi,
  /\b(?:chunkid|blockid)\s*[#:=]?\s*[\w-]+\b/gi,
];

const GRADING_ARTIFACTS = [
  /\badditional corrections needed for full credit\.?/gi,
  /\bmissing required evidence or corrections\.?/gi,
  /\bbased on the (?:provided )?evidence,?\s*/gi,
  /\bthe evidence (?:shows|indicates|suggests) that\s*/gi,
  /\bthis (?:criterion|rubric item) (?:is|was) (?:fully |partially )?met\.?/gi,
];

export function sanitizeLearnerFeedback(value: unknown): string {
  let text = typeof value === "string" ? value : String(value ?? "");
  for (const pattern of INTERNAL_REFERENCE_PATTERNS) {
    text = text.replaceAll(pattern, "");
  }
  for (const pattern of GRADING_ARTIFACTS) {
    text = text.replaceAll(pattern, "");
  }

  const cleaned = text
    .replaceAll(/[\t ]+/g, " ")
    .replaceAll(/\s+([!,.:;?])/g, "$1")
    .replaceAll(/\n{3,}/g, "\n\n")
    .trim();
  return cleaned ? cleaned[0].toUpperCase() + cleaned.slice(1) : "";
}

function normalizeStatus(score: RubricScore): "full" | "partial" | "none" {
  if (
    score.status === "full" ||
    score.status === "partial" ||
    score.status === "none"
  ) {
    return score.status;
  }
  const awarded = score.pointsAwarded ?? 0;
  const maximum = score.maxPoints ?? 0;
  if (maximum > 0 && awarded >= maximum) return "full";
  return awarded > 0 ? "partial" : "none";
}

function humanizeEvidence(evidence?: string[]): string {
  if (!evidence?.length) return "";
  const useful = evidence
    .map((item) => sanitizeLearnerFeedback(item))
    .filter(Boolean)
    .filter((item) => !/no supporting evidence found/i.test(item));
  return useful.slice(0, 2).join(" · ").slice(0, 500);
}

function inferNextStep(score: RubricScore, feedback: string): string {
  const explicit = sanitizeLearnerFeedback(score.nextStep);
  if (explicit) return explicit;

  const actionable = feedback
    .split(/(?<=[!.?])\s+/)
    .find((sentence) =>
      /\b(add|include|explain|clarify|show|state|describe|compare|test|report|interpret|document|revise|replace|remove)\b/i.test(
        sentence,
      ),
    );
  if (actionable) return actionable;

  return "Revise this part of the submission to address the missing detail described above.";
}

export function buildLearnerStructuredFeedback(
  points: number,
  rubricScores: RubricScore[],
  overallFeedback?: string,
): LearnerStructuredFeedback {
  const criteria = rubricScores.map((score, index) => {
    const status = normalizeStatus(score);
    const feedback =
      sanitizeLearnerFeedback(score.justification) ||
      (status === "full"
        ? "The submission addresses this area clearly."
        : "The submission does not yet provide enough detail in this area.");

    return {
      name:
        sanitizeLearnerFeedback(score.rubricQuestion) ||
        `Criterion ${index + 1}`,
      pointsAwarded: score.pointsAwarded ?? 0,
      maxPoints: score.maxPoints ?? 0,
      status,
      evidence: humanizeEvidence(score.evidence),
      feedback,
      ...(status === "full"
        ? {}
        : { nextStep: inferNextStep(score, feedback) }),
    };
  });

  const maximum = criteria.reduce(
    (sum, criterion) => sum + criterion.maxPoints,
    0,
  );
  const fullyMet = criteria.filter(
    (criterion) => criterion.status === "full",
  ).length;
  const summary =
    maximum > 0
      ? `You earned ${points}/${maximum}. ${fullyMet} of ${criteria.length} criteria were fully met.`
      : sanitizeLearnerFeedback(overallFeedback);
  const priorities = criteria
    .filter((criterion) => criterion.status !== "full" && criterion.nextStep)
    .slice(0, 3)
    .map((criterion) => `${criterion.name}: ${criterion.nextStep}`);

  return {
    summary,
    criteria,
    guidance:
      priorities.length > 0
        ? priorities.map((priority) => `- ${priority}`).join("\n")
        : "All assessed criteria were fully met.",
  };
}
