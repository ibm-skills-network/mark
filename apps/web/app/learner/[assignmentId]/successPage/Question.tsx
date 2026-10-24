import { trueFalseTranslations } from "@/app/Helpers/Languages/TrueFalseInAllLang";
import CollapsibleFeedback, {
  StructuredFeedbackData,
} from "@/components/CollapsibleFeedback";
import RichTextViewer from "@/components/rich-text/RichTextViewer";
import dynamic from "next/dynamic";

const PdfFeedbackViewer = dynamic(
  () => import("@/components/PdfFeedbackViewer"),
  { ssr: false },
);
import {
  type CompletedAttemptQuestion,
  type CorrectAnswerVisibility,
  type ExtendedFileContent,
  type Feedback,
  type ResponseHighlighting,
  HighlightLevel,
} from "@/config/types";
import {
  isUnsupportedQuestion,
  UNSUPPORTED_QUESTION_NOTICE,
} from "@/lib/unsupported-questions";
import { parseLearnerResponse } from "@/lib/utils";
import { useAssignmentDetails } from "@/stores/learner";
import { CheckIcon, SparklesIcon, XMarkIcon } from "@heroicons/react/24/solid";
import { FC, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import ShowHideRubric from "../../(components)/Question/ShowHideRubric";
import FilePreview from "@/components/FileExplorer/FilePreview";
import {
  fetchFileContentSafe,
  downloadFile,
  getFileExtension,
} from "@/lib/shared";
import PdfAnnotationModal from "./PdfAnnotationModal";

interface Props {
  /**
   * Served by the completed-attempt read with every visibility rule already
   * applied: `points`/`feedback` are null when hidden and a choice carries
   * `isCorrect`/`feedback` only when correct answers may be shown.
   */
  question: CompletedAttemptQuestion;
  number: number;
  language: string;
  showSubmissionFeedback: boolean;
  /** Decides whether an unanswered question shows a 0 or no score at all. */
  showQuestionScore: boolean;
  correctAnswerVisibility: CorrectAnswerVisibility;
}

const BLANK_ANSWER_FEEDBACK: Feedback[] = [
  { feedback: "This answer was blank" },
];

/** A stored answer arrives as JSON text, or already parsed. */
function toLearnerResponse(value: unknown): LearnerResponseType {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "string") return parseLearnerResponse(value);
  if (typeof value === "number") return String(value);
  return value as LearnerResponseType;
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
  showQuestionScore,
  correctAnswerVisibility,
}) => {
  const {
    question: questionText,
    totalPoints,
    response,
    type,
    choices,
    scoring,
  } = question;
  const unsupported = isUnsupportedQuestion(question);

  const filePreviewRequest = useRef(0);
  const [fileViewer, setFileViewer] = useState<FileViewerState>({
    isOpen: false,
    currentFile: null,
    currentContent: null,
    isLoading: false,
    allFiles: [],
    currentIndex: 0,
  });

  const assignmentDetails = useAssignmentDetails(
    (state) => state.assignmentDetails,
  );
  const questionControls = assignmentDetails?.questionControls;
  const [isPdfModalOpen, setIsPdfModalOpen] = useState(false);

  const checkToShowRubric = () => {
    if (
      ["TEXT", "UPLOAD", "LINk_FILE", "URL"].includes(question.type) &&
      scoring?.showRubricsToLearner &&
      scoring?.rubrics
    )
      return true;
    else return false;
  };

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
        size: result.size,
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

    const request = ++filePreviewRequest.current;
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
      if (request !== filePreviewRequest.current) return;
      setFileViewer((prev) => ({
        ...prev,
        currentContent: content,
        isLoading: false,
      }));

      if (content.error) {
        toast.error(`Error loading file: ${content.error}`);
      }
    } catch (error: unknown) {
      if (request !== filePreviewRequest.current) return;
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

    const request = ++filePreviewRequest.current;
    const nextFile = fileViewer.allFiles[nextIndex];
    setFileViewer((prev) => ({
      ...prev,
      currentFile: nextFile,
      currentContent: null,
      isLoading: true,
      currentIndex: nextIndex,
    }));

    const content = await fetchFileContent(nextFile);
    if (request !== filePreviewRequest.current) return;
    setFileViewer((prev) => ({
      ...prev,
      currentContent: content,
      isLoading: false,
    }));
  };

  const handlePreviousFile = async () => {
    const prevIndex = fileViewer.currentIndex - 1;
    if (prevIndex < 0) return;

    const request = ++filePreviewRequest.current;
    const prevFile = fileViewer.allFiles[prevIndex];
    setFileViewer((prev) => ({
      ...prev,
      currentFile: prevFile,
      currentContent: null,
      isLoading: true,
      currentIndex: prevIndex,
    }));

    const content = await fetchFileContent(prevFile);
    if (request !== filePreviewRequest.current) return;
    setFileViewer((prev) => ({
      ...prev,
      currentContent: content,
      isLoading: false,
    }));
  };

  const handleCloseFileViewer = () => {
    filePreviewRequest.current += 1;
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

  // Points null means the server hid them. An unanswered question has no
  // response row; it scored 0 when scores are shown.
  const earnedPoints: number | null = response
    ? response.points
    : showQuestionScore && !unsupported
      ? 0
      : null;
  const responseFeedback: Feedback[] | null = response
    ? response.feedback
    : showSubmissionFeedback && !unsupported
      ? BLANK_ANSWER_FEEDBACK
      : null;
  // Feedback the server withheld, as opposed to feedback that never existed.
  const feedbackHidden = Boolean(response) && response.feedback === null;

  // A question response should never display more points than the question is
  // worth. Some historical multi-select responses were graded above the
  // question maximum; clamp for display so the per-question score, its
  // pass/partial styling, and the attempt total all agree.
  const displayedPoints: number | null =
    earnedPoints === null
      ? null
      : Math.min(
          earnedPoints,
          typeof totalPoints === "number"
            ? totalPoints
            : Number.POSITIVE_INFINITY,
        );

  const parsedFeedback = useMemo<{
    feedbackText: string;
    structuredFeedback?: StructuredFeedbackData;
    highlighting?: ResponseHighlighting;
    annotatedPdfUrl?: string;
  }>(() => {
    const feedbackEntry = responseFeedback?.[0];
    let feedbackText =
      typeof feedbackEntry?.feedback === "string"
        ? feedbackEntry.feedback
        : feedbackEntry?.feedback
          ? String(feedbackEntry.feedback)
          : "";
    let structuredFeedback: StructuredFeedbackData | undefined = undefined;
    let highlighting = feedbackEntry?.highlighting;
    let annotatedPdfUrl = feedbackEntry?.annotatedPdfUrl;
    if (
      typeof feedbackText === "string" &&
      feedbackText.trim().startsWith("[")
    ) {
      try {
        let jsonString = feedbackText.trim();
        let bracketCount = 0;
        let jsonEndIndex = -1;
        // Brackets inside JSON strings (e.g. quoted code) are not structure.
        let inString = false;

        for (let index = 0; index < jsonString.length; index++) {
          const char = jsonString[index];
          if (inString) {
            if (char === "\\") index++;
            else if (char === '"') inString = false;
          } else if (char === '"') inString = true;
          else if (char === "[") bracketCount++;
          else if (char === "]") {
            bracketCount--;
            if (bracketCount === 0) {
              jsonEndIndex = index + 1;
              break;
            }
          }
        }

        if (jsonEndIndex > 0) {
          jsonString = jsonString.substring(0, jsonEndIndex);
        }

        const parsed = JSON.parse(jsonString);
        if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].feedback) {
          feedbackText = parsed[0].feedback;
          const rawStructured = parsed[0].structuredFeedback;
          if (rawStructured && typeof rawStructured === "object") {
            structuredFeedback = rawStructured as StructuredFeedbackData;
          }
          highlighting = parsed[0].highlighting;
          annotatedPdfUrl = parsed[0].annotatedPdfUrl;
        }
      } catch (error) {
        // Failed to parse highlighting data - continue without highlights
      }
    }

    if (!structuredFeedback && feedbackEntry?.structuredFeedback) {
      const rawStructured = feedbackEntry.structuredFeedback;
      if (typeof rawStructured === "string") {
        try {
          structuredFeedback = JSON.parse(
            rawStructured,
          ) as StructuredFeedbackData;
        } catch {
          structuredFeedback = undefined;
        }
      } else if (typeof rawStructured === "object") {
        structuredFeedback = rawStructured;
      }
    }

    if (
      structuredFeedback &&
      (!structuredFeedback.summary ||
        !Array.isArray(structuredFeedback.criteria))
    ) {
      structuredFeedback = undefined;
    }

    return {
      feedbackText: feedbackText ?? "",
      structuredFeedback,
      highlighting,
      annotatedPdfUrl,
    };
  }, [responseFeedback]);

  const allHighlights = useMemo(() => {
    const pages = parsedFeedback.highlighting?.pages;
    const pageArray = Array.isArray(pages)
      ? pages
      : pages && typeof pages === "object"
        ? Object.values(pages as Record<string, ResponseHighlighting>)
        : [];

    return pageArray.flatMap((page) =>
      page.highlights.map((h) => ({ ...h, page: page.pageNumber })),
    );
  }, [parsedFeedback.highlighting]);

  const quickStrengths = useMemo(() => {
    if (parsedFeedback.structuredFeedback?.criteria) {
      return parsedFeedback.structuredFeedback.criteria
        .filter(
          (criterion) =>
            criterion.status === "full" ||
            criterion.pointsAwarded === criterion.maxPoints,
        )
        .map(
          (criterion) =>
            `${criterion.name}: ${criterion.feedback || "Met in full"}`,
        )
        .slice(0, 4);
    }

    return allHighlights
      .filter((h) => h.level === HighlightLevel.CORRECT)
      .map((h) => `${h.text}: ${h.comment || "Matches rubric"}`)
      .slice(0, 4);
  }, [allHighlights, parsedFeedback.structuredFeedback]);

  const quickNeedsWork = useMemo(() => {
    if (parsedFeedback.structuredFeedback?.criteria) {
      return parsedFeedback.structuredFeedback.criteria
        .filter((criterion) => criterion.status !== "full")
        .map(
          (criterion) =>
            `${criterion.name}: ${criterion.feedback || "Needs more detail"}`,
        )
        .slice(0, 4);
    }

    return allHighlights
      .filter(
        (h) =>
          h.level === HighlightLevel.PARTIAL ||
          h.level === HighlightLevel.INCORRECT,
      )
      .map((h) => `${h.text}: ${h.comment || "Needs revision"}`)
      .slice(0, 4);
  }, [allHighlights, parsedFeedback.structuredFeedback]);

  const quickGuidance = useMemo(() => {
    const guidanceText = parsedFeedback.structuredFeedback?.guidance;
    if (typeof guidanceText === "string" && guidanceText.trim()) {
      return guidanceText
        .split(/\n|•|- /)
        .map((item) => item.trim())
        .filter(Boolean)
        .map((item) => item)
        .slice(0, 4);
    }

    const match = parsedFeedback.feedbackText.match(/Guidance:\s*([\s\S]+)/i);
    if (match && match[1]) {
      return match[1]
        .split(/\n|•|- /)
        .map((item) => item.trim())
        .filter(Boolean)
        .map((item) => item)
        .slice(0, 4);
    }

    return [];
  }, [parsedFeedback.feedbackText, parsedFeedback.structuredFeedback]);

  const scoreRationale = useMemo(() => {
    if (parsedFeedback.structuredFeedback?.summary) {
      return parsedFeedback.structuredFeedback.summary;
    }
    if (displayedPoints !== null) {
      return `Awarded ${displayedPoints}/${totalPoints} points.`;
    }
    return "";
  }, [displayedPoints, parsedFeedback.structuredFeedback, totalPoints]);

  // Right/wrong colouring of a scored answer needs a visible score and an
  // author who lets correctness show at all.
  const shouldShowHighlighting =
    correctAnswerVisibility !== "NEVER" && displayedPoints !== null;

  const learnerResponse = toLearnerResponse(response?.learnerResponse);
  const renderLearnerAnswer = () => {
    if (unsupported) {
      return (
        <p className="text-gray-700 bg-gray-50 border border-gray-300 rounded p-2 w-full">
          {UNSUPPORTED_QUESTION_NOTICE}
        </p>
      );
    }
    if (
      type === "TEXT" &&
      learnerResponse &&
      (typeof learnerResponse === "string" ||
        typeof learnerResponse === "boolean")
    ) {
      return (
        <p
          className={`text-gray-800 w-full ${
            shouldShowHighlighting
              ? displayedPoints === totalPoints
                ? "bg-green-50 border border-green-500 rounded p-2"
                : displayedPoints > 0
                  ? "bg-yellow-50 border border-yellow-500 rounded p-2"
                  : "bg-red-50 border border-red-700 rounded p-2"
              : "bg-gray-50 border border-gray-300 rounded p-2"
          }`}
        >
          <RichTextViewer
            className="text-gray-800"
            allowCopy={!(questionControls?.disableCopy ?? false)}
          >
            {learnerResponse.toString()}
          </RichTextViewer>
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
          <p
            className={`text-gray-800 ${shouldShowHighlighting ? "bg-red-50 border border-red-700" : "bg-gray-50 border border-gray-300"} rounded p-2 w-full flex items-center justify-between`}
          >
            <span className="w-full">
              No answer was provided by the learner.
            </span>
            {shouldShowHighlighting && (
              <XMarkIcon className="w-5 h-5 text-red-500 ml-2 flex-shrink-0" />
            )}
          </p>
        );
      }

      const isSingleChoice = type === "SINGLE_CORRECT";
      // Answers reach this page as the chosen choice text, which is also what
      // the grader matched, so selection is by text alone. Matching positions
      // too made a digit answer like "2" also select whichever choice sat at
      // index 2. String() undoes JSON parsing a bare digit answer to a number.
      const selectedTexts = new Set(
        (Array.isArray(learnerResponse)
          ? (learnerResponse as unknown[])
          : [learnerResponse]
        ).map((ans) => String(ans)),
      );

      return (
        <ul className="list-none text-gray-800 w-full flex flex-col justify-start gap-y-2">
          {choices.map((choiceObj, idx) => {
            const isSelected = selectedTexts.has(choiceObj.choice);
            // The server sends isCorrect only when correct answers may be
            // shown for this attempt; without it nothing is marked.
            const correctnessKnown = typeof choiceObj.isCorrect === "boolean";
            const isCorrect = choiceObj.isCorrect === true;
            return (
              <li
                key={idx}
                className={`flex items-start mb-2 px-2 py-2 ${
                  correctnessKnown
                    ? isSelected
                      ? isCorrect
                        ? "bg-green-50 border border-green-500 rounded"
                        : "bg-red-50 border border-red-700 rounded"
                      : isCorrect
                        ? "bg-green-50 border border-green-500 rounded"
                        : ""
                    : isSelected
                      ? "bg-gray-50 border border-gray-300 rounded"
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

                    {isSelected && choiceObj.feedback && (
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
                    {correctnessKnown && isCorrect && (
                      <CheckIcon className="w-5 h-5 text-green-500" />
                    )}
                    {correctnessKnown && !isCorrect && isSelected && (
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
            shouldShowHighlighting
              ? displayedPoints === totalPoints
                ? "bg-green-50 border border-green-500 rounded p-2"
                : displayedPoints > 0
                  ? "bg-yellow-50 border border-yellow-500 rounded p-2"
                  : "bg-red-50 border border-red-700 rounded p-2"
              : "bg-gray-50 border border-gray-300 rounded p-2"
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
                        void handleFileView(
                          learnerResponse as LearnerFileResponse[],
                          idx,
                        );
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
              shouldShowHighlighting
                ? displayedPoints === totalPoints
                  ? "bg-green-50 border border-green-500 rounded p-2"
                  : displayedPoints > 0
                    ? "bg-yellow-50 border border-yellow-500 rounded p-2"
                    : "bg-red-50 border border-red-700 rounded p-2"
                : "bg-gray-50 border border-gray-300 rounded p-2"
            }`}
          >
            {learnerResponse}
          </p>
        );
      } else {
        return (
          <p
            className={`text-gray-800 ${shouldShowHighlighting ? "bg-red-50 border border-red-700" : "bg-gray-50 border border-gray-300"} rounded p-2 w-full flex items-center justify-between`}
          >
            <span className="w-full">
              No answer was provided by the learner.
            </span>
            {shouldShowHighlighting && (
              <XMarkIcon className="w-5 h-5 text-red-500 ml-2 flex-shrink-0" />
            )}
          </p>
        );
      }
    } else {
      return (
        <p
          className={`text-gray-800 ${shouldShowHighlighting ? "bg-red-50 border border-red-700" : "bg-gray-50 border border-gray-300"} rounded p-2 w-full flex items-center justify-between`}
        >
          <span className="w-full">No answer was provided by the learner.</span>
          {shouldShowHighlighting && (
            <XMarkIcon className="w-5 h-5 text-red-500 ml-2 flex-shrink-0" />
          )}
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
        {unsupported ? (
          <p className="text-sm text-gray-600 mt-2 md:mt-0">Not graded</p>
        ) : displayedPoints === null ? (
          <p className="text-sm text-gray-600 mt-2 md:mt-0">Points hidden</p>
        ) : (
          <p className="text-sm text-gray-600">
            Score:{" "}
            <span className="font-bold text-gray-800">
              {displayedPoints}/{totalPoints}
            </span>
          </p>
        )}
      </div>

      <RichTextViewer
        className="mb-2 sm:mb-4 pb-2 sm:pb-4 border-b text-gray-700"
        allowCopy={!(questionControls?.disableCopy ?? false)}
      >
        {questionText ?? ""}
      </RichTextViewer>

      {checkToShowRubric() && (
        <ShowHideRubric
          rubrics={scoring?.rubrics}
          className="mb-4"
          showRubrics={scoring?.showRubricsToLearner}
          showPoints={scoring?.showPoints}
        />
      )}

      <div className="w-full mb-4">{renderLearnerAnswer()}</div>

      {(responseFeedback || feedbackHidden) && (
        <div className="mt-4">
          {feedbackHidden || !showSubmissionFeedback ? (
            <div className="p-4 rounded-lg bg-gray-50 flex items-center gap-4">
              <div className="flex-shrink-0 w-6 justify-center items-center flex">
                <SparklesIcon className="w-4 h-4 text-violet-600" />
              </div>
              <p className="text-gray-800">
                Feedback has been hidden by the instructor. Please wait until
                your instructor enable it back.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center gap-2 mb-2">
                <SparklesIcon className="w-5 h-5 text-violet-600" />
                <h3 className="text-lg font-semibold text-gray-900">
                  Grading Feedback
                </h3>
              </div>
              {parsedFeedback.annotatedPdfUrl && (
                <div className="rounded-xl border border-violet-100 bg-gradient-to-r from-violet-50 to-indigo-50 p-4 shadow-sm">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-sm font-semibold text-violet-900">
                        Interactive PDF with AI feedback
                      </p>
                      <p className="text-sm text-violet-800">
                        Your submission with color-coded highlights and detailed
                        comments
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={() => setIsPdfModalOpen(true)}
                        className="inline-flex items-center gap-2 rounded-md bg-violet-700 px-4 py-2 text-sm font-semibold text-white shadow-md transition hover:bg-violet-600"
                      >
                        <svg
                          className="h-4 w-4"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"
                          />
                        </svg>
                        View Fullscreen
                      </button>
                      <a
                        href={parsedFeedback.annotatedPdfUrl}
                        download
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 rounded-md bg-white px-4 py-2 text-sm font-semibold text-violet-800 shadow hover:bg-violet-50 border border-violet-200"
                      >
                        <svg
                          className="h-4 w-4"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                          />
                        </svg>
                        Download
                      </a>
                    </div>
                  </div>
                </div>
              )}

              {parsedFeedback.annotatedPdfUrl ? (
                <PdfFeedbackViewer
                  pdfUrl={parsedFeedback.annotatedPdfUrl}
                  highlighting={parsedFeedback.highlighting}
                  strengths={quickStrengths}
                  needsWork={quickNeedsWork}
                  guidance={quickGuidance}
                  scoreRationale={scoreRationale}
                />
              ) : ["TRUE_FALSE", "SINGLE_CORRECT", "MULTIPLE_CORRECT"].includes(
                  type,
                ) ? (
                <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
                  {parsedFeedback.feedbackText && (
                    <div className="prose prose-sm max-w-none text-gray-800">
                      <RichTextViewer
                        className="text-gray-800"
                        allowCopy={!(questionControls?.disableCopy ?? false)}
                      >
                        {parsedFeedback.feedbackText}
                      </RichTextViewer>
                    </div>
                  )}
                  {!parsedFeedback.feedbackText && (
                    <p className="text-sm text-gray-500 italic">
                      No feedback available
                    </p>
                  )}
                </div>
              ) : (
                <CollapsibleFeedback
                  feedback={parsedFeedback.feedbackText}
                  structuredFeedback={parsedFeedback.structuredFeedback}
                  showSubQuestions={scoring?.showSubQuestionsToLearner ?? true}
                  showPoints={scoring?.showPoints ?? true}
                  className="text-gray-800"
                />
              )}
            </div>
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
          loading={fileViewer.isLoading}
        />
      )}

      <PdfAnnotationModal
        open={isPdfModalOpen}
        onClose={() => setIsPdfModalOpen(false)}
        pdfUrl={parsedFeedback.annotatedPdfUrl}
        highlighting={parsedFeedback.highlighting}
        strengths={quickStrengths}
        needsWork={quickNeedsWork}
        guidance={quickGuidance}
        scoreRationale={scoreRationale}
      />
    </>
  );
};

export default Question;
