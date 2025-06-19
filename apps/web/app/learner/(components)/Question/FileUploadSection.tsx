// FileUploadSection.js
import { readFile } from "@/app/Helpers/fileReader";
import { openFileInNewTab } from "@/app/Helpers/openNewTabGithubFile";
import { QuestionStore, QuestionType, ResponseType } from "@/config/types";
import { getStoredGithubToken } from "@/lib/talkToBackend";
import {
  learnerFileResponse,
  useGitHubStore,
  useLearnerOverviewStore,
  useLearnerStore,
} from "@/stores/learner";
import { Octokit } from "@octokit/rest";
import {
  IconBrandGithub,
  IconCloudUpload,
  IconEye,
  IconX,
} from "@tabler/icons-react";
import { motion } from "framer-motion";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useDropzone } from "react-dropzone";
import CustomFileViewer from "./FileViewer";
import GithubUploadModal from "./GithubUploadModal";
import PresentationGrader from "./PresentationGrader";
import VideoPresentationEditor from "./VideoPresentationEditor";

const MAX_CHAR_LIMIT = 40000;

interface FileUploadSectionProps {
  question: QuestionStore;
  responseType: ResponseType;
  onFileChange: (files: learnerFileResponse[], questionId: number) => void;
  removeFileUpload: (file: learnerFileResponse, questionId: number) => void;
}

const FileUploadSection = ({
  question,
  onFileChange,
  removeFileUpload,
}: FileUploadSectionProps) => {
  const questionId = question.id;
  const questionType = question.type;
  const responseType = question.responseType;
  const [currentFileContent, setCurrentFileContent] = useState<string | null>(
    null,
  );
  const addFileUpload = useLearnerStore((state) => state.addFileUpload);
  const [error, setError] = useState<string | null>(null);
  const [showContent, setShowContent] = useState(false);
  const learnerFileResponse = useLearnerStore((state) =>
    state.getFileUpload(questionId),
  );
  const deleteFile = useLearnerStore((state) => state.deleteFile);
  const [fileBlob, setFileBlob] = useState<Blob | null>(null);
  const onDrop = async (acceptedFiles: File[]) => {
    try {
      const fileContents: learnerFileResponse[] = await Promise.all(
        acceptedFiles.map(async (file) => {
          const result = await readFile(file, questionId);
          return {
            filename: file.name,
            content: result.content,
            githubUrl: "",
          };
        }),
      );
      fileContents.forEach((file) => addFileUpload(file, questionId));
    } catch (error) {
      setError(error as string);
    }
  };

  const showFileContent = (file: learnerFileResponse) => {
    setCurrentFileContent(file.content);
    setFileBlob(file.blob);
    setShowContent(true);
  };

  const closePreview = () => {
    setShowContent(false);
    setCurrentFileContent(null);
  };
  const [filename, setFilename] = useState<string>("");
  const handleDeleteFile = (file: learnerFileResponse) => {
    deleteFile(file, questionId);
  };
  const assignmentId =
    useLearnerOverviewStore((state) => state.assignmentId) ||
    parseInt(usePathname().split("/")[3]);
  const { questionGitHubState } = useGitHubStore();
  const selectedFiles = questionGitHubState[questionId]?.selectedFiles || [];
  const persistStateForQuestion = useGitHubStore(
    (state) => state.persistStateForQuestion,
  );
  const [octokit, setOctokit] = useState<Octokit | null>(null);
  const getTokenFromBackend = async () => {
    const token = await getStoredGithubToken();
    return token;
  };
  const addToPath = useGitHubStore((state) => state.addToPath);
  const isGithubModalOpen =
    questionGitHubState[questionId]?.isGithubModalOpen || false;
  const setGithubModalOpen = (isOpen: boolean) => {
    useGitHubStore.setState((state) => ({
      questionGitHubState: {
        ...state.questionGitHubState,
        [questionId]: {
          ...state.questionGitHubState[questionId],
          isGithubModalOpen: isOpen,
        },
      },
    }));
  };
  const setActiveQuestionId = useGitHubStore(
    (state) => state.setActiveQuestionId,
  );
  const changeSelectedFiles = (
    questionId: number,
    files: learnerFileResponse[],
  ) => {
    useGitHubStore.setState((state) => {
      const currentFiles =
        state.questionGitHubState[questionId]?.selectedFiles || [];
      if (JSON.stringify(currentFiles) === JSON.stringify(files)) {
        return state;
      }

      return {
        questionGitHubState: {
          ...state.questionGitHubState,
          [questionId]: {
            ...state.questionGitHubState[questionId],
            selectedFiles: files,
          },
        },
      };
    });
  };

  const handleRemoveFile = (fileName: string, fileUrl: string) => {
    removeFileUpload(
      {
        filename: fileName,
        content: "",
        githubUrl: fileUrl,
      },
      questionId,
    );
    changeSelectedFiles(
      questionId,
      selectedFiles.filter((file) => file.githubUrl !== fileUrl),
    );
  };

  useEffect(() => {
    setActiveQuestionId(questionId);
    persistStateForQuestion();
  }, [questionId]);
  useEffect(() => {
    void getTokenFromBackend().then((token) => {
      if (token) {
        const octokit = new Octokit({
          auth: token,
        });
        setOctokit(octokit);
      }
    });
  }, []);
  const getAcceptedFileTypes = (
    questionType: QuestionType,
    responseType?: ResponseType,
  ): { [key: string]: string[] } => {
    const fileType =
      responseType && responseType !== undefined ? responseType : questionType;
    switch (fileType) {
      case "CODE":
        return {
          "text/x-python": [".py"],
          "application/javascript": [".js"],
          "application/x-typescript": [".ts"],
          "application/x-tsx": [".tsx"],
          "application/x-shellscript": [".sh"],
          "text/html": [".html"],
          "text/css": [".css"],
          "application/sql": [".sql"],
          "text/markdown": [".md"],
          "application/x-ipynb+json": [".ipynb"],
        };
      case "IMAGES":
        return {
          "image/jpeg": [".jpg", ".jpeg"],
          "image/png": [".png"],
          "image/gif": [".gif"],
          "image/svg+xml": [".svg"],
        };
      case "UPLOAD":
      case "REPORT":
      case "SPREADSHEET":
        return {
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
        };
      default:
        return {}; // No files allowed by default
    }
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: getAcceptedFileTypes(questionType, responseType),
    multiple: true,
  });

  return (
    <motion.div
      className="relative overflow-y-auto max-h-[80vh] w-full p-2"
      initial={{ y: 50, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 50, opacity: 0 }}
    >
      {responseType === "LIVE_RECORDING" ? (
        <PresentationGrader question={question} assignmentId={assignmentId} />
      ) : responseType === "PRESENTATION" ? (
        <VideoPresentationEditor
          question={question}
          assignmentId={assignmentId}
        />
      ) : (
        <>
          <div className="flex flex-1">
            <div className="flex flex-col gap-4 pr-4 w-full">
              {responseType === "CODE" && (
                <div className="bg-white py-8 flex flex-col items-center border gap-4 border-gray-200 rounded-md p-4">
                  <span className="text-lg">
                    Browse your repositories and select the files you need.
                  </span>
                  <button
                    className="flex items-center gap-2 px-4 py-2 bg-black text-white rounded-md hover:bg-gray-800"
                    onClick={() => {
                      setGithubModalOpen(true);
                    }}
                  >
                    <IconBrandGithub className="h-5 w-5 text-white" />
                    Select from GitHub
                  </button>
                </div>
              )}
              <div {...getRootProps()} className="w-full">
                <motion.div
                  whileHover={{ scale: 1.0 }}
                  className={`flex flex-col items-center justify-center border-2 border-dashed p-6 rounded-md cursor-pointer transition-colors ${
                    isDragActive
                      ? "border-blue-500 bg-blue-50"
                      : "border-gray-300"
                  }`}
                >
                  <input {...getInputProps()} />
                  <IconCloudUpload size={50} className="text-gray-500 mb-4" />
                  {isDragActive ? (
                    <p className="text-blue-500">Drop the files here...</p>
                  ) : (
                    <p className="text-gray-800">
                      Drag & drop some files here, or click to select files
                    </p>
                  )}
                </motion.div>
              </div>
            </div>
            {learnerFileResponse.length > 0 ? (
              <div className="border-l border-gray-200 pl-4 flex-2 w-full">
                <ul className="text-gray-600">
                  {learnerFileResponse.map((file) => (
                    <li
                      className="flex items-center justify-between bg-gray-100 rounded-md px-3 py-2 mb-2"
                      key={file.filename}
                    >
                      <div className="flex items-center justify-between w-full">
                        <span>{file.filename}</span>
                        <div className="flex items-center space-x-2">
                          <button
                            onClick={() => {
                              if (file.githubUrl !== "") {
                                void openFileInNewTab(file.githubUrl, octokit);
                              } else {
                                setFilename(file.filename);
                                void showFileContent(file);
                              }
                            }}
                            className="text-blue-500 hover:text-blue-600"
                            aria-label={`Preview file ${file.filename}`}
                          >
                            <IconEye size={20} />
                          </button>
                          <button
                            onClick={() => handleDeleteFile(file)}
                            className="text-red-500 hover:text-red-600"
                            aria-label={`Remove file ${file.filename}`}
                          >
                            <IconX size={20} />
                          </button>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>

          {/* Github modal */}
          {isGithubModalOpen && responseType === "CODE" && (
            <GithubUploadModal
              onClose={() => setGithubModalOpen(false)}
              assignmentId={assignmentId}
              questionId={questionId}
              owner={questionGitHubState[questionId].owner}
              setOwner={(owner) => {
                useGitHubStore.setState((state) => ({
                  questionGitHubState: {
                    ...state.questionGitHubState,
                    [questionId]: {
                      ...state.questionGitHubState[questionId],
                      owner,
                    },
                  },
                }));
              }}
              repos={questionGitHubState[questionId].repos}
              setRepos={(repos) => {
                useGitHubStore.setState((state) => ({
                  questionGitHubState: {
                    ...state.questionGitHubState,
                    [questionId]: {
                      ...state.questionGitHubState[questionId],
                      repos,
                    },
                  },
                }));
              }}
              currentPath={questionGitHubState[questionId].currentPath}
              setCurrentPath={(currentPath) => {
                useGitHubStore.setState((state) => ({
                  questionGitHubState: {
                    ...state.questionGitHubState,
                    [questionId]: {
                      ...state.questionGitHubState[questionId],
                      currentPath,
                    },
                  },
                }));
              }}
              addToPath={addToPath}
              selectedRepo={questionGitHubState[questionId].selectedRepo}
              setSelectedRepo={(selectedRepo) => {
                useGitHubStore.setState((state) => ({
                  questionGitHubState: {
                    ...state.questionGitHubState,
                    [questionId]: {
                      ...state.questionGitHubState[questionId],
                      selectedRepo,
                    },
                  },
                }));
              }}
              selectedFiles={selectedFiles}
              setSelectedFiles={(files) => {
                changeSelectedFiles(questionId, files);
              }}
              repoContents={questionGitHubState[questionId].repoContents}
              setRepoContents={(repoContents) => {
                useGitHubStore.setState((state) => ({
                  questionGitHubState: {
                    ...state.questionGitHubState,
                    [questionId]: {
                      ...state.questionGitHubState[questionId],
                      repoContents,
                    },
                  },
                }));
              }}
              onFileChange={onFileChange}
            />
          )}

          {/* Modal for file content preview */}
          {showContent && (
            <CustomFileViewer
              file={{
                filename,
                content: currentFileContent,
                blob: fileBlob,
              }}
              onClose={closePreview}
            />
          )}
        </>
      )}
    </motion.div>
  );
};

export default FileUploadSection;
