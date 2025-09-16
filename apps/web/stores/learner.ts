import { AVAILABLE_LANGUAGES } from "@/app/Helpers/getLanguageName";
import type {
  Assignment,
  AssignmentAttempt,
  AssignmentDetails,
  Choice,
  PresentationQuestionResponse,
  QuestionStatus,
  QuestionStore,
  RepoContentItem,
  RepoType,
  slideMetaData,
} from "@/config/types";
import { getUser } from "@/lib/talkToBackend";
import { create } from "zustand";
import { devtools, persist } from "zustand/middleware";
import { shallow } from "zustand/shallow";
import { createWithEqualityFn } from "zustand/traditional";

type GitHubQuestionState = {
  repos: RepoType[];
  owner: string | null;
  selectedRepo: string | null;
  repoContents: RepoContentItem[];
  currentPath: string[];
  selectedFiles: learnerFileResponse[];
  isGithubModalOpen: boolean;
};

interface VideoRecorderState {
  recording: boolean;
  videoBlob: Blob | null;
  videoURL: string;
  countdown: number | null;
  cameraError: string | null;
  recordingStartTime: number | null;
  mediaRecorderRef: MediaRecorder | null;
  chunksRef: Blob[];
  videoRef: HTMLVideoElement | null;
  streamRef: MediaStream | null;

  setRecording: (recording: boolean) => void;
  setVideoBlob: (blob: Blob | null) => void;
  setVideoURL: (url: string) => void;
  setCountdown: (count: number | null) => void;
  setCameraError: (error: string | null) => void;
  setRecordingStartTime: (time: number | null) => void;
  setMediaRecorderRef: (ref: MediaRecorder | null) => void;
  setChunksRef: (chunks: Blob[]) => void;
  setVideoRef: (ref: HTMLVideoElement | null) => void;
  setStreamRef: (ref: MediaStream | null) => void;

  reconnectCamera: () => Promise<void>;
  getSupportedMimeType: () => string;
  startRecordingImpl: (onRecordingComplete: (blob: Blob) => void) => void;
  startRecording: () => Promise<void>;
  stopRecording: () => void;
}

export const useVideoRecorderStore = createWithEqualityFn<VideoRecorderState>()(
  persist(
    devtools(
      (set, get) => ({
        recording: false,
        videoBlob: null,
        videoURL: "",
        countdown: null,
        cameraError: null,
        recordingStartTime: null,
        mediaRecorderRef: null,
        chunksRef: [],
        videoRef: null,
        streamRef: null,

        setRecording: (recording) => set({ recording }),
        setVideoBlob: (blob) => set({ videoBlob: blob }),
        setVideoURL: (url) => set({ videoURL: url }),
        setCountdown: (count) => set({ countdown: count }),
        setCameraError: (error) => set({ cameraError: error }),
        setRecordingStartTime: (time) => set({ recordingStartTime: time }),
        setMediaRecorderRef: (ref) => set({ mediaRecorderRef: ref }),
        setChunksRef: (chunks) => set({ chunksRef: chunks }),
        setVideoRef: (ref) => set({ videoRef: ref }),
        setStreamRef: (ref) => set({ streamRef: ref }),

        reconnectCamera: async () => {
          try {
            const stream = await navigator.mediaDevices.getUserMedia({
              video: true,
              audio: true,
            });
            get().setStreamRef(stream);
            if (get().videoRef) {
              get().videoRef.srcObject = stream;
              await get().videoRef.play();
            }
            get().setCameraError(null);
          } catch (err: any) {
            get().setCameraError(
              "Error accessing camera. Please check your camera settings.",
            );
          }
        },

        getSupportedMimeType: () => {
          const possibleTypes = [
            "video/webm; codecs=vp9",
            "video/webm; codecs=vp8",
            "video/webm",
          ];
          return (
            possibleTypes.find((type) => MediaRecorder.isTypeSupported(type)) ||
            ""
          );
        },

        startRecordingImpl: (onRecordingComplete) => {
          if (!get().streamRef) {
            return;
          }

          get().setChunksRef([]);
          get().setRecordingStartTime(Date.now());

          const mimeType = get().getSupportedMimeType();
          const recorder = new MediaRecorder(get().streamRef, { mimeType });
          get().setMediaRecorderRef(recorder);

          recorder.ondataavailable = (evt) => {
            if (evt.data.size > 0) {
              get().setChunksRef([...get().chunksRef, evt.data]);
            }
          };

          recorder.onstop = () => {
            const blob = new Blob(get().chunksRef, { type: mimeType });
            const url = URL.createObjectURL(blob);
            get().setVideoBlob(blob);
            get().setVideoURL(url);

            if (get().videoRef) {
              get().videoRef.srcObject = null;
              get().videoRef.src = url;
              get().videoRef.controls = true;
              get().videoRef.muted = true;
              get().videoRef.load();
            }

            onRecordingComplete(blob);
          };

          recorder.start();
          get().setRecording(true);
        },

        startRecording: async () => {
          if (get().cameraError) return;

          try {
            const stream = await navigator.mediaDevices.getUserMedia({
              video: true,
              audio: true,
            });
            get().setStreamRef(stream);
            if (get().videoRef) {
              get().videoRef.srcObject = stream;
              get().videoRef.muted = true;
              await get().videoRef.play();
            }
          } catch (error) {
            get().setCameraError(
              "Error accessing camera. Please check your camera settings.",
            );
            return;
          }
          get().setCountdown(3);
        },

        stopRecording: () => {
          if (get().mediaRecorderRef?.state === "recording") {
            get().mediaRecorderRef.stop();
          }
          if (get().streamRef) {
            get()
              .streamRef.getTracks()
              .forEach((track) => track.stop());
            get().setStreamRef(null);
          }
          get().setRecording(false);
        },
      }),

      { name: "video-recorder-store", trace: true, traceLimit: 25 },
    ),
    {
      name: "video-recorder-store",
      partialize: (state) => ({
        recording: state.recording,
        videoURL: state.videoURL,
        countdown: state.countdown,
        cameraError: state.cameraError,
        recordingStartTime: state.recordingStartTime,
      }),
    },
  ),
  shallow,
);

export const getAssignmentIdFromURL = (role: string): string | null => {
  if (typeof window === "undefined") {
    return null;
  }

  const pathSegments = window.location.pathname.split("/");
  const index = pathSegments.indexOf(role);

  if (index !== -1 && pathSegments.length > index + 1) {
    return pathSegments[index + 1];
  }

  return null;
};

const ASSIGNMENT_ID = getAssignmentIdFromURL("learner");

type GitHubState = {
  questionGitHubState: Record<number, GitHubQuestionState>;
  activeQuestionId: number | null;
  setGithubModalOpen: (isOpen: boolean) => void;
  setActiveQuestionId: (questionId: number) => void;
  repos: RepoType[];
  owner: string | null;
  selectedRepo: string | null;
  repoContents: RepoContentItem[];
  currentPath: string[];
  selectedFiles: learnerFileResponse[];
  isGithubModalOpen: boolean;
  setRepos: (repos: RepoType[]) => void;
  setOwner: (owner: string | null) => void;
  setSelectedRepo: (repo: string | null) => void;
  setRepoContents: (contents: RepoContentItem[]) => void;
  setCurrentPath: (path: string[]) => void;
  addToPath: (path: string) => void;
  setSelectedFiles: (files: learnerFileResponse[]) => void;
  persistStateForQuestion: () => void;
  clearGithubStore: () => void;
};

export const useGitHubStore = createWithEqualityFn<GitHubState>()(
  persist(
    devtools(
      (set, get) => ({
        questionGitHubState: {},
        activeQuestionId: null,
        setActiveQuestionId: (questionId) => {
          const { questionGitHubState, persistStateForQuestion } = get();

          if (get().activeQuestionId !== null) {
            persistStateForQuestion();
          }

          set({
            activeQuestionId: questionId,
            ...questionGitHubState[questionId],
          });
        },

        repos: [],
        owner: null,
        selectedRepo: null,
        repoContents: [],
        currentPath: [],
        selectedFiles: [],
        isGithubModalOpen: false,
        setGithubModalOpen: (isOpen) => set({ isGithubModalOpen: isOpen }),
        addToPath: (path) => set({ currentPath: [...get().currentPath, path] }),
        setRepos: (repos) => set({ repos }),
        setOwner: (owner) => set({ owner }),
        setSelectedRepo: (repo) => set({ selectedRepo: repo }),
        setRepoContents: (contents) => set({ repoContents: contents }),
        setCurrentPath: (path) => set({ currentPath: path }),
        setSelectedFiles: (files) => set({ selectedFiles: files }),
        clearGithubStore: () => {
          set({
            questionGitHubState: {},
          });
        },
        persistStateForQuestion: () => {
          const {
            activeQuestionId,
            repos,
            owner,
            selectedRepo,
            repoContents,
            currentPath,
            selectedFiles,
            questionGitHubState,
            isGithubModalOpen,
          } = get();

          if (activeQuestionId === null) return;

          set({
            questionGitHubState: {
              ...questionGitHubState,
              [activeQuestionId]: {
                repos,
                owner,
                selectedRepo,
                repoContents,
                currentPath,
                selectedFiles,
                isGithubModalOpen,
              },
            },
          });
        },
      }),
      { name: "github-store", trace: true, traceLimit: 25 },
    ),
    {
      name: "github-store",
      partialize: (state) => ({
        questionGitHubState: state.questionGitHubState,
        activeQuestionId: state.activeQuestionId,
      }),
    },
  ),
  shallow,
);

export type LearnerState = {
  activeAttemptId: number | null;
  activeQuestionNumber: number | null | undefined;
  expiresAt: number | undefined;
  questions: QuestionStore[];
  role?: "learner" | "author";
  totalPointsEarned: number;
  totalPointsPossible: number;
  translationOn: boolean;
  globalLanguage: string;
  userPreferedLanguage: string;
};

export type learnerFileResponse = {
  filename: string;
  imageUrl?: string;
  imageData?: string;
  imageBucket?: string;
  imageKey?: string;
  mimeType?: string;
  owner?: string;
  repo?: RepoType;
  path?: string;

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
};
export type LearnerActions = {
  setTranscript: (questionId: number, transcript: string) => void;
  setBodyLanguage: (
    questionId: number,
    score: number,
    explanation: string,
  ) => void;
  setSpeech: (questionId: number, speechAnalysis: string) => void;
  setContent: (questionId: number, contentAnalysis: string) => void;
  setPresentationResponse: (
    questionId: number,
    presentationResponse: PresentationQuestionResponse,
  ) => void;
  setSlidesData: (questionId: number, slidesData: slideMetaData[]) => void;
  setActiveAttemptId: (id: number) => void;
  setActiveQuestionNumber: (id: number | null) => void;
  addQuestion: (question: QuestionStore) => void;
  setQuestion: (question: Partial<QuestionStore>) => void;
  showSubmissionFeedback: boolean;
  showQuestions: boolean;
  setShowQuestions: (showQuestions: boolean) => void;
  setShowSubmissionFeedback: (ShowSubmissionFeedback: boolean) => void;
  setQuestions: (questions: Partial<QuestionStore>[]) => void;
  setTextResponse: (learnerTextResponse: string, questionId?: number) => void;
  setURLResponse: (learnerUrlResponse: string, questionId?: number) => void;
  setChoices: (learnerChoices: string[], questionId?: number) => void;
  addChoice: (learnerChoiceIndex: string, questionId?: number) => void;
  removeChoice: (learnerChoiceIndex: string, questionId?: number) => void;
  setAnswerChoice: (learnerAnswerChoice: boolean, questionId?: number) => void;
  setLearnerStore: (learnerState: Partial<LearnerState>) => void;
  getQuestionStatusById: (questionId: number) => QuestionStatus;
  setQuestionStatus: (questionId: number, status?: QuestionStatus) => void;
  setRole: (role: "learner" | "author") => void;
  setTotalPointsEarned: (totalPointsEarned: number) => void;
  setTotalPointsPossible: (totalPointsPossible: number) => void;
  onUrlChange: (url: string, questionId: number) => void;
  onFileChange: (files: learnerFileResponse[], questionId: number) => void;
  removeFileUpload: (file: learnerFileResponse, questionId: number) => void;
  addFileUpload: (file: learnerFileResponse, questionId: number) => void;
  onModeChange: (
    mode: "file" | "link",
    data: learnerFileResponse[] | string,
    questionId: number,
  ) => void;
  getFileUpload: (questionId: number) => learnerFileResponse[];
  setFileUpload: (
    learnerFileResponse: learnerFileResponse[],
    questionId: number,
  ) => void;
  deleteFile: (fileToDelete: learnerFileResponse, questionId: number) => void;
  setTranslationOn: (questionId: number, translationOn: boolean) => void;
  getTranslationOn: (questionId: number) => boolean;
  setSelectedLanguage: (questionId: number, language: string) => void;
  setTranslatedQuestion: (
    questionId: number,
    translatedQuestion: string,
  ) => void;
  setTranslatedChoices: (
    questionId: number,
    translatedChoices: string[],
  ) => void;
  setGlobalLanguage: (language: string) => void;
  setUserPreferedLanguage: (language: string) => void;
  getUserPreferedLanguageFromLTI: () => Promise<string>;
};

export type AssignmentDetailsState = {
  assignmentDetails: Assignment | null;
  grade: number | null;
};

export type AssignmentDetailsActions = {
  setAssignmentDetails: (assignmentDetails: Assignment) => void;
  setGrade: (grade: number) => void;
};

const isQuestionEdited = (question: QuestionStore) => {
  const {
    learnerTextResponse,
    learnerUrlResponse,
    learnerChoices,
    learnerAnswerChoice,
    learnerFileResponse,
    learnerPresentationResponse,
  } = question;
  return (
    (learnerTextResponse &&
      learnerTextResponse.trim().length > 0 &&
      learnerTextResponse !== "<p><br></p>") ||
    (learnerUrlResponse && learnerUrlResponse.trim().length > 0) ||
    (learnerChoices && learnerChoices.length > 0) ||
    learnerAnswerChoice !== undefined ||
    learnerFileResponse?.map((file) => file?.content).join("") !== "" ||
    learnerPresentationResponse !== undefined ||
    false
  );
};
export type LearnerOverviewState = {
  listOfAttempts: AssignmentAttempt[];
  assignmentId: number | null;
  assignmentName: string;
  languageModalTriggered: boolean;
};
export type LearnerOverviewActions = {
  setListOfAttempts: (listOfAttempts: AssignmentAttempt[]) => void;
  setAssignmentId: (assignmentId: number) => void;
  setAssignmentName: (assignmentName: string) => void;
  setLanguageModalTriggered: (triggered: boolean) => void;
};

export const useLearnerOverviewStore = createWithEqualityFn<
  LearnerOverviewState & LearnerOverviewActions
>()(
  devtools(
    persist(
      (set) => ({
        listOfAttempts: [],
        assignmentId: null,
        setListOfAttempts: (listOfAttempts) => set({ listOfAttempts }),
        setAssignmentId: (assignmentId) => set({ assignmentId }),
        assignmentName: "",
        setAssignmentName: (assignmentName) => set({ assignmentName }),
        languageModalTriggered: true,
        setLanguageModalTriggered: (triggered) =>
          set({ languageModalTriggered: triggered }),
      }),
      {
        name: `learner-overview-${ASSIGNMENT_ID}`,
        partialize: (state) => ({
          listOfAttempts: state.listOfAttempts,
          assignmentId: state.assignmentId,
          languageModalTriggered: state.languageModalTriggered,
        }),
      },
    ),
    {
      name: `learner-overview-${ASSIGNMENT_ID}`,
      trace: true,
      traceLimit: 25,
      enabled: process.env.NODE_ENV === "development",
      serialize: {
        options: true,
      },
    },
  ),
  shallow,
);

export const useLearnerStore = createWithEqualityFn<
  LearnerState & LearnerActions
>()(
  persist(
    devtools(
      (set, get) => ({
        setTranscript: (questionId: number, transcript: string) =>
          set((state) => ({
            questions: state.questions.map((q) => {
              if (q.id === questionId) {
                return {
                  ...q,
                  presentationResponse: {
                    ...q.presentationResponse,
                    transcript,
                  },
                };
              }
              return q;
            }),
          })),
        setSlidesData: (questionId, slidesData) =>
          set((state) => ({
            questions: state.questions.map((q) =>
              q.id === questionId
                ? {
                    ...q,
                    presentationResponse: {
                      ...q.presentationResponse,
                      slidesData,
                    },
                  }
                : q,
            ),
          })),
        setBodyLanguage: (questionId, score, explanation) =>
          set((state) => ({
            questions: state.questions.map((q) =>
              q.id === questionId
                ? {
                    ...q,
                    presentationResponse: {
                      ...q.presentationResponse,
                      bodyLanguage: score,
                      bodyLanguageExplanation: explanation,
                    },
                  }
                : q,
            ),
          })),
        setSpeech: (questionId, speechAnalysis) =>
          set((state) => ({
            questions: state.questions.map((q) =>
              q.id === questionId
                ? {
                    ...q,
                    presentationResponse: {
                      ...q.presentationResponse,
                      speech: speechAnalysis,
                    },
                  }
                : q,
            ),
          })),
        setContent: (questionId, contentAnalysis) =>
          set((state) => ({
            questions: state.questions.map((q) =>
              q.id === questionId
                ? {
                    ...q,
                    presentationResponse: {
                      ...q.presentationResponse,
                      content: contentAnalysis,
                    },
                  }
                : q,
            ),
          })),
        setPresentationResponse: (questionId, presentationResponse) =>
          set((state) => ({
            questions: state.questions.map((q) =>
              q.id === questionId
                ? { ...q, presentationResponse: presentationResponse }
                : q,
            ),
          })),
        setTranslatedQuestion: (questionId, translatedQuestion) =>
          set((state) => {
            const question = state.questions.find((q) => q.id === questionId);
            if (question) {
              return {
                ...state,
                questions: state.questions.map((q) =>
                  q.id === questionId ? { ...q, translatedQuestion } : q,
                ),
              };
            }
            return state;
          }),

        setTranslatedChoices: (questionId, translatedChoices) =>
          set((state) => {
            const question = state.questions.find((q) => q.id === questionId);
            if (question) {
              question.translatedChoices = translatedChoices;
            }
            return state;
          }),

        setSelectedLanguage: (questionId, language) => {
          set((state) => ({
            questions: state.questions.map((q) =>
              q.id === questionId ? { ...q, selectedLanguage: language } : q,
            ),
          }));
        },
        translationOn: true,
        setTranslationOn: (questionId, translationOn) => {
          set((state) => ({
            questions: state.questions.map((q) =>
              q.id === questionId ? { ...q, translationOn } : q,
            ),
          }));
        },
        getTranslationOn: (questionId) => {
          const question = get().questions.find((q) => q.id === questionId);
          return question?.translationOn || false;
        },
        getFileUpload: (questionId) => {
          const question = get().questions.find((q) => q.id === questionId);
          return question?.learnerFileResponse || [];
        },
        addFileUpload: (file, questionId) => {
          set((state) => {
            const updatedQuestions = state.questions.map((q) => {
              if (q.id === questionId) {
                return {
                  ...q,
                  learnerFileResponse: [...(q.learnerFileResponse || []), file],
                };
              }
              return q;
            });
            return { ...state, questions: updatedQuestions };
          });
          get().setQuestionStatus(questionId);
        },
        removeFileUpload: (file, questionId) => {
          set((state) => {
            const updatedQuestions = state.questions.map((q) => {
              if (q.id === questionId) {
                return {
                  ...q,
                  learnerFileResponse: q.learnerFileResponse?.filter(
                    (f) => f.filename !== file.filename,
                  ),
                };
              }
              return q;
            });
            return { questions: updatedQuestions };
          });
          get().setQuestionStatus(questionId);
        },
        onFileChange: (files, questionId) => {
          const formattedFiles = files.map((file: learnerFileResponse) => ({
            filename: file.filename,
            content: file.content,
            githubUrl: file.githubUrl,
          }));
          set((state) => {
            const updatedQuestions = state.questions.map((q) => {
              if (q.id === questionId) {
                return { ...q, learnerFileResponse: formattedFiles };
              }
              return q;
            });
            return { questions: updatedQuestions };
          });
          get().setQuestionStatus(questionId);
        },
        onUrlChange: (url, questionId) => {
          set((state) => {
            const updatedQuestions = state.questions.map((q) => {
              if (q.id === questionId) {
                return { ...q, learnerUrlResponse: url };
              }
              return q;
            });
            return { questions: updatedQuestions };
          });
        },
        onModeChange: (mode, data, questionId) => {
          if (mode === "file") {
            const formattedData = (data as learnerFileResponse[]).map(
              (file) => ({
                filename: file.filename,
                content: file.content,
              }),
            );
            get().onFileChange(formattedData, questionId);
          } else {
            get().onUrlChange(data as string, questionId);
          }
        },
        getUserPreferedLanguageFromLTI: async () => {
          try {
            const user = await getUser();
            const language = user.launch_presentation_locale;
            return language;
          } catch (e) {
            return navigator.language;
          }
        },
        setGlobalLanguage: (language) => set({ globalLanguage: language }),
        setUserPreferedLanguage: (languageCode) => {
          try {
            const parsedLocale = new Intl.Locale(languageCode);
            const baseLang = parsedLocale.language;
            const region = parsedLocale.region;

            let finalCode: string | undefined;

            if (baseLang === "zh") {
              if (region === "TW") {
                finalCode = "zh-TW";
              } else if (region === "CN") {
                finalCode = "zh-CN";
              } else {
                finalCode = "zh-CN";
              }
            } else {
              const foundLanguageCode = AVAILABLE_LANGUAGES.find(
                (langCode) => langCode === baseLang,
              );
              finalCode = foundLanguageCode ? foundLanguageCode : undefined;
            }
            if (!finalCode) {
              finalCode = "en";
            }
            set({ userPreferedLanguage: finalCode });
          } catch (e) {
            set({ userPreferedLanguage: "en" });
          }
        },

        setFileUpload: (newFiles, questionId) => {
          set((state) => {
            const updatedQuestions = state.questions.map((q) => {
              if (q.id === questionId) {
                const existingFiles = q.learnerFileResponse || [];

                const mergedFiles = [...existingFiles, ...newFiles];
                return { ...q, learnerFileResponse: mergedFiles };
              }
              return q;
            });
            return { questions: updatedQuestions };
          });
          get().setQuestionStatus(questionId);
        },
        deleteFile: (fileToDelete, questionId) => {
          set((state) => {
            const updatedQuestions = state.questions.map((q) => {
              if (q.id === questionId) {
                const existingFiles = q.learnerFileResponse || [];
                const updatedFiles = existingFiles.filter(
                  (file) => file.filename !== fileToDelete.filename,
                );
                return { ...q, learnerFileResponse: updatedFiles };
              }
              return q;
            });
            return { questions: updatedQuestions };
          });
          get().setQuestionStatus(questionId);
        },
        globalLanguage: "English",
        userPreferedLanguage: null,
        showQuestions: true,
        setShowQuestions: (showQuestions) => set({ showQuestions }),
        activeAttemptId: null,
        totalPointsEarned: 0,
        totalPointsPossible: 0,
        setActiveAttemptId: (id) => {
          set({ activeAttemptId: id });
        },
        activeQuestionNumber: 1,
        setActiveQuestionNumber: (id) => set({ activeQuestionNumber: id }),
        assignmentDetails: null,
        expiresAt: undefined,
        questions: [],
        showSubmissionFeedback: false,
        setShowSubmissionFeedback: (showSubmissionFeedback) =>
          set({ showSubmissionFeedback }),
        addQuestion: (question) =>
          set((state) => ({
            questions: [
              ...(state.questions ?? []),
              {
                ...question,
                status: "unedited",
              },
            ],
          })),
        setQuestion: (question) =>
          set((state) => ({
            questions: state.questions?.map((q) =>
              q.id === question.id
                ? { ...q, ...question, status: q.status ?? "unedited" }
                : q,
            ),
          })),
        setQuestions: (questions) =>
          set((state) => {
            const updatedQuestions = questions.map((q) => {
              const prevDataForQuestion = state.questions.find(
                (q2) => q2.id === q.id,
              );
              return prevDataForQuestion ? { ...prevDataForQuestion, ...q } : q;
            });
            return { questions: updatedQuestions as QuestionStore[] };
          }),
        getQuestionStatusById: (questionId: number) => {
          const question = get().questions.find((q) => q.id === questionId);
          return question?.status ?? "unedited";
        },
        setQuestionStatus: (questionId: number, status?: QuestionStatus) => {
          const question = get().questions.find((q) => q.id === questionId);
          if (
            question &&
            (question.status !== "flagged" || status === "unflagged")
          ) {
            if (status === undefined) {
              const isEdited = isQuestionEdited(question);
              const newStatus = isEdited ? "edited" : "unedited";
              set((state) => ({
                questions: state.questions?.map((q) =>
                  q.id === questionId ? { ...q, status: newStatus } : q,
                ),
              }));
            } else {
              set((state) => ({
                questions: state.questions?.map((q) =>
                  q.id === questionId ? { ...q, status } : q,
                ),
              }));
            }
          }
        },

        setTextResponse: (learnerTextResponse, questionId) => {
          set((state) => ({
            questions: state.questions?.map((q) =>
              q.id === questionId ? { ...q, learnerTextResponse } : q,
            ),
          }));
          get().setQuestionStatus(questionId);
        },

        setURLResponse: (learnerUrlResponse, questionId) => {
          set((state) => ({
            questions: state.questions?.map((q) =>
              q.id === questionId ? { ...q, learnerUrlResponse } : q,
            ),
          }));
          get().setQuestionStatus(questionId);
        },

        setChoices: (learnerChoices, questionId) => {
          set((state) => ({
            questions: state.questions?.map((q) =>
              q.id === questionId ? { ...q, learnerChoices } : q,
            ),
          }));
          get().setQuestionStatus(questionId);
        },

        addChoice: (learnerChoiceIndex, questionId) => {
          (set((state) => {
            const updatedQuestions = state.questions.map((q) =>
              q.id === questionId
                ? {
                    ...q,
                    learnerChoices: [
                      ...(q.learnerChoices ?? []),
                      learnerChoiceIndex,
                    ],
                  }
                : q,
            );
            return { questions: updatedQuestions };
          }),
            get().setQuestionStatus(questionId));
        },
        removeChoice: (learnerChoiceIndex, questionId) => {
          (set((state) => {
            const updatedQuestions = state.questions.map((q) =>
              q.id === questionId
                ? {
                    ...q,
                    learnerChoices: q.learnerChoices?.filter(
                      (c) => c !== learnerChoiceIndex,
                    ),
                  }
                : q,
            );
            return { questions: updatedQuestions };
          }),
            get().setQuestionStatus(questionId));
        },

        setAnswerChoice: (learnerAnswerChoice, questionId) => {
          set((state) => {
            const activeQuestionId =
              questionId ||
              state.questions[(state.activeQuestionNumber ?? 1) - 1].id;
            const updatedQuestions = state.questions.map((q) =>
              q.id === activeQuestionId
                ? { ...q, learnerAnswerChoice: Boolean(learnerAnswerChoice) }
                : q,
            );
            return { questions: updatedQuestions };
          });
          get().setQuestionStatus(questionId);
        },
        setRole: (role) => set({ role }),
        setLearnerStore: (learnerState) => set(learnerState),
        setTotalPointsEarned: (totalPointsEarned) => set({ totalPointsEarned }),
        setTotalPointsPossible: (totalPointsPossible) =>
          set({ totalPointsPossible }),
      }),
      {
        name: `learner-${ASSIGNMENT_ID}`,
        trace: true,
        traceLimit: 25,
        enabled: process.env.NODE_ENV === "development",
        serialize: {
          options: true,
        },
      },
    ),
    {
      name: `learner-${ASSIGNMENT_ID}`,

      partialize: (state) => ({
        questions: state.questions,
        activeAttemptId: state.activeAttemptId,
        userPreferedLanguage: state.userPreferedLanguage,
      }),
    },
  ),
  shallow,
);

/**
 * made this a separate store so I can leverage the persist middleware (to store in local storage)
 * Purpose: to store the assignment details which are fetched from the backend when the learner
 * is on the assignment overview page. This reduces the number of requests to the backend.
 */
export const useAssignmentDetails = createWithEqualityFn<
  AssignmentDetailsState & AssignmentDetailsActions
>()(
  persist(
    devtools(
      (set) => ({
        assignmentDetails: null,
        setAssignmentDetails: (assignmentDetails) =>
          set({ assignmentDetails: assignmentDetails }),
        grade: null,
        setGrade: (grade) => set({ grade }),
      }),
      {
        name: "learner",
        trace: true,
        traceLimit: 25,
        enabled: process.env.NODE_ENV === "development",
      },
    ),
    {
      name: "assignmentDetails",
      partialize: (state) => ({
        assignmentDetails: state.assignmentDetails,
      }),
    },
  ),
  shallow,
);
