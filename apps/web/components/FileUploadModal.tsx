import MarkQuestionGenAnimation from "@/animations/MarkQuestionGenAnimation.json";
import MarkQuestionGenCompleted from "@/animations/MarkQuestionGenCompleted.json";
import MarkQuestionGenFailed from "@/animations/MarkQuestionGenFailed.json";
import { readFile } from "@/app/Helpers/fileReader";
import {
  AssignmentTypeEnum,
  Choice,
  Criteria,
  QuestionAuthorStore,
  QuestionGenerationPayload,
  ResponseType,
} from "@/config/types";
import { getJobStatus, uploadFiles } from "@/lib/talkToBackend";
import { generateTempQuestionId } from "@/lib/utils";
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
import { processQuestions } from "@/app/Helpers/processQuestionsBeforePublish";

const MAX_CHAR_LIMIT = 20000;

interface FileUploadModalProps {
  onClose: () => void;
  questionId: number;
}

const FileUploadModal = ({ onClose, questionId }: FileUploadModalProps) => {
  const [fileUploaded, setFileUploaded] = useAuthorStore((state) => [
    state.fileUploaded,
    state.setFilesUploaded,
  ]);
  const [progress, setProgress] = useState<number | null>(null);
  const [progressMessage, setProgressMessage] = useState<string | null>(null);
  const [jobId, setJobId] = useState<number | null>(null);
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
  const [learningObjectives, setLearningObjectives] = useAuthorStore(
    (state) => [state.learningObjectives, state.setLearningObjectives],
  );
  const [error, setError] = useState<string | null>(null);
  const questions = useAuthorStore((state) => state.questions);
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

  const [selectedResponseTypes, setSelectedResponseTypes] = useState({
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

    if (fileUploaded.length === 0 && learningObjectives.length === 0) {
      toast.error("Please upload files or enter learning objectives.");
      return;
    } else if (
      Object.values(selectedQuestionTypes).reduce((a, b) => a + b, 0) === 0
    ) {
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
          multipleChoice: selectedQuestionTypes.multipleChoice,
          multipleSelect: selectedQuestionTypes.multipleSelect,
          textResponse: selectedQuestionTypes.textResponse,
          trueFalse: selectedQuestionTypes.trueFalse,
          url: selectedQuestionTypes.url,
          upload: selectedQuestionTypes.upload,
          linkFile: selectedQuestionTypes.linkFile,
          responseTypes: selectedResponseTypes,
        },
        fileContents: fileUploaded,
        learningObjectives,
      };

      const response = await uploadFiles(payload);
      if (response.success && response.jobId) {
        setJobId(response.jobId);
        setProgress(0);
        setProgressMessage("Processing started");
      } else {
        setError("Failed to upload files");
      }
    } catch (error) {
      setError("An error occurred while uploading files.");
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
    let intervalId: NodeJS.Timeout;

    if (jobId) {
      intervalId = setInterval(async () => {
        try {
          const statusData = await getJobStatus(jobId);
          setStatusData(statusData);
          if (!statusData) {
            throw new Error("Failed to fetch job status");
          }
          setProgressMessage(statusData.progress || "");

          if (statusData.status === "Completed") {
            clearInterval(intervalId);
            if (statusData.questions) {
              const questionsGenerated: QuestionAuthorStore[] =
                statusData.questions;
              questionsGenerated.forEach((question: QuestionAuthorStore) => {
                question.alreadyInBackend = false;
                question.id = generateTempQuestionId();
                question.assignmentId = activeAssignmentId;
                question.randomizedChoices = true;
                question.totalPoints =
                  question.scoring?.criteria &&
                  Array.isArray(question.scoring.criteria)
                    ? Math.max(
                        ...question.scoring.criteria.map(
                          (c: Criteria) => c.points,
                        ),
                      )
                    : question.choices
                      ? question.choices.reduce(
                          (acc: number, choice: Choice) => acc + choice.points,
                          0,
                        )
                      : 0;
                if (question.choices && Array.isArray(question.choices)) {
                  question.choices = question.choices.map(
                    (choice: Choice, index: number) => ({
                      ...choice,
                      id: index,
                    }),
                  );
                }
              });
              const processedQuestions = processQuestions(questionsGenerated);
              if (replaceExistingQuestions) {
                setQuestions(processedQuestions);
              } else {
                setQuestions(questions.concat(processedQuestions));
              }
            }
            setTimeout(() => onClose(), 2000);
          } else if (statusData.status === "Failed") {
            clearInterval(intervalId);
            setError("Processing failed. Please try again.");
            setTimeout(() => {
              setProgress(null);
            }, 5000);
          }
        } catch (error: unknown) {
          clearInterval(intervalId);
          setError("An error occurred while fetching job status.");
        }
      }, 2500);
    }

    return () => {
      if (intervalId) {
        clearInterval(intervalId);
      }
    };
  }, [jobId, setQuestions, onClose]);

  return (
    <Modal onClose={onClose} Title="Generate Questions for your assignment">
      <motion.div
        className="relative overflow-y-auto max-h-[80vh] pb-24 p-6 scrollbar-hide"
        initial={{ y: 50, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 50, opacity: 0 }}
      >
        <p className="text-gray-700 mb-2 bg-gray-100 p-4 rounded-md">
          Generate Questions by providing information. Information can be
          written and/or uploaded.
        </p>

        <div className="my-6">
          <h2 className="text-md text-gray-600 mb-2">
            What are the learning objectives?
          </h2>

          <textarea
            value={learningObjectives}
            onChange={(e) => setLearningObjectives(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-violet-500 focus:border-violet-500 sm:text-sm"
            placeholder="Enter topics, learning objectives, or additional content here..."
          />
        </div>

        <div className="mb-6">
          <h2 className="text-lg text-gray-600 mb-2">
            Upload additional resources (optional)
          </h2>
          <div {...getRootProps()} className="w-full">
            <motion.div
              whileHover={{ scale: 1.02 }}
              className={`flex flex-col items-center justify-center border-2 border-dashed p-6 rounded-md cursor-pointer transition-colors ${
                isDragActive
                  ? "border-purple-500 bg-purple-50"
                  : "border-gray-300"
              }`}
            >
              <input {...getInputProps()} />
              <IconCloudUpload size={50} className="text-gray-500 mb-4" />
              {isDragActive ? (
                <p className="text-purple-500">Drop the files here...</p>
              ) : (
                <>
                  <p className="text-gray-500">
                    Drag & drop some files here, or click to select files.
                  </p>
                  <p className="text-gray-500">
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
                      className="flex flex-col border-gray-300 border rounded-md px-4 py-3 hover:shadow-md"
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
                          <IconFile size={32} className="text-gray-500" />
                          <div>
                            <p className="text-gray-700 font-medium text-left">
                              {file.filename}
                            </p>
                            <div className="flex items-center space-x-2">
                              <p className="text-sm text-gray-500">
                                {formatFileSize(file.size)}
                              </p>
                              <p className="text-sm text-gray-500">
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
                        <div className="relative h-1 w-full bg-gray-200 rounded">
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
              <p className="text-gray-500 text-center">
                No files uploaded yet.
              </p>
            )}
          </div>
        </div>
        <h1 className="text-lg font-medium text-center text-gray-800 mb-2 border-t border-b border-gray-300 py-2">
          Question Details
        </h1>
        <form onSubmit={handleSend} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="grid grid-row-2 gap-4">
              <div>
                <h1 className="text-lg font-medium text-gray-800">Styles</h1>
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
                        className="h-4 w-4 mt-1 text-violet-600 border-gray-300 focus:ring-violet-500"
                      />
                      <div>
                        <span className="text-sm font-medium text-gray-700">
                          {option.label}
                        </span>
                        <p className="text-sm text-gray-500">
                          {getDifficultyDescription(option.value)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="flex items-center space-x-2">
                <div className="flex items-center">
                  <label className="text-sm font-medium text-gray-700">
                    Replace Existing Questions:
                  </label>
                  <Tooltip
                    content="If enabled, existing questions will be replaced with the new ones."
                    maxWidth={3}
                    up={-3.3}
                  >
                    <IconInfoCircle
                      size={16}
                      className="text-gray-500 cursor-pointer ml-1"
                    />
                  </Tooltip>
                </div>
                <button
                  type="button"
                  onClick={() => setReplaceExistingQuestions((prev) => !prev)}
                  className={`${
                    replaceExistingQuestions ? "bg-violet-600" : "bg-gray-200"
                  } relative inline-flex items-center h-6 rounded-full w-11 transition-colors focus:outline-none`}
                >
                  <span
                    className={`${
                      replaceExistingQuestions
                        ? "translate-x-6"
                        : "translate-x-1"
                    } inline-block w-4 h-4 transform bg-white rounded-full transition-transform`}
                  />
                </button>
              </div>
            </div>

            <div className="grid grid-row border-l border-gray-300 pl-4 mb-16">
              <div className="flex flex-col space-y-2">
                <h1 className="text-lg font-medium text-gray-800">
                  Question Types
                </h1>
                <p className="text-sm text-gray-600">
                  How many questions of each type would you like to generate?
                </p>
              </div>

              <div className="flex items-center space-x-2">
                <input
                  type="number"
                  min="0"
                  value={selectedQuestionTypes.multipleChoice}
                  onChange={(e) =>
                    setSelectedQuestionTypes((prev) => ({
                      ...prev,
                      multipleChoice: parseInt(e.target.value, 10),
                    }))
                  }
                  className="w-16 p-1 border border-gray-300 rounded-md"
                />
                <label className="text-sm font-medium text-gray-700">
                  Multiple Choice
                </label>
              </div>

              <div className="flex items-center space-x-2">
                <input
                  type="number"
                  min="0"
                  value={selectedQuestionTypes.multipleSelect}
                  onChange={(e) =>
                    setSelectedQuestionTypes((prev) => ({
                      ...prev,
                      multipleSelect: parseInt(e.target.value, 10),
                    }))
                  }
                  className="w-16 p-1 border border-gray-300 rounded-md"
                />
                <label className="text-sm font-medium text-gray-700">
                  Multiple Select
                </label>
              </div>

              <div className="flex items-center space-x-2">
                <input
                  type="number"
                  min="0"
                  value={selectedQuestionTypes.textResponse}
                  onChange={(e) =>
                    setSelectedQuestionTypes((prev) => ({
                      ...prev,
                      textResponse: parseInt(e.target.value, 10),
                    }))
                  }
                  className="w-16 p-1 border border-gray-300 rounded-md"
                />
                <label className="text-sm font-medium text-gray-700">
                  Text Response
                </label>
              </div>

              <div className="flex items-center space-x-2">
                <input
                  type="number"
                  min="0"
                  value={selectedQuestionTypes.trueFalse}
                  onChange={(e) =>
                    setSelectedQuestionTypes((prev) => ({
                      ...prev,
                      trueFalse: parseInt(e.target.value, 10),
                    }))
                  }
                  className="w-16 p-1 border border-gray-300 rounded-md"
                />
                <label className="text-sm font-medium text-gray-700">
                  True or False
                </label>
              </div>

              <div className="flex items-center space-x-2 mt-4">
                <input
                  type="number"
                  min="0"
                  value={selectedQuestionTypes.url}
                  onChange={(e) =>
                    setSelectedQuestionTypes((prev) => ({
                      ...prev,
                      url: parseInt(e.target.value, 10),
                    }))
                  }
                  className="w-16 p-1 border border-gray-300 rounded-md"
                />
                <label className="text-sm font-medium text-gray-700">
                  URL Response
                </label>
                <Tooltip
                  content="Questions that require students to submit a URL"
                  maxWidth={3}
                  up={-3.3}
                >
                  <IconInfoCircle
                    size={16}
                    className="text-gray-500 cursor-pointer ml-1"
                  />
                </Tooltip>
              </div>

              <div className="flex items-center space-x-2">
                <input
                  type="number"
                  min="0"
                  value={selectedQuestionTypes.upload}
                  onChange={(e) =>
                    setSelectedQuestionTypes((prev) => ({
                      ...prev,
                      upload: parseInt(e.target.value, 10),
                    }))
                  }
                  className="w-16 p-1 border border-gray-300 rounded-md"
                />
                <label className="text-sm font-medium text-gray-700">
                  File Upload
                </label>
                <Tooltip
                  content="Questions that require students to upload a file"
                  maxWidth={3}
                  up={-3.3}
                >
                  <IconInfoCircle
                    size={16}
                    className="text-gray-500 cursor-pointer ml-1"
                  />
                </Tooltip>
              </div>

              <div className="flex items-center space-x-2">
                <input
                  type="number"
                  min="0"
                  value={selectedQuestionTypes.linkFile}
                  onChange={(e) =>
                    setSelectedQuestionTypes((prev) => ({
                      ...prev,
                      linkFile: parseInt(e.target.value, 10),
                    }))
                  }
                  className="w-16 p-1 border border-gray-300 rounded-md"
                />
                <label className="text-sm font-medium text-gray-700">
                  Link or File
                </label>
                <Tooltip
                  content="Questions that allow students to either submit a URL or upload a file"
                  maxWidth={3}
                  up={-3.3}
                >
                  <IconInfoCircle
                    size={16}
                    className="text-gray-500 cursor-pointer ml-1"
                  />
                </Tooltip>
              </div>
            </div>
          </div>
          <p className="text-sm font-medium text-gray-600 mt-4">
            Total Questions:{" "}
            {Object.values(selectedQuestionTypes).reduce((a, b) => a + b, 0)}
          </p>

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
            className="absolute inset-0 bg-white bg-opacity-90 flex flex-col items-center justify-center z-10"
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
                  className="text-xl font-medium text-gray-800 transition-all duration-200"
                  key={progressMessage}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.2 }}
                >
                  {progressMessage}
                </motion.span>
                <div className="fixed bottom-0 left-0 w-full bg-gray-100 py-3 shadow-lg">
                  <span className="text-sm text-gray-700 text-center block px-4">
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
      {/* File Inspector Modal */}
      {fileInspectorModalOpen && (
        <Modal
          onClose={() => setFileInspectorModalOpen(false)}
          Title="File Viewer"
        >
          <motion.div
            className="p-6 bg-white rounded-lg shadow-lg max-w-2xl w-full max-h-[80vh] overflow-y-auto"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <h2 className="text-lg font-bold mb-4">{selectedFileName}</h2>
            <pre className="text-sm whitespace-pre-wrap bg-gray-100 p-4 rounded-md text-gray-600">
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
