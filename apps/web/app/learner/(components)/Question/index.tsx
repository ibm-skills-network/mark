"use client";

import animationData from "@/animations/LoadSN.json";
import Loading from "@/components/Loading";
import type {
  Assignment,
  AssignmentAttemptWithQuestions,
  PresentationQuestionResponse,
  QuestionStore,
} from "@/config/types";
import { QuestionDisplayType } from "@/config/types";
import { cn } from "@/lib/strings";
import { getAssignment } from "@/lib/talkToBackend";
import { parseLearnerResponse, useDebugLog } from "@/lib/utils";
import { useAppConfig } from "@/stores/appConfig";
import {
  type learnerFileResponse,
  useAssignmentDetails,
  useLearnerStore,
} from "@/stores/learner";
import { useRouter } from "next/navigation";
import { useEffect, useState, type ComponentPropsWithoutRef } from "react";
import Overview from "./Overview";
import QuestionContainer from "./QuestionContainer";
import TipsView from "./TipsView";
import SecurityMonitor from "../SecurityMonitor";
import VersionMismatchBanner from "../VersionMismatchBanner";
import { clearAssignmentLocalStorage } from "@/app/learner/utils/localStorage";

interface Props extends ComponentPropsWithoutRef<"div"> {
  attempt: AssignmentAttemptWithQuestions;
  assignmentId: number;
  isNewAttempt?: boolean;
}

const normalizeChoiceText = (value: string) =>
  value.trim().toLowerCase().replace(/\s+/g, " ");

const getChoiceTexts = (choices?: QuestionStore["choices"]) =>
  (choices ?? [])
    .map((choice) => {
      if (typeof choice === "string" || typeof choice === "number") {
        return String(choice);
      }
      return choice?.choice ?? "";
    })
    .filter((choice) => {
      if (choice === null || choice === undefined) {
        return false;
      }
      return true;
    });

const getLatestQuestionResponse = (question: QuestionStore) => {
  const responses = question.questionResponses ?? [];
  if (!Array.isArray(responses) || responses.length === 0) {
    return undefined;
  }
  return responses.reduce((latest, response) =>
    (response?.id ?? 0) > (latest?.id ?? 0) ? response : latest,
  );
};

const isPresentationResponse = (
  value: unknown,
): value is PresentationQuestionResponse => {
  if (!value || typeof value !== "object") return false;
  return (
    "transcript" in value ||
    "slidesData" in value ||
    "speechReport" in value ||
    "contentReport" in value ||
    "bodyLanguageScore" in value ||
    "bodyLanguageExplanation" in value
  );
};

const isLearnerFileResponse = (
  value: unknown,
): value is learnerFileResponse => {
  if (!value || typeof value !== "object") return false;
  return (
    "filename" in value &&
    typeof (value as { filename?: unknown }).filename === "string"
  );
};

const isLearnerFileResponseArray = (
  value: unknown,
): value is learnerFileResponse[] =>
  Array.isArray(value) && value.every(isLearnerFileResponse);

const mapChoicesToIndices = (values: unknown[], choiceTexts: string[]) => {
  if (choiceTexts.length === 0) {
    return [];
  }
  const indices: number[] = [];
  values.forEach((value) => {
    if (typeof value === "number" && Number.isInteger(value)) {
      if (value >= 0 && value < choiceTexts.length) {
        indices.push(value);
        return;
      }
    }
    const valueText = String(value).trim();
    if (/^\d+$/.test(valueText)) {
      const index = Number(valueText);
      if (index >= 0 && index < choiceTexts.length) {
        indices.push(index);
        return;
      }
    }
    const normalizedValue = normalizeChoiceText(valueText);
    const matchIndex = choiceTexts.findIndex(
      (choice) => normalizeChoiceText(choice) === normalizedValue,
    );
    if (matchIndex >= 0) {
      indices.push(matchIndex);
    }
  });
  return Array.from(new Set(indices)).map((index) => String(index));
};

const hydrateQuestionResponse = (question: QuestionStore): QuestionStore => {
  const latestResponse = getLatestQuestionResponse(question);
  const rawResponse = latestResponse?.learnerResponse;
  const parsedResponse =
    typeof rawResponse === "string" && rawResponse.trim().length > 0
      ? parseLearnerResponse(rawResponse)
      : undefined;
  const updated: Partial<QuestionStore> = {};

  if (latestResponse?.learnerResponse) {
    updated.learnerResponse = latestResponse.learnerResponse;
  }

  const hasPresentation = isPresentationResponse(parsedResponse);
  if (!question.presentationResponse && hasPresentation) {
    updated.presentationResponse =
      parsedResponse as PresentationQuestionResponse;
  }

  if (
    question.type === "SINGLE_CORRECT" ||
    question.type === "MULTIPLE_CORRECT"
  ) {
    const choiceTexts = getChoiceTexts(question.choices);
    const existingChoices = Array.isArray(question.learnerChoices)
      ? question.learnerChoices
      : [];
    const existingAreIndices =
      existingChoices.length > 0 &&
      existingChoices.every(
        (choice) =>
          typeof choice === "string" &&
          /^\d+$/.test(choice) &&
          Number(choice) >= 0 &&
          Number(choice) < choiceTexts.length,
      );

    if (existingAreIndices) {
      updated.learnerChoices = existingChoices;
    } else {
      const responseValues = existingChoices.length
        ? existingChoices
        : Array.isArray(parsedResponse)
          ? parsedResponse
          : typeof parsedResponse === "string"
            ? [parsedResponse]
            : [];
      const mappedChoices = mapChoicesToIndices(responseValues, choiceTexts);
      if (mappedChoices.length > 0) {
        updated.learnerChoices = mappedChoices;
      }
    }
  }

  if (question.type === "TRUE_FALSE" && question.learnerAnswerChoice == null) {
    if (typeof parsedResponse === "boolean") {
      updated.learnerAnswerChoice = parsedResponse;
    } else if (typeof parsedResponse === "string") {
      const normalized = parsedResponse.trim().toLowerCase();
      if (normalized === "true" || normalized === "false") {
        updated.learnerAnswerChoice = normalized === "true";
      }
    }
  }

  if (question.type === "TEXT" && !question.learnerTextResponse) {
    if (typeof parsedResponse === "string") {
      updated.learnerTextResponse = parsedResponse;
    }
  }

  if (
    (question.type === "URL" || question.type === "LINK_FILE") &&
    !question.learnerUrlResponse
  ) {
    if (typeof parsedResponse === "string") {
      updated.learnerUrlResponse = parsedResponse;
    } else if (
      parsedResponse &&
      typeof parsedResponse === "object" &&
      "url" in parsedResponse &&
      typeof parsedResponse.url === "string"
    ) {
      updated.learnerUrlResponse = parsedResponse.url;
    }
  }

  if (
    (question.type === "UPLOAD" ||
      question.type === "CODE" ||
      question.type === "LINK_FILE") &&
    !question.learnerFileResponse &&
    !hasPresentation
  ) {
    if (isLearnerFileResponseArray(parsedResponse)) {
      updated.learnerFileResponse = parsedResponse;
    } else if (isLearnerFileResponse(parsedResponse)) {
      updated.learnerFileResponse = [parsedResponse];
    }
  }

  const nextQuestion = { ...question, ...updated };
  const hasResponse =
    (nextQuestion.learnerTextResponse?.trim()?.length ?? 0) > 0 ||
    (nextQuestion.learnerUrlResponse?.trim()?.length ?? 0) > 0 ||
    (nextQuestion.learnerChoices?.length ?? 0) > 0 ||
    typeof nextQuestion.learnerAnswerChoice === "boolean" ||
    (nextQuestion.learnerFileResponse?.length ?? 0) > 0 ||
    nextQuestion.presentationResponse !== undefined;

  return {
    ...nextQuestion,
    status: nextQuestion.status ?? (hasResponse ? "edited" : "unedited"),
  };
};

const buildAssignmentDetailsFromAttempt = (
  attempt: AssignmentAttemptWithQuestions,
): Assignment | undefined => {
  if (attempt.assignmentDetails?.id && attempt.assignmentDetails.name) {
    return {
      ...attempt.assignmentDetails,
      passingGrade:
        attempt.assignmentDetails.passingGrade ?? attempt.passingGrade,
      showSubmissionFeedback:
        attempt.assignmentDetails.showSubmissionFeedback ??
        attempt.showSubmissionFeedback,
      showAssignmentScore:
        attempt.assignmentDetails.showAssignmentScore ??
        attempt.showAssignmentScore,
      showQuestions:
        attempt.assignmentDetails.showQuestions ?? attempt.showQuestions,
      showQuestionScore:
        attempt.assignmentDetails.showQuestionScore ?? attempt.showQuestionScore,
      correctAnswerVisibility:
        attempt.assignmentDetails.correctAnswerVisibility ??
        attempt.correctAnswerVisibility,
      questionControls:
        attempt.assignmentDetails.questionControls ?? attempt.questionControls,
    } as Assignment;
  }

  if (attempt.name) {
    return {
      id: attempt.assignmentId,
      name: attempt.name,
      passingGrade: attempt.passingGrade,
      showSubmissionFeedback: attempt.showSubmissionFeedback,
      showAssignmentScore: attempt.showAssignmentScore,
      showQuestions: attempt.showQuestions,
      showQuestionScore: attempt.showQuestionScore,
      correctAnswerVisibility: attempt.correctAnswerVisibility,
      questionControls: attempt.questionControls,
    } as Assignment;
  }

  return undefined;
};

const shouldUpdateAssignmentDetails = (
  current: Assignment | null,
  next: Assignment,
) => {
  if (!current || current.id !== next.id) {
    return true;
  }

  return JSON.stringify(current) !== JSON.stringify(next);
};

function QuestionPage(props: Props) {
  const { attempt, assignmentId, isNewAttempt } = props;
  const { questions, id, expiresAt } = attempt;
  const debugLog = useDebugLog();
  const router = useRouter();
  const questionsStore = useLearnerStore((state) => state.questions);

  const setLearnerStore = useLearnerStore((state) => state.setLearnerStore);
  const setQuestions = useLearnerStore((state) => state.setQuestions);
  const [assignmentDetails, setAssignmentDetails] = useAssignmentDetails(
    (state) => [state.assignmentDetails, state.setAssignmentDetails],
  );
  const [pageState, setPageState] = useState<
    "loading" | "success" | "no-questions"
  >("loading");
  const tips = useAppConfig((state) => state.tips);
  const setTipsVersion = useAppConfig((state) => state.setTipsVersion);

  useEffect(() => {
    if (isNewAttempt) {
      clearAssignmentLocalStorage(assignmentId);
    }
  }, [isNewAttempt, assignmentId]);

  useEffect(() => {
    setTipsVersion("v1.0");
  }, []);

  useEffect(() => {
    let cancelled = false;

    const hydratePage = async () => {
      let nextAssignmentDetails = buildAssignmentDetailsFromAttempt(attempt);

      if (!nextAssignmentDetails) {
        nextAssignmentDetails = await getAssignment(assignmentId);
      }

      if (!nextAssignmentDetails) {
        router.push(`/learner/${assignmentId}`);
        return;
      }

      if (cancelled) {
        return;
      }

      if (
        shouldUpdateAssignmentDetails(assignmentDetails, nextAssignmentDetails)
      ) {
        setAssignmentDetails(nextAssignmentDetails);
      }

      const questionsWithStatus = questions.map((question) =>
        hydrateQuestionResponse({
          ...question,
          status: question.status ?? "unedited",
        }),
      );

      const expiresAtMs = expiresAt
        ? typeof expiresAt === "string"
          ? new Date(expiresAt).getTime()
          : expiresAt instanceof Date
            ? expiresAt.getTime()
            : undefined
        : undefined;
      const normalizedExpiresAt =
        typeof expiresAtMs === "number" && !Number.isNaN(expiresAtMs)
          ? expiresAtMs
          : undefined;

      debugLog("attemptId, expiresAt", id, normalizedExpiresAt);

      setQuestions(questionsWithStatus);

      const currentStoreUpdate = {
        activeAttemptId: id,
        expiresAt: normalizedExpiresAt,
      };

      const hasOtherChanges =
        id !== useLearnerStore.getState().activeAttemptId ||
        normalizedExpiresAt !== useLearnerStore.getState().expiresAt;
      if (hasOtherChanges) {
        setLearnerStore(currentStoreUpdate);
      }
      if (questions.length) {
        setPageState("success");
      } else {
        setPageState("no-questions");
      }
    };

    void hydratePage();

    return () => {
      cancelled = true;
    };
  }, [
    attempt,
    assignmentId,
    assignmentDetails,
    questions,
    id,
    expiresAt,
    setQuestions,
    setLearnerStore,
    setAssignmentDetails,
  ]);

  const [activeQuestionNumber] = useLearnerStore((state) => [
    state.activeQuestionNumber,
  ]);

  if (pageState === "loading") {
    return <Loading animationData={animationData} />;
  }
  if (pageState === "no-questions") {
    return (
      <div className="col-span-4 flex items-center justify-center h-full">
        <h1>No questions found.</h1>
      </div>
    );
  }

  const showVersionMismatchBanner =
    attempt.versionMismatch === true &&
    (attempt.questionResponses?.length ?? 0) === 0;

  return (
    <>
      {showVersionMismatchBanner && (
        <VersionMismatchBanner
          assignmentId={assignmentId}
          attemptId={attempt.id}
        />
      )}
      <div
        className={cn(
          "bg-gray-50 flex-grow min-h-0 flex flex-col md:grid gap-2 md:gap-4",
          tips ? "md:grid-cols-[260px_1fr_265px]" : "md:grid-cols-[260px_1fr]",
        )}
      >
        <div className="md:rounded-md h-auto pt-3 md:pt-6 px-3 md:px-4 w-full md:w-auto border-b md:border-b-0 bg-white md:bg-transparent">
          <Overview questions={questionsStore} />
        </div>

        <div
          className={`flex flex-col gap-y-3 md:gap-y-5 py-3 md:py-6 overflow-y-auto px-3 md:pl-4 h-full ${
            tips ? "md:pr-4" : "md:pr-14"
          }`}
        >
          {assignmentDetails?.questionDisplay === "ALL_PER_PAGE"
            ? questionsStore.map((question, index) => (
                <QuestionContainer
                  key={index}
                  questionNumber={index + 1}
                  questionId={question.id}
                  question={question}
                  questionDisplay={
                    assignmentDetails?.questionDisplay ??
                    QuestionDisplayType.ALL_PER_PAGE
                  }
                  lastQuestionNumber={questionsStore.length}
                />
              ))
            : questionsStore.map((question, index) =>
                index + 1 === activeQuestionNumber ? (
                  <QuestionContainer
                    key={index}
                    questionNumber={index + 1}
                    questionId={question.id}
                    question={question}
                    questionDisplay={
                      assignmentDetails?.questionDisplay ??
                      QuestionDisplayType.ONE_PER_PAGE
                    }
                    lastQuestionNumber={questionsStore.length}
                  />
                ) : null,
              )}
        </div>
        {tips && (
          <div className="md:rounded-md h-auto pt-3 md:pt-6 px-3 md:px-0 w-full md:w-auto border-t md:border-t-0 bg-white md:bg-transparent">
            <TipsView />
          </div>
        )}
        {process.env.NODE_ENV === "development" && (
          <div style={{ display: "none" }}></div>
        )}
        <SecurityMonitor
          questionControls={assignmentDetails?.questionControls}
        />
      </div>
    </>
  );
}

export default QuestionPage;
