import MarkdownEditor from "@/components/MarkDownEditor";
import MultipleChoiceSVG from "@/components/svgs/MC";
import Tooltip from "@/components/Tooltip";
import type {
  CreateQuestionRequest,
  Criteria,
  QuestionAuthorStore,
  QuestionType,
  QuestionVariants,
  ResponseType,
  UpdateQuestionStateParams,
} from "@/config/types";
import { cn } from "@/lib/strings";
import { generateQuestionVariant } from "@/lib/talkToBackend";
import { generateTempQuestionId } from "@/lib/utils";
import { useAuthorStore, useQuestionStore } from "@/stores/author";
import { Menu, Transition } from "@headlessui/react";
import { ChevronDownIcon } from "@heroicons/react/20/solid";
import {
  ArrowPathRoundedSquareIcon,
  ArrowUpTrayIcon,
  Bars3BottomLeftIcon,
  CodeBracketIcon,
  DocumentArrowUpIcon,
  DocumentChartBarIcon,
  DocumentDuplicateIcon,
  DocumentTextIcon,
  LinkIcon,
  PencilSquareIcon,
  PlusIcon,
  PresentationChartBarIcon,
  TrashIcon,
} from "@heroicons/react/24/outline";
import {
  ExclamationTriangleIcon,
  SparklesIcon,
} from "@heroicons/react/24/solid";
import {
  IconArrowsShuffle,
  IconCheckbox,
  IconCircleCheck,
  IconDeviceComputerCamera,
  IconPhotoScan,
} from "@tabler/icons-react";
import { useRouter } from "next/navigation";
import { FC, Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import QuestionWrapper from "../(questionComponents)/QuestionWrapper";

interface QuestionProps {
  question: QuestionAuthorStore;
  onDelete?: (questionId: number) => void;
  questionId: number;
  duplicateThisQuestion?: (questionData: CreateQuestionRequest) => void;
  questionIndex: number;
  collapse?: boolean;
  isFocusedQuestion?: boolean;
  preview?: boolean;
}

const Question: FC<QuestionProps> = ({
  question,
  onDelete,
  questionId,
  duplicateThisQuestion,
  questionIndex,
  collapse,
  isFocusedQuestion,
  preview = false,
}) => {
  const [maxWordCount, setMaxWordCount] = useState<number | null>(
    question.maxWords || null,
  );
  const [maxCharacters, setMaxCharacters] = useState<number | null>(
    question.maxCharacters || null,
  );
  const setQuestionTitle = useAuthorStore((state) => state.setQuestionTitle);
  const addVariant = useAuthorStore((state) => state.addVariant);
  const replaceQuestion = useAuthorStore((state) => state.replaceQuestion);
  const deleteVariant = useAuthorStore((state) => state.deleteVariant);
  const [newIndex, setNewIndex] = useState<number>(questionIndex);
  const [isFocused, setIsFocused] = useState(false);
  const disabledMenuButtons = ["VIDEO", "AUDIO"];
  const { questionStates, setShowWordCountInput, setCountMode } =
    useQuestionStore();
  const [variantLoading, setVariantLoading] = useState(false);
  const router = useRouter();
  const setFocusedQuestionId = useAuthorStore(
    (state) => state.setFocusedQuestionId,
  );
  const showWordCountInput =
    questionStates[question.id]?.showWordCountInput || false;
  const countMode = questionStates[question.id]?.countMode || "CHARACTER";
  const [toggleQuestion, setToggleQuestion] = useState<boolean>(
    !collapse || isFocusedQuestion,
  );
  const [questionTitle, setQuestionTitleState] = useState<string>(
    question.question || "",
  );
  const [questionType, setQuestionTypeState] = useState<QuestionType>(
    question.type,
  );
  const [responseType, setResponseType] = useState<ResponseType>(
    question.responseType || "OTHER",
  );
  const [toggleDeleteConfirmation, setToggleDeleteConfirmation] =
    useState<boolean>(false);
  const [questionCriteria, setQuestionCriteriaState] = useState<{
    points: number[];
    criteriaDesc: string[];
    criteriaIds: number[];
  }>({
    points: question.scoring?.criteria?.map((c) => c.points) || [1, 0],
    criteriaDesc: question.scoring?.criteria?.map((c) => c.description) || [
      "Student must show their work and state the correct answer",
      "By default, learners will be given 0 points if they do not meet any of the criteria.",
    ],
    criteriaIds: question.scoring?.criteria?.map(
      (c, index) => c.id || index + 1,
    ) || [1, 2],
  });
  const [inputValue, setInputValue] = useState<string>(
    questionIndex.toString(),
  );

  const handleDeleteVariant = (variantId: number) => {
    try {
      deleteVariant(questionId, variantId);
      toast.success("Variant deleted successfully");
    } catch (error) {
      toast.error("Failed to delete variant");
    }
  };

  useEffect(() => {
    if (!collapse || isFocusedQuestion) {
      setToggleQuestion(true);
    }
  }, [collapse, isFocusedQuestion]);

  // Function to update the main question state
  const handleUpdateQuestionState = (
    params: UpdateQuestionStateParams,
    variantMode = false,
  ) => {
    //if showSubQuestionsToLearner is undefined, use false as default
    const showSubQuestions =
      params.showSubQuestionsToLearner !== undefined
        ? params.showSubQuestionsToLearner
        : (question.scoring?.showSubQuestionsToLearner ?? false);

    //if showRubricsToLearner is undefined, use false as default
    const showRubrics = showSubQuestions
      ? params.showRubricsToLearner !== undefined
        ? params.showRubricsToLearner
        : (question.scoring?.showRubricsToLearner ?? false)
      : false;

    //if showRubrics is false, showPoints uses false as default
    const showPoints = showRubrics
      ? params.showPoints !== undefined
        ? params.showPoints
        : (question.scoring?.showPoints ?? false)
      : false;

    if (variantMode) {
      const updatedData: Partial<QuestionVariants> = {};
      if (params.questionTitle !== undefined) {
        updatedData.variantContent = params.questionTitle;
      }
      if (params.questionType !== undefined) {
        updatedData.type = params.questionType;
      }
      if (params.rubrics !== undefined) {
        updatedData.scoring = {
          type: "CRITERIA_BASED",
          rubrics: params.rubrics,
        };
      }
      if (params.randomizedChoices !== undefined) {
        updatedData.randomizedChoices = params.randomizedChoices;
      }
      if (params.maxCharacters !== undefined) {
        updatedData.maxCharacters = params.maxCharacters;
      }

      updatedData.scoring.showSubQuestionsToLearner = showSubQuestions;
      updatedData.scoring.showRubricsToLearner = showRubrics;
      updatedData.scoring.showPoints = showPoints;

      if (params.maxWordCount !== undefined) {
        updatedData.maxWords = params.maxWordCount;
      }
      useAuthorStore.getState().modifyQuestion(questionId, {
        ...question,
        ...updatedData,
        choices: Array.isArray(updatedData.choices)
          ? updatedData.choices
          : question.choices,
      });
    } else {
      const updatedQuestion: Partial<QuestionAuthorStore> = {
        id: questionId,
        responseType: params.responseType ?? responseType,
        totalPoints: params.totalPoints ?? question.totalPoints,
        question: params.questionTitle ?? questionTitle,
        type: params.questionType ?? questionType,
        maxWords: params.maxWordCount,
        maxCharacters: params.maxCharacters,
        randomizedChoices:
          params.randomizedChoices ?? question.randomizedChoices,
        scoring: {
          type: "CRITERIA_BASED",
          showSubQuestionsToLearner: showSubQuestions,
          showPoints: showPoints,
          showRubricsToLearner: showRubrics,
          rubrics: params.rubrics
            ? params.rubrics
            : (question.scoring?.rubrics ?? []),
        },
      };

      useAuthorStore.getState().modifyQuestion(questionId, updatedQuestion);
    }
  };

  const handleUpdateVariant = (
    variantId: number,
    updatedData: Partial<QuestionVariants>,
  ) => {
    useAuthorStore.getState().editVariant(questionId, variantId, updatedData);
  };

  const handleAddVariant = () => {
    const newVariant: QuestionVariants = {
      id: generateTempQuestionId(),
      questionId: question.id,
      variantContent: question.question || "",
      choices:
        questionType === "MULTIPLE_CORRECT" || questionType === "SINGLE_CORRECT"
          ? [
              {
                choice: "",
                points: 1,
                feedback: "",
                isCorrect: true,
              },
              {
                choice: "",
                points: 0,
                feedback: "",
                isCorrect: false,
              },
            ]
          : undefined,
      scoring:
        questionType === "TEXT" || questionType === "URL"
          ? {
              type: "CRITERIA_BASED",
              criteria: [
                {
                  id: 1,
                  description: "",
                  points: 1,
                },
                {
                  id: 2,
                  description: "",
                  points: 0,
                },
              ],
            }
          : undefined,
      createdAt: new Date().toISOString(),
      variantType: "REWORDED",
      type: questionType,
      randomizedChoices: true,
    };

    addVariant(question.id, newVariant);
  };

  const handleIndexChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setInputValue(value);
  };

  const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      handleIndexBlur();
    }
  };

  const handleAddVariantUsingAi = async () => {
    if (
      Array.isArray(question.variants) &&
      question.variants.some(
        (v) => Array.isArray(v.choices) && v.choices.some((c) => !c.choice),
      )
    ) {
      toast.error("Please fill in all choices before generating variants");
      return;
    }
    setVariantLoading(true);
    const questionsWithVariants = await generateQuestionVariant(
      [question],
      1,
      question.assignmentId,
    );
    if (questionsWithVariants) {
      replaceQuestion(questionId, questionsWithVariants[0]);
    }

    setVariantLoading(false);
  };

  const handleResetCounters = (mode: "CHARACTER" | "WORD") => {
    if (mode === "CHARACTER") {
      setMaxWordCount(null);
      handleUpdateQuestionState({
        maxCharacters: maxCharacters || 1000,
        maxWordCount: null,
      });
    }
    if (mode === "WORD") {
      setMaxCharacters(null);
      handleUpdateQuestionState({
        maxCharacters: null,
        maxWordCount: maxWordCount || 250,
      });
    }
  };

  // Handle the blur event for the index input, updating the question order
  const handleIndexBlur = useCallback(() => {
    if (inputValue !== "") {
      const parsedValue = parseInt(inputValue, 10);
      if (!isNaN(parsedValue)) {
        setNewIndex(parsedValue);
        const updatedQuestions = [...useAuthorStore.getState().questions];
        const currentQuestion = updatedQuestions.find(
          (q) => q.id === questionId,
        );
        if (currentQuestion) {
          updatedQuestions.splice(questionIndex - 1, 1);
          updatedQuestions.splice(parsedValue - 1, 0, currentQuestion);
          updatedQuestions.forEach((q, index) => {
            q.index = index + 1;
          });
          useAuthorStore.getState().setQuestions(updatedQuestions);
        }
      }
    } else {
      setInputValue(newIndex.toString());
    }
  }, [inputValue, newIndex, questionId, questionIndex]);

  const questionTypes = useMemo(
    () => [
      {
        value: "MULTIPLE_CORRECT",
        label: "Multiple Select",
        icon: <IconCheckbox className="w-5 h-5" />,
      },

      {
        value: "SINGLE_CORRECT",
        label: "Multiple Choice",
        icon: <MultipleChoiceSVG className="w-5 h-5 " />,
      },

      {
        value: "TRUE_FALSE",
        label: "True/False",
        icon: <IconCircleCheck className="w-5 h-5" />,
      },
      {
        value: "TEXT",
        label: "Text Response",
        icon: <Bars3BottomLeftIcon className="w-5 h-5 stroke-gray-500" />,
      },
      {
        value: "URL",
        label: "URL Link",
        icon: <LinkIcon className="w-5 h-5  stroke-gray-500" />,
      },
      {
        value: "UPLOAD",
        label: "Upload",
        icon: <DocumentArrowUpIcon className="w-5 h-5 stroke-gray-500" />,
      },
      {
        value: "LINK_FILE",
        label: "File or Link",
        icon: <ArrowUpTrayIcon className="w-5 h-5 stroke-gray-500" />,
      },
    ],
    [],
  );
  const responseTypes = useMemo(
    () => [
      {
        value: "CODE",
        label: "Code",
        icon: <CodeBracketIcon className="w-5 h-5 stroke-gray-500" />,
      },

      {
        value: "ESSAY",
        label: "Essay",
        icon: <DocumentTextIcon className="w-5 h-5  stroke-gray-500" />,
      },
      {
        value: "REPORT",
        label: "Report",
        icon: <DocumentChartBarIcon className="w-5 h-5 stroke-gray-500" />,
      },
      {
        value: "PRESENTATION",
        label: "Video Presentation (Beta)",
        icon: <PresentationChartBarIcon className="w-5 h-5 stroke-gray-500" />,
      },
      {
        value: "LIVE_RECORDING",
        label: "Live Recording (Beta)",
        icon: <IconDeviceComputerCamera className="w-5 h-5 stroke-gray-500" />,
      },
      {
        value: "IMAGES",
        label: "Image",
        icon: <IconPhotoScan className="w-5 h-5 stroke-gray-500" />,
      },
      {
        value: "OTHER",
        label: "Other",
      },
    ],
    [],
  );
  const toggleRandomizedChoicesMode = useAuthorStore(
    (state) => state.toggleRandomizedChoicesMode,
  );

  const randomizedChoices = (
    questionId: number,
    questionIndex: number,
    variantId?: number,
    Index?: number,
  ) => {
    if (variantId) {
      const randomizedMode = toggleRandomizedChoicesMode(questionId, variantId);
      toast.info(
        `Randomized choice order for question ${questionIndex}  ${
          variantId ? `: variant ${Index}` : ""
        } has been ${randomizedMode ? "ENABLED" : "DISABLED"}`,
      );
      return;
    }
    const randomizedMode = toggleRandomizedChoicesMode(questionId);
    toast.info(
      `Randomized choice order for question number ${questionIndex} has been ${
        randomizedMode ? "ENABLED" : "DISABLED"
      }`,
    );
  };
  const handleEditClick = (id: number) => {
    setFocusedQuestionId(id);
    router.push(`/author/${question.assignmentId}/questions`);
  };

  return (
    <div className="flex flex-col items-center justify-between rounded-lg bg-white w-full gap-y-6">
      <div className="flex gap-2 flex-wrap w-full">
        <div className="flex items-center gap-x-2 flex-1">
          <div className="items-center w-11 h-full typography-body text-gray-500 border border-gray-200 rounded-md text-center">
            {preview ? (
              <div className="w-full h-full flex items-center justify-center">
                {questionIndex}
              </div>
            ) : (
              <input
                type="text"
                min={1}
                max={useAuthorStore.getState().questions?.length}
                value={inputValue}
                onChange={handleIndexChange}
                onBlur={handleIndexBlur}
                onKeyPress={handleKeyPress}
                className="w-full h-full text-center p-0 m-0 border-none bg-transparent focus:outline-none focus:ring-0"
              />
            )}
          </div>

          <Menu as="div" className="relative inline-block text-left">
            <div>
              <Menu.Button
                className="inline-flex justify-between items-center px-4 py-2 border border-gray-200 rounded-md bg-white text-gray-700 min-w-[208px] h-min body-typography gap-1.5 hover:bg-gray-100"
                disabled={preview}
              >
                {questionType === "EMPTY" ? (
                  <div className="gap-x-1.5 content-between ">
                    <div className="flex items-center gap-x-1.5 typography-body">
                      <ExclamationTriangleIcon
                        className="w-5 h-5"
                        style={{ color: "#F59E0B" }}
                      />
                      <span className="typography-body text-center text-gray-600">
                        Select Type
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5 typography-body text-gray-600">
                    {
                      questionTypes.find((qt) => qt.value === questionType)
                        ?.icon
                    }
                    {
                      questionTypes.find((qt) => qt.value === questionType)
                        ?.label
                    }
                  </div>
                )}
                {preview ? null : (
                  <ChevronDownIcon
                    className="w-5 h-5 text-gray-500"
                    aria-hidden="true"
                  />
                )}
              </Menu.Button>
            </div>

            <Transition
              as={Fragment}
              enter="transition ease-out duration-100"
              enterFrom="transform opacity-0 scale-95"
              enterTo="transform opacity-100 scale-100"
              leave="transition ease-in duration-75"
              leaveFrom="transform opacity-100 scale-100"
              leaveTo="transform opacity-0 scale-95"
            >
              <Menu.Items className="absolute left-0 z-10 w-52 mt-1 origin-top-left bg-white divide-y divide-gray-100 rounded-md ring-1 ring-black ring-opacity-5 focus:outline-none">
                <div className="py-1">
                  {questionTypes?.map((qt) => (
                    <Menu.Item key={qt.value}>
                      {({ active }) => (
                        <button
                          onClick={() => {
                            if (disabledMenuButtons.includes(qt.value)) {
                              return;
                            }
                            setQuestionTypeState(
                              qt.value as
                                | "TEXT"
                                | "URL"
                                | "MULTIPLE_CORRECT"
                                | "UPLOAD"
                                | "CODE"
                                | "SINGLE_CORRECT"
                                | "TRUE_FALSE",
                            );
                            handleUpdateQuestionState({
                              questionType: qt.value as
                                | "TEXT"
                                | "URL"
                                | "MULTIPLE_CORRECT"
                                | "UPLOAD"
                                | "CODE"
                                | "SINGLE_CORRECT"
                                | "TRUE_FALSE",
                            });
                          }}
                          disabled={
                            disabledMenuButtons.includes(qt.value)
                              ? true
                              : false
                          }
                          className={`${
                            active
                              ? "bg-gray-100 text-gray-600"
                              : "text-gray-600"
                          } group flex items-center w-full py-2 px-4 gap-1.5 typography-body ${
                            disabledMenuButtons.includes(qt.value)
                              ? "cursor-not-allowed opacity-50"
                              : "cursor-pointer"
                          }`}
                        >
                          <div className="stroke-gray-500">{qt.icon}</div>
                          {qt.label}
                        </button>
                      )}
                    </Menu.Item>
                  ))}
                </div>
              </Menu.Items>
            </Transition>
          </Menu>

          {["TEXT", "URL", "UPLOAD", "LINK_FILE"].includes(questionType) ? (
            <Menu as="div" className="relative inline-block text-left">
              <div>
                <Menu.Button
                  className="inline-flex justify-between items-center px-4 py-2 border border-gray-200 rounded-md bg-white text-gray-700 min-w-[208px] h-min body-typography gap-1.5 hover:bg-gray-100"
                  disabled={preview}
                >
                  {responseTypes ? (
                    <div className="flex items-center gap-1.5 typography-body text-gray-600">
                      {
                        responseTypes.find((qt) => qt.value === responseType)
                          ?.icon
                      }
                      {
                        responseTypes.find((qt) => qt.value === responseType)
                          ?.label
                      }
                    </div>
                  ) : null}
                  {preview ? null : (
                    <ChevronDownIcon
                      className="w-5 h-5 text-gray-500"
                      aria-hidden="true"
                    />
                  )}
                </Menu.Button>
              </div>

              <Transition
                as={Fragment}
                enter="transition ease-out duration-100"
                enterFrom="transform opacity-0 scale-95"
                enterTo="transform opacity-100 scale-100"
                leave="transition ease-in duration-75"
                leaveFrom="transform opacity-100 scale-100"
                leaveTo="transform opacity-0 scale-95"
              >
                <Menu.Items className="absolute left-0 z-10 w-52 mt-1 origin-top-left bg-white divide-y divide-gray-100 rounded-md ring-1 ring-black ring-opacity-5 focus:outline-none">
                  <div className="py-1">
                    {responseTypes
                      ?.filter((qt) => {
                        if (questionType === "TEXT") {
                          return ![
                            "SPREADSHEET",
                            "VIDEO",
                            "AUDIO",
                            "PRESENTATION",
                            "LIVE_RECORDING",
                          ].includes(qt.value);
                        }
                        return true;
                      })
                      .map((qt) => (
                        <Menu.Item key={qt.value}>
                          {({ active }) => (
                            <button
                              onClick={() => {
                                if (disabledMenuButtons.includes(qt.value)) {
                                  return;
                                }
                                setResponseType(qt.value as ResponseType);
                                handleUpdateQuestionState({
                                  responseType: qt.value as ResponseType,
                                });
                              }}
                              disabled={
                                disabledMenuButtons.includes(qt.value)
                                  ? true
                                  : false
                              }
                              className={`${
                                active
                                  ? "bg-gray-100 text-gray-600"
                                  : "text-gray-600"
                              } group flex items-center w-full py-2 px-4 gap-1.5 typography-body ${
                                disabledMenuButtons.includes(qt.value)
                                  ? "cursor-not-allowed opacity-50"
                                  : "cursor-pointer"
                              }`}
                            >
                              <div className="stroke-gray-500">{qt.icon}</div>
                              {qt.label}
                            </button>
                          )}
                        </Menu.Item>
                      ))}
                  </div>
                </Menu.Items>
              </Transition>
            </Menu>
          ) : null}
        </div>

        <div className="flex items-center gap-4 flex-wrap">
          {preview ? (
            <div className="flex items-center gap-2 text-gray-600 text-nowrap ">
              {maxCharacters ? (
                <div className="flex items-center">
                  <span className="text-gray-600 typography-body">
                    Character Count: {maxCharacters}
                  </span>
                </div>
              ) : (
                maxWordCount && (
                  <div className="flex items-center">
                    <span className="text-gray-600 typography-body shit">
                      Word Count: {maxWordCount}
                    </span>
                  </div>
                )
              )}
              <button
                onClick={() => {
                  handleEditClick(questionId);
                }}
              >
                <PencilSquareIcon className="h-6 w-6 text-gray-500" />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-gray-600 text-nowrap ">
              {showWordCountInput ? (
                <>
                  <ArrowPathRoundedSquareIcon
                    height={16}
                    width={16}
                    onClick={() => {
                      setCountMode(
                        questionId,
                        countMode === "CHARACTER" ? "WORD" : "CHARACTER",
                      );
                      handleResetCounters(
                        countMode === "CHARACTER" ? "WORD" : "CHARACTER",
                      );
                    }}
                  />
                  {countMode === "CHARACTER" ? (
                    <div className="flex items-center">
                      <span className="text-gray-600 typography-body">
                        Character Count:
                      </span>
                      <input
                        type="text"
                        value={maxCharacters}
                        onKeyPress={(e) => {
                          if (e.key === "Enter") {
                            setMaxCharacters(maxCharacters);
                            setMaxWordCount(null);
                            handleUpdateQuestionState({
                              maxCharacters: maxCharacters,
                              maxWordCount: null,
                            });
                          }
                        }}
                        onChange={(e) => {
                          const value = parseInt(e.target.value, 10);
                          if (isNaN(value) || value <= 0) {
                            setShowWordCountInput(questionId, false);
                            setMaxCharacters(null);
                            setMaxWordCount(null);
                          } else if (value > 10000) {
                            setMaxCharacters(10000);
                            setMaxWordCount(null);
                          } else {
                            setMaxCharacters(value);
                            setMaxWordCount(null);
                          }
                        }}
                        onBlur={() => {
                          handleUpdateQuestionState({
                            maxCharacters: maxCharacters,
                            maxWordCount: null,
                          });
                        }}
                        className={`w-16 h-8 text-left px-1 py-1 m-0 border-none ${
                          isFocused ? "focused" : "not-focused"
                        }`}
                        style={{
                          width: `${maxCharacters?.toString()?.length + 1}ch`,
                        }}
                      />
                      <button
                        className="items-center"
                        onClick={() => {
                          setShowWordCountInput(questionId, false);
                          setMaxWordCount(null);
                          setMaxCharacters(null);
                          handleUpdateQuestionState({
                            maxWordCount: null,
                            maxCharacters: null,
                          });
                        }}
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          className="h-4 w-4 text-gray-500"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M6 18L18 6M6 6l12 12"
                          />
                        </svg>
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center">
                      <span className="text-gray-600 typography-body test">
                        Word Count:
                      </span>
                      <input
                        type="text"
                        value={maxWordCount}
                        onChange={(e) => {
                          const value = parseInt(e.target.value, 10);
                          if (isNaN(value) || value <= 0) {
                            setShowWordCountInput(questionId, false);
                            setMaxWordCount(null);
                            setMaxCharacters(null);
                          } else if (value > 10000) {
                            setMaxWordCount(10000);
                            setMaxCharacters(null);
                          } else {
                            setMaxWordCount(value);
                            setMaxCharacters(null);
                          }
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            handleUpdateQuestionState({
                              maxWordCount: maxWordCount,
                              maxCharacters: null,
                            });
                          }
                        }}
                        onFocus={() => setIsFocused(true)}
                        onBlur={() => {
                          setIsFocused(false);
                          handleUpdateQuestionState({
                            maxWordCount: maxWordCount,
                            maxCharacters: null,
                          });
                        }}
                        className={`w-16 h-8 text-left px-1 py-1 m-0 border-none ${
                          isFocused ? "focused" : "not-focused"
                        }`}
                        style={{
                          width: `${
                            isFocused
                              ? maxWordCount?.toString()?.length + 2
                              : maxWordCount?.toString()?.length + 1
                          }ch`,
                        }}
                      />
                      <button
                        onClick={() => {
                          setShowWordCountInput(questionId, false);
                          setMaxWordCount(null);
                          setMaxCharacters(null);
                          handleUpdateQuestionState({
                            maxWordCount: null,
                            maxCharacters: null,
                          });
                        }}
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          className="h-4 w-4 text-gray-500"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M6 18L18 6M6 6l12 12"
                          />
                        </svg>
                      </button>
                    </div>
                  )}
                </>
              ) : maxWordCount || maxCharacters ? (
                <div className="flex items-center gap-x-2">
                  <ArrowPathRoundedSquareIcon
                    height={16}
                    width={16}
                    onClick={() => {
                      setCountMode(
                        questionId,
                        countMode === "CHARACTER" ? "WORD" : "CHARACTER",
                      );
                      handleResetCounters(
                        countMode === "CHARACTER" ? "WORD" : "CHARACTER",
                      );
                    }}
                  />
                  <span
                    className="text-gray-600 typography-body"
                    onClick={() => {
                      setShowWordCountInput(questionId, true);
                      if (maxCharacters) {
                        setCountMode(questionId, "CHARACTER");
                      } else if (maxWordCount) {
                        setCountMode(questionId, "WORD");
                      }
                    }}
                  >
                    {maxCharacters
                      ? `Character Count: ${maxCharacters}`
                      : `Word Count: ${maxWordCount}`}
                  </span>
                </div>
              ) : questionType === "TEXT" ? (
                <button
                  className="text-gray-600 text-nowrap typography-body"
                  onClick={() => {
                    setShowWordCountInput(questionId, true);
                    handleResetCounters("CHARACTER");
                  }}
                >
                  + Add character/word limit
                </button>
              ) : null}
              {question.type === "MULTIPLE_CORRECT" ||
              question.type === "SINGLE_CORRECT" ? (
                <Tooltip
                  content={
                    question.randomizedChoices
                      ? "Disable randomized choice order"
                      : "Enable randomized choice order"
                  }
                  className="flex items-center gap-2"
                >
                  <IconArrowsShuffle className="w-6 h-6 text-gray-500 cursor-pointer" />
                  <button
                    type="button"
                    onClick={() => {
                      randomizedChoices(question.id, questionIndex);
                    }}
                    className={cn(
                      "relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none",
                      question.randomizedChoices
                        ? "bg-violet-600"
                        : "bg-gray-200",
                    )}
                    role="switch"
                    aria-checked={question.randomizedChoices}
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        "pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out",
                        question.randomizedChoices
                          ? "translate-x-5"
                          : "translate-x-0",
                      )}
                    />
                  </button>
                </Tooltip>
              ) : null}

              <button
                className="text-gray-500"
                onClick={() => {
                  try {
                    duplicateThisQuestion(question);
                  } catch (error) {
                    toast.error("Failed to duplicate question");
                  }
                }}
              >
                <DocumentDuplicateIcon width={20} height={20} />
              </button>

              <button
                className="text-gray-500"
                onClick={() => setToggleDeleteConfirmation(true)}
              >
                <TrashIcon width={20} height={20} />
              </button>
            </div>
          )}
        </div>
      </div>
      {toggleQuestion && (
        <>
          <QuestionWrapper
            questionId={question.id}
            questionTitle={questionTitle}
            setQuestionTitle={(title) => {
              setQuestionTitle(title, question.id);
              setQuestionTitleState(title);
            }}
            questionType={questionType}
            setQuestionType={(type) => {
              setQuestionTypeState(type);
              handleUpdateQuestionState({ questionType: type });
            }}
            questionCriteria={questionCriteria}
            setQuestionCriteria={(criteria) => {
              setQuestionCriteriaState(criteria);
            }}
            handleUpdateQuestionState={handleUpdateQuestionState}
            questionIndex={questionIndex}
            preview={preview}
            questionFromParent={question}
            variantMode={false}
            responseType={question.responseType ?? ("OTHER" as const)}
            showSubQuestionsToLearner={
              question.scoring?.showSubQuestionsToLearner
            }
            showRubricsToLearner={question.scoring?.showRubricsToLearner}
            showPoints={question.scoring?.showPoints}
          />

          {question.variants?.map((variant, index) => {
            const [localVariantContent, setLocalVariantContent] = useState(
              variant.variantContent || "",
            );
            const [localType, setLocalType] = useState(
              variant.type || questionType,
            );
            const [localCriteria, setLocalCriteria] = useState(() =>
              variant.scoring?.criteria
                ? {
                    points: variant.scoring.criteria.map((c) => c.points),
                    criteriaDesc: variant.scoring.criteria.map(
                      (c) => c.description,
                    ),
                    criteriaIds: variant.scoring.criteria.map((c) => c.id),
                  }
                : {
                    points: [1, 0],
                    criteriaDesc: [
                      "Student must show their work and state the correct answer",
                      "By default, learners will be given 0 points if they do not meet any of the criteria.",
                    ],
                    criteriaIds: [1, 2],
                  },
            );

            return (
              <div
                key={variant.id}
                className="border-t-2 flex flex-col border-gray-200 pt-4 w-full gap-y-6"
              >
                <div className="flex items-center justify-between w-full">
                  <span className="typography-body">Variant {index + 1}</span>
                  <div className="flex items-center gap-4">
                    {question.type === "MULTIPLE_CORRECT" ||
                    question.type === "SINGLE_CORRECT" ? (
                      <Tooltip
                        content={
                          variant.randomizedChoices
                            ? "Disable randomized choice order"
                            : "Enable randomized choice order"
                        }
                        className="flex items-center gap-2"
                      >
                        <IconArrowsShuffle className="w-6 h-6 text-gray-500 cursor-pointer" />

                        <button
                          type="button"
                          onClick={() => {
                            randomizedChoices(
                              question.id,
                              questionIndex,
                              variant.id,
                              index + 1,
                            );
                          }}
                          className={cn(
                            "relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none",
                            variant.randomizedChoices
                              ? "bg-violet-600"
                              : "bg-gray-200",
                          )}
                          role="switch"
                          aria-checked={variant.randomizedChoices}
                        >
                          <span
                            aria-hidden="true"
                            className={cn(
                              "pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out",
                              variant.randomizedChoices
                                ? "translate-x-5"
                                : "translate-x-0",
                            )}
                          />
                        </button>
                      </Tooltip>
                    ) : null}
                    <button
                      className="text-gray-500"
                      onClick={() => handleDeleteVariant(variant.id)}
                    >
                      <TrashIcon width={20} height={20} />
                    </button>
                  </div>
                </div>
                <QuestionWrapper
                  questionId={question.id}
                  questionTitle={localVariantContent}
                  setQuestionTitle={setLocalVariantContent}
                  questionType={localType}
                  setQuestionType={setLocalType}
                  questionCriteria={localCriteria}
                  setQuestionCriteria={setLocalCriteria}
                  handleUpdateQuestionState={(params) => {
                    const updatedData: Partial<QuestionVariants> = {};
                    if (params.questionTitle !== undefined) {
                      updatedData.variantContent = params.questionTitle;
                    }
                    if (params.questionType !== undefined) {
                      updatedData.type = params.questionType;
                    }
                    if (params.questionCriteria !== undefined) {
                      updatedData.scoring = {
                        type: "CRITERIA_BASED",
                        criteria: params.questionCriteria.criteriaDesc?.map(
                          (desc, idx) => ({
                            id: params.questionCriteria.criteriaIds[idx],
                            description:
                              params.questionCriteria.criteriaDesc[idx],
                            points: params.questionCriteria.points[idx],
                          }),
                        ),
                      };
                    }
                    handleUpdateVariant(variant.id, updatedData);
                  }}
                  questionIndex={index + 1}
                  preview={preview}
                  questionFromParent={{
                    ...question,
                    ...variant,
                    choices: Array.isArray(variant.choices)
                      ? variant.choices
                      : [],
                  }}
                  variantMode={true}
                  variantId={variant.id}
                  responseType={question.responseType ?? ("OTHER" as const)}
                />
              </div>
            );
          })}

          {questionTitle?.length > 0 && !preview ? (
            variantLoading ? (
              <div className="flex items-center justify-center w-full gap-4">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-center w-full gap-4">
                  <button
                    onClick={handleAddVariant}
                    className="flex items-center gap-2 border border-gray-200 rounded-md p-2 hover:bg-gray-100 py-2 px-4"
                  >
                    <PlusIcon className="w-4 h-4 text-gray-500" />
                    <span className="text-gray-600 typography-body text-nowrap">
                      Create Blank Variant
                    </span>
                  </button>

                  <button
                    onClick={handleAddVariantUsingAi}
                    className="flex items-center gap-2 bg-violet-100 border border-violet-200 rounded-md p-2 hover:bg-violet-100 py-2 px-4"
                  >
                    <SparklesIcon className="w-4 h-4 text-violet-800" />
                    <span className="text-violet-800 typography-body text-nowrap font-bold">
                      Add Variant
                    </span>
                  </button>
                </div>
              </>
            )
          ) : null}
        </>
      )}
      {toggleDeleteConfirmation && (
        <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-50 z-50">
          <div className="bg-white p-6 rounded-lg max-w-xl w-full max-h-[80vh] overflow-y-auto">
            <h2 className="text-lg font-bold mb-4">Delete Question</h2>
            <p className="text-gray-600 mb-4">
              Are you sure you want to delete this question?
            </p>
            <div className="flex items-center gap-4 justify-end">
              <button
                onClick={() => {
                  onDelete && onDelete(questionId);
                  setToggleDeleteConfirmation(false);
                }}
                className="px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600"
              >
                Delete
              </button>
              <button
                onClick={() => setToggleDeleteConfirmation(false)}
                className="px-4 py-2 bg-gray-200 text-gray-600 rounded hover:bg-gray-300"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Question;
