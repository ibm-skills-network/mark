"use client";

import GripVertical from "@/components/svgs/GripVertical";
import MultipleChoiceSVG from "@/components/svgs/MC";
import type {
  CreateQuestionRequest,
  Criteria,
  QuestionAuthorStore,
} from "@/config/types";
import useBeforeUnload from "@/hooks/use-before-unload";
import { getAssignment } from "@/lib/talkToBackend";
import { generateTempQuestionId } from "@/lib/utils";
import { useAuthorStore } from "@/stores/author";
import {
  closestCenter,
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Menu, Transition } from "@headlessui/react";
import {
  ChevronDownIcon,
  ListBulletIcon,
  PencilIcon,
} from "@heroicons/react/20/solid";
import {
  ArrowUpTrayIcon,
  Bars3BottomLeftIcon,
  LinkIcon,
  TrashIcon,
} from "@heroicons/react/24/solid";
import { IconCheckbox, IconCircleCheck } from "@tabler/icons-react";
import { useRouter } from "next/navigation";
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FC,
} from "react";
import { toast } from "sonner";
import { FooterNavigation } from "../StepOne/FooterNavigation";
import Question from "./Question";

interface Props {
  assignmentId: number;
  defaultQuestionRetries: number;
}
interface Active {
  id: string | number;
}
interface Over {
  id: string | number;
}

const AuthorQuestionsPage: FC<Props> = ({
  assignmentId,
  defaultQuestionRetries,
}) => {
  const router = useRouter();
  useBeforeUnload(
    "Are you sure you want to leave this page? You will lose any unsaved changes.",
  ); // Prompt the user before leaving the page
  const [focusedQuestionId, setFocusedQuestionId] = useAuthorStore((state) => [
    state.focusedQuestionId,
    state.setFocusedQuestionId,
  ]);
  const [handleToggleTable, setHandleToggleTable] = useState(true); // State to toggle the table of contents
  const questions = useAuthorStore((state) => state.questions);
  const setQuestions = useAuthorStore((state) => state.setQuestions);
  const addQuestion = useAuthorStore((state) => state.addQuestion);
  const activeAssignmentId = useAuthorStore(
    (state) => state.activeAssignmentId,
  );
  const setActiveAssignmentId = useAuthorStore(
    (state) => state.setActiveAssignmentId,
  );
  const setName = useAuthorStore((state) => state.setName);
  const focusRef = useRef(focusedQuestionId); // Ref to store the focused question ID
  const [collapseAll, setCollapseAll] = useState(false); // State to collapse all questions
  const [activeId, setActiveId] = useState<number | null>(null); // State to store the active assignment ID
  const questionTypes = useMemo(
    () => [
      {
        value: "TEXT",
        label: "Text Response",
        icon: <Bars3BottomLeftIcon className="w-5 h-5 stroke-gray-500" />,
      },

      {
        value: "MULTIPLE_CORRECT",
        label: "Multiple Select",
        icon: <IconCheckbox className="w-5 h-5 mr-2" />,
      },
      {
        value: "SINGLE_CORRECT",
        label: "Multiple Choice",
        icon: <MultipleChoiceSVG className="w-5 h-5 mr-2 " />,
      },
      {
        value: "TRUE_FALSE",
        label: "True/False",
        icon: <IconCircleCheck className="w-5 h-5 mr-2" />,
      },
      {
        value: "URL",
        label: "URL Link",
        icon: <LinkIcon className="w-5 h-5  stroke-gray-500" />,
      },
      {
        value: "UPLOAD",
        label: "Repo Upload",
        icon: <ArrowUpTrayIcon className="w-5 h-5 stroke-gray-500" />,
      },
    ],
    [],
  );

  /**
   * Scrolls the page to the specified question element.
   *
   * @param questionId - The ID of the question element to scroll to.
   */
  const handleJumpToQuestion = useCallback((questionId: number) => {
    const element = document.getElementById(`item-${String(questionId)}`);
    if (!element) return;
    requestAnimationFrame(() => {
      element.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }, []);

  useEffect(() => {
    if (assignmentId !== activeAssignmentId) {
      const fetchAssignment = async () => {
        try {
          const assignment = await getAssignment(assignmentId);
          if (assignment) {
            setActiveAssignmentId(assignmentId);
            setName(assignment.name || "Untitled Assignment");
            const questions: QuestionAuthorStore[] = assignment.questions?.map(
              (question: QuestionAuthorStore, index: number) => {
                const criteriaWithId = question.scoring?.criteria
                  ?.map((criteria: Criteria, criteriaIndex: number) => ({
                    ...criteria,
                    index: criteriaIndex + 1,
                  }))
                  .sort((a, b) => b.points - a.points); // Sort criteria by points in descending order for existing assingments with criteria
                return {
                  ...question,
                  alreadyInBackend: true,
                  scoring: {
                    type: "CRITERIA_BASED",
                    criteria: criteriaWithId || [],
                  },
                  index: index + 1,
                };
              },
            );
            if (questions?.length > 0) {
              setQuestions(questions);
              setFocusedQuestionId(questions[0].id);
            }
          } else {
            toast.error("Failed to get assignment details");
            router.push("/");
          }
        } catch (error) {
          toast.error("Failed to get assignment details");
          router.push("/");
        }
      };
      void fetchAssignment();
    }
  }, [
    assignmentId,
    activeAssignmentId,
    setActiveAssignmentId,
    setName,
    setQuestions,
    router,
  ]);
  useEffect(() => {
    const currentQuestionOrder = useAuthorStore.getState().questionOrder;
    const newQuestionOrder = questions.map((q) => q.id);

    if (
      JSON.stringify(currentQuestionOrder) !== JSON.stringify(newQuestionOrder)
    ) {
      useAuthorStore.getState().setQuestionOrder(newQuestionOrder); // Only update if the order changes
    }
  }, [questions]);

  useEffect(() => {
    if (!focusedQuestionId && questions.length > 0) {
      setFocusedQuestionId(questions[0].id);
    }
  }, [focusedQuestionId, questions]);

  /**
   * Focuses on a specific question when the focusedQuestionId changes.
   */
  useEffect(() => {
    focusRef.current = focusedQuestionId;
    handleJumpToQuestion(focusedQuestionId);
  }, [focusedQuestionId, handleJumpToQuestion]);

  /**
   * Adds a text box question to the author questions page.
   *
   * @param type - The type of the question. Can be one of:
   *   - "TEXT"
   *   - "SINGLE_CORRECT"
   *   - "MULTIPLE_CORRECT"
   *   - "TRUE_FALSE"
   *   - "URL"
   *   - "UPLOAD"
   */
  const handleAddTextBox = (
    type:
      | "TEXT"
      | "SINGLE_CORRECT"
      | "MULTIPLE_CORRECT"
      | "TRUE_FALSE"
      | "URL"
      | "UPLOAD",
  ) => {
    const question: CreateQuestionRequest = {
      question: "",
      totalPoints: 1,
      numRetries: defaultQuestionRetries ?? 1,
      type: type,
      scoring: {
        type: "CRITERIA_BASED",
        criteria: [],
      },
    };
    const questionId = generateTempQuestionId();
    if (!questionId) {
      toast.error("Failed to add question");
      return;
    }
    addQuestion({
      ...question,
      question: "",
      id: questionId,
      choices:
        type === "MULTIPLE_CORRECT" || type === "SINGLE_CORRECT"
          ? [
              {
                choice: "",
                isCorrect: true,
                points: 1,
              },
              {
                choice: "",
                isCorrect: false,
                points: type === "SINGLE_CORRECT" ? 0 : -1,
              },
            ]
          : undefined,
      alreadyInBackend: false,
      assignmentId: assignmentId,
      numRetries: defaultQuestionRetries ?? 1,
      index: questions.length + 1,
    });
    setFocusedQuestionId(questionId);
    handleJumpToQuestion(questionId);
    toast.success("Question has been added!");
  };

  /**
   * Adds an empty typed question to the list of questions.
   *
   * @returns void
   */
  const handleAddEmptyQuestion = () => {
    const question: CreateQuestionRequest = {
      question: "",
      totalPoints: 1,
      numRetries: defaultQuestionRetries ?? 1,
      type: "EMPTY",
      scoring: {
        type: "CRITERIA_BASED",
        criteria: [],
      },
    };
    const questionId = generateTempQuestionId();
    if (!questionId) {
      toast.error("Failed to add question");
      return;
    }
    addQuestion({
      ...question,
      question: "",
      id: questionId,
      alreadyInBackend: false,
      assignmentId: assignmentId,
      numRetries: defaultQuestionRetries ?? -1,
      index: questions.length + 1, // Set the index for the new question
    });
    setFocusedQuestionId(questionId);
    toast.success("Question has been added!");
  };

  /**
   * Duplicates a question in the AuthorQuestionsPage.
   *
   * @param question - The question to be duplicated.
   */
  let queue = Promise.resolve(); // Queue to handle the duplication of questions to avoid race conditions

  const duplicateThisQuestion = (question: QuestionAuthorStore) => {
    queue = queue.then(() => {
      const questionId = generateTempQuestionId();
      if (!questionId) {
        toast.error("Failed to add question");
        return;
      }

      const newQuestion = {
        ...question,
        id: questionId,
        alreadyInBackend: false,
        assignmentId: assignmentId,
        choices: question.choices,
        answer: question.answer,
        scoring: question.scoring,
        numRetries: question.numRetries,
        index: Number(question.index) + 1, // Set the index for the new question
      };

      const questionIndex = Number(question.index);
      const updatedQuestions = [
        ...questions.slice(0, questionIndex),
        newQuestion,
        ...questions.slice(questionIndex),
      ];

      updatedQuestions.forEach((q, index) => {
        q.index = index + 1; // Re-index questions to ensure proper order
      });

      setQuestions(updatedQuestions);
      useAuthorStore
        .getState()
        .setQuestionOrder(updatedQuestions.map((q) => q.id));
      setFocusedQuestionId(questionId);
      toast.success("Question duplicated successfully!");
    });
  };

  const DragHandle = () => (
    // DragHandle component
    <GripVertical height={16} width={16} className="cursor-move" />
  );

  /**
   * Sets the focus on a specific question.
   *
   * @param questionId - The ID of the question to focus on.
   */
  const handleFocus = (questionId: number) => {
    focusRef.current = questionId;

    setFocusedQuestionId(questionId);
  };

  /**
   * Renders a sortable item for the AuthorQuestionsPage component.
   *
   * @param question - The question object.
   * @param questionIndex - The index of the question.
   * @returns The rendered sortable item.
   */
  const SortableItem = ({
    question,
    questionIndex,
  }: {
    question: QuestionAuthorStore;
    questionIndex: number;
  }) => {
    const {
      attributes,
      listeners,
      setNodeRef,
      transform,
      transition,
      isDragging,
    } = useSortable({ id: question.id });

    const style = {
      transform: CSS.Transform.toString(transform),
      transition,
      opacity: isDragging ? 0 : 1, // Hide the original item while dragging
    };

    return (
      <div
        ref={setNodeRef}
        style={style}
        className="col-span-4 md:col-start-3 md:col-end-11 gap-5 mb-8"
        id={`item-${question.id}`}
        {...attributes}
      >
        {/* This is wrapper around the question component */}
        <div
          className={`relative cursor-default transition-all flex items-center justify-between rounded-md bg-white py-6 px-8 group border border-gray-200 w-full ${
            focusedQuestionId === question.id
              ? "border-1 border-violet-600 shadow-md"
              : "shadow-sm"
          }`}
          onClick={() => handleFocus(question.id)}
        >
          <div className="absolute flex self-center max-w-8 w-8 px-2 left-0">
            <div
              className="opacity-0 group-hover:opacity-100 transition-all"
              {...listeners} // Attach the listeners only to the DragHandle
            >
              {/* DragHandle component */}
              <DragHandle />
            </div>
          </div>
          {/* Question component */}
          <Question
            question={question}
            onDelete={handleDelete}
            questionId={question.id}
            duplicateThisQuestion={duplicateThisQuestion}
            questionIndex={questionIndex + 1}
            collapse={collapseAll}
            isFocusedQuestion={focusedQuestionId === question.id}
          />
        </div>
      </div>
    );
  };

  const SortableList = ({
    questions,
  }: {
    questions: QuestionAuthorStore[];
  }) => {
    return (
      <SortableContext
        items={questions.map((question) => question.id)}
        strategy={verticalListSortingStrategy}
      >
        {/* SortableItem component responsible for rendering each question and making it draggable */}

        {questions.map((question, index) => (
          <SortableItem
            key={`item-${question.id}`}
            question={question}
            questionIndex={index}
          />
        ))}
      </SortableContext>
    );
  };

  /**
   * Handles the sorting of questions after dragging.
   *
   * @param active - The active question being sorted.
   * @param over - The question being sorted over.
   */
  const onSortEnd = ({ active, over }: { active: Active; over: Over }) => {
    setActiveId(null);
    if (active.id !== over.id) {
      const oldIndex = questions.findIndex((q) => q.id === active.id);
      const newIndex = questions.findIndex((q) => q.id === over.id);

      const updatedQuestions = arrayMove(questions, oldIndex, newIndex);
      updatedQuestions.forEach((q, index) => {
        q.index = index + 1; // Update the index of each question after sorting
      });

      setQuestions(updatedQuestions);
      useAuthorStore
        .getState()
        .setQuestionOrder(updatedQuestions.map((q) => q.id));
    }
  };
  const handleDragStart = ({ active }: { active: Active }) => {
    setActiveId(active.id as number);
  };

  /**
   * Deletes a question based on its ID.
   *
   * @param {number} questionId - The ID of the question to be deleted.
   */
  const handleDelete = (questionId: number) => {
    const question = questions.find((q) => q.id === questionId);
    if (!question) return;
    const updatedQuestions = questions.filter((q) => q.id !== questionId);
    updatedQuestions.forEach((q, index) => {
      q.index = index + 1;
    });
    setQuestions(updatedQuestions);
    toast.success("Question has been deleted!");
  };

  return (
    <DndContext
      sensors={useSensors(useSensor(PointerSensor))}
      collisionDetection={closestCenter}
      onDragEnd={onSortEnd}
      onDragStart={handleDragStart}
    >
      <div className="grid grid-cols-4 gap-x-4 mx-6 md:grid-cols-12 md:mx-8 md:gap-x-6 mt-8">
        {questions.length > 0 && (
          <>
            {/* NavigationBox component */}
            <div className="col-span-2 md:col-span-2 lg:col-span-2 md:col-start-1 md:col-end-3 hidden lg:block text-nowrap">
              <NavigationBox
                setQuestions={setQuestions}
                questions={questions}
                focusedQuestionId={focusedQuestionId}
                handleToggleTable={handleToggleTable}
                setHandleToggleTable={setHandleToggleTable}
                onSelectQuestion={(index) => {
                  setFocusedQuestionId(questions[index].id);
                  handleJumpToQuestion(questions[index].id);
                }}
              />
            </div>
          </>
        )}
        <div className="col-span-8 md:col-span-8 md:col-start-3 md:col-end-11">
          {questions.length > 0 ? (
            <>
              {/* If there are questions, render the SortableList component, all the question components renders here */}
              <SortableList questions={questions} />
              <DragOverlay>
                {activeId ? (
                  <SortableItem
                    question={questions.find((q) => q.id === activeId)}
                    questionIndex={questions.findIndex(
                      (q) => q.id === activeId,
                    )}
                  />
                ) : null}
              </DragOverlay>
            </>
          ) : (
            <div className="col-span-4 md:col-start-5 md:col-end-8">
              {/* If there are no questions, render the empty state */}
              <p className="text-center text-gray-500 text-base leading-5 my-12">
                Begin writing the questions for your assignment below.
              </p>
            </div>
          )}
          <div className="mx-auto items-center justify-center mb-8 hover:no-underline typography-btn flex rounded-md shadow-sm hover:shadow-md transition-all focus:none disabled:opacity-50 disabled:cursor-not-allowed text-gray-600 bg-white w-fit whitespace-nowrap border-gray-200 border border-solid col-span-4 md:col-start-5 md:col-end-8 ">
            {/* Add Question button */}
            <button
              type="button"
              className="hover:no-underline text-gray-600 hover:text-gray-600 typography-btn px-4 py-2 border-r border-solid border-r-gray-200 border-l-0 border-t-0 border-b-0 focus:ring-offset-2 focus:ring-violet-600 focus:ring-2 focus:outline-none rounded-l-md focus:rounded-md bg-white hover:bg-gray-100 ring-offset-white "
              onClick={() => handleAddEmptyQuestion()}
            >
              Add Question
            </button>
            <Menu as="div" className="relative inline-block text-left">
              <Menu.Button className="text-gray-500 hover:text-gray-500 px-2 py-2.5 focus:ring-offset-2 focus:ring-violet-600 focus:ring-2 focus:outline-none rounded-r-md focus:rounded-md hover:bg-gray-100 leading-[0] ring-offset-white">
                <ChevronDownIcon width={20} height={20} />
              </Menu.Button>

              <Transition
                as={Fragment}
                enter="transition ease-out duration-100"
                enterFrom="transform opacity-0 scale-95"
                enterTo="transform opacity-100 scale-100"
                leave="transition ease-in duration-75"
                leaveFrom="transform opacity-100 scale-100"
                leaveTo="transform opacity-0 scale-95"
              >
                <Menu.Items className="absolute left-0 z-10 w-52 mt-1 origin-top-left bg-white divide-y divide-gray-100 rounded-md shadow-sm hover:shadow-md transition-all ring-1 ring-black ring-opacity-5 focus:outline-none">
                  <div className="py-1">
                    {questionTypes.map((qt) => (
                      <Menu.Item key={qt.value}>
                        {({ active }) => (
                          <button
                            onClick={() =>
                              handleAddTextBox(
                                qt.value as
                                  | "TEXT"
                                  | "SINGLE_CORRECT"
                                  | "MULTIPLE_CORRECT"
                                  | "TRUE_FALSE"
                                  | "URL"
                                  | "UPLOAD",
                              )
                            }
                            disabled={qt.value === "UPLOAD"}
                            className={`${
                              active
                                ? "bg-gray-100 text-gray-600"
                                : "text-gray-600"
                            } group flex items-center w-full py-2 px-4 gap-1.5 typography-body ${
                              qt.value === "UPLOAD" &&
                              "cursor-not-allowed opacity-50"
                            }`}
                          >
                            <div className="size-5">{qt.icon}</div>
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
          <div className="col-span-2 md:col-span-2 lg:col-span-2 md:col-start-9 md:col-end-11 lg:col-start-9 lg:col-end-11 mb-8">
            <FooterNavigation nextStep="review" />
          </div>
        </div>
        {/* If there are questions, render the collapse all button */}
        {questions.length > 0 && (
          <div className="col-span-2 md:col-span-2 lg:col-span-2 md:col-start-11 md:col-end-13 lg:col-start-11 lg:col-end-13 hidden lg:block h-full row-start-1 text-nowrap">
            <div className="flex items-center sticky top-4">
              <button
                onClick={() => setCollapseAll(!collapseAll)}
                className="p-3 border border-gray-300 rounded-lg shadow-sm hover:shadow-md transition-all bg-white duration-300 ease-in-out"
              >
                {collapseAll ? "Expand All" : "Collapse All"}
              </button>
            </div>
          </div>
        )}
      </div>
    </DndContext>
  );
};

interface NavigationBoxProps {
  questions: QuestionAuthorStore[];
  onSelectQuestion: (index: number) => void;
  focusedQuestionId: number | null;
  handleToggleTable: boolean;
  setQuestions: (questions: QuestionAuthorStore[]) => void;
  setHandleToggleTable: (value: boolean) => void;
  isDeleting?: boolean;
}

interface SortableNavListProps {
  questions: QuestionAuthorStore[];
  onSelectQuestion: (index: number) => void;
  focusedQuestionId: number | null;
  handleToggleTable: boolean;
  setQuestions: (questions: QuestionAuthorStore[]) => void;
  handleCheckboxChange: (questionId: number) => void;
  selectedQuestions: number[];
  setHandleToggleTable: (value: boolean) => void;
  isDeleting?: boolean;
  tocRefs: React.MutableRefObject<(HTMLDivElement | null)[]>;
}
interface SortableNavItemProps {
  question: QuestionAuthorStore;
  index: number;
  questionIndex: number;
  onSelectQuestion: (index: number) => void;
  focusedQuestionId: number | null;
  isDeleting: boolean;
  handleCheckboxChange: (questionId: number) => void;
  selectedQuestions: number[];
  tocRefs: React.MutableRefObject<(HTMLDivElement | null)[]>;
}
const DragHandle = () => (
  <GripVertical height={16} width={16} className="cursor-move" />
);
const SortableNavItem = ({
  question,
  questionIndex,
  focusedQuestionId,
  isDeleting,
  handleCheckboxChange,
  selectedQuestions,
  tocRefs,
}: SortableNavItemProps) => {
  const { attributes, listeners, setNodeRef, transform, transition } =
    useSortable({ id: question.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={(el: HTMLDivElement | null) => {
        if (el) {
          setNodeRef(el);
          tocRefs.current[questionIndex] = el;
        }
      }}
      style={style}
      key={question?.id}
      id={`toc-${question?.id}`}
      className={` truncate py-2 text-gray-600 hover:text-violet-600 typography-body transition-colors unselectable duration-300 ${
        focusedQuestionId === question.id ? "font-bold text-violet-800 " : ""
      }`}
      {...attributes}
    >
      <div className="flex items-center justify-between max-w-[calc(100%-0.4rem)]">
        <div className="flex items-center max-w-[calc(100%-1rem)]">
          <div {...listeners}>
            <DragHandle /> {/* DragHandle component */}
          </div>
          <span className="truncate block ml-2">
            {question.question.trim() === "" ||
            question.question.trim() === "<p></p>"
              ? `${questionIndex + 1}. Untitled`
              : `${questionIndex + 1}. ${question.question
                  .replace(/<\/?[^>]+(>|$)/g, "")
                  .trim()}`}
          </span>
        </div>
        {isDeleting && (
          <div className="flex items-center">
            <input
              type="checkbox"
              className="cursor-pointer rounded-sm text-violet-600 focus:ring-violet-600"
              checked={selectedQuestions.includes(question.id)}
              onChange={() => handleCheckboxChange(question.id)}
              onClick={(e) => e.stopPropagation()} // Prevents the question from being focused when clicking on the checkbox
            />
          </div>
        )}
      </div>
    </div>
  );
};

/**
 * SortableNavList component wraps the SortableNavItem component and renders a list of sortable questions. changes focus on click.
 *
 * @component
 * @param {SortableNavListProps} props - The component props.
 * @param {QuestionAuthorStore[]} props.questions - The list of questions.
 * @param {Function} props.onSelectQuestion - The function to handle question selection.
 * @param {number} props.focusedQuestionId - The ID of the focused question.
 * @param {boolean} props.isDeleting - Indicates if questions are being deleted.
 * @param {Function} props.handleCheckboxChange - The function to handle checkbox change.
 * @param {QuestionAuthorStore[]} props.selectedQuestions - The list of selected questions.
 * @param {any} props.tocRefs - The table of contents references.
 * @returns {JSX.Element} The rendered SortableNavList component.
 */
const SortableNavList = ({
  questions,
  onSelectQuestion,
  focusedQuestionId,
  isDeleting,
  handleCheckboxChange,
  selectedQuestions,
  tocRefs,
}: SortableNavListProps) => {
  return (
    <SortableContext
      items={questions.map((question) => question.id)}
      strategy={verticalListSortingStrategy}
    >
      {questions.map((question: QuestionAuthorStore, index: number) => (
        <div
          key={`nav-item-${question.id}`}
          onClick={() => onSelectQuestion(index)}
        >
          <SortableNavItem
            index={index}
            question={question}
            onSelectQuestion={onSelectQuestion}
            focusedQuestionId={focusedQuestionId}
            isDeleting={isDeleting}
            handleCheckboxChange={handleCheckboxChange}
            selectedQuestions={selectedQuestions}
            tocRefs={tocRefs}
            questionIndex={index}
          />
        </div>
      ))}
    </SortableContext>
  );
};

const NavigationBox: FC<NavigationBoxProps> = ({
  questions,
  onSelectQuestion,
  focusedQuestionId,
  handleToggleTable,
  setQuestions,
  setHandleToggleTable,
}) => {
  const [selectedQuestions, setSelectedQuestions] = useState<number[]>([]);
  const [isDeleting, setIsDeleting] = useState(false);
  const tocRefs = useRef<(HTMLDivElement | null)[]>([]);

  const handleCheckboxChange = (questionId: number) => {
    setSelectedQuestions((prevSelected: number[]) =>
      prevSelected.includes(questionId)
        ? prevSelected.filter((id: number) => id !== questionId)
        : [...prevSelected, questionId],
    );
  };

  const handleDeleteSelected = () => {
    if (selectedQuestions.length === 0) {
      setIsDeleting(false);
      return;
    }
    const deletedQuestionIds: number[] = [];

    for (const questionId of selectedQuestions) {
      const question = questions.find((q) => q.id === questionId);
      if (!question) continue;
      deletedQuestionIds.push(questionId);
    }

    const updatedQuestions = questions.filter(
      (q) => !deletedQuestionIds.includes(q.id),
    );
    updatedQuestions.forEach((q, index) => {
      q.index = index + 1;
    });

    setQuestions(updatedQuestions);
    toast.success("Questions have been deleted!");

    setSelectedQuestions([]);
    setIsDeleting(false);
  };

  const handleNavSortEnd = ({
    active,
    over,
  }: {
    active: Active;
    over: Over;
  }) => {
    if (active.id !== over.id) {
      const oldIndex = questions.findIndex((q) => q.id === active.id);
      const newIndex = questions.findIndex((q) => q.id === over.id);

      const updatedQuestions = arrayMove(questions, oldIndex, newIndex);
      updatedQuestions.forEach((q, index) => {
        q.index = index + 1;
      });
      setQuestions(updatedQuestions);
      useAuthorStore
        .getState()
        .setQuestionOrder(updatedQuestions.map((q) => q.id));
    }
  };

  return (
    <DndContext
      sensors={useSensors(useSensor(PointerSensor))}
      collisionDetection={closestCenter}
      onDragEnd={handleNavSortEnd}
    >
      <div
        className={`sticky overflow-y-auto top-4 p-3 border border-gray-200 rounded-lg shadow-sm hover:shadow-md transition-all bg-white overflow-hidden duration-300 ease-in-out ${
          handleToggleTable ? "w-full max-h-[700px]" : "w-12"
        }`}
      >
        <button
          onClick={() => setHandleToggleTable(!handleToggleTable)}
          className="flex items-center justify-between text-gray-600 hover:text-violet-700 transition-colors duration-300"
        >
          <ListBulletIcon className="w-5 h-5 text-gray-500" />
        </button>
        {handleToggleTable && (
          <div className="absolute top-3.5 right-3 flex items-center gap-2">
            {isDeleting ? (
              <>
                <button
                  onClick={() => {
                    if (selectedQuestions.length === questions.length) {
                      setSelectedQuestions([]);
                    }
                    setSelectedQuestions(
                      selectedQuestions.length === questions.length
                        ? []
                        : questions.map((q) => q.id),
                    );
                  }}
                  className="text-gray-500 hover:text-violet-600 transition-colors duration-300"
                >
                  Select All
                </button>

                {selectedQuestions.length > 0 ? (
                  <button
                    onClick={handleDeleteSelected}
                    className="text-red-500 transition-colors duration-300"
                  >
                    <TrashIcon className="w-5 h-5" />
                  </button>
                ) : (
                  <button
                    onClick={() => setIsDeleting(false)}
                    className="text-gray-500 transition-colors duration-300"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className="h-5 w-5 text-gray-500 hover:text-red-500"
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
                )}
              </>
            ) : (
              <button
                onClick={() => setIsDeleting(true)}
                className="text-gray-500 hover:text-red-500 transition-colors duration-300"
              >
                <PencilIcon className="w-5 h-5" />
              </button>
            )}
          </div>
        )}
        <div
          className={`transition-max-h duration-300 text-left ease-in-out ${
            handleToggleTable
              ? "max-h-[calc(100vh-8rem)] overflow-y-auto mt-2"
              : "max-h-0 overflow-hidden"
          }`}
        >
          <SortableNavList
            questions={questions}
            onSelectQuestion={onSelectQuestion}
            focusedQuestionId={focusedQuestionId}
            isDeleting={isDeleting}
            handleCheckboxChange={handleCheckboxChange}
            selectedQuestions={selectedQuestions}
            handleToggleTable={false}
            setQuestions={setQuestions}
            setHandleToggleTable={setHandleToggleTable}
            tocRefs={tocRefs}
          />
        </div>
      </div>
    </DndContext>
  );
};

export default AuthorQuestionsPage;
