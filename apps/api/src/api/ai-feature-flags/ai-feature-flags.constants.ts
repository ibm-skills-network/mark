import { AIUsageType, QuestionType } from "@prisma/client";

/**
 * Components of Mark that consume the (currently OpenAI-only) LLM provider and
 * can be independently switched off. `ALL` is the master kill-switch: when it is
 * disabled, every other component is treated as disabled regardless of its own
 * flag.
 */
export enum AiFeatureComponent {
  ALL = "ALL",
  GRADING = "GRADING",
  CHAT = "CHAT",
  AUTHORING = "AUTHORING",
}

/**
 * Environment variable that seeds each component's disabled state at boot.
 * Parsed with the existing `"true"/"1"/"yes"` idiom used elsewhere in the app.
 */
export const ENV_VAR_BY_COMPONENT: Record<AiFeatureComponent, string> = {
  [AiFeatureComponent.ALL]: "AI_FEATURES_DISABLED",
  [AiFeatureComponent.GRADING]: "AI_GRADING_DISABLED",
  [AiFeatureComponent.CHAT]: "AI_CHAT_DISABLED",
  [AiFeatureComponent.AUTHORING]: "AI_AUTHORING_DISABLED",
};

/**
 * Maps each LLM usage type to the component that governs it. Used by the
 * money-backstop in the prompt processor so that no provider call is made for a
 * disabled component, even for jobs that were already queued when the switch
 * flipped. Usage types absent from this map are never gated.
 *
 * NOTE: `CHAT_ASSISTANT` is intentionally omitted — the chatbot does not route
 * through the prompt processor; it is gated directly in `MarkChatService`.
 */
export const COMPONENT_BY_USAGE_TYPE: Partial<
  Record<AIUsageType, AiFeatureComponent>
> = {
  [AIUsageType.ASSIGNMENT_GRADING]: AiFeatureComponent.GRADING,
  [AIUsageType.GRADING_VALIDATION]: AiFeatureComponent.GRADING,
  [AIUsageType.LIVE_RECORDING_FEEDBACK]: AiFeatureComponent.GRADING,
  [AIUsageType.TRANSLATION]: AiFeatureComponent.AUTHORING,
  [AIUsageType.QUESTION_GENERATION]: AiFeatureComponent.AUTHORING,
  [AIUsageType.ASSIGNMENT_GENERATION]: AiFeatureComponent.AUTHORING,
};

/**
 * Question types whose grading routes through the LLM provider (and therefore
 * cost money). An assignment is considered "AI-graded" — and is blocked while
 * grading is disabled — if it contains at least one question of these types.
 *
 * Deterministic types (`SINGLE_CORRECT`, `MULTIPLE_CORRECT`, `TRUE_FALSE`) and
 * the manual-only `LINK_FILE` are deliberately excluded, so quizzes built
 * solely from those (e.g. the sales team's MCQ quizzes) are never affected.
 */
export const AI_GRADED_QUESTION_TYPES: QuestionType[] = [
  QuestionType.TEXT,
  QuestionType.URL,
  QuestionType.UPLOAD,
];
