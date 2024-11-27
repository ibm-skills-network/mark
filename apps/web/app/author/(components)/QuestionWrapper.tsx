"use client";

import SparkleLottie from "@/app/animations/sparkleLottie";
import MarkdownViewer from "@/components/MarkdownViewer";
import Tooltip from "@/components/Tooltip";
import type {
  Choice,
  CreateQuestionRequest,
  QuestionAuthorStore,
  QuestionType,
  QuestionTypeDropdown,
  UpdateQuestionStateParams,
  ResponseType,
  Criteria,
} from "@/config/types";
import { generateRubric } from "@/lib/talkToBackend";
import { useAuthorStore, useQuestionStore } from "@/stores/author";
import MarkdownEditor from "@components/MarkDownEditor";
import { PlusIcon } from "@heroicons/react/24/outline";
import {
  ArrowDownIcon,
  PencilIcon,
  SparklesIcon,
} from "@heroicons/react/24/solid";
import React, {
  FC,
  useEffect,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
} from "react";
import { toast } from "sonner";
import MultipleAnswerSection from "./Questions/QuestionTypes/MultipleAnswerSection";
import WarningAlert from "@/components/WarningAlert";

// Props type definition for the QuestionWrapper component
interface QuestionWrapperProps extends ComponentPropsWithoutRef<"div"> {
  questionId: number;
  questionTitle: string;
  setQuestionTitle: (questionTitle: string) => void;
  questionType: QuestionType;
  setQuestionType: (questionType: QuestionType) => void;
  questionCriteria: {
    points: number[];
    criteriaDesc: string[];
    criteriaIds: number[];
  };
  setQuestionCriteria: (questionCriteria: {
    points: number[];
    criteriaDesc: string[];
    criteriaIds: number[];
  }) => void;
  handleUpdateQuestionState: (params: UpdateQuestionStateParams) => void;
  questionIndex: number;
  preview: boolean;
  questionFromParent: QuestionAuthorStore;
  variantMode: boolean;
  responseType: ResponseType;
  variantId?: number;
}

// Main component function to manage question criteria and title
const QuestionWrapper: FC<QuestionWrapperProps> = ({
  questionId,
  questionTitle,
  setQuestionTitle,
  questionType,
  setQuestionType,
  questionCriteria,
  setQuestionCriteria,
  handleUpdateQuestionState,
  questionIndex,
  preview,
  questionFromParent,
  variantMode,
  variantId,
  responseType,
}) => {
  const [localQuestionTitle, setLocalQuestionTitle] =
    useState<string>(questionTitle);
  const titleRef = useRef<HTMLDivElement>(null);
  const { questionStates, setCriteriaMode } = useQuestionStore();
  const criteriaMode = questionStates[questionId]?.criteriaMode || "CUSTOM";
  const [loading, setLoading] = useState<boolean>(false);
  const addChoice = useAuthorStore((state) => state.addChoice);
  const removeChoice = useAuthorStore((state) => state.removeChoice);
  const setChoices = useAuthorStore((state) => state.setChoices);
  const modifyChoice = useAuthorStore((state) => state.modifyChoice);
  const [isModalOpen, setModalOpen] = useState(false);
  const handleUpdateAllVariantsCriteria = useAuthorStore(
    (state) => state.handleUpdateAllVariantsCriteria,
  );
  const addTrueFalseChoice = useAuthorStore(
    (state) => state.addTrueFalseChoice,
  );
  const updatePointsTrueFalse = useAuthorStore(
    (state) => state.updatePointsTrueFalse,
  );
  const isItTrueOrFalse = useAuthorStore((state) =>
    state.isItTrueOrFalse(questionId),
  );
  const TrueFalsePoints = useAuthorStore((state) =>
    state.getTrueFalsePoints(questionId),
  );

  // State for the local question
  const [localPoints, setLocalPoints] = useState<number>(TrueFalsePoints || 0);

  useEffect(() => {
    if (localPoints !== TrueFalsePoints) {
      setLocalPoints(TrueFalsePoints);
    }
  }, [TrueFalsePoints]);

  const handleSelectAnswer = (answer: boolean) => {
    addTrueFalseChoice(questionId, answer);
  };
  const getToggleTitle = useQuestionStore((state) => state.getToggleTitle);
  const setToggleTitle = useQuestionStore((state) => state.setToggleTitle);
  const showCriteriaHeader = useQuestionStore(
    (state) => state.questionStates.showCriteriaHeader ?? true,
  );
  const setShowCriteriaHeader = useQuestionStore(
    (state) => state.setShowCriteriaHeader,
  );
  const toggleTitle = getToggleTitle(
    questionId,
    variantMode ? variantId : undefined,
  );
  const toggleLoading = useQuestionStore((state) => state.toggleLoading);
  const maxPointsEver = 100000; // Maximum points allowed for a question in Mark
  // Effect to handle clicks outside the title input to toggle it off
  useEffect(() => {
    const handleOutsideClick = (event: MouseEvent) => {
      if (
        titleRef.current &&
        !titleRef.current.contains(event.target as Node)
      ) {
        setToggleTitle(questionId, false, variantMode ? variantId : undefined);
        const toggleTitle = false;
        handleQuestionTitleChange(localQuestionTitle, toggleTitle);
      }
    };
    document.addEventListener("mousedown", handleOutsideClick);
    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
    };
  }, [localQuestionTitle]);

  // Handle changes to the question title and update the store
  const handleQuestionTitleChange = (value: string, toggleTitle: boolean) => {
    if (toggleTitle === false) {
      setQuestionTitle(value);
      handleUpdateQuestionState({ questionTitle: value });
    }
  };

  // Handle criteria description changes
  const handleCriteriaChange = (index: number, value: string) => {
    const newCriteriaArray = [...questionCriteria.criteriaDesc];
    newCriteriaArray[index] = value;
    setQuestionCriteria({
      ...questionCriteria,
      criteriaDesc: newCriteriaArray,
    });
    // Update the store correctly
    handleUpdateQuestionState({
      questionCriteria: {
        ...questionCriteria,
        criteriaDesc: newCriteriaArray,
      },
    });
  };
  // Handle blur event on criteria input to update the state
  const handleCriteriaBlur = () => {
    setQuestionCriteria({
      ...questionCriteria,
      criteriaDesc: questionCriteria.criteriaDesc.map((desc) => desc?.trim()),
    });
    handleUpdateQuestionState({ questionCriteria });
  };

  const handleShiftCriteria = () => {
    const newPointArray = [...questionCriteria.points];
    const newCriteriaArray = [...questionCriteria.criteriaDesc];
    const newCriteriaIds = [...questionCriteria.criteriaIds];

    let hasGap = false;
    for (let i = 0; i < newPointArray.length - 1; i++) {
      if (newPointArray[i] - newPointArray[i + 1] > 1) {
        hasGap = true;
        break;
      }
    }

    if (hasGap) {
      let insertIndex = 0;
      for (let i = 0; i < newPointArray.length - 1; i++) {
        if (newPointArray[i] - newPointArray[i + 1] > 1) {
          insertIndex = i + 1;
          break;
        }
      }

      newPointArray.splice(insertIndex, 0, newPointArray[insertIndex - 1] - 1);
      newCriteriaArray.splice(insertIndex, 0, "");
      newCriteriaIds.splice(insertIndex, 0, newCriteriaIds.length + 1);
    } else {
      const newPoint = Math.max(...newPointArray) + 1;
      newPointArray.unshift(newPoint);
      newCriteriaArray.unshift("");
      newCriteriaIds.unshift(newCriteriaIds.length + 1);
    }

    setQuestionCriteria({
      points: newPointArray,
      criteriaDesc: newCriteriaArray,
      criteriaIds: newCriteriaIds,
    });

    handleUpdateQuestionState({
      questionCriteria: {
        points: newPointArray,
        criteriaDesc: newCriteriaArray,
        criteriaIds: newCriteriaIds,
      },
    });
  };

  // Remove criteria from the list
  const handleRemoveCriteria = (index: number) => {
    const newPointArray = [...questionCriteria.points];
    const newCriteriaArray = [...questionCriteria.criteriaDesc];
    const newCriteriaIds = [...questionCriteria.criteriaIds];
    newPointArray.splice(index, 1);
    newCriteriaArray.splice(index, 1);
    newCriteriaIds.splice(index, 1);

    const updatedCriteriaIds = newCriteriaIds.map((_, idx) => idx + 1);

    setQuestionCriteria({
      points: newPointArray,
      criteriaDesc: newCriteriaArray,
      criteriaIds: updatedCriteriaIds,
    });
    handleUpdateQuestionState({
      questionCriteria: {
        points: newPointArray,
        criteriaDesc: newCriteriaArray,
        criteriaIds: updatedCriteriaIds,
      },
    });
  };
  const isloading = useQuestionStore((state) => {
    if (variantMode) {
      return (
        state.questionStates[questionId]?.variants?.[variantId]?.isloading ||
        state.questionStates[questionId]?.isloading
      );
    } else {
      return state.questionStates[questionId]?.isloading;
    }
  });

  useEffect(() => {
    if (isloading) {
      setLoading(true);
    } else {
      setLoading(false);
    }
  }, [isloading]);

  // Manage swapping indices for animation during criteria sorting
  const [swappingIndices, setSwappingIndices] = useState<number[]>([]);
  const rowsRef = useRef<(HTMLTableRowElement | null)[]>([]);

  // Handle changes to points, sort criteria, and animate rows accordingly
  const handlePointsChange = (index: number, value: string) => {
    let parsedValue = parseInt(value, 10);

    if (isNaN(parsedValue) || parsedValue < 0 || parsedValue > maxPointsEver) {
      parsedValue = Math.min(Math.max(parsedValue, 0), maxPointsEver);
      if (parsedValue === maxPointsEver) {
        toast.error("Maximum points allowed is 100000");
      }
    }

    const newPointArray = [...questionCriteria.points];
    newPointArray[index] = parsedValue;

    const newCriteriaArray = [...questionCriteria.criteriaDesc];
    const newCriteriaIds = [...questionCriteria.criteriaIds];

    // Sort points and descriptions based on points in descending order
    const sortedIndices = newPointArray
      .map((value, idx) => ({ value, idx }))
      .sort((a, b) => b.value - a.value)
      .map(({ idx }) => idx);

    const fromIndex = index;
    const toIndex = sortedIndices.indexOf(index);

    if (toIndex !== fromIndex) {
      setSwappingIndices([fromIndex, toIndex]);

      // Apply transforms to animate the rows being swapped
      const fromRow = rowsRef.current[fromIndex];
      const toRow = rowsRef.current[toIndex];
      if (fromRow && toRow) {
        const fromRect = fromRow.getBoundingClientRect();
        const toRect = toRow.getBoundingClientRect();
        const fromHeight = fromRect.height;
        const toHeight = toRect.height;

        // Apply transforms to the rows being swapped
        fromRow.style.transform = `translateY(${toRect.top - fromRect.top}px)`;
        toRow.style.transform = `translateY(${fromRect.top - toRect.top}px)`;

        // Adjust rows in between the swap positions
        if (fromIndex < toIndex) {
          for (let i = fromIndex + 1; i <= toIndex; i++) {
            const row = rowsRef.current[i];
            if (row) {
              row.style.transform = `translateY(-${fromHeight}px)`;
            }
          }
        } else {
          for (let i = toIndex; i < fromIndex; i++) {
            const row = rowsRef.current[i];
            if (row) {
              row.style.transform = `translateY(${toHeight}px)`;
            }
          }
        }

        // Reset transforms after the animation
        setTimeout(() => {
          setQuestionCriteria({
            points: sortedIndices.map((i) => newPointArray[i]),
            criteriaDesc: sortedIndices.map((i) => newCriteriaArray[i]),
            criteriaIds: sortedIndices.map((i) => newCriteriaIds[i]),
          });
          handleUpdateQuestionState({
            questionCriteria: {
              points: sortedIndices.map((i) => newPointArray[i]),
              criteriaDesc: sortedIndices.map((i) => newCriteriaArray[i]),
              criteriaIds: sortedIndices.map((i) => newCriteriaIds[i]),
            },
          });

          // Reset all transforms
          rowsRef.current.forEach((row) => {
            if (row) row.style.transform = "";
          });
          setSwappingIndices([]);
        }, 300); // Duration of the CSS transition
      }
    } else {
      setQuestionCriteria({
        points: sortedIndices.map((i) => newPointArray[i]),
        criteriaDesc: sortedIndices.map((i) => newCriteriaArray[i]),
        criteriaIds: sortedIndices.map((i) => newCriteriaIds[i]),
      });
    }
  };

  // Handle input changes for points without sorting
  const handlePointsInputChange = (index: number, value: string) => {
    const parsedValue = parseInt(value, 10);
    if (!isNaN(parsedValue)) {
      const newPointArray = [...questionCriteria.points];
      newPointArray[index] = parsedValue;

      setQuestionCriteria({
        ...questionCriteria,
        points: newPointArray,
      });
    }
  };

  // Function to fetch rubric from the API
  const fetchRubric = async () => {
    const questions = [
      {
        id: questionId,
        questionText: questionTitle,
        questionType: questionType,
        responseType: responseType,
      },
    ];
    const assignmentId = useAuthorStore.getState().activeAssignmentId;

    try {
      const response = await generateRubric(
        questions,
        assignmentId,
        variantMode,
      );
      const newPoints: number[] = [];
      const newCriteriaDesc: string[] = [];
      const newCriteriaIds: number[] = [];
      Object.keys(response).forEach((key) => {
        const rubricItems = JSON.parse(response[key] as string) as {
          id: number;
          description: string;
          points: number;
        }[];
        Object.values(rubricItems).forEach((item) => {
          newPoints.push(item.points);
          newCriteriaDesc.push(item.description);
          newCriteriaIds.push(item.id);
        });
      });
      setQuestionCriteria({
        points: newPoints,
        criteriaDesc: newCriteriaDesc,
        criteriaIds: newCriteriaIds,
      });

      handleUpdateQuestionState({
        questionCriteria: {
          points: newPoints,
          criteriaDesc: newCriteriaDesc,
          criteriaIds: newCriteriaIds,
        },
      });
      if (!variantMode) {
        const criteria: Criteria[] = newCriteriaIds.map((id, index) => ({
          id,
          points: newPoints[index],
          description: newCriteriaDesc[index],
        }));
        handleUpdateAllVariantsCriteria(questionId, criteria);
      }
    } catch (error) {
      toast.error("Failed to generate rubric. Please try again.");
    }
  };

  const handleAiClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    if (questionCriteria && questionCriteria.points?.length > 0) {
      setModalOpen(true);
    } else {
      void handleConfirm();
    }
  };

  const handleConfirm = async () => {
    setModalOpen(false); // Close the modal

    if (questionTitle?.trim() === "") {
      toast.error("Please enter a question title first.");
      return;
    }

    setCriteriaMode(questionId, "AI_GEN");

    try {
      toggleLoading(questionId, true, variantMode ? variantId : undefined);
      await fetchRubric();
    } catch (error) {
      console.error("Failed to generate rubric:", error);
      toast.error("Failed to generate rubric. Please try again.");
    } finally {
      toggleLoading(questionId, false, variantMode ? variantId : undefined);
    }
  };

  const handleCancel = () => {
    setModalOpen(false); // Close the modal
  };
  useEffect(() => {
    if (questionCriteria.points?.length > 0 && criteriaMode !== "CUSTOM") {
      setCriteriaMode(questionId, "CUSTOM");
    }
  }, [questionCriteria.points, criteriaMode]);
  return (
    <div
      id={`question-title-${questionId}`}
      className="flex flex-col w-full gap-y-2"
    >
      {/* Markdown editor for the question title */}
      {toggleTitle && !preview ? (
        <div ref={titleRef} className="w-full">
          <MarkdownEditor
            className="title-placeholder placeholder-gray-500 w-full"
            value={localQuestionTitle}
            setValue={(value) => {
              setLocalQuestionTitle(value?.trim());
            }}
            placeholder="Enter your question here..."
            onBlur={() => {
              setToggleTitle(
                questionId,
                false,
                variantMode ? variantId : undefined,
              );
              setQuestionTitle(localQuestionTitle);
              handleUpdateQuestionState({ questionTitle: localQuestionTitle });
            }}
          />
        </div>
      ) : (
        <div
          className="text-gray-500 cursor-pointer w-full"
          onClick={() =>
            setToggleTitle(
              questionId,
              true,
              variantMode ? variantId : undefined,
            )
          }
        >
          <MarkdownViewer
            className={`typography-body px-1 py-0.5 ${
              localQuestionTitle?.trim() === ""
                ? "!text-gray-500"
                : "!text-black"
            }`}
          >
            {localQuestionTitle?.trim() === ""
              ? "Enter question here"
              : localQuestionTitle}
          </MarkdownViewer>
          <div className="border-b border-gray-200 w-full" />
        </div>
      )}

      {/* Criteria Header, displayed for the first question */}
      {showCriteriaHeader && questionIndex === 1 && !variantMode && !preview ? (
        <div className="flex justify-between bg-violet-100 rounded py-4 pl-5 pr-7">
          <div className="flex items-start h-full">
            <ArrowDownIcon className="stroke-violet-600 fill-violet-600 h-6 w-6 p-1" />
          </div>
          <p className="typography-body text-violet-800">
            Set up a rubric to define how this question should be graded. Mark
            will handle grading, saving you time. Learner will receive a grade
            and/or feedback at the end of the assignment based off of this
            rubric.
          </p>
          <div className="flex items-start h-full">
            <button
              className="text-gray-500"
              onClick={() => {
                setShowCriteriaHeader(false);
              }}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-5 w-5"
                fill="#7C3AED"
                viewBox="0 0 24 24"
                stroke="#7C3AED"
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
        </div>
      ) : null}
      {/* Render Criteria, Multiple Choice Section, or other components based on questionType */}
      {questionType === "MULTIPLE_CORRECT" ||
      questionType === "SINGLE_CORRECT" ? (
        <MultipleAnswerSection
          questionId={questionId}
          variantId={variantId}
          preview={preview}
          questionTitle={localQuestionTitle}
          questionFromParent={questionFromParent}
          addChoice={addChoice}
          removeChoice={removeChoice}
          setChoices={setChoices}
          modifyChoice={modifyChoice}
          variantMode={variantMode}
        />
      ) : questionType === "TRUE_FALSE" ? (
        <div className="flex justify-center items-center space-x-6 mt-6">
          {/* True Button */}
          <button
            type="button"
            disabled={preview}
            className={`px-6 py-3 rounded-lg text-lg font-semibold transition-colors duration-200 focus:outline-none focus:ring-2 ${
              isItTrueOrFalse === true
                ? "bg-violet-600 text-white border-violet-600 shadow-lg"
                : "bg-white text-gray-700 border border-gray-300 hover:bg-gray-100"
            }`}
            onClick={() => handleSelectAnswer(true)}
          >
            True
          </button>

          {/* False Button */}
          <button
            type="button"
            disabled={preview}
            className={`px-6 py-3 rounded-lg text-lg font-semibold transition-colors duration-200 focus:outline-none focus:ring-2 ${
              isItTrueOrFalse === false
                ? "bg-violet-600 text-white border-violet-600 shadow-lg"
                : "bg-white text-gray-700 border border-gray-300 hover:bg-gray-100"
            }`}
            onClick={() => handleSelectAnswer(false)}
          >
            False
          </button>

          {/* Point Input */}
          <div className="relative flex items-center">
            <input
              type="number"
              className={`text-center w-16 px-3 py-2 rounded-lg border text-gray-700 focus:outline-none focus:ring-2 focus:ring-violet-500 transition-all duration-200 `}
              value={localPoints}
              disabled={preview}
              onChange={(e) => setLocalPoints(parseInt(e.target.value, 10))}
              onBlur={() => updatePointsTrueFalse(questionId, localPoints)}
              style={{
                width: `${localPoints?.toString()?.length + 5}ch`,
              }}
            />
            <span className="ml-2 text-gray-600">pts</span>
          </div>
        </div>
      ) : (
        <>
          {/* Criteria Table */}
          <div className="mx-auto min-w-full border rounded border-solid border-gray-200 overflow-hidden">
            <table className="min-w-full bg-white">
              <thead className="h-min">
                <tr className="border-b border-gray-200 w-full">
                  <th className="py-2 px-4 text-left bg-white w-1/6 h-min border-r border-gray-200">
                    <div className="flex flex-col">
                      <p className="typography-body text-gray-600">Points</p>
                    </div>
                  </th>
                  <th className="py-2 px-4 text-left bg-white w-full h-min">
                    <div className="flex justify-between">
                      <div className="flex flex-col">
                        <p className="typography-body text-gray-600">
                          Criteria
                        </p>
                      </div>
                      {/* gererating rubric button */}
                      {criteriaMode && !preview && (
                        <Tooltip
                          content="Generate a rubric with AI"
                          className="cursor-pointer"
                          distance={-10.5}
                          direction="x"
                          up={-1.8}
                        >
                          <div className="flex justify-end">
                            <button
                              className="text-gray-500"
                              onClick={handleAiClick}
                              disabled={loading}
                            >
                              <SparklesIcon className="w-4 h-4 inline-block mr-2 stroke-violet-600 fill-violet-600" />
                            </button>
                          </div>
                        </Tooltip>
                      )}
                    </div>
                  </th>
                </tr>
                {criteriaMode && questionCriteria.points?.length > 0 ? (
                  questionCriteria.points.map((point, index) => (
                    <React.Fragment key={index}>
                      <tr
                        key={index}
                        ref={(el) => {
                          rowsRef.current[index] = el;
                        }}
                        className={
                          index === questionCriteria.points?.length - 1
                            ? ""
                            : "border-b"
                        }
                        style={{
                          transition: swappingIndices.includes(index)
                            ? "transform 0.3s ease"
                            : "none",
                        }}
                      >
                        <th className="py-2 px-4 text-left w-1/6 h-min border-r border-gray-200">
                          <div className="flex flex-col">
                            <input
                              type="number"
                              disabled={preview}
                              className="border-none w-full text-left focus:outline-none focus:ring-0 px-0 py-0 text-gray-600"
                              value={point}
                              min={0}
                              max={Math.max(...questionCriteria.points) + 1}
                              onChange={(e) =>
                                handlePointsInputChange(index, e.target.value)
                              }
                              onBlur={() =>
                                handlePointsChange(index, point.toString())
                              }
                              onKeyPress={(e) => {
                                if (e.key === "Enter") {
                                  handlePointsChange(index, point.toString());
                                }
                              }}
                            />
                          </div>
                        </th>
                        <th className="relative text-left typography-body size-4 w-full h-min py-2 pl-6 pr-10">
                          {loading ? (
                            <div className="animate-pulse bg-gray-200 h-5 w-full rounded"></div>
                          ) : (
                            <input
                              className="border-none resize-none h-5 placeholder-gray-500 focus:outline-none focus:ring-0 px-0 pr-2 py-0 w-full text-left"
                              placeholder="Click here to add criteria"
                              disabled={preview}
                              value={questionCriteria.criteriaDesc[index] || ""}
                              onChange={(e) =>
                                handleCriteriaChange(index, e.target.value)
                              }
                              onBlur={handleCriteriaBlur}
                            />
                          )}
                          {/* Remove Criteria Button */}
                          {preview ? null : (
                            <button
                              className="absolute top-1/2 transform -translate-y-1/2 right-4"
                              onClick={() => {
                                handleRemoveCriteria(index);
                              }}
                            >
                              <svg
                                xmlns="http://www.w3.org/2000/svg"
                                className="h-5 w-5 text-gray-500"
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
                        </th>
                      </tr>
                      {index === questionCriteria.points?.length - 1 &&
                        !preview && (
                          <tr className="border-t border-gray-200 w-full">
                            <td colSpan={2} className="py-2 px-4 text-left">
                              <div
                                className="text-gray-600 w-full flex items-center gap-x-1.5 text-left text-base full-width cursor-pointer"
                                onClick={handleShiftCriteria}
                              >
                                <PlusIcon className="w-4 h-4 inline-block mr-2 stroke-gray-500" />
                                <p className="text-gray-600 typography-body">
                                  Click to add new criteria.
                                </p>
                              </div>
                            </td>
                          </tr>
                        )}
                    </React.Fragment>
                  ))
                ) : (
                  <tr className="border-b border-gray-200 w-full">
                    <td colSpan={2} className="py-2 px-4 text-center">
                      <div className="flex justify-center items-center gap-x-4">
                        {loading ? (
                          <>
                            <div className="animate-pulse bg-gray-200 h-5 w-1/2 rounded"></div>
                            <div className="animate-pulse bg-gray-200 h-5 w-1/2 rounded"></div>
                          </>
                        ) : !preview ? (
                          <>
                            <button
                              className="text-gray-500"
                              onClick={handleAiClick}
                              disabled={loading}
                            >
                              <SparkleLottie />
                              <SparklesIcon className="w-4 h-4 inline-block mr-2 stroke-violet-600 fill-violet-600" />
                              Generate a rubric with AI
                            </button>
                            <span className="text-gray-500">OR</span>
                            <button
                              className="text-gray-500"
                              onClick={() => {
                                setCriteriaMode(questionId, "CUSTOM");
                                questionCriteria.points = [1, 0];
                                questionCriteria.criteriaDesc = ["", ""];
                                questionCriteria.criteriaIds = [1, 2];
                              }}
                              disabled={loading}
                            >
                              <PencilIcon className="w-4 h-4 inline-block mr-2 stroke-gray-500" />
                              Create a rubric from scratch
                            </button>
                          </>
                        ) : (
                          <p className="text-gray-500 typography-body">
                            No criteria set up yet.
                          </p>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
              </thead>
            </table>
          </div>
          <WarningAlert
            isOpen={isModalOpen}
            onClose={handleCancel}
            onConfirm={handleConfirm}
            description="This will overwrite your current rubric. Are you sure you want to proceed?"
            confirmText="Confirm"
            cancelText="Cancel"
          />
        </>
      )}
    </div>
  );
};

export default QuestionWrapper;
