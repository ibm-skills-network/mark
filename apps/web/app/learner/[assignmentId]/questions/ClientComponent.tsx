"use client";

import animationData from "@/animations/LoadSN.json";
import ErrorPage from "@/components/ErrorPage";
import Loading from "@/components/Loading";
import ServiceUnavailableNotice from "@/components/ServiceUnavailableNotice";
import type { QuestionStore } from "@/config/types";
import { getAiStatus } from "@/lib/ai-status";
import { getAssignment } from "@/lib/talkToBackend";
import { generateTempQuestionId } from "@/lib/utils";
import {
  buildAuthorPreviewPayload,
  readAuthorPreviewPayload,
  type AuthorPreviewPayload,
} from "@/app/learner/utils/authorPreview";
import { useAssignmentDetails, useLearnerStore } from "@/stores/learner";
import QuestionPage from "@learnerComponents/Question";
import { useEffect, useMemo, useState } from "react";

// Mirror of the server's AI_GRADED_QUESTION_TYPES — the question types whose
// grading goes through the LLM. Kept in sync with the backend kill-switch gate
// so author preview blocks exactly the assignments a learner would be blocked on.
const AI_GRADED_QUESTION_TYPES = new Set(["TEXT", "URL", "UPLOAD"]);

const isAiGradedQuestion = (question: QuestionStore): boolean =>
  AI_GRADED_QUESTION_TYPES.has(question.type ?? "");

const shuffleItems = <T,>(items: T[]): T[] => {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index--) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [
      shuffled[swapIndex],
      shuffled[index],
    ];
  }
  return shuffled;
};

const maybeShuffleChoices = (question: QuestionStore): QuestionStore => {
  if (!question.randomizedChoices || !Array.isArray(question.choices)) {
    return question;
  }

  return {
    ...question,
    choices: shuffleItems(question.choices),
  };
};

interface ClientLearnerLayoutProps {
  assignmentId: number;
  role?: "learner" | "author";
}

const ClientLearnerLayout: React.FC<ClientLearnerLayoutProps> = ({
  assignmentId,
  role,
}) => {
  const setAssignmentDetails = useAssignmentDetails(
    (state) => state.setAssignmentDetails,
  );
  const setRole = useLearnerStore((state) => state.setRole);
  const [previewPayload, setPreviewPayload] =
    useState<AuthorPreviewPayload | null>(() =>
      readAuthorPreviewPayload(assignmentId),
    );
  const [previewError, setPreviewError] = useState<string | null>(null);
  // null = not yet resolved; false = AI grading available; true = paused by the
  // kill-switch. Used only to gate the preview UX — the backend still blocks
  // every paid AI call regardless of what we render here.
  const [aiGradingPaused, setAiGradingPaused] = useState<boolean | null>(null);

  useEffect(() => {
    setRole(role || "learner");
  }, [role, setRole]);

  useEffect(() => {
    let cancelled = false;

    void getAiStatus().then((status) => {
      if (cancelled) return;
      // A failed status fetch returns undefined — fail open (treat as available)
      // since the server enforces the real gate; we only suppress the preview
      // when we positively know grading is paused.
      setAiGradingPaused(status ? status.grading === false : false);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadPreviewPayload() {
      setPreviewError(null);
      const storedPayload = readAuthorPreviewPayload(assignmentId);
      if (storedPayload) {
        if (!cancelled) {
          setPreviewPayload(storedPayload);
        }
        return;
      }

      setPreviewPayload(null);

      try {
        const assignment = await getAssignment(assignmentId);
        if (cancelled) return;

        if (assignment) {
          setPreviewPayload(buildAuthorPreviewPayload(assignment));
        } else {
          setPreviewError("Assignment could not be loaded for preview.");
        }
      } catch {
        if (!cancelled) {
          setPreviewError("Assignment could not be loaded for preview.");
        }
      }
    }

    void loadPreviewPayload();

    return () => {
      cancelled = true;
    };
  }, [assignmentId]);

  const assignmentDetails = previewPayload?.assignmentDetails;
  const allQuestions = previewPayload?.questions ?? [];
  const numberOfQuestionsPerAttempt =
    assignmentDetails?.numberOfQuestionsPerAttempt || null;
  const displayOrder = assignmentDetails?.displayOrder;
  // Content-based dep: `allQuestions` is a fresh array each render (re-parsed
  // from localStorage), so we key the memo on the question id list instead of
  // the array ref — otherwise the shuffle would re-run on every render.
  const questionShuffleKey = allQuestions
    .map((q) => {
      const choicesKey = Array.isArray(q.choices)
        ? q.choices
            .map((choice) =>
              typeof choice === "object" && choice !== null
                ? `${choice.choice}:${choice.points}:${choice.isCorrect}:${choice.feedback ?? ""}`
                : String(choice),
            )
            .join("~")
        : "";

      return `${q.id}:${q.randomizedChoices === true}:${choicesKey}`;
    })
    .join("|");
  const questions: QuestionStore[] = useMemo(() => {
    const shouldShuffle =
      displayOrder === "RANDOM" ||
      (numberOfQuestionsPerAttempt !== null && numberOfQuestionsPerAttempt > 0);

    if (!shouldShuffle) return allQuestions.map(maybeShuffleChoices);

    const pool = shuffleItems(allQuestions);

    const selectedQuestions =
      numberOfQuestionsPerAttempt && numberOfQuestionsPerAttempt > 0
        ? pool.slice(0, numberOfQuestionsPerAttempt)
        : pool;

    return selectedQuestions.map(maybeShuffleChoices);
  }, [questionShuffleKey, displayOrder, numberOfQuestionsPerAttempt]);
  useEffect(() => {
    if (!assignmentDetails) return;

    setAssignmentDetails({
      ...assignmentDetails,
      showQuestions: assignmentDetails.showQuestions || false,
      introduction: assignmentDetails.introduction || "",
      graded: assignmentDetails.graded || false,
      published: assignmentDetails.published || false,
      questionOrder: assignmentDetails.questionOrder || [],
      updatedAt:
        typeof assignmentDetails.updatedAt === "string"
          ? Date.parse(assignmentDetails.updatedAt)
          : assignmentDetails.updatedAt || Date.now(),
      passingGrade: assignmentDetails.passingGrade || 0,
      showSubmissionFeedback: assignmentDetails.showSubmissionFeedback || false,
      showQuestionScore: assignmentDetails.showQuestionScore || false,
      showPassFailIndicator: assignmentDetails.showPassFailIndicator || false,
      showAssignmentScore: assignmentDetails.showAssignmentScore || false,
      questionControls: assignmentDetails.questionControls,
    });
  }, [assignmentDetails, setAssignmentDetails]);

  if (previewError) {
    return <ErrorPage error={previewError} statusCode={500} />;
  }

  if (!previewPayload || !assignmentDetails) {
    return <Loading animationData={animationData} />;
  }

  // Author preview never hits the gated learner attempt-creation path, so the
  // kill-switch has to be applied here too. When this assignment is AI-graded,
  // hold the preview until the status resolves, then show the same out-of-service
  // notice a learner would see rather than letting the author run a quiz that
  // can't be graded. Non-AI (e.g. MCQ) previews are unaffected.
  const previewHasAiGradedQuestion = allQuestions.some(isAiGradedQuestion);
  if (previewHasAiGradedQuestion) {
    if (aiGradingPaused === null) {
      return <Loading animationData={animationData} />;
    }
    if (aiGradingPaused) {
      return (
        <ServiceUnavailableNotice message="This assignment is graded with AI, which is paused for maintenance right now. Learners won't be able to start it until AI is back." />
      );
    }
  }

  return (
    <main className="flex flex-col h-[calc(100vh-100px)]">
      <QuestionPage
        attempt={{
          id: generateTempQuestionId(),
          assignmentId,
          submitted: false,
          questions,
          assignmentDetails,
          expiresAt:
            assignmentDetails?.strictTimeLimit === true
              ? new Date(
                  Date.now() +
                    (assignmentDetails?.allotedTimeMinutes || 0) * 60000,
                ).toISOString()
              : null,
        }}
        assignmentId={assignmentId}
      />
    </main>
  );
};

export default ClientLearnerLayout;
