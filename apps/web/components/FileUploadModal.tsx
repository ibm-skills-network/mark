import MarkQuestionGenAnimation from "@/animations/MarkQuestionGenAnimation.json";
import MarkQuestionGenCompleted from "@/animations/MarkQuestionGenCompleted.json";
import MarkQuestionGenFailed from "@/animations/MarkQuestionGenFailed.json";
import { readFile } from "@/app/Helpers/fileReader";
import {
  AssignmentTypeEnum,
  QuestionAuthorStore,
  QuestionGenerationPayload,
  ResponseType,
} from "@/config/types";
import {
  pollQuestionGenerationJob,
  startQuestionGenerationJob,
} from "@/lib/question-generation/client";
import { mergeGeneratedQuestionsForAuthorStore } from "@/lib/question-generation/normalize";
import { useAuthorStore } from "@/stores/author";
import {
  IconCloudUpload,
  IconFile,
  IconInfoCircle,
  IconTrash,
} from "@tabler/icons-react";
import { AnimatePresence, motion } from "framer-motion";
import Lottie from "lottie-react";
import { useEffect, useState } from "react";
import { useDropzone } from "react-dropzone";
import { toast } from "sonner";
import Modal from "./Modal";
import Tooltip from "./Tooltip";

const MAX_CHAR_LIMIT = 20000;

interface FileUploadModalProps {
  onClose: () => void;
  questionId: number;
}

type MultipleChoiceSubtypeCounts = NonNullable<
  QuestionGenerationPayload["questionsToGenerate"]["multipleChoiceSubtypes"]
>;

const multipleChoiceSubtypeFields: Array<{
  key: keyof MultipleChoiceSubtypeCounts;
  label: string;
}> = [
  { key: "short", label: "Short" },
  { key: "quantitative", label: "Quantitative" },
  { key: "long", label: "Long" },
  { key: "scenario", label: "Scenario" },
];

// Show an empty string when the value is 0 so users can backspace and type
// a new number without fighting a persistent "0". Placeholder still shows "0".
const toDisplayValue = (n: number): string | number => (n === 0 ? "" : n);

const clampNonNegative = (raw: string, max?: number): number => {
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return max !== undefined ? Math.min(max, parsed) : parsed;
};

const FileUploadModal = ({ onClose, questionId }: FileUploadModalProps) => {
  const [fileUploaded, setFileUploaded] = useAuthorStore((state) => [
    state.fileUploaded,
    state.setFilesUploaded,
  ]);
  const [progress, setProgress] = useState<number | null>(null);
  const [progressMessage, setProgressMessage] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [statusData, setStatusData] = useState<{
    status: string;
    progress: string;
    questions?: QuestionAuthorStore[];
  } | null>(null);
  const activeAssignmentId = useAuthorStore(
    (state) => state.activeAssignmentId,
  );
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const [selectedFileContent, setSelectedFileContent] = useState<string | null>(
    null,
  );
  const setQuestions = useAuthorStore((state) => state.setQuestions);
  const setQuestionOrder = useAuthorStore((state) => state.setQuestionOrder);
  const setUpdatedAt = useAuthorStore((state) => state.setUpdatedAt);
  const [learningObjectives, setLearningObjectives] = useAuthorStore(
    (state) => [state.learningObjectives, state.setLearningObjectives],
  );
  const [error, setError] = useState<string | null>(null);
  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    else if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    else return `${(bytes / 1048576).toFixed(1)} MB`;
  };

  const countTokens = (content: string): number => {
    return content.split(/\s+/).length;
  };
  const onDrop = async (acceptedFiles: File[]) => {
    const fileContents = await Promise.all(
      acceptedFiles.map(async (file: File) => {
        const content = await readFile(file, questionId);
        return {
          filename: file.name,
          content: content.content,
          size: file.size,
          tokenCount: countTokens(content.content),
        };
      }),
    );
    if (fileContents.length === 0) {
      toast.error("No valid files uploaded. Please try again.");
      return;
    }
    if (
      fileContents.some(
        (file) =>
          file.tokenCount > MAX_CHAR_LIMIT ||
          file.content.length > MAX_CHAR_LIMIT,
      )
    ) {
      toast.error(
        `One or more files exceed the maximum character limit of ${MAX_CHAR_LIMIT}. Please shorten the content.`,
      );
      return;
    }

    setFileUploaded(fileUploaded.concat(fileContents));
  };

  const [fileInspectorModalOpen, setFileInspectorModalOpen] = useState(false);
  const [selectedDifficulty, setSelectedDifficulty] =
    useState<AssignmentTypeEnum>(AssignmentTypeEnum.PRACTICE);
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "text/plain": [".txt"],
      "application/pdf": [".pdf"],
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
        [".docx"],
      "application/vnd.ms-excel": [".xls", ".xlsx"],
      "text/csv": [".csv"],
      "text/markdown": [".md"],
      "application/vnd.openxmlformats-officedocument.presentationml.presentation":
        [".pptx"],
      "application/x-ipynb+json": [".ipynb"],
    },
    multiple: true,
  });
  const [selectedQuestionTypes, setSelectedQuestionTypes] = useState({
    multipleChoice: 0,
    multipleSelect: 0,
    textResponse: 0,
    trueFalse: 0,
    url: 0,
    upload: 0,
    linkFile: 0,
  });
  const [multipleChoiceSubtypes, setMultipleChoiceSubtypes] =
    useState<MultipleChoiceSubtypeCounts>({
      short: 0,
      quantitative: 0,
      long: 0,
      scenario: 0,
    });

  const [selectedResponseTypes] = useState({
    TEXT: "OTHER" as ResponseType,
    URL: "OTHER" as ResponseType,
    UPLOAD: "OTHER" as ResponseType,
    LINK_FILE: "OTHER" as ResponseType,
  });
  const [replaceExistingQuestions, setReplaceExistingQuestions] =
    useState(false);

  const difficultyOptions = [
    { value: AssignmentTypeEnum.PRACTICE, label: "Practice" },
    { value: AssignmentTypeEnum.QUIZ, label: "Quiz" },
    { value: AssignmentTypeEnum.ASSINGMENT, label: "Assignment" },
    { value: AssignmentTypeEnum.MIDTERM, label: "Semi-Final" },
    { value: AssignmentTypeEnum.FINAL, label: "Final" },
  ];

  const truncateContent = (content: string) => {
    if (content.length > MAX_CHAR_LIMIT) {
      alert(
        `Content is too long (${content.length} characters). Only the first ${MAX_CHAR_LIMIT} characters will be sent.`,
      );
      return content.substring(0, MAX_CHAR_LIMIT) + "...";
    }
    return content;
  };

  const handleSend = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStatusData(null);
    setError(null);

    const subtypeTotal = Object.values(multipleChoiceSubtypes).reduce(
      (total, count) => total + count,
      0,
    );
    const multipleChoiceTotal = selectedQuestionTypes.multipleChoice;
    const totalRequestedQuestions = Object.values(selectedQuestionTypes).reduce(
      (a, b) => a + b,
      0,
    );

    if (fileUploaded.length === 0 && learningObjectives.length === 0) {
      toast.error("Please upload files or enter learning objectives.");
      return;
    } else if (subtypeTotal > multipleChoiceTotal) {
      toast.error(
        `Styled multiple choice counts (${subtypeTotal}) exceed the total (${multipleChoiceTotal}).`,
      );
      return;
    } else if (totalRequestedQuestions === 0) {
      toast.error("Please select at least one question type to generate.");
      return;
    } else if (learningObjectives.length > MAX_CHAR_LIMIT) {
      toast.error(
        `Learning objectives are too long (${learningObjectives.length} characters). Please shorten the objectives.`,
      );
      return;
    }

    try {
      const payload: QuestionGenerationPayload = {
        assignmentId: activeAssignmentId,
        assignmentType: selectedDifficulty,
        questionsToGenerate: {
          multipleChoice: multipleChoiceTotal - subtypeTotal,
          multipleSelect: selectedQuestionTypes.multipleSelect,
          textResponse: selectedQuestionTypes.textResponse,
          trueFalse: selectedQuestionTypes.trueFalse,
          url: selectedQuestionTypes.url,
          upload: selectedQuestionTypes.upload,
          linkFile: selectedQuestionTypes.linkFile,
          ...(subtypeTotal > 0 ? { multipleChoiceSubtypes } : {}),
          responseTypes: selectedResponseTypes,
        },
        fileContents: fileUploaded,
        learningObjectives,
      };

      const nextJobId = await startQuestionGenerationJob(payload);
      setJobId(nextJobId);
      setProgress(0);
      setProgressMessage("Processing started");
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === "Failed to upload files"
      ) {
        setError("Failed to upload files");
      } else {
        setError("An error occurred while uploading files.");
      }
    }
  };
  const getDifficultyDescription = (difficulty: AssignmentTypeEnum) => {
    switch (difficulty) {
      case AssignmentTypeEnum.PRACTICE:
        return "Surface-level, simple questions to reinforce understanding.";
      case AssignmentTypeEnum.QUIZ:
        return "Moderately challenging questions to test comprehension.";
      case AssignmentTypeEnum.ASSINGMENT:
        return "In-depth questions requiring detailed explanations or calculations.";
      case AssignmentTypeEnum.MIDTERM:
        return "Comprehensive questions that assess understanding of multiple topics.";
      case AssignmentTypeEnum.FINAL:
        return "Advanced, in-depth questions with follow-ups to evaluate mastery.";
      default:
        return "";
    }
  };

  useEffect(() => {
    if (jobId) {
      const stopPolling = pollQuestionGenerationJob({
        jobId,
        onUpdate: (latestStatusData) => {
          setStatusData(latestStatusData);
          setProgressMessage(latestStatusData.progress || "");
        },
        onCompleted: (latestStatusData) => {
          if (latestStatusData.questions) {
            const latestStore = useAuthorStore.getState();
            const mergeResult = mergeGeneratedQuestionsForAuthorStore({
              existingQuestions: latestStore.questions || [],
              generatedQuestions: latestStatusData.questions,
              assignmentId: activeAssignmentId,
              existingQuestionOrder: latestStore.questionOrder || [],
              replaceExisting: replaceExistingQuestions,
            });

            setQuestions(mergeResult.questions);
            setQuestionOrder(mergeResult.questionOrder);
            if (setUpdatedAt) {
              setUpdatedAt(Date.now());
            }
          }
          setTimeout(() => onClose(), 2000);
        },
        onFailed: () => {
          setError("Processing failed. Please try again.");
          setTimeout(() => {
            setProgress(null);
          }, 5000);
        },
        onError: () => {
          setError("An error occurred while fetching job status.");
        },
      });

      return () => {
        stopPolling();
      };
    }
  }, [
    activeAssignmentId,
    jobId,
    onClose,
    replaceExistingQuestions,
    setQuestionOrder,
    setQuestions,
    setUpdatedAt,
  ]);

  return (
    <Modal onClose={onClose} Title="Generate Questions for your assignment">
      <motion.div
        className="relative overflow-y-auto max-h-[80vh] pb-24 p-6 scrollbar-hide"
        initial={{ y: 50, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 50, opacity: 0 }}
      >
        <p className="text-gray-700 dark:text-gray-200 mb-2 bg-gray-100 dark:bg-gray-700 p-4 rounded-md">
          Generate Questions by providing information. Information can be
          written and/or uploaded.
        </p>

        <div className="my-6">
          <h2 className="text-md text-gray-600 dark:text-gray-300 mb-2">
            What are the learning objectives?
          </h2>

          <textarea
            value={learningObjectives}
            onChange={(e) => setLearningObjectives(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-violet-500 focus:border-violet-500 sm:text-sm"
            placeholder="Enter topics, learning objectives, or additional content here..."
          />
        </div>

        <div className="mb-6">
          <h2 className="text-lg text-gray-600 dark:text-gray-300 mb-2">
            Upload additional resources (optional)
          </h2>
          <div {...getRootProps()} className="w-full">
            <motion.div
              whileHover={{ scale: 1.02 }}
              className={`flex flex-col items-center justify-center border-2 border-dashed p-6 rounded-md cursor-pointer transition-colors ${
                isDragActive
                  ? "border-purple-500 bg-purple-50 dark:bg-purple-900/20"
                  : "border-gray-300 dark:border-gray-600"
              }`}
            >
              <input {...getInputProps()} />
              <IconCloudUpload
                size={50}
                className="text-gray-500 dark:text-gray-400 mb-4"
              />
              {isDragActive ? (
                <p className="text-purple-500">Drop the files here...</p>
              ) : (
                <>
                  <p className="text-gray-500 dark:text-gray-400">
                    Drag & drop some files here, or click to select files.
                  </p>
                  <p className="text-gray-500 dark:text-gray-400">
                    Allowed file types: .txt .pdf .docx .xls .xlsx .csv .md
                    .ipynb
                  </p>
                </>
              )}
            </motion.div>
          </div>
          <div className="mt-4 w-full">
            {fileUploaded.length > 0 ? (
              <ul className="space-y-3">
                <AnimatePresence>
                  {fileUploaded.map((file) => (
                    <motion.li
                      key={file.filename}
                      className="flex flex-col border-gray-300 dark:border-gray-600 border rounded-md px-4 py-3 hover:shadow-md"
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 10 }}
                      transition={{ duration: 0.3 }}
                    >
                      <div className="flex items-center justify-between space-x-3 px-4">
                        <button
                          className="flex items-center space-x-3"
                          onClick={() => {
                            setSelectedFileName(file.filename);
                            setSelectedFileContent(
                              truncateContent(file.content),
                            );
                            setFileInspectorModalOpen(true);
                          }}
                        >
                          <IconFile
                            size={32}
                            className="text-gray-500 dark:text-gray-400"
                          />
                          <div>
                            <p className="text-gray-700 dark:text-gray-200 font-medium text-left">
                              {file.filename}
                            </p>
                            <div className="flex items-center space-x-2">
                              <p className="text-sm text-gray-500 dark:text-gray-400">
                                {formatFileSize(file.size)}
                              </p>
                              <p className="text-sm text-gray-500 dark:text-gray-400">
                                {file.tokenCount} tokens
                              </p>
                            </div>
                          </div>
                        </button>

                        <button
                          className="text-red-500 hover:text-red-600"
                          onClick={() =>
                            setFileUploaded(
                              fileUploaded.filter(
                                (f) => f.filename !== file.filename,
                              ),
                            )
                          }
                          aria-label={`Remove file ${file.filename}`}
                        >
                          <IconTrash size={20} />
                        </button>
                      </div>

                      <div className="flex-1 mx-4">
                        <p className="text-right text-sm  mb-2">SUCCESS</p>
                        <div className="relative h-1 w-full bg-gray-200 dark:bg-gray-700 rounded">
                          <motion.div
                            className="absolute h-1 bg-purple-500 rounded"
                            initial={{ width: "0%" }}
                            animate={{ width: "100%" }}
                            transition={{ duration: 0.5 }}
                            style={{ width: "100%" }}
                          ></motion.div>
                        </div>
                      </div>
                    </motion.li>
                  ))}
                </AnimatePresence>
              </ul>
            ) : (
              <p className="text-gray-500 dark:text-gray-400 text-center">
                No files uploaded yet.
              </p>
            )}
          </div>
        </div>
        <h1 className="text-lg font-medium text-center text-gray-800 dark:text-gray-200 mb-2 border-t border-b border-gray-300 dark:border-gray-600 py-2">
          Question Details
        </h1>
        <form onSubmit={handleSend} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="grid grid-row-2 gap-4">
              <div>
                <h1 className="text-lg font-medium text-gray-800 dark:text-gray-200">
                  Styles
                </h1>
                <div className="mt-2 space-y-4">
                  {difficultyOptions.map((option) => (
                    <div
                      key={option.value}
                      className="flex items-center space-x-3"
                    >
                      <input
                        type="radio"
                        name="difficulty"
                        value={option.value}
                        checked={selectedDifficulty === option.value}
                        onChange={() => setSelectedDifficulty(option.value)}
                        className="h-4 w-4 mt-1 text-violet-600 border-gray-300 dark:border-gray-600 focus:ring-violet-500"
                      />

                      <div>
                        <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
                          {option.label}
                        </span>
                        <p className="text-sm text-gray-500 dark:text-gray-400">
                          {getDifficultyDescription(option.value)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="flex items-center space-x-2">
                <div className="flex items-center">
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-200">
                    Replace Existing Questions:
                  </label>
                  <Tooltip
                    content="If enabled, existing questions will be replaced with the new ones."
                    maxWidth={3}
                    up={-3.3}
                  >
                    <IconInfoCircle
                      size={16}
                      className="text-gray-500 dark:text-gray-400 cursor-pointer ml-1"
                    />
                  </Tooltip>
                </div>
                <button
                  type="button"
                  onClick={() => setReplaceExistingQuestions((prev) => !prev)}
                  className={`${
                    replaceExistingQuestions
                      ? "bg-violet-600"
                      : "bg-gray-200 dark:bg-gray-700"
                  } relative inline-flex items-center h-6 rounded-full w-11 transition-colors focus:outline-none`}
                >
                  <span
                    className={`${
                      replaceExistingQuestions
                        ? "translate-x-6"
                        : "translate-x-1"
                    } inline-block w-4 h-4 transform bg-white dark:bg-gray-800 rounded-full transition-transform`}
                  />
                </button>
              </div>
            </div>

            <div className="grid grid-row border-l border-gray-300 dark:border-gray-600 pl-4 mb-16">
              <div className="flex flex-col space-y-2">
                <h1 className="text-lg font-medium text-gray-800 dark:text-gray-200">
                  Question Types
                </h1>
                <p className="text-sm text-gray-600 dark:text-gray-300">
                  How many questions of each type would you like to generate?
                </p>
              </div>

              <div className="rounded-md border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 p-3">
                <p className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  Multiple Choice
                </p>
                <div className="mt-3 flex items-center space-x-2">
                  <input
                    type="number"
                    min="0"
                    max="100"
                    placeholder="0"
                    value={toDisplayValue(selectedQuestionTypes.multipleChoice)}
                    onFocus={(e) => e.currentTarget.select()}
                    onWheel={(e) => e.currentTarget.blur()}
                    onChange={(e) => {
                      const next = clampNonNegative(e.target.value, 100);
                      setSelectedQuestionTypes((prev) => ({
                        ...prev,
                        multipleChoice: next,
                      }));
                    }}
                    className="w-16 p-1 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200"
                  />
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-200">
                    Total
                  </label>
                </div>
                <p className="mt-3 text-xs text-gray-600 dark:text-gray-300">
                  Optionally steer the style of some questions. The rest are
                  generated as standard multiple choice.
                </p>
                <div className="mt-2 flex flex-col space-y-2">
                  {multipleChoiceSubtypeFields.map((field) => (
                    <div
                      key={field.key}
                      className="flex items-center space-x-2"
                    >
                      <input
                        type="number"
                        min="0"
                        max="50"
                        placeholder="0"
                        value={toDisplayValue(
                          multipleChoiceSubtypes[field.key],
                        )}
                        onFocus={(e) => e.currentTarget.select()}
                        onWheel={(e) => e.currentTarget.blur()}
                        onChange={(e) => {
                          const next = clampNonNegative(e.target.value, 50);
                          const targetKey = field.key;
                          setMultipleChoiceSubtypes((prev) => ({
                            ...prev,
                            [targetKey]: next,
                          }));
                        }}
                        className="w-16 p-1 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200"
                      />
                      <label className="text-sm font-medium text-gray-700 dark:text-gray-200">
                        {field.label}
                      </label>
                    </div>
                  ))}
                </div>
                {(() => {
                  const activeSubtypes = multipleChoiceSubtypeFields
                    .map(({ key, label }) => ({
                      label: label.toLowerCase(),
                      count: Number(multipleChoiceSubtypes[key]) || 0,
                    }))
                    .filter((entry) => entry.count > 0);
                  const subtypeSum = activeSubtypes.reduce(
                    (acc, entry) => acc + entry.count,
                    0,
                  );
                  const total =
                    Number(selectedQuestionTypes.multipleChoice) || 0;
                  const standard = total - subtypeSum;

                  if (total === 0 && subtypeSum === 0) return null;

                  if (subtypeSum > total) {
                    const subtypeParts = activeSubtypes
                      .map((e) => `${e.count} ${e.label}`)
                      .join(" + ");
                    return (
                      <p className="mt-3 text-xs text-red-600 font-medium">
                        {subtypeParts} = {subtypeSum}, exceeds total of {total}.
                        Reduce the counts or raise the total.
                      </p>
                    );
                  }

                  const parts: string[] = [];
                  if (standard > 0) parts.push(`${standard} standard`);
                  for (const entry of activeSubtypes) {
                    parts.push(`${entry.count} ${entry.label}`);
                  }
                  if (parts.length <= 1) return null;

                  const text = `${parts.join(" + ")} = ${total} total`;

                  // key={text} forces remount each text change so the readout
                  // stays correct even when a sibling component's hydration
                  // mismatch leaves React reconciliation in a degraded state.
                  return (
                    <p
                      key={text}
                      translate="no"
                      className="mt-3 text-xs text-gray-600 dark:text-gray-300"
                    >
                      {text}
                    </p>
                  );
                })()}
              </div>

              <div className="flex items-center space-x-2">
                <input
                  type="number"
                  min="0"
                  placeholder="0"
                  value={toDisplayValue(selectedQuestionTypes.multipleSelect)}
                  onFocus={(e) => e.currentTarget.select()}
                  onWheel={(e) => e.currentTarget.blur()}
                  onChange={(e) =>
                    setSelectedQuestionTypes((prev) => ({
                      ...prev,
                      multipleSelect: clampNonNegative(e.target.value),
                    }))
                  }
                  className="w-16 p-1 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200"
                />

                <label className="text-sm font-medium text-gray-700 dark:text-gray-200">
                  Multiple Select
                </label>
              </div>

              <div className="flex items-center space-x-2">
                <input
                  type="number"
                  min="0"
                  placeholder="0"
                  value={toDisplayValue(selectedQuestionTypes.textResponse)}
                  onFocus={(e) => e.currentTarget.select()}
                  onWheel={(e) => e.currentTarget.blur()}
                  onChange={(e) =>
                    setSelectedQuestionTypes((prev) => ({
                      ...prev,
                      textResponse: clampNonNegative(e.target.value),
                    }))
                  }
                  className="w-16 p-1 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200"
                />

                <label className="text-sm font-medium text-gray-700 dark:text-gray-200">
                  Text Response
                </label>
              </div>

              <div className="flex items-center space-x-2">
                <input
                  type="number"
                  min="0"
                  placeholder="0"
                  value={toDisplayValue(selectedQuestionTypes.trueFalse)}
                  onFocus={(e) => e.currentTarget.select()}
                  onWheel={(e) => e.currentTarget.blur()}
                  onChange={(e) =>
                    setSelectedQuestionTypes((prev) => ({
                      ...prev,
                      trueFalse: clampNonNegative(e.target.value),
                    }))
                  }
                  className="w-16 p-1 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200"
                />

                <label className="text-sm font-medium text-gray-700 dark:text-gray-200">
                  True or False
                </label>
              </div>

              <div className="flex items-center space-x-2 mt-4">
                <input
                  type="number"
                  min="0"
                  placeholder="0"
                  value={toDisplayValue(selectedQuestionTypes.url)}
                  onFocus={(e) => e.currentTarget.select()}
                  onWheel={(e) => e.currentTarget.blur()}
                  onChange={(e) =>
                    setSelectedQuestionTypes((prev) => ({
                      ...prev,
                      url: clampNonNegative(e.target.value),
                    }))
                  }
                  className="w-16 p-1 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200"
                />

                <label className="text-sm font-medium text-gray-700 dark:text-gray-200">
                  URL Response
                </label>
                <Tooltip
                  content="Questions that require students to submit a URL"
                  maxWidth={3}
                  up={-3.3}
                >
                  <IconInfoCircle
                    size={16}
                    className="text-gray-500 dark:text-gray-400 cursor-pointer ml-1"
                  />
                </Tooltip>
              </div>

              <div className="flex items-center space-x-2">
                <input
                  type="number"
                  min="0"
                  placeholder="0"
                  value={toDisplayValue(selectedQuestionTypes.upload)}
                  onFocus={(e) => e.currentTarget.select()}
                  onWheel={(e) => e.currentTarget.blur()}
                  onChange={(e) =>
                    setSelectedQuestionTypes((prev) => ({
                      ...prev,
                      upload: clampNonNegative(e.target.value),
                    }))
                  }
                  className="w-16 p-1 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200"
                />

                <label className="text-sm font-medium text-gray-700 dark:text-gray-200">
                  File Upload
                </label>
                <Tooltip
                  content="Questions that require students to upload a file"
                  maxWidth={3}
                  up={-3.3}
                >
                  <IconInfoCircle
                    size={16}
                    className="text-gray-500 dark:text-gray-400 cursor-pointer ml-1"
                  />
                </Tooltip>
              </div>

              <div className="flex items-center space-x-2">
                <input
                  type="number"
                  min="0"
                  placeholder="0"
                  value={toDisplayValue(selectedQuestionTypes.linkFile)}
                  onFocus={(e) => e.currentTarget.select()}
                  onWheel={(e) => e.currentTarget.blur()}
                  onChange={(e) =>
                    setSelectedQuestionTypes((prev) => ({
                      ...prev,
                      linkFile: clampNonNegative(e.target.value),
                    }))
                  }
                  className="w-16 p-1 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200"
                />

                <label className="text-sm font-medium text-gray-700 dark:text-gray-200">
                  Link or File
                </label>
                <Tooltip
                  content="Questions that allow students to either submit a URL or upload a file"
                  maxWidth={3}
                  up={-3.3}
                >
                  <IconInfoCircle
                    size={16}
                    className="text-gray-500 dark:text-gray-400 cursor-pointer ml-1"
                  />
                </Tooltip>
              </div>
            </div>
          </div>
          <p className="text-sm font-medium text-gray-600 dark:text-gray-300 mt-4">
            Total Questions:{" "}
            {Object.values(selectedQuestionTypes).reduce((a, b) => a + b, 0)}
          </p>
          {error && <p className="text-sm text-red-600">{error}</p>}

          <button
            type="submit"
            className="mt-4 px-6 py-2 rounded-lg shadow-md text-sm font-medium text-white bg-violet-600 hover:bg-violet-700"
          >
            Generate Questions
          </button>
        </form>
      </motion.div>

      <AnimatePresence>
        {progress !== null && (
          <motion.div
            className="absolute inset-0 bg-white dark:bg-gray-800 bg-opacity-90 flex flex-col items-center justify-center z-10"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              className="flex flex-col items-center"
              initial={{ scale: 0.8 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.8 }}
              transition={{ duration: 0.2 }}
            >
              <div className="flex flex-col items-center">
                {statusData?.status === "Completed" ? (
                  <Lottie
                    animationData={MarkQuestionGenCompleted}
                    loop={false}
                    style={{ width: 200, height: 200 }}
                  />
                ) : statusData?.status === "Failed" ? (
                  <Lottie
                    animationData={MarkQuestionGenFailed}
                    loop={false}
                    style={{ width: 200, height: 200 }}
                  />
                ) : statusData?.status === "In Progress" ? (
                  <Lottie
                    animationData={MarkQuestionGenAnimation}
                    style={{ width: 200, height: 200 }}
                  />
                ) : null}
                <motion.span
                  className="text-xl font-medium text-gray-800 dark:text-gray-200 transition-all duration-200"
                  key={progressMessage}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.2 }}
                >
                  {progressMessage}
                </motion.span>
                <div className="fixed bottom-0 left-0 w-full bg-gray-100 dark:bg-gray-700 py-3 shadow-lg">
                  <span className="text-sm text-gray-700 dark:text-gray-200 text-center block px-4">
                    Generating more questions might take longer and could
                    include occasional mistakes, but we're constantly optimizing
                    to improve accuracy and efficiency.
                  </span>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {fileInspectorModalOpen && (
        <Modal
          onClose={() => setFileInspectorModalOpen(false)}
          Title="File Viewer"
        >
          <motion.div
            className="p-6 bg-white dark:bg-gray-800 rounded-lg shadow-lg max-w-2xl w-full max-h-[80vh] overflow-y-auto"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <h2 className="text-lg font-bold mb-4">{selectedFileName}</h2>
            <pre className="text-sm whitespace-pre-wrap bg-gray-100 dark:bg-gray-700 p-4 rounded-md text-gray-600 dark:text-gray-300">
              {selectedFileContent}
            </pre>
            <button
              onClick={() => setFileInspectorModalOpen(false)}
              className="mt-4 px-4 py-2 bg-purple-500 text-white rounded hover:bg-purple-600"
            >
              Close
            </button>
          </motion.div>
        </Modal>
      )}
    </Modal>
  );
};

export default FileUploadModal;
