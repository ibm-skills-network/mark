import type { CorrectAnswerVisibility } from "@/config/types";

type LevelPrefill = {
  level: number;
  config: {
    attemptsBeforeCoolDown: number;
    retakeAttemptCoolDownMinutes: number;
  };
  feedback: {
    showAssignmentScore: boolean;
    showQuestionScore: boolean;
    showSubmissionFeedback: boolean;
    showQuestions: boolean;
    correctAnswerVisibility: CorrectAnswerVisibility;
  };
};

// Match "Level 1-4" in titles; case-insensitive.
const LEVEL_TITLE_REGEX = /\blevel\s+([1-4])\b/i;

export function getLevelPrefillFromTitle(
  title?: string | null,
): LevelPrefill | null {
  if (!title) return null;
  const match = LEVEL_TITLE_REGEX.exec(title);
  if (!match) return null;

  const level = Number.parseInt(match[1], 10);
  if (Number.isNaN(level)) return null;

  // Standard wait-after-every-attempt cooldown.
  const config = {
    attemptsBeforeCoolDown: 1,
    retakeAttemptCoolDownMinutes: 5,
  };

  if (level === 3) {
    return {
      level,
      config,
      feedback: {
        showAssignmentScore: true,
        showQuestionScore: false,
        showSubmissionFeedback: false,
        showQuestions: false,
        correctAnswerVisibility: "NEVER",
      },
    };
  }

  return {
    level,
    config,
    feedback: {
      showAssignmentScore: true,
      showQuestionScore: true,
      showSubmissionFeedback: false,
      showQuestions: true,
      correctAnswerVisibility: "ON_PASS",
    },
  };
}
