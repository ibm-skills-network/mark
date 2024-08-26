import {
  FC,
  useState,
  useEffect,
  Fragment,
  useCallback,
  useMemo,
  useRef,
} from "react";
import { Menu, Transition } from "@headlessui/react";
import { toast } from "sonner";
import { useAuthorStore } from "@/stores/author";
import { useQuestionStore } from "@/stores/author";
import type {
  CreateQuestionRequest,
  QuestionAuthorStore,
  QuestionType,
  UpdateQuestionStateParams,
} from "@/config/types";
import QuestionWrapper from "../QuestionWrapper";
import {
  LinkIcon,
  ArrowUpTrayIcon,
  DocumentDuplicateIcon,
  TrashIcon,
  Bars3BottomLeftIcon,
  ArrowPathRoundedSquareIcon,
} from "@heroicons/react/24/outline";
import { ChevronDownIcon } from "@heroicons/react/20/solid";
import { ExclamationTriangleIcon } from "@heroicons/react/24/solid";
import MultipleChoiceSVG from "@/components/svgs/MC";

// Props type definition for the Question component
interface QuestionProps {
  question: QuestionAuthorStore;
  onDelete: (questionId: number) => void;
  questionId: number;
  duplicateThisQuestion: (questionData: CreateQuestionRequest) => void;
  questionIndex: number;
  collapse: boolean;
  isFocusedQuestion: boolean;
}

// Main functional component to handle each question
const Question: FC<QuestionProps> = ({
  question,
  onDelete,
  questionId,
  duplicateThisQuestion,
  questionIndex,
  collapse,
  isFocusedQuestion,
}) => {
  const [toggleQuestion, setToggleQuestion] = useState<boolean>(false);
  const [questionTitle] = useState<string>(question.question || "");
  const setQuestionTitle = useAuthorStore((state) => state.setQuestionTitle);
  const [newIndex, setNewIndex] = useState<number>(questionIndex);
  const [isFocused, setIsFocused] = useState(false);
  const disabledMenuButtons = ["MULTIPLE_CORRECT", "UPLOAD"]; // These question types are disabled in the dropdown menu
  const { questionStates, setShowWordCountInput, setCountMode } =
    useQuestionStore();

  // Manage word count input visibility and mode (character or word count)
  const showWordCountInput =
    questionStates[questionId]?.showWordCountInput || false;
  const countMode = questionStates[questionId]?.countMode || "CHARACTER";

  // State to manage question scoring criteria and points
  const [questionCriteria, setQuestionCriteria] = useState({
    id: question.scoring?.criteria?.map((c) => c.id) || [2, 1],
    points: question.scoring?.criteria?.map((c) => c.points) || [1, 0],
    criteriaDesc: question.scoring?.criteria?.map((c) => c.description) || [
      "Student must show their work and state the correct answer",
      "By default, learners will be given 0 points if they do not meet any of the criteria.",
    ],
    criteriaIds: question.scoring?.criteria?.map(
      (c, index) => c.id || index + 1,
    ) || [1, 2],
  });

  const [questionMaxPoints, setQuestionMaxPoints] = useState<number>(
    question.totalPoints || 1,
  );
  const [questionType, setQuestionType] = useState<QuestionType>(question.type);
  const [inputValue, setInputValue] = useState<string>(
    questionIndex.toString(),
  );
  const [maxWordCount, setMaxWordCount] = useState<number>(
    question.maxWords || null,
  );
  const [maxCharacters, setmaxCharacters] = useState<number>(
    question.maxCharacters || null,
  );

  // Set initial question max points based on criteria if applicable
  useEffect(() => {
    if (
      (question.type === "TEXT" || question.type === "URL") &&
      question.scoring?.type === "CRITERIA_BASED" &&
      question.scoring?.criteria &&
      question.scoring.criteria.length > 0
    ) {
      setQuestionMaxPoints(question.scoring.criteria.at(0).points);
    } else {
      setQuestionMaxPoints(question.totalPoints);
    }
  }, []);

  // Apply the checkQuestionToggle effect whenever the questionType changes
  useEffect(() => {
    // checkQuestionToggle;
    if (!collapse || isFocusedQuestion) {
      setToggleQuestion(true);
    }
  }, [collapse, isFocusedQuestion]);

  // Handles updating the state of the question, reflecting changes to its properties
  const handleUpdateQuestionState = useCallback(
    (params: UpdateQuestionStateParams) => {
      const updatedQuestion = {
        id: questionId,
        totalPoints:
          params.questionCriteria?.points !== undefined
            ? params.questionCriteria.points[0]
            : questionMaxPoints,
        question:
          params.questionTitle !== undefined
            ? params.questionTitle
            : questionTitle,
        type:
          params.questionType !== undefined
            ? params.questionType
            : questionType,
        maxWords:
          params.maxWordCount !== undefined
            ? params.maxWordCount
            : maxWordCount,
        maxCharacters:
          params.maxCharacters !== undefined
            ? params.maxCharacters
            : maxCharacters,
        scoring: {
          type: "CRITERIA_BASED" as const,
          criteria:
            params.questionCriteria !== undefined
              ? params.questionCriteria.criteriaDesc.map((criteria, index) => {
                  return {
                    id: params.questionCriteria.criteriaIds[index],
                    description: criteria,
                    points: params.questionCriteria.points[index],
                  };
                })
              : questionCriteria.criteriaDesc.map((criteria, index) => {
                  return {
                    id: questionCriteria.criteriaIds[index],
                    description: criteria,
                    points: questionCriteria.points[index],
                  };
                }),
        },
      };
      useAuthorStore.getState().modifyQuestion(questionId, updatedQuestion);
      if (params.questionCriteria !== undefined) {
        const questionOrder = useAuthorStore
          .getState()
          .questions.map((q) => q.id);
        useAuthorStore.getState().setQuestionOrder(questionOrder);
      }
    },
    [
      questionTitle,
      questionType,
      questionCriteria,
      maxWordCount,
      maxCharacters,
    ],
  );

  // Handle changes to the question index
  const handleIndexChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setInputValue(value);
  };

  // Handle key press events, particularly the "Enter" key
  const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      handleIndexBlur();
    }
  };

  // Handle the reset of character or word counters based on the mode
  const handleResetCounters = (mode: "CHARACTER" | "WORD") => {
    if (mode === "CHARACTER") {
      setMaxWordCount(null);
      handleUpdateQuestionState({
        maxCharacters: maxCharacters || 1000,
        maxWordCount: null,
      });
    }
    if (mode === "WORD") {
      setmaxCharacters(null);
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

  // Memoized list of question types for rendering in the dropdown
  const questionTypes = useMemo(
    () => [
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
        value: "MULTIPLE_CORRECT",
        label: "Multiple Choice",
        icon: <MultipleChoiceSVG className="w-5 h-5  stroke-gray-500" />,
      },
      {
        value: "UPLOAD",
        label: "Repo Upload",
        icon: <ArrowUpTrayIcon className="w-5 h-5 stroke-gray-500" />,
      },
    ],
    [],
  );

  return (
    <div className="flex flex-col items-center justify-between rounded-lg bg-white w-full gap-y-6">
      {/* First row containing the question index input and dropdown menu */}
      <div className="flex gap-2 flex-wrap w-full">
        <div className="flex items-center gap-x-2 flex-1">
          <div className="items-center w-11 h-full typography-body text-gray-500 border border-gray-200 rounded-md text-center shadow-sm">
            <input
              type="text"
              min={1}
              max={useAuthorStore.getState().questions.length}
              value={inputValue}
              onChange={handleIndexChange}
              onBlur={handleIndexBlur}
              onKeyPress={handleKeyPress}
              className="w-full h-full text-center p-0 m-0 border-none bg-transparent focus:outline-none focus:ring-0"
            />
          </div>

          {/* Dropdown menu for selecting question type */}
          <Menu as="div" className="relative inline-block text-left">
            <div>
              <Menu.Button className="inline-flex justify-between items-center px-4 py-2 border border-gray-200 rounded-md bg-white text-gray-700 min-w-[208px] h-min body-typography shadow-sm gap-1.5 hover:bg-gray-100">
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
                <ChevronDownIcon
                  className="w-5 h-5 text-gray-500"
                  aria-hidden="true"
                />
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
              <Menu.Items className="absolute left-0 z-10 w-52 mt-1 origin-top-left bg-white divide-y divide-gray-100 rounded-md shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none">
                <div className="py-1">
                  {questionTypes.map((qt) => (
                    <Menu.Item key={qt.value}>
                      {({ active }) => (
                        <button
                          onClick={() => {
                            if (
                              qt.value === "MULTIPLE_CORRECT" ||
                              qt.value === "UPLOAD"
                            ) {
                              return;
                            }
                            setQuestionType(
                              qt.value as
                                | "TEXT"
                                | "URL"
                                | "MULTIPLE_CORRECT"
                                | "UPLOAD",
                            );
                            handleUpdateQuestionState({
                              questionType: qt.value as
                                | "TEXT"
                                | "URL"
                                | "MULTIPLE_CORRECT"
                                | "UPLOAD",
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
                            (qt.value === "MULTIPLE_CORRECT" ||
                              qt.value === "UPLOAD") &&
                            "cursor-not-allowed opacity-50"
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
        </div>

        {/* Word count and other controls */}
        <div className="flex items-center gap-4 flex-wrap">
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
                          setmaxCharacters(maxCharacters);
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
                          setmaxCharacters(null);
                          setMaxWordCount(null);
                        } else if (value > 10000) {
                          setmaxCharacters(10000);
                          setMaxWordCount(null);
                        } else {
                          setmaxCharacters(value);
                          setMaxWordCount(null);
                        }
                      }}
                      onBlur={() => {
                        handleUpdateQuestionState({
                          maxCharacters: maxCharacters,
                          maxWordCount: null,
                        });
                      }}
                      className={`w-16 h-8 text-left px-1 py-1 m-0 border-none ${isFocused ? "focused" : "not-focused"}`}
                      style={{
                        width: `${maxCharacters?.toString().length + 1}ch`,
                      }}
                    />
                    <button
                      className="items-center"
                      onClick={() => {
                        setShowWordCountInput(questionId, false);
                        setMaxWordCount(null);
                        setmaxCharacters(null);
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
                    <span className="text-gray-600 typography-body">
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
                          setmaxCharacters(null);
                        } else if (value > 10000) {
                          setMaxWordCount(10000);
                          setmaxCharacters(null);
                        } else {
                          setMaxWordCount(value);
                          setmaxCharacters(null);
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
                      className={`w-16 h-8 text-left px-1 py-1 m-0 border-none ${isFocused ? "focused" : "not-focused"}`}
                      style={{
                        width: `${isFocused ? maxWordCount?.toString().length + 2 : maxWordCount?.toString().length + 1}ch`,
                      }}
                    />
                    <button
                      onClick={() => {
                        setShowWordCountInput(questionId, false);
                        setMaxWordCount(null);
                        setmaxCharacters(null);
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
            ) : (
              <button
                className="text-gray-600 text-nowrap typography-body"
                onClick={() => {
                  setShowWordCountInput(questionId, true);
                  handleResetCounters("CHARACTER");
                }}
              >
                + Add character/word limit
              </button>
            )}
          </div>

          <div className="flex gap-2 align-middle">
            {/* Duplicate question button */}
            <button
              className="text-gray-500"
              onClick={() => {
                const questionData: QuestionAuthorStore = {
                  question: questionTitle,
                  totalPoints: Math.max(...questionCriteria.points),
                  type: questionType as
                    | "TEXT"
                    | "URL"
                    | "MULTIPLE_CORRECT"
                    | "UPLOAD",
                  maxWords: maxWordCount,
                  maxCharacters: maxCharacters,
                  index: questionIndex,
                  scoring: {
                    type: "CRITERIA_BASED",
                    criteria: questionCriteria.criteriaDesc.map(
                      (criteria, index) => {
                        return {
                          id: questionCriteria.criteriaIds[index],
                          description: criteria,
                          points: questionCriteria.points[index],
                        };
                      },
                    ),
                  },
                  id: 0,
                  assignmentId: 0,
                };
                try {
                  duplicateThisQuestion(questionData);
                } catch (error) {
                  toast.error("Failed to duplicate question");
                }
              }}
            >
              <DocumentDuplicateIcon width={20} height={20} />
            </button>
            {/* Delete question button */}
            <button
              className="text-gray-500"
              onClick={() => onDelete(question.id)}
            >
              <TrashIcon width={20} height={20} />
            </button>
          </div>
        </div>
      </div>
      {/* Render the QuestionWrapper component if the question is toggled open */}
      {toggleQuestion && (
        <QuestionWrapper
          questionId={question.id}
          questionTitle={questionTitle}
          setQuestionTitle={setQuestionTitle}
          questionType={questionType}
          setQuestionType={setQuestionType}
          questionCriteria={questionCriteria}
          setQuestionCriteria={setQuestionCriteria}
          handleUpdateQuestionState={handleUpdateQuestionState}
          questionIndex={questionIndex}
        />
      )}
    </div>
  );
};

export default Question;
