"use client";

import { getLanguageName } from "@/app/Helpers/getLanguageName";
import Dropdown from "@/components/Dropdown";
import MarkdownViewer from "@/components/MarkdownViewer";
import Modal from "@/components/Modal";
import {
  Assignment,
  AssignmentAttempt,
  LearnerAssignmentState,
} from "@/config/types";
import { getSupportedLanguages } from "@/lib/talkToBackend";
import { useLearnerOverviewStore, useLearnerStore } from "@/stores/learner";
import { ChevronDownIcon, ChevronUpIcon } from "@heroicons/react/24/outline";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import React, { FC, useEffect, useState } from "react";
import { toast } from "sonner";
import BeginTheAssignmentButton from "./BeginTheAssignmentButton";
import {
  getExpiresAtMs,
  getLatestAttempt,
  getTimestampMs,
  isAttemptInProgress,
  isAttemptSubmitted,
} from "@/app/learner/utils/attempts";

interface AssignmentSectionProps {
  title: string;
  content: string;
}

const AssignmentSection: FC<AssignmentSectionProps> = ({ title, content }) => {
  const [isCollapsed, setIsCollapsed] = useState(false);

  return (
    <div className="bg-white shadow rounded-lg overflow-hidden">
      <div className="flex items-center justify-between px-4 sm:px-6 py-3 sm:py-4 border-b border-gray-200">
        <h2 className="text-lg sm:text-xl font-semibold text-gray-800">
          {title}
        </h2>
        <button
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="sm:hidden flex items-center text-gray-600 hover:text-gray-800 transition-colors"
          aria-label={isCollapsed ? `Expand ${title}` : `Collapse ${title}`}
        >
          {isCollapsed ? (
            <ChevronDownIcon className="w-5 h-5" />
          ) : (
            <ChevronUpIcon className="w-5 h-5" />
          )}
        </button>
      </div>
      <div
        className={`px-4 sm:px-6 py-4 transition-all duration-300 ${
          isCollapsed
            ? "max-h-0 opacity-0 py-0 sm:max-h-none sm:opacity-100 sm:py-4 overflow-hidden"
            : "max-h-none opacity-100"
        }`}
      >
        <MarkdownViewer className="text-gray-600 text-sm sm:text-base">
          {content || `No ${title.toLowerCase()} provided.`}
        </MarkdownViewer>
      </div>
    </div>
  );
};

interface AboutTheAssignmentProps {
  assignment: Assignment;
  attempts: AssignmentAttempt[];
  role: "learner" | "author";
  assignmentId: number;
  fetchData: () => void;
}

const getAssignmentState = (
  attempts: AssignmentAttempt[],
  numAttempts: number,
): LearnerAssignmentState => {
  if (numAttempts !== -1 && attempts.length >= numAttempts) return "completed";

  const inProgress = attempts.some(isAttemptInProgress);

  return inProgress ? "in-progress" : "not-started";
};

const AboutTheAssignment: FC<AboutTheAssignmentProps> = ({
  assignment,
  attempts,
  role,
  assignmentId,
  fetchData,
}) => {
  const {
    introduction = "No introduction provided.",
    instructions = "",
    gradingCriteriaOverview = "",
    allotedTimeMinutes,
    timeEstimateMinutes,
    numAttempts = -1,
    attemptsBeforeCoolDown = 1,
    retakeAttemptCoolDownMinutes = 5,
    passingGrade,
    name = "Untitled",
    id,
    graded,
    published = false,
  } = assignment;
  const [userPreferedLanguage, setUserPreferedLanguage] = useLearnerStore(
    (state) => [state.userPreferedLanguage, state.setUserPreferedLanguage],
  );
  const [languageModalTriggered, setLanguageModalTriggered] =
    useLearnerOverviewStore((state) => [
      state.languageModalTriggered,
      state.setLanguageModalTriggered,
    ]);
  const router = useRouter();
  const [languages, setLanguages] = useState<string[]>([]);
  const [selectedLanguage, setSelectedLanguage] = useState<string | null>(
    userPreferedLanguage,
  );
  const [isLoading, setIsLoading] = useState(false);
  const pathname = usePathname();
  const [toggleLanguageSelectionModal, setToggleLanguageSelectionModal] =
    useState(false);
  const [isAboutCollapsed, setIsAboutCollapsed] = useState(false);
  useEffect(() => {
    if (!userPreferedLanguage || languageModalTriggered) {
      setToggleLanguageSelectionModal(true);
    }
  }, [userPreferedLanguage, languageModalTriggered]);
  useEffect(() => {
    async function fetchLanguages() {
      setIsLoading(true);
      const supportedLanguages = await getSupportedLanguages(assignmentId);
      setLanguages(supportedLanguages);
      setIsLoading(false);
    }
    void fetchLanguages();
  }, [assignmentId]);
  const assignmentState =
    !published && role === "learner"
      ? "not-published"
      : getAssignmentState(attempts, numAttempts);

  const attemptsLeft =
    numAttempts === -1 ? Infinity : Math.max(0, numAttempts - attempts.length);

  const latestAttempt = getLatestAttempt(attempts || []);

  const attemptsCount = attempts.length;
  const [cooldownMessage, setCooldownMessage] = useState<string | null>(null);
  const [isCooldown, setIsCooldown] = useState(false);

  useEffect(() => {
    if (
      !latestAttempt ||
      !latestAttempt.createdAt ||
      attemptsBeforeCoolDown <= 0 ||
      attemptsCount < attemptsBeforeCoolDown ||
      attemptsLeft === 0 ||
      retakeAttemptCoolDownMinutes <= 0 ||
      assignmentState === "in-progress" ||
      !isAttemptSubmitted(latestAttempt)
    ) {
      setCooldownMessage(null);
      setIsCooldown(false);
      return;
    }

    const fallbackCreatedAt = latestAttempt.createdAt
      ? new Date(latestAttempt.createdAt).getTime()
      : undefined;

    const updatedAtMs = getTimestampMs(latestAttempt.updatedAt);

    let finishedAt =
      getExpiresAtMs(latestAttempt.expiresAt) ??
      updatedAtMs ??
      fallbackCreatedAt;

    if (
      isAttemptSubmitted(latestAttempt) &&
      updatedAtMs !== undefined &&
      !Number.isNaN(updatedAtMs)
    ) {
      finishedAt = finishedAt ? Math.min(finishedAt, updatedAtMs) : updatedAtMs;
    }

    if (finishedAt === undefined || Number.isNaN(finishedAt)) {
      setCooldownMessage(null);
      setIsCooldown(false);
      return;
    }

    const cooldownMs = retakeAttemptCoolDownMinutes * 60_000;
    const nextEligibleAt = finishedAt + cooldownMs;

    function updateCountdown() {
      const remainingMs = nextEligibleAt - Date.now();

      if (remainingMs <= 0) {
        setCooldownMessage(null);
        setIsCooldown(false);
        return;
      }

      setIsCooldown(true);

      const days = Math.floor(remainingMs / (24 * 60 * 60 * 1000));
      let remainder = remainingMs % (24 * 60 * 60 * 1000);
      const hours = Math.floor(remainder / (60 * 60 * 1000));
      remainder %= 60 * 60 * 1000;
      const minutes = Math.floor(remainder / 60000);
      const seconds = Math.floor((remainder % 60000) / 1000);

      const parts = [];
      if (days) parts.push(`${days}d`);
      if (hours) parts.push(`${hours}h`);
      if (minutes) parts.push(`${minutes}m`);
      if (seconds) parts.push(`${seconds}s`);

      const timeString = parts.length > 0 ? parts.join(" ") : "a moment";
      setCooldownMessage(`Please wait ${timeString} before retrying`);
    }

    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);
    return () => clearInterval(interval);
  }, [
    latestAttempt,
    attemptsLeft,
    attemptsCount,
    attemptsBeforeCoolDown,
    retakeAttemptCoolDownMinutes,
  ]);

  useEffect(() => {
    if (!userPreferedLanguage || languageModalTriggered) {
      setToggleLanguageSelectionModal(true);
    }
  }, [userPreferedLanguage, languageModalTriggered]);
  useEffect(() => {
    async function fetchLanguages() {
      setIsLoading(true);
      const supportedLanguages = await getSupportedLanguages(assignmentId);
      setLanguages(supportedLanguages);
      setIsLoading(false);
    }
    void fetchLanguages();
  }, [assignmentId]);

  const handleConfirm = () => {
    if (selectedLanguage) {
      router.replace(`${pathname}?lang=${selectedLanguage}`, undefined);
      setUserPreferedLanguage(selectedLanguage);
      setLanguageModalTriggered(false);
      setToggleLanguageSelectionModal(false);
      void fetchData();
    } else {
      toast.error("Please select a language to continue.");
    }
  };
  const handleCloseModal = () => {
    setLanguageModalTriggered(false);
    setToggleLanguageSelectionModal(false);
  };

  const url =
    role === "learner"
      ? `/learner/${assignmentId}/questions`
      : `/learner/${assignmentId}/questions?authorMode=true`;

  const buttonLabel = assignmentState === "in-progress" ? "Resume" : "Begin";
  let buttonMessage = "";
  let buttonDisabled = false;

  if (!role) {
    buttonDisabled = true;
    buttonMessage = "You must be signed in with a role to begin.";
  } else if (role === "learner" && assignmentState === "not-published") {
    buttonDisabled = true;
    buttonMessage = "The assignment is not published yet.";
  } else if (attemptsLeft === 0) {
    buttonDisabled = true;
    buttonMessage =
      "Maximum attempts reached, contact the author to request more.";
  } else if (isCooldown && cooldownMessage) {
    buttonDisabled = true;
    buttonMessage = cooldownMessage;
  } else {
    buttonMessage = `Click to ${assignmentState === "in-progress" ? "Resume" : "Begin"}`;
  }

  const latestAttemptDate = latestAttempt
    ? new Date(latestAttempt.createdAt).toLocaleString()
    : "No attempts yet";

  return (
    <>
      <main className="flex-1 py-6 sm:py-12 px-4 sm:px-6 bg-gray-50 overflow-auto">
        <div className="max-w-4xl mx-auto space-y-6">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col">
              <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold text-gray-900 leading-tight">
                {name}
              </h1>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-4 text-gray-600 pt-2">
                <div className="flex flex-col sm:flex-row sm:flex-wrap gap-2 sm:gap-x-4 sm:gap-y-2">
                  <span className="font-medium text-sm sm:text-base">
                    Latest attempt: {latestAttemptDate}
                  </span>
                  {role === "learner" && (
                    <Link
                      href={`/learner/${id}/attempts`}
                      className="text-violet-600 text-sm sm:text-base hover:text-violet-700 transition-colors"
                    >
                      See all attempts
                    </Link>
                  )}
                </div>
                <div className="sm:hidden">
                  <BeginTheAssignmentButton
                    className="w-full"
                    disabled={isCooldown || buttonDisabled}
                    message={isCooldown ? cooldownMessage : buttonMessage}
                    label={buttonLabel}
                    href={url}
                  />
                </div>
                <div className="hidden sm:block">
                  <BeginTheAssignmentButton
                    className="w-auto"
                    disabled={isCooldown || buttonDisabled}
                    message={isCooldown ? cooldownMessage : buttonMessage}
                    label={buttonLabel}
                    href={url}
                  />
                </div>
              </div>
              {isCooldown && cooldownMessage && (
                <span className="text-red-600 font-semibold">
                  ({cooldownMessage})
                </span>
              )}
            </div>
          </div>

          <div className="bg-white shadow rounded-lg overflow-hidden">
            <div className="flex items-center justify-between px-4 sm:px-6 py-3 sm:py-4 border-b border-gray-200">
              <h2 className="text-lg sm:text-xl font-semibold text-gray-800">
                About this assignment
              </h2>
              <button
                onClick={() => setIsAboutCollapsed(!isAboutCollapsed)}
                className="sm:hidden flex items-center text-gray-600 hover:text-gray-800 transition-colors"
                aria-label={
                  isAboutCollapsed
                    ? "Expand about section"
                    : "Collapse about section"
                }
              >
                {isAboutCollapsed ? (
                  <ChevronDownIcon className="w-5 h-5" />
                ) : (
                  <ChevronUpIcon className="w-5 h-5" />
                )}
              </button>
            </div>
            <div
              className={`transition-all duration-300 ${
                isAboutCollapsed
                  ? "max-h-0 opacity-0 overflow-hidden sm:max-h-none sm:opacity-100"
                  : "max-h-none opacity-100"
              }`}
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 p-4 sm:p-6">
                <div className="flex flex-col gap-1 text-gray-600">
                  <span className="font-semibold text-sm">Assignment type</span>
                  <span className="text-sm">
                    {graded ? "Graded" : "Practice"}
                  </span>
                </div>
                <div className="flex flex-col gap-1 text-gray-600">
                  <span className="font-semibold text-sm">Time Limit</span>
                  <span className="text-sm">
                    {allotedTimeMinutes
                      ? `${allotedTimeMinutes} minutes`
                      : "Unlimited"}
                  </span>
                </div>
                <div className="flex flex-col gap-1 text-gray-600">
                  <span className="font-semibold text-sm">Estimated Time</span>
                  <span className="text-sm">
                    {timeEstimateMinutes
                      ? `${timeEstimateMinutes} minutes`
                      : "Not provided"}
                  </span>
                </div>
                <div className="flex flex-col gap-1 text-gray-600">
                  <span className="font-semibold text-sm">
                    Assignment attempts
                  </span>
                  <span className="text-sm">
                    {numAttempts === -1
                      ? "Unlimited"
                      : `${attemptsLeft} attempt${
                          attemptsLeft > 1 ? "s" : ""
                        } left`}
                  </span>
                </div>
                <div className="flex flex-col gap-1 text-gray-600">
                  <span className="font-semibold text-sm">Passing Grade</span>
                  <span className="text-sm">{passingGrade}%</span>
                </div>
              </div>
              <div className="border-t border-gray-200 px-4 sm:px-6 py-4">
                <MarkdownViewer className="text-gray-600 text-sm sm:text-base">
                  {introduction}
                </MarkdownViewer>
              </div>
            </div>
          </div>

          <AssignmentSection title="Instructions" content={instructions} />
          <AssignmentSection
            title="Grading Criteria"
            content={gradingCriteriaOverview}
          />

          <div className="flex justify-center mt-6">
            <BeginTheAssignmentButton
              className="w-full sm:w-auto"
              disabled={isCooldown || buttonDisabled}
              message={isCooldown ? cooldownMessage : buttonMessage}
              label={buttonLabel}
              href={url}
            />
          </div>
        </div>
      </main>
      {toggleLanguageSelectionModal &&
        role === "learner" &&
        languageModalTriggered && (
          <Modal
            onClose={handleCloseModal}
            Title="Please pick one of the available languages"
          >
            <div className="space-y-4">
              <p className="text-gray-600 text-sm sm:text-base">
                We recommend you experience our assignment in
                <strong> English </strong>
                as it's the original language. However, if you would like to
                continue learning in your chosen language please be aware that
                our translations are AI generated and may contain some
                inaccuracies.
              </p>
              <p className="text-gray-600 text-sm sm:text-base">
                You will be able to switch your language at any time during the
                assignment.
              </p>

              {isLoading ? (
                <div className="text-center text-gray-500 py-4">
                  Loading languages...
                </div>
              ) : (
                <div className="w-full">
                  <Dropdown
                    items={languages.map((lang) => ({
                      label: getLanguageName(lang),
                      value: lang,
                    }))}
                    selectedItem={selectedLanguage}
                    setSelectedItem={setSelectedLanguage}
                    placeholder="Select language"
                  />
                </div>
              )}

              <div className="flex flex-col sm:flex-row justify-end gap-3 pt-4">
                <button
                  className="w-full sm:w-auto px-4 py-2 text-gray-500 hover:text-gray-700 transition-colors"
                  onClick={() => setToggleLanguageSelectionModal(false)}
                >
                  Cancel
                </button>
                <button
                  className="w-full sm:w-auto px-4 py-2 bg-violet-500 text-white rounded-md disabled:opacity-50 hover:bg-violet-600 transition-colors"
                  onClick={handleConfirm}
                  disabled={!selectedLanguage}
                >
                  Confirm
                </button>
              </div>
            </div>
          </Modal>
        )}
    </>
  );
};

export default AboutTheAssignment;
