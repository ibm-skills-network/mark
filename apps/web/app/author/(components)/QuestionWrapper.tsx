"use client";

import type {
  CreateQuestionRequest,
  QuestionType,
  UpdateQuestionStateParams,
  QuestionTypeDropdown,
} from "@/config/types";
import { useAuthorStore, useQuestionStore } from "@/stores/author";
import MarkdownEditor from "@components/MarkDownEditor";
import {
  type ComponentPropsWithoutRef,
  useEffect,
  useRef,
  useState,
} from "react";
import React from "react";
import MarkdownViewer from "@/components/MarkdownViewer";
import { PlusIcon } from "@heroicons/react/24/outline";
import {
  ArrowDownIcon,
  PencilIcon,
  SparklesIcon,
} from "@heroicons/react/24/solid";
import { toast } from "sonner";
import { generateRubric } from "@/lib/talkToBackend";
import SparkleLottie from "@/app/animations/sparkleLottie";

// Props type definition for the QuestionWrapper component
interface TextBoxProps extends ComponentPropsWithoutRef<"div"> {
  questionId: number;
  questionTitle: string;
  setQuestionTitle: (questionTitle: string, questionId: number) => void;
  questionType: QuestionType;
  setQuestionType: (questionType: QuestionType) => void;
  questionCriteria: {
    points: number[];
    criteriaDesc: string[];
    criteriaIds: number[];
  };
  setQuestionCriteria: (questionCriteria: object) => void;
  handleUpdateQuestionState: (params: UpdateQuestionStateParams) => void;
  questionIndex: number;
}

// Main component function to manage question criteria and title
function QuestionWrapper(props: TextBoxProps) {
  const {
    questionId,
    questionTitle,
    questionCriteria,
    setQuestionCriteria,
    setQuestionTitle,
    handleUpdateQuestionState,
    questionIndex,
  } = props;

  // Zustand store hooks to manage state
  const toggleTitle = useQuestionStore(
    (state) => state.questionStates[questionId]?.toggleTitle,
  );
  const setToggleTitle = useQuestionStore((state) => state.setToggleTitle);
  const showCriteriaHeader = useQuestionStore(
    (state) => state.questionStates.showCriteriaHeader ?? true,
  );
  const setShowCriteriaHeader = useQuestionStore(
    (state) => state.setShowCriteriaHeader,
  );

  const maxPointsEver = 100000; // Maximum points allowed for a question in Mark
  const [questionTitle2, setQuestionTitle2] = useState(questionTitle);
  const titleRef = useRef<HTMLDivElement>(null);
  const criteriaMode = useQuestionStore(
    (state) => state.questionStates[questionId]?.criteriaMode,
  );
  const [loading, setLoading] = useState(false);
  const setCriteriaMode = useQuestionStore((state) => state.setCriteriaMode);

  // Effect to handle clicks outside the title input to toggle it off
  useEffect(() => {
    const handleOutsideClick = (event: MouseEvent) => {
      if (
        titleRef.current &&
        !titleRef.current.contains(event.target as Node)
      ) {
        setToggleTitle(questionId, false);
        const toggleTitle = false;
        handleQuestionTitleChange(questionTitle2, toggleTitle);
      }
    };
    document.addEventListener("mousedown", handleOutsideClick);
    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
    };
  }, [questionTitle2]);

  // Handle changes to the question title and update the store
  const handleQuestionTitleChange = (value: string, toggleTitle: boolean) => {
    if (toggleTitle === false) {
      setQuestionTitle(value, questionId);
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
  };

  // Handle blur event on criteria input to update the state
  const handleCriteriaBlur = () => {
    handleUpdateQuestionState({ questionCriteria });
  };

  // Add new criteria to the list
  const handleShiftCriteria = () => {
    const newPointArray = [...questionCriteria.points];
    const newCriteriaArray = [...questionCriteria.criteriaDesc];
    const newCriteriaIds = [...questionCriteria.criteriaIds];

    // Find the correct index to insert the new point
    let insertIndex = 0;
    for (let i = 0; i < newPointArray.length - 1; i++) {
      if (newPointArray[i] - newPointArray[i + 1] > 1) {
        insertIndex = i + 1;
        break;
      }
    }

    if (insertIndex > 0) {
      // If there's a gap, insert a point with value one less than the previous point
      newPointArray.splice(insertIndex, 0, newPointArray[insertIndex - 1] - 1);
      newCriteriaArray.splice(insertIndex, 0, "");
      newCriteriaIds.splice(insertIndex, 0, newCriteriaIds.length + 1);
    } else {
      // If no gap found, increase the first point by 1 and add the new criteria
      newPointArray[0] += 1;
      newPointArray.splice(1, 0, newPointArray[0] - 1);
      newCriteriaArray.splice(1, 0, "");
      newCriteriaIds.splice(1, 0, newCriteriaIds.length + 1);
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

      setQuestionCriteria((prev: CreateQuestionRequest) => ({
        ...prev,
        points: newPointArray,
      }));
    }
  };

  // Function to fetch rubric from the API
  const fetchRubric = async () => {
    const questions = [
      {
        id: questionId,
        questionText: questionTitle,
        questionType:
          useAuthorStore.getState().questions[questionIndex - 1].type,
      },
    ]; // adding question type to the request, -1 because questionIndex is 1-based
    const assignmentId = useAuthorStore.getState().activeAssignmentId;

    try {
      const response = await generateRubric(questions, assignmentId);
      const newPoints: number[] = [];
      const newCriteriaDesc: string[] = [];
      const newCriteriaIds: number[] = [];

      Object.keys(response).forEach((key) => {
        const rubricText = response[key] as string;
        // Split the rubric text by the special character "|"
        const pairs = rubricText
          .split("||")
          .map((pair) => pair.trim())
          .filter((pair) => pair);
        pairs.forEach((pair) => {
          // Split each pair by the first colon to separate point and description
          const [pointText, ...descriptionParts] = pair.split(":");
          const points = parseInt(pointText.replace("points", "").trim(), 10);
          const description = descriptionParts.join(":").trim();
          // Check that the points and description are valid before adding to arrays
          if (!isNaN(points) && description) {
            newPoints.push(points);
            newCriteriaDesc.push(description);
            newCriteriaIds.push(newCriteriaIds.length + 1);
          }
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
    } catch (error) {
      toast.error("Failed to generate rubric. Please try again.");
    }
  };

  const handleAiClick = async (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation(); // Prevent the click event from bubbling up to the parent0=
    if (questionTitle.trim() === "") {
      toast.error("Please enter a question title first.");
      return;
    }
    setCriteriaMode(questionId, "AI_GEN");
    try {
      setLoading(true);
      await fetchRubric();
      setLoading(false);
    } catch (error) {
      toast.error("Failed to generate rubric. Please try again.");
    }
  };

  useEffect(() => {
    if (questionCriteria.points.length > 0) {
      setCriteriaMode(questionId, "CUSTOM");
    }
  }, [questionCriteria.points]);

  return (
    <>
      {/* Markdown editor for the question title */}
      {toggleTitle ? (
        <div ref={titleRef} className="w-full">
          <MarkdownEditor
            className="title-placeholder placeholder-gray-500 w-full"
            value={questionTitle}
            setValue={(value) => {
              // Remove any <p><br></p> at the end of the string
              const cleanedValue = value
                .replace(/<p>\s*<br>\s*<\/p>$/g, "")
                .trim();
              setQuestionTitle2(cleanedValue);
            }}
            placeholder="Enter your question here..."
            onBlur={() => {
              setToggleTitle(questionId, false);
              const cleanedValue = questionTitle
                .replace(/<p>\s*<br>\s*<\/p>$/g, "")
                .trim();
              setQuestionTitle(cleanedValue, questionId);
            }}
          />
        </div>
      ) : (
        <div
          className="text-gray-500 cursor-pointer w-full"
          onClick={() => setToggleTitle(questionId, true)}
        >
          <MarkdownViewer
            className={`typography-body px-1 py-0.5 ${
              questionTitle.replace(/<\/?[^>]+(>|$)/g, "").trim() === ""
                ? "!text-gray-500"
                : "!text-black" // Regular text color
            }`}
          >
            {questionTitle.replace(/<\/?[^>]+(>|$)/g, "").trim() === ""
              ? "Enter question here"
              : questionTitle}
          </MarkdownViewer>

          <div className="border-b border-gray-200 w-full" />
        </div>
      )}

      {/* Criteria Header, displayed for the first question */}
      {showCriteriaHeader && questionIndex === 1 ? (
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

      {/* Criteria Table */}
      <div className="mx-auto min-w-full border rounded border-solid border-gray-200 overflow-hidden">
        <table className="min-w-full bg-white">
          <thead className="h-min">
            <tr className="border-b border-gray-200 w-full">
              <th className="py-2 px-4 text-left bg-gray-50 w-1/6 h-min border-r border-gray-200">
                <div className="flex flex-col">
                  <p className="typography-body text-gray-600">Points</p>
                </div>
              </th>
              <th className="py-2 px-4 text-left bg-gray-50 w-full h-min">
                <div className="flex justify-between">
                  <div className="flex flex-col">
                    <p className="typography-body text-gray-600">Criteria</p>
                  </div>
                  {/* gererating rubric button */}
                  {criteriaMode && (
                    <div className="flex justify-end">
                      <button
                        className="text-gray-500"
                        onClick={handleAiClick}
                        disabled={loading}
                      >
                        <SparklesIcon className="w-4 h-4 inline-block mr-2 stroke-violet-600 fill-violet-600" />
                      </button>
                    </div>
                  )}
                </div>
              </th>
            </tr>
            {criteriaMode && questionCriteria.points.length > 0 ? (
              questionCriteria.points.map((point, index) => (
                <React.Fragment key={index}>
                  <tr
                    key={index}
                    ref={(el) => {
                      rowsRef.current[index] = el;
                    }}
                    className={
                      index === questionCriteria.points.length - 1
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
                          value={questionCriteria.criteriaDesc[index] || ""}
                          onChange={(e) =>
                            handleCriteriaChange(index, e.target.value)
                          }
                          onBlur={handleCriteriaBlur}
                        />
                      )}
                      {/* Remove Criteria Button */}
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
                    </th>
                  </tr>
                  {index === questionCriteria.points.length - 1 && (
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
                  <div className="flex justify-center items-center gap-x-3">
                    {loading ? (
                      <>
                        <div className="animate-pulse bg-gray-200 h-5 w-1/2 rounded"></div>
                        <div className="animate-pulse bg-gray-200 h-5 w-1/2 rounded"></div>
                      </>
                    ) : (
                      <>
                        <button
                          className="text-gray-500"
                          onClick={handleAiClick}
                          disabled={loading}
                        >
                          <SparkleLottie />
                          <SparklesIcon className="w-4 h-4 inline-block mr-2 stroke-violet-600 fill-violet-600" />
                          Generate a rubric with Mark
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
                    )}
                  </div>
                </td>
              </tr>
            )}
          </thead>
        </table>
      </div>
    </>
  );
}

export default QuestionWrapper;
