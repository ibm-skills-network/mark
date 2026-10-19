import type { Model } from "./types";

const assignmentFields = [
  "introduction",
  "instructions",
  "gradingCriteriaOverview",
];
export const MODELS: Model[] = [
  { name: "Assignment", fields: assignmentFields, scope: 'r."id"' },
  {
    name: "AssignmentVersion",
    fields: assignmentFields,
    scope: 'r."assignmentId"',
  },
  {
    name: "AssignmentDraft",
    fields: [...assignmentFields, "questionsData"],
    jsonFields: ["questionsData"],
    scope: 'r."assignmentId"',
  },
  {
    name: "Question",
    auditFields: ["authorComment", "scoring", "choices"],
    auditJsonFields: ["scoring", "choices"],
    fields: ["question"],
    scope: 'r."assignmentId"',
  },
  {
    name: "QuestionVersion",
    auditFields: ["authorComment", "scoring", "choices"],
    auditJsonFields: ["scoring", "choices"],
    fields: ["question"],
    scope: 'v."assignmentId"',
    joins: 'LEFT JOIN "AssignmentVersion" v ON v.id = r."assignmentVersionId"',
  },
  {
    name: "QuestionVariant",
    auditFields: ["scoring", "choices"],
    auditJsonFields: ["scoring", "choices"],
    fields: ["variantContent"],
    scope: 'q."assignmentId"',
    joins: 'LEFT JOIN "Question" q ON q.id = r."questionId"',
    context: `jsonb_build_object('questionId', r."questionId")::text`,
  },
  {
    name: "Translation",
    auditFields: ["translatedChoices", "untranslatedChoices"],
    auditJsonFields: ["translatedChoices", "untranslatedChoices"],
    fields: ["translatedText", "untranslatedText"],
    scope: 'COALESCE(q."assignmentId", vq."assignmentId")',
    joins:
      'LEFT JOIN "Question" q ON q.id = r."questionId" LEFT JOIN "QuestionVariant" v ON v.id = r."variantId" LEFT JOIN "Question" vq ON vq.id = v."questionId"',
  },
  {
    name: "AssignmentTranslation",
    fields: [
      ...assignmentFields,
      "translatedIntroduction",
      "translatedInstructions",
      "translatedGradingCriteriaOverview",
    ],
    scope: 'r."assignmentId"',
  },
  {
    name: "QuestionResponse",
    auditFields: ["feedback", "metadata"],
    auditJsonFields: ["feedback", "metadata"],
    fields: ["learnerResponse"],
    scope: 'a."assignmentId"',
    joins: 'LEFT JOIN "AssignmentAttempt" a ON a.id = r."assignmentAttemptId"',
    // Attempts from before versioning have no version; use the question's own type.
    context: `(SELECT jsonb_build_object('attemptId', r."assignmentAttemptId", 'questionId', r."questionId", 'attemptVersion', a."assignmentVersionId", 'types', CASE WHEN a.id IS NOT NULL AND a."assignmentVersionId" IS NULL THEN COALESCE((SELECT jsonb_agg(q.type::text) FROM "Question" q WHERE q.id = r."questionId"), '[]'::jsonb) ELSE COALESCE(jsonb_agg(DISTINCT v.type::text), '[]'::jsonb) END, 'typeSource', CASE WHEN a.id IS NOT NULL AND a."assignmentVersionId" IS NULL THEN 'question' ELSE 'version' END)::text FROM "QuestionVersion" v WHERE v."assignmentVersionId" = a."assignmentVersionId" AND v."questionId" = r."questionId")`,
  },
  {
    name: "FeedbackTranslation",
    fields: [],
    auditFields: ["translatedFeedback", "untranslatedFeedback"],
    auditJsonFields: ["translatedFeedback", "untranslatedFeedback"],
    scope: 'q."assignmentId"',
    joins: 'LEFT JOIN "Question" q ON q.id = r."questionId"',
  },
];

export function modelByName(name: string): Model {
  const model = MODELS.find((candidate) => candidate.name === name);
  if (!model) throw new Error("unknown-model");
  return model;
}

export function from(model: Model): string {
  return `FROM "${model.name}" r ${model.joins ?? ""}`;
}
export function scopeClause(model: Model): string {
  return `($1::int[] IS NULL OR ${model.scope} = ANY($1::int[]))`;
}
export function valuesSql(model: Model): string {
  return `jsonb_build_object(${model.fields.map((field) => `'${field}', r."${field}"${model.jsonFields?.includes(field) ? "::text" : ""}`).join(", ")})`;
}
export function contextSql(model: Model): string {
  return model.context ?? "NULL::text";
}

export function extraSql(model: Model): string {
  return `jsonb_build_object(${(model.auditFields ?? []).map((field) => `'${field}', r."${field}"${model.auditJsonFields?.includes(field) ? "::text" : ""}`).join(", ")})`;
}
