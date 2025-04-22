"use client";

import { trueFalseTranslations } from "@/app/Helpers/Languages/TrueFalseInAllLang";
import { openFileInNewTab } from "@/app/Helpers/openNewTabGithubFile";
import FeedbackFormatter from "@/components/FeedbackFormatter";
import MarkdownViewer from "@/components/MarkdownViewer";
import type { QuestionStore, Scoring } from "@/config/types";
import {
  AuthorizeGithubBackend,
  exchangeGithubCodeForToken,
  getStoredGithubToken,
} from "@/lib/talkToBackend";
import { parseLearnerResponse } from "@/lib/utils";
import { useLearnerOverviewStore, useLearnerStore } from "@/stores/learner";
import { CheckIcon, SparklesIcon, XMarkIcon } from "@heroicons/react/24/solid";
import { Octokit } from "@octokit/rest";
import { FC, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import FileViewer from "../../(components)/Question/FileViewer";
import ShowHideRubric from "../../(components)/Question/ShowHideRubric";

interface Props {
  question: QuestionStore;
  number: number;
  language: string;
}

interface HighestScoreResponseType {
  points: number;
  feedback: { feedback: string }[];
}

export type LearnerResponseType =
  | string
  | string[]
  | boolean
  | { filename: string; content: string }[]
  | undefined
  | { transcript: string };

const Question: FC<Props> = ({ question, number, language = "en" }) => {
  const {
    question: questionText,
    totalPoints,
    questionResponses,
    type,
    learnerChoices,
    learnerTextResponse,
    learnerUrlResponse,
    learnerAnswerChoice,
    learnerFileResponse,
    choices,
  } = question;
  const showSubmissionFeedback = useLearnerStore(
    (state) => state.showSubmissionFeedback,
  );
  const [selectedFileContent, setSelectedFileContent] = useState<string | null>(
    null,
  );
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const [octokit, setOctokit] = useState<Octokit | null>(null);
  const assignmentId = useLearnerOverviewStore((state) => state.assignmentId);
  const [token, setToken] = useState<string | null>(null);
  const scoring: Scoring | undefined =
    typeof question.scoring === "string"
      ? (JSON.parse(question.scoring) as Scoring)
      : question.scoring;
  const checkToShowRubric = () => {
    if (
      ["TEXT", "UPLOAD", "LINk_FILE", "URL"].includes(question.type) &&
      scoring?.showRubricsToLearner &&
      scoring?.rubrics
    )
      return true;
    else return false;
  };
  const urlParams = new URLSearchParams(window.location.search);
  useEffect(() => {
    const initialize = async () => {
      if (token) return;

      const code = urlParams.get("code");

      if (code) {
        const returnedToken = await exchangeGithubCodeForToken(code);
        if (returnedToken && (await validateToken(returnedToken))) {
          setToken(returnedToken);
          setOctokit(new Octokit({ auth: returnedToken }));
          // remove code from url
          const newUrl = window.location.href.replace(
            window.location.search,
            "",
          );
          window.history.replaceState({}, document.title, newUrl);
          toast.success(
            "Github token has been authenticated successfully. You can now view files.",
          );
        } else {
          toast.warning(
            "Looks like there was an issue with the authentication. Please try to check your github file again.",
          );
        }
        return;
      }

      const backendToken = await getStoredGithubToken();
      if (backendToken && (await validateToken(backendToken))) {
        setToken(backendToken);
        setOctokit(new Octokit({ auth: backendToken }));
      } else {
        void authenticateUser();
      }
    };
    // check if any question include github url, if so, initialize octokit
    if (questionResponses) {
      for (const response of questionResponses) {
        if (response.learnerResponse) {
          const learnerResponse = parseLearnerResponse(
            response.learnerResponse,
          );
          if (Array.isArray(learnerResponse)) {
            for (const file of learnerResponse as {
              filename: string;
              content: string;
              githubUrl?: string;
            }[]) {
              if (file?.githubUrl) {
                void initialize();
                return;
              }
            }
          }
        }
      }
    }
  }, [token, urlParams, questionResponses]);
  const validateToken = async (testToken: string): Promise<boolean> => {
    const testOctokit = new Octokit({ auth: testToken });
    try {
      await testOctokit.request("GET /user");
      return true;
    } catch (error) {
      console.error("Token validation failed:", error);
      return false;
    }
  };

  const authenticateUser = async () => {
    try {
      const redirectUrl = window.location.href;
      const { url } = await AuthorizeGithubBackend(assignmentId, redirectUrl);
      if (url) window.open(url, "_self");
      return;
    } catch (error) {
      console.error("GitHub authentication error:", error);
      toast.error("Failed to authenticate with GitHub.");
    }
  };

  const handleFileView = async (githubUrl: string) => {
    if (!octokit && !token) {
      await initializeOctokit(githubUrl);
    } else {
      void openFileInNewTab(githubUrl, octokit);
    }
  };
  const initializeOctokit = async (githubUrl: string) => {
    const backendToken = await getStoredGithubToken();
    if (backendToken && (await validateToken(backendToken))) {
      setToken(backendToken);
      setOctokit(new Octokit({ auth: backendToken }));
    } else {
      // make sure url doesnt have code
      if (urlParams.get("code")) {
        // remove code from url
        const newUrl = window.location.href.replace(window.location.search, "");
        window.history.replaceState({}, document.title, newUrl);
      }
      void authenticateUser();
    }
  };

  const highestScoreResponse = useMemo<
    HighestScoreResponseType | undefined
  >(() => {
    if (!questionResponses || questionResponses.length === 0) {
      return showSubmissionFeedback
        ? { points: 0, feedback: [{ feedback: "This answer was blank" }] }
        : undefined;
    }
    return questionResponses.reduce((acc, curr) =>
      acc.points > curr.points ? acc : curr,
    );
  }, [questionResponses, showSubmissionFeedback]);

  const questionResponse = questionResponses?.[0];

  const learnerResponse: LearnerResponseType =
    learnerTextResponse ??
    learnerFileResponse ??
    learnerUrlResponse ??
    learnerAnswerChoice ??
    (learnerChoices && learnerChoices.length > 0
      ? learnerChoices
      : undefined) ??
    (questionResponse?.learnerResponse
      ? parseLearnerResponse(questionResponse.learnerResponse)
      : undefined);

  const renderLearnerAnswer = () => {
    if (
      type === "TEXT" &&
      learnerResponse &&
      (typeof learnerResponse === "string" ||
        typeof learnerResponse === "boolean")
    ) {
      return (
        <p
          className={`text-gray-800 w-full ${
            highestScoreResponse?.points === totalPoints
              ? "bg-green-50 border border-green-500 rounded p-2"
              : highestScoreResponse?.points > 0
                ? "bg-yellow-50 border border-yellow-500 rounded p-2"
                : "bg-red-50 border border-red-700 rounded p-2"
          }
          
          `}
        >
          <MarkdownViewer className="text-gray-800 ">
            {learnerResponse.toString()}
          </MarkdownViewer>
        </p>
      );
    } else if (
      (type === "URL" || type === "LINK_FILE") &&
      typeof learnerResponse === "string" &&
      learnerResponse !== "" &&
      learnerResponse.startsWith("http")
    ) {
      return (
        <a
          href={learnerResponse}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-600 underline break-all"
        >
          {learnerResponse}
        </a>
      );
    } else if (
      (type === "SINGLE_CORRECT" || type === "MULTIPLE_CORRECT") &&
      Array.isArray(choices)
    ) {
      if (
        !learnerResponse ||
        (Array.isArray(learnerResponse) && learnerResponse.length === 0)
      ) {
        return (
          <p className="text-gray-800 bg-red-50 border border-red-700 rounded p-2 w-full flex items-center justify-between">
            <span className="w-full">
              No answer was provided by the learner.
            </span>
            <XMarkIcon className="w-5 h-5 text-red-500 ml-2 hover:cursor-pointer" />
          </p>
        );
      }

      const isSingleChoice = type === "SINGLE_CORRECT";

      return (
        <ul className="list-none text-gray-800 w-full flex flex-col justify-start gap-y-2">
          {choices.map((choiceObj, idx) => {
            const isSelected = Array.isArray(learnerResponse)
              ? (learnerResponse as string[]).includes(choiceObj.choice)
              : false;

            const isCorrect = choiceObj.isCorrect;
            return (
              <li
                key={idx}
                className={`flex items-center justify-between mb-2 px-2 py-2 ${
                  isSelected && showSubmissionFeedback
                    ? isCorrect
                      ? "bg-green-50 border border-green-500 rounded"
                      : "bg-red-50 border border-red-700 rounded"
                    : isCorrect && showSubmissionFeedback
                      ? "bg-green-50 border border-green-500 rounded"
                      : ""
                }`}
              >
                <div className="flex items-center">
                  {isSingleChoice ? (
                    <input
                      type="radio"
                      checked={isSelected}
                      readOnly
                      className="form-radio text-violet-600 mr-2"
                    />
                  ) : (
                    <input
                      type="checkbox"
                      checked={isSelected}
                      readOnly
                      className="form-checkbox text-violet-600 mr-2"
                    />
                  )}
                  <span className="font-medium">{choiceObj.choice}</span>
                </div>
                <div className="flex items-center">
                  {isCorrect && showSubmissionFeedback && (
                    <CheckIcon className="w-5 h-5 text-green-500 ml-2" />
                  )}
                  {!isCorrect && isSelected && showSubmissionFeedback && (
                    <XMarkIcon className="w-5 h-5 text-red-500 ml-2 hover:cursor-pointer" />
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      );
    } else if (type === "TRUE_FALSE") {
      return (
        <p
          className={`text-gray-800 w-full ${
            highestScoreResponse?.points === totalPoints
              ? "bg-green-50 border border-green-500 rounded p-2"
              : highestScoreResponse?.points > 0
                ? "bg-yellow-50 border border-yellow-500 rounded p-2"
                : "bg-red-50 border border-red-700 rounded p-2"
          }
          
          `}
        >
          {learnerResponse
            ? (trueFalseTranslations[language]?.true ??
              trueFalseTranslations.en.true)
            : (trueFalseTranslations[language]?.false ??
              trueFalseTranslations.en.false)}
        </p>
      );
    } else if (
      type === "CODE" ||
      type === "IMAGES" ||
      type === "UPLOAD" ||
      type === "LINK_FILE"
    ) {
      if (
        ["PRESENTATION", "LIVE_RECORDING"].includes(question.responseType) &&
        typeof learnerResponse === "object"
      ) {
        const transcript =
          "transcript" in learnerResponse
            ? learnerResponse.transcript
            : undefined;
        return (
          <p
            className={`text-gray-800 w-full ${
              highestScoreResponse?.points === totalPoints
                ? "bg-green-50 border border-green-500 rounded p-2"
                : highestScoreResponse?.points > 0
                  ? "bg-yellow-50 border border-yellow-500 rounded p-2"
                  : "bg-red-50 border border-red-700 rounded p-2"
            }
          `}
          >
            Transcript: {transcript}
          </p>
        );
      }
      if (Array.isArray(learnerResponse) && learnerResponse.length > 0) {
        return (
          <ul className="list-disc ml-5 text-gray-800">
            {(
              learnerResponse as unknown as {
                filename: string;
                content: string;
                githubUrl?: string;
              }[]
            ).map((file, idx) => (
              <li key={idx}>
                {file.filename}
                <button
                  onClick={() => {
                    if (file.githubUrl) {
                      void handleFileView(file.githubUrl);
                    } else {
                      setSelectedFileContent(file.content);
                      setSelectedFileName(file.filename);
                    }
                  }}
                  className="ml-2 text-blue-600 underline"
                >
                  View Content
                </button>
              </li>
            ))}
          </ul>
        );
      } else if (
        typeof learnerResponse === "string" &&
        learnerResponse !== ""
      ) {
        return (
          <p
            className={`text-gray-800 w-full ${
              highestScoreResponse?.points === totalPoints
                ? "bg-green-50 border border-green-500 rounded p-2"
                : highestScoreResponse?.points > 0
                  ? "bg-yellow-50 border border-yellow-500 rounded p-2"
                  : "bg-red-50 border border-red-700 rounded p-2"
            }
          
          `}
          >
            {learnerResponse}
          </p>
        );
      } else {
        return (
          <p className="text-gray-800 bg-red-50 border border-red-700 rounded p-2 w-full flex items-center justify-between">
            <span className="w-full">
              No answer was provided by the learner.
            </span>
            <XMarkIcon className="w-5 h-5 text-red-500 ml-2 hover:cursor-pointer" />
          </p>
        );
      }
    } else {
      return (
        <p className="text-gray-800 bg-red-50 border border-red-700 rounded p-2 w-full flex items-center justify-between">
          <span className="w-full">No answer was provided by the learner.</span>
          <XMarkIcon className="w-5 h-5 text-red-500 ml-2 hover:cursor-pointer" />
        </p>
      );
    }
  };

  return (
    <>
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between mb-4">
        <h2 className="text-xl font-semibold text-gray-800">
          Question {number}
        </h2>
        {highestScoreResponse?.points === -1 ? (
          <p className="text-sm text-gray-600 mt-2 md:mt-0">Points hidden</p>
        ) : (
          <p className="text-sm text-gray-600">
            Score:{" "}
            <span className="font-bold text-gray-800">
              {highestScoreResponse?.points || 0}/{totalPoints}
            </span>
          </p>
        )}
      </div>

      {/* Question Text */}
      <MarkdownViewer className="mb-2 sm:mb-4 pb-2 sm:pb-4 border-b text-gray-700">
        {questionText}
      </MarkdownViewer>
      {/* show/hide rubric */}
      {checkToShowRubric() && (
        <ShowHideRubric rubrics={scoring?.rubrics} className="mb-4" />
      )}

      {/* Learner's Answer */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-2 mb-4">
        {renderLearnerAnswer()}
      </div>

      {/* Feedback */}
      {highestScoreResponse?.feedback && (
        <div className="p-4 mt-4 rounded-lg bg-gray-50 flex items-center gap-4">
          <div className="flex-shrink-0 w-6 justify-center items-center flex">
            <SparklesIcon className="w-4 h-4 text-violet-600" />
          </div>
          <FeedbackFormatter className="text-gray-800 flex-1 mt-2 sm:mt-0">
            {highestScoreResponse?.feedback[0]?.feedback}
          </FeedbackFormatter>
        </div>
      )}
      {selectedFileContent && (
        <FileViewer
          file={{
            filename: selectedFileName,
            content: selectedFileContent,
            blob: new Blob([selectedFileContent], { type: "text/plain" }),
          }}
          onClose={() => {
            setSelectedFileContent(null);
            setSelectedFileName(null);
          }}
        />
      )}
    </>
  );
};

export default Question;
