"use client";

import { openFileInNewTab } from "@/app/Helpers/openNewTabGithubFile";
import { QuestionStore, QuestionType, ResponseType } from "@/config/types";
import { getStoredGithubToken } from "@/lib/talkToBackend";
import {
  learnerFileResponse,
  useGitHubStore,
  useLearnerOverviewStore,
  useLearnerStore,
} from "@/stores/learner";
import { DocumentTextIcon, TrashIcon } from "@heroicons/react/24/outline";
import { Octokit } from "@octokit/rest";
import { IconBrandGithub } from "@tabler/icons-react";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import FileUploadSection from "./FileUploadSection";
import GithubUploadModal from "./GithubUploadModal";

interface FileCodeUploadSectionProps {
  questionId: number;
  questionType: QuestionType;
  responseType: ResponseType;
  question: QuestionStore;
  onFileChange: (files: learnerFileResponse[], questionId: number) => void;
  addFileUpload: (file: learnerFileResponse, questionId: number) => void;
  removeFileUpload: (file: learnerFileResponse, questionId: number) => void;
}

const FileCodeUploadSection = ({
  questionId,
  questionType,
  responseType,
  question,
  onFileChange,
  addFileUpload,
  removeFileUpload,
}: FileCodeUploadSectionProps) => {
  const assignmentId = useLearnerOverviewStore((state) => state.assignmentId);
  const { questionGitHubState } = useGitHubStore();
  const selectedFiles = questionGitHubState[questionId]?.selectedFiles || [];
  const addToPath = useGitHubStore((state) => state.addToPath);
  const persistStateForQuestion = useGitHubStore(
    (state) => state.persistStateForQuestion,
  );
  const learnerFileResponse = useLearnerStore(
    (state) => state.questions[questionId].learnerFileResponse,
  );
  const [octokit, setOctokit] = useState<Octokit | null>(null);
  const getTokenFromBackend = async () => {
    const token = await getStoredGithubToken();
    return token;
  };
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

  const handleRemoveFile = (filename: string, fileUrl: string) => {
    removeFileUpload(
      {
        filename: filename,
        content: "",
        githubUrl: fileUrl,
      },
      questionId,
    );
    changeSelectedFiles(
      questionId,
      selectedFiles.filter((file) => file.filename !== filename),
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

  return (
    <div className="relative overflow-y-auto max-h-[80vh] w-full px-6 py-4 space-y-4">
      <div className="bg-white p-4 rounded-lg">
        <h3 className="text-lg font-semibold text-gray-800 mb-2 flex items-center gap-2">
          Upload or Select Files
        </h3>
        <p className="text-sm text-gray-600">
          You can either upload files directly or select them from your GitHub
          repositories.
        </p>
      </div>

      <div className="bg-white p-4 rounded-lg ">
        <FileUploadSection
          question={question}
          onFileChange={onFileChange}
          removeFileUpload={removeFileUpload}
          responseType={responseType}
        />
      </div>

      <div className="flex items-center justify-center relative">
        <div className="border-t border-gray-300 w-full" />
        <span className="px-3 text-sm text-gray-500 absolute bg-white">OR</span>
      </div>

      <div className="flex items-center justify-center">
        <div
          className={`bg-white py-4 flex flex-col items-center ${
            selectedFiles?.length > 0 ? "border-r pr-8 border-gray-300" : null
          }`}
        >
          <h4 className="text-md font-semibold text-gray-800 flex items-center gap-2 mb-2">
            <IconBrandGithub className="h-5 w-5 text-gray-600" />
            Select from GitHub
          </h4>
          <p className="text-sm text-gray-600 mb-4 text-center">
            Browse your repositories and pick the files you need.
          </p>
          <button
            onClick={() => setGithubModalOpen(true)}
            className="max-w-fit bg-violet-500 hover:bg-violet-600 text-white font-semibold py-2 px-4 rounded-lg transition-colors duration-200 ease-in-out"
          >
            Open GitHub Selector
          </button>
        </div>

        {learnerFileResponse && learnerFileResponse.length > 0 && (
          <AnimatePresence>
            <motion.div
              initial={{ opacity: 0, y: 10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -10, scale: 0.95 }}
              transition={{ duration: 0.3 }}
              className=" py-2 h-full max-w-[300px] ml-16 overflow-y-auto flex-wrap"
              style={{ maxHeight: "200px" }}
            >
              <h4 className="text-md font-semibold text-gray-800 mb-2">
                Selected GitHub Files
              </h4>
              <ul className="gap-2 text-sm text-gray-700 flex items-center flex-wrap">
                {learnerFileResponse.map((file) => {
                  if (file.githubUrl) {
                    return (
                      <li
                        key={file.filename}
                        className="flex items-center gap-2 bg-gray-50 max-w-fit p-2 rounded hover:bg-gray-100 transition-colors"
                      >
                        <button
                          onClick={() =>
                            openFileInNewTab(file.githubUrl, octokit)
                          }
                          className="flex items-center gap-2"
                        >
                          <DocumentTextIcon className="h-4 w-4 text-gray-600" />
                          <span className="truncate">{file.filename}</span>
                        </button>
                        <TrashIcon
                          className="h-4 w-4 text-gray-600 cursor-pointer"
                          onClick={() => {
                            void handleRemoveFile(
                              file.filename,
                              file.githubUrl,
                            );
                          }}
                        />
                      </li>
                    );
                  }
                })}
              </ul>
            </motion.div>
          </AnimatePresence>
        )}
      </div>

      {isGithubModalOpen && (
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
    </div>
  );
};

export default FileCodeUploadSection;
