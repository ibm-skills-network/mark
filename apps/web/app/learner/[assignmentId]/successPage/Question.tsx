import { trueFalseTranslations } from "@/app/Helpers/Languages/TrueFalseInAllLang";
import { openFileInNewTab } from "@/app/Helpers/openNewTabGithubFile";
import FeedbackFormatter from "@/components/FeedbackFormatter";
import MarkdownViewer from "@/components/MarkdownViewer";
import type {
  ExtendedFileContent,
  QuestionStore,
  Scoring,
} from "@/config/types";
import {
  AuthorizeGithubBackend,
  exchangeGithubCodeForToken,
  getStoredGithubToken,
} from "@/lib/talkToBackend";
import { parseLearnerResponse } from "@/lib/utils";
import { useLearnerOverviewStore } from "@/stores/learner";
import { CheckIcon, SparklesIcon, XMarkIcon } from "@heroicons/react/24/solid";
import { Octokit } from "@octokit/rest";
import { FC, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import ShowHideRubric from "../../(components)/Question/ShowHideRubric";
import FilePreview from "@/components/FileExplorer/FilePreview";
import {
  fetchFileContentSafe,
  downloadFile,
  getFileExtension,
  formatFileSize,
} from "@/lib/shared";

interface Props {
  question: QuestionStore;
  number: number;
  language: string;
  showSubmissionFeedback?: boolean;
  showCorrectAnswer?: boolean;
}

interface HighestScoreResponseType {
  points: number;
  feedback: { feedback: string }[];
}

export type LearnerResponseType =
  | string
  | string[]
  | boolean
  | LearnerFileResponse[]
  | undefined
  | { transcript: string };

export interface LearnerFileResponse {
  filename: string;
  imageUrl?: string;
  imageData?: string;
  imageBucket?: string;
  imageKey?: string;
  mimeType?: string;
  imageAnalysisResult?: {
    width: number;
    height: number;
    aspectRatio: number;
    fileSize: number;
    dominantColors: any[];
    detectedObjects: any[];
    detectedText: any[];
    sceneType: string;
    rawDescription: string;
  };

  content?: string;
  key?: string;
  bucket?: string;
  fileType?: string;
  githubUrl?: string;
}

export interface EnhancedFileObject {
  id: string;
  fileName: string;
  content?: string;
  imageUrl?: string;
  imageBucket?: string;
  imageKey?: string;
  fileType?: string;
  cosKey: string;
  cosBucket: string;
  path: string;
  size: number;
  createdAt: string;
  updatedAt: string;
  fileSize?: number;
}

interface FileViewerState {
  isOpen: boolean;
  currentFile: EnhancedFileObject | null;
  currentContent: ExtendedFileContent | null;
  isLoading: boolean;
  allFiles: EnhancedFileObject[];
  currentIndex: number;
}

const Question: FC<Props> = ({
  question,
  number,
  language = "en",
  showSubmissionFeedback,
  showCorrectAnswer,
}) => {
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

  const [fileViewer, setFileViewer] = useState<FileViewerState>({
    isOpen: false,
    currentFile: null,
    currentContent: null,
    isLoading: false,
    allFiles: [],
    currentIndex: 0,
  });

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

  const convertToEnhancedFileObjects = (
    files: LearnerFileResponse[],
  ): EnhancedFileObject[] => {
    return files.map((file, index) => {
      const fileKey = file.imageKey || file.key || "";
      const fileBucket = file.imageBucket || file.bucket || "";
      const fileContent =
        file.imageData && file.imageData !== "InCos" && file.imageData !== ""
          ? file.imageData
          : file.content && file.content !== "InCos" && file.content !== ""
            ? file.content
            : undefined;

      return {
        id: `file-${question.id}-${index}`,
        fileName: file.filename,
        content: fileContent,
        imageUrl: file.imageUrl || "",
        imageBucket: fileBucket,
        imageKey: fileKey,
        fileType:
          file.mimeType || file.fileType || getFileExtension(file.filename),
        cosKey: fileKey,
        cosBucket: fileBucket,
        path: file.filename,
        size:
          file.imageAnalysisResult?.fileSize ||
          (fileContent ? new Blob([fileContent]).size : 0),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        fileSize: file.imageAnalysisResult?.fileSize || 0,
      };
    });
  };

  const fetchFileContent = async (
    file: EnhancedFileObject,
  ): Promise<ExtendedFileContent> => {
    try {
      if (file.content && file.content.trim().length > 0) {
        return {
          content: file.content,
          filename: file.fileName,
          questionId: question.id.toString(),
        };
      }

      if (!file.cosKey || !file.cosBucket) {
        throw new Error("No file key or bucket available for direct access");
      }

      const result = await fetchFileContentSafe(
        file.cosKey,
        file.cosBucket,
        file.fileName,
        "learner",
      );

      return {
        content: result.content,
        url: result.url,
        filename: result.filename,
        questionId: question.id.toString(),
        error: result.error,
        type: result.type,
      };
    } catch (err: unknown) {
      const errorMessage =
        err instanceof Error ? err.message : "Unknown error occurred";
      return {
        error: `Failed to load ${file.fileName}: ${errorMessage}`,
        filename: file.fileName,
        questionId: question.id.toString(),
      };
    }
  };

  const handleFileView = async (
    files: LearnerFileResponse[],
    selectedIndex: number,
  ) => {
    if (!files || files.length === 0) {
      toast.error("No files available to view");
      return;
    }

    const enhancedFiles = convertToEnhancedFileObjects(files);
    const selectedFile = enhancedFiles[selectedIndex];

    if (!selectedFile) {
      toast.error("Selected file not found");
      return;
    }

    if (!selectedFile.cosKey || !selectedFile.cosBucket) {
      if (!selectedFile.content) {
        toast.error("File cannot be accessed - missing storage information");
        return;
      }
    }

    setFileViewer({
      isOpen: true,
      currentFile: selectedFile,
      currentContent: null,
      isLoading: true,
      allFiles: enhancedFiles,
      currentIndex: selectedIndex,
    });

    try {
      const content = await fetchFileContent(selectedFile);
      setFileViewer((prev) => ({
        ...prev,
        currentContent: content,
        isLoading: false,
      }));

      if (content.error) {
        toast.error(`Error loading file: ${content.error}`);
      }
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error occurred";
      setFileViewer((prev) => ({
        ...prev,
        currentContent: {
          error: `Failed to load file: ${errorMessage}`,
          filename: selectedFile.fileName,
          questionId: question.id.toString(),
        },
        isLoading: false,
      }));
      toast.error(`Error loading file: ${errorMessage}`);
    }
  };

  const handleNextFile = async () => {
    const nextIndex = fileViewer.currentIndex + 1;
    if (nextIndex >= fileViewer.allFiles.length) return;

    const nextFile = fileViewer.allFiles[nextIndex];
    setFileViewer((prev) => ({
      ...prev,
      currentFile: nextFile,
      currentContent: null,
      isLoading: true,
      currentIndex: nextIndex,
    }));

    const content = await fetchFileContent(nextFile);
    setFileViewer((prev) => ({
      ...prev,
      currentContent: content,
      isLoading: false,
    }));
  };

  const handlePreviousFile = async () => {
    const prevIndex = fileViewer.currentIndex - 1;
    if (prevIndex < 0) return;

    const prevFile = fileViewer.allFiles[prevIndex];
    setFileViewer((prev) => ({
      ...prev,
      currentFile: prevFile,
      currentContent: null,
      isLoading: true,
      currentIndex: prevIndex,
    }));

    const content = await fetchFileContent(prevFile);
    setFileViewer((prev) => ({
      ...prev,
      currentContent: content,
      isLoading: false,
    }));
  };

  const handleCloseFileViewer = () => {
    setFileViewer({
      isOpen: false,
      currentFile: null,
      currentContent: null,
      isLoading: false,
      allFiles: [],
      currentIndex: 0,
    });
  };

  const handleDownloadFile = async (file: EnhancedFileObject) => {
    try {
      if (file.content) {
        const blob = new Blob([file.content], { type: "text/plain" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = file.fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        return;
      }

      if (file.cosKey && file.cosBucket) {
        await downloadFile(file.cosKey, file.cosBucket, file.fileName);
      } else {
        throw new Error(
          "No file content or storage location available for download",
        );
      }
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error occurred";
      toast.error(`Failed to download file: ${errorMessage}`);
    }
  };

  useEffect(() => {
    const initialize = async () => {
      if (token) return;

      const code = urlParams.get("code");

      if (code) {
        const returnedToken = await exchangeGithubCodeForToken(code);
        if (returnedToken && (await validateToken(returnedToken))) {
          setToken(returnedToken);
          setOctokit(new Octokit({ auth: returnedToken }));

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

    if (questionResponses) {
      for (const response of questionResponses) {
        if (response.learnerResponse) {
          const learnerResponse = parseLearnerResponse(
            response.learnerResponse,
          );
          if (Array.isArray(learnerResponse)) {
            for (const file of learnerResponse as LearnerFileResponse[]) {
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
      toast.error("Failed to authenticate with GitHub.");
    }
  };

  const handleGithubFileView = async (githubUrl: string) => {
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
      if (urlParams.get("code")) {
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
    (learnerChoices && learnerChoices.length > 0
      ? learnerChoices
      : undefined) ??
    learnerTextResponse ??
    learnerFileResponse ??
    learnerUrlResponse ??
    learnerAnswerChoice ??
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
          }`}
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
          className="text-purple-600 underline break-all"
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
            <XMarkIcon className="w-5 h-5 text-red-500 ml-2 flex-shrink-0" />
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
                className={`flex items-start mb-2 px-2 py-2 ${
                  isSelected && showSubmissionFeedback
                    ? isCorrect
                      ? "bg-green-50 border border-green-500 rounded"
                      : "bg-red-50 border border-red-700 rounded"
                    : isCorrect && showCorrectAnswer
                      ? "bg-green-50 border border-green-500 rounded"
                      : ""
                }`}
              >
                <div className="flex items-center w-full overflow-hidden">
                  <div className="flex-shrink-0  mr-2">
                    {isSingleChoice ? (
                      <input
                        type="radio"
                        checked={isSelected}
                        readOnly
                        className="form-radio text-violet-600"
                      />
                    ) : (
                      <input
                        type="checkbox"
                        checked={isSelected}
                        readOnly
                        className="form-checkbox text-violet-600"
                      />
                    )}
                  </div>

                  <div className="flex-grow">
                    <div className="font-medium whitespace-pre-wrap break-words hyphens-auto overflow-hidden">
                      {choiceObj.choice}
                    </div>

                    {isSelected &&
                      choiceObj.feedback &&
                      showSubmissionFeedback && (
                        <div className="mt-1 text-sm italic">
                          <span
                            className={
                              isCorrect ? "text-green-700" : "text-red-700"
                            }
                          >
                            {choiceObj.feedback}
                          </span>
                        </div>
                      )}
                  </div>

                  <div className="flex-shrink-0 ml-2">
                    {isCorrect && showCorrectAnswer && (
                      <CheckIcon className="w-5 h-5 text-green-500" />
                    )}
                    {!isCorrect && isSelected && (
                      <XMarkIcon className="w-5 h-5 text-red-500" />
                    )}
                  </div>
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
          }`}
        >
          {learnerResponse
            ? (trueFalseTranslations[language]?.true ??
              trueFalseTranslations.en.true)
            : (trueFalseTranslations[language]?.false ??
              trueFalseTranslations.en.false)}
        </p>
      );
    } else if (type === "CODE" || type === "UPLOAD" || type === "LINK_FILE") {
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
            }`}
          >
            Transcript: {transcript}
          </p>
        );
      }
      if (Array.isArray(learnerResponse) && learnerResponse.length > 0) {
        return (
          <div className="space-y-2">
            <ul className="list-disc ml-5 text-gray-800">
              {(learnerResponse as LearnerFileResponse[]).map((file, idx) => (
                <li key={idx} className="mb-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium">{file.filename}</span>
                    <button
                      onClick={() => {
                        if (file.githubUrl) {
                          void handleGithubFileView(file.githubUrl);
                        } else {
                          void handleFileView(
                            learnerResponse as LearnerFileResponse[],
                            idx,
                          );
                        }
                      }}
                      className="px-3 py-1 text-sm bg-purple-100 hover:bg-purple-200 text-purple-800 rounded-md transition-colors flex items-center gap-1"
                    >
                      <svg
                        className="w-4 h-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                        />
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                        />
                      </svg>
                      View Content
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
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
            }`}
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
            <XMarkIcon className="w-5 h-5 text-red-500 ml-2 flex-shrink-0" />
          </p>
        );
      }
    } else {
      return (
        <p className="text-gray-800 bg-red-50 border border-red-700 rounded p-2 w-full flex items-center justify-between">
          <span className="w-full">No answer was provided by the learner.</span>
          <XMarkIcon className="w-5 h-5 text-red-500 ml-2 flex-shrink-0" />
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

      <MarkdownViewer className="mb-2 sm:mb-4 pb-2 sm:pb-4 border-b text-gray-700">
        {questionText}
      </MarkdownViewer>

      {checkToShowRubric() && (
        <ShowHideRubric
          rubrics={scoring?.rubrics}
          className="mb-4"
          showPoints={scoring?.showPoints}
        />
      )}

      <div className="w-full mb-4">{renderLearnerAnswer()}</div>

      {highestScoreResponse?.feedback && (
        <div className="p-4 mt-4 rounded-lg bg-gray-50 flex items-center gap-4">
          <div className="flex-shrink-0 w-6 justify-center items-center flex">
            <SparklesIcon className="w-4 h-4 text-violet-600" />
          </div>
          {!showSubmissionFeedback ? (
            <p className="text-gray-800">
              Feedback has been hidden by the instructor. Please wait until your
              instructor enable it back.
            </p>
          ) : (
            <FeedbackFormatter className="text-gray-800 flex-1 mt-2 sm:mt-0">
              {highestScoreResponse?.feedback[0]?.feedback}
            </FeedbackFormatter>
          )}
        </div>
      )}

      {fileViewer.isOpen && fileViewer.currentFile && (
        <FilePreview
          file={fileViewer.currentFile}
          content={fileViewer.currentContent}
          onClose={handleCloseFileViewer}
          onDownload={handleDownloadFile}
          onNext={
            fileViewer.currentIndex < fileViewer.allFiles.length - 1
              ? handleNextFile
              : undefined
          }
          onPrevious={
            fileViewer.currentIndex > 0 ? handlePreviousFile : undefined
          }
          hasNext={fileViewer.currentIndex < fileViewer.allFiles.length - 1}
          hasPrevious={fileViewer.currentIndex > 0}
        />
      )}

      {fileViewer.isLoading && fileViewer.isOpen && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white p-6 rounded-lg shadow-xl flex items-center gap-3">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-purple-600"></div>
            <span className="text-gray-700">Loading file content...</span>
          </div>
        </div>
      )}
    </>
  );
};

export default Question;
