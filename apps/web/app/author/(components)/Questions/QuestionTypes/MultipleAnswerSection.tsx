import Tooltip from "@/components/Tooltip";
import WarningAlert from "@/components/WarningAlert";
import { Choice, QuestionAuthorStore } from "@/config/types";
import { generateRubric } from "@/lib/talkToBackend";
import { useAuthorStore, useQuestionStore } from "@/stores/author";
import {
  ChevronDownIcon,
  ChevronUpIcon,
  PencilIcon,
  PlusIcon,
  SparklesIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import React, { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

interface SectionProps {
  questionId: number;
  variantId?: number;
  preview?: boolean;
  questionTitle: string;
  questionFromParent: QuestionAuthorStore;
  addChoice: (questionId: number, choice: Choice, variantId?: number) => void;
  removeChoice: (
    questionId: number,
    choiceIndex: number,
    variantId?: number,
  ) => void;
  setChoices: (
    questionId: number,
    choices: Choice[],
    variantId?: number,
  ) => void;
  modifyChoice: (
    questionId: number,
    choiceIndex: number,
    updatedChoice: Partial<Choice>,
    variantId?: number,
  ) => void;
  variantMode: boolean;
}

function Section({
  questionId,
  variantId,
  preview,
  questionTitle,
  questionFromParent: question,
  addChoice,
  removeChoice,
  setChoices,
  modifyChoice,
  variantMode,
}: SectionProps) {
  const [setCriteriaMode] = useQuestionStore((state) => [
    state.setCriteriaMode,
  ]);
  const criteriaMode = useQuestionStore(
    (state) => state.questionStates[questionId]?.criteriaMode,
  );
  const [modalOpen, setModalOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const backspaceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const [backspaceCount, setBackspaceCount] = useState(0);

  const enterTimerRef = useRef<NodeJS.Timeout | null>(null);
  const [enterCount, setEnterCount] = useState(0);
  if (!question) return null;
  const { choices, type } = question;

  const [localChoices, setLocalChoices] = useState(
    choices?.map((choice) => choice?.choice ?? "") || [],
  );
  const [localFeedback, setLocalFeedback] = useState(
    choices?.map((choice) => choice?.feedback ?? "") || [],
  );
  const [localPoints, setLocalPoints] = useState(
    choices?.map((choice) => choice?.points?.toString() ?? "") || [],
  );

  const textAreaRefs = useRef<(HTMLTextAreaElement | null)[]>([]);
  const pointsTextAreaRefs = useRef<(HTMLTextAreaElement | null)[]>([]);
  const feedbackTextAreaRefs = useRef<(HTMLTextAreaElement | null)[]>([]);

  const resizeTextArea = (textArea: HTMLTextAreaElement | null) => {
    if (textArea) {
      textArea.style.height = "auto";
      textArea.style.height = `${textArea.scrollHeight}px`;
    }
  };

  useEffect(() => {
    textAreaRefs.current = textAreaRefs.current.slice(0, choices?.length || 0);
    pointsTextAreaRefs.current = pointsTextAreaRefs.current.slice(
      0,
      choices?.length || 0,
    );
    feedbackTextAreaRefs.current = feedbackTextAreaRefs.current.slice(
      0,
      choices?.length || 0,
    );

    textAreaRefs.current.forEach((ref) => {
      resizeTextArea(ref);
    });
    pointsTextAreaRefs.current.forEach((ref) => {
      resizeTextArea(ref);
    });
    feedbackTextAreaRefs.current.forEach((ref) => {
      resizeTextArea(ref);
    });
  }, [choices?.length]);

  useEffect(() => {
    setLocalChoices(choices?.map((choice) => choice?.choice ?? "") || []);
    setLocalFeedback(choices?.map((choice) => choice?.feedback ?? "") || []);
    setLocalPoints(
      choices?.map((choice) => choice?.points?.toString() ?? "") || [],
    );

    setTimeout(() => {
      textAreaRefs.current.forEach((ref) => {
        resizeTextArea(ref);
      });
      pointsTextAreaRefs.current.forEach((ref) => {
        resizeTextArea(ref);
      });
      feedbackTextAreaRefs.current.forEach((ref) => {
        resizeTextArea(ref);
      });
    }, 0);
  }, [choices]);

  const handleAddChoice = () => {
    addChoice(questionId, undefined, variantId);
  };

  const handleRemoveChoice = (choiceIndex: number) => {
    removeChoice(questionId, choiceIndex, variantId);
  };

  const handleChoiceChange = (
    choiceIndex: number,
    updatedChoice: Partial<Choice>,
  ) => {
    modifyChoice(questionId, choiceIndex, updatedChoice, variantId);
  };

  const handleSetChoices = (choices: Choice[]) => {
    setChoices(questionId, choices, variantId);
  };

  const handleChoiceToggle = (choiceIndex: number) => {
    if (type === "SINGLE_CORRECT") {
      const newCorrectStatus = !choices[choiceIndex].isCorrect;
      handleChoiceChange(choiceIndex, {
        isCorrect: newCorrectStatus,
        points: newCorrectStatus ? 1 : 0,
      });

      choices.forEach((_, index) => {
        if (index !== choiceIndex && choices[index].isCorrect) {
          handleChoiceChange(index, { isCorrect: false, points: 0 });
        }
      });
    } else if (type === "MULTIPLE_CORRECT") {
      const newCorrectStatus = !choices[choiceIndex].isCorrect;
      if (newCorrectStatus) {
        handleChoiceChange(choiceIndex, {
          isCorrect: newCorrectStatus,
          points:
            choices[choiceIndex].points > 0 ? choices[choiceIndex].points : 1,
        });
      } else {
        handleChoiceChange(choiceIndex, {
          isCorrect: newCorrectStatus,
          points:
            choices[choiceIndex].points < 0 ? choices[choiceIndex].points : -1,
        });
      }
    }
  };

  const handleKeyDown = (
    index: number,
    column: string,
    event: React.KeyboardEvent,
  ) => {
    if (event.key === "Enter") {
      if (event.shiftKey) {
        return;
      }

      event.preventDefault();

      if (enterTimerRef.current) {
        clearTimeout(enterTimerRef.current);
      }

      setEnterCount((prevCount) => prevCount + 1);

      enterTimerRef.current = setTimeout(() => {
        setEnterCount(0);
      }, 1000);

      if (enterCount === 1) {
        focusNextInput(index, column);
        setEnterCount(0);
      }
    } else if (event.key === "Backspace") {
      handleBackspacePress(index, event);

      setEnterCount(0);
      if (enterTimerRef.current) {
        clearTimeout(enterTimerRef.current);
      }
    } else {
      setEnterCount(0);
      if (enterTimerRef.current) {
        clearTimeout(enterTimerRef.current);
      }
    }
  };

  const handleBackspacePress = (
    choiceIndex: number,
    event: React.KeyboardEvent,
  ) => {
    const value = (
      event.currentTarget as HTMLTextAreaElement | HTMLInputElement
    ).value;

    if (event.key === "Backspace" && value === "") {
      if (backspaceTimerRef.current) {
        clearTimeout(backspaceTimerRef.current);
      }

      setBackspaceCount((prevCount) => prevCount + 1);

      backspaceTimerRef.current = setTimeout(() => {
        setBackspaceCount(0);
      }, 1000);

      if (backspaceCount === 1) {
        handleRemoveChoice(choiceIndex);

        setTimeout(() => {
          const prevChoiceInput = document.getElementById(
            `choice-${questionId}-${choiceIndex - 1}`,
          );
          if (prevChoiceInput) {
            prevChoiceInput.focus();
          }
        }, 100);
      }
    } else {
      setBackspaceCount(0);
    }
  };

  const focusNextInput = (index: number, column: string) => {
    const nextIndex = index + 1;
    if (nextIndex < choices.length) {
      setTimeout(() => {
        const nextInput = document.getElementById(
          `${column}-${questionId}-${nextIndex}`,
        );
        if (nextInput) {
          nextInput.focus();
        }
      }, 300);
    } else {
      handleAddChoice();
      setTimeout(() => {
        const newInput = document.getElementById(
          `${column}-${questionId}-${choices.length}`,
        );
        if (newInput) {
          newInput.focus();
        }
      }, 300);
    }
  };

  const fetchAiGenChoices = async (question: QuestionAuthorStore) => {
    setLoading(true);
    const assignmentId = useAuthorStore.getState().activeAssignmentId;
    try {
      const response = await generateRubric(question, assignmentId);
      if (response && Array.isArray(response)) {
        const parsedChoices = response.map((choice: Choice) => ({
          choice: choice.choice,
          isCorrect: choice.isCorrect,
          points: choice.points,
          feedback: choice.feedback,
        }));
        setChoices(questionId, parsedChoices, variantId);
        toast.success("Choices generated successfully!");
      } else {
        toast.error("No choices found in the generated response.");
      }
    } catch (error) {
      toast.error("Failed to generate choices. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const disableAddChoice = choices?.length >= 10 || preview;
  const handleAiClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    if (questionTitle?.trim() === "") {
      toast.error("Please enter a question title first.");
      return;
    }
    if (question.scoring?.criteria?.length > 0) {
      setModalOpen(true);
    } else {
      void fetchAiGenChoices(question);
    }
  };

  const handleConfirm = async () => {
    setModalOpen(false);
    if (questionTitle?.trim() === "") {
      toast.error("Please enter a question title first.");
      return;
    }

    setCriteriaMode(questionId, "AI_GEN");

    try {
      await fetchAiGenChoices(question);
    } catch (error) {
      toast.error("Failed to generate rubric. Please try again.");
    }
  };

  const handleCancel = () => {
    setModalOpen(false);
  };
  const handleManualChoices = () => {
    if (!choices) {
      if (type === "MULTIPLE_CORRECT") {
        setChoices(questionId, [
          { choice: "", isCorrect: true, points: 1 },
          { choice: "", isCorrect: false, points: -1 },
          { choice: "", isCorrect: false, points: -1 },
          { choice: "", isCorrect: false, points: -1 },
        ]);
      } else if (choices?.some((choice) => choice?.points === 0)) {
        const updatedChoices = choices?.map((choice) =>
          choice.points === 0 ? { ...choice, points: -1 } : choice,
        );
        setChoices(questionId, updatedChoices);
      } else if (type === "SINGLE_CORRECT") {
        setChoices(questionId, [
          { choice: "", isCorrect: true, points: 1 },
          { choice: "", isCorrect: false, points: 0 },
          { choice: "", isCorrect: false, points: 0 },
          { choice: "", isCorrect: false, points: 0 },
        ]);
      } else if (choices?.some((choice) => choice?.points === -1)) {
        const updatedChoices = choices?.map((choice) =>
          choice.points === -1 ? { ...choice, points: 0 } : choice,
        );
        setChoices(questionId, updatedChoices);
      }
    }
  };

  useEffect(() => {
    if (choices?.length > 0) {
      setCriteriaMode(questionId, "CUSTOM");
    }
  }, [choices]);

  return (
    <div className="w-full border rounded-lg overflow-hidden bg-white">
      <table className="min-w-full text-left border-collapse">
        <thead>
          <tr className="bg-white border-b">
            <th className="p-3 typography-body text-gray-600 border-r w-32">
              Options
            </th>
            <th className="p-3 typography-body text-gray-600 border-r w-32">
              Points
            </th>
            <th className="p-3 typography-body text-gray-600 border-r">
              Choices
            </th>
            <th className="p-3 typography-body text-gray-600 ">
              <div className="flex items-center justify-between">
                <span>Feedback</span>

                <div className="flex items-center">
                  {!preview && criteriaMode && (
                    <Tooltip
                      content="Generate choices with AI"
                      className="cursor-pointer"
                      distance={-10.5}
                      direction="x"
                      up={-1.8}
                    >
                      <div className="flex justify-end">
                        <button
                          className="text-gray-500 rounded-full hover:bg-gray-100 w-6 h-6 flex items-center justify-center"
                          onClick={handleAiClick}
                          disabled={loading}
                        >
                          <SparklesIcon className="w-4 h-4 stroke-violet-600 fill-violet-600" />
                        </button>
                      </div>
                    </Tooltip>
                  )}
                </div>
              </div>
            </th>
          </tr>
        </thead>

        {criteriaMode || choices?.length > 0 ? (
          <>
            <tbody>
              {choices?.map((choice, index) => (
                <tr
                  key={`row-${questionId}-${index}`}
                  id={`row-${questionId}-${index}`}
                  className="border-b"
                >
                  <td className={`p-3 border-r`}>
                    {loading ? (
                      <div className="animate-pulse bg-gray-200 h-5 w-full rounded"></div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <div className="flex flex-col items-center space-y-1">
                          <button
                            type="button"
                            onClick={() => {
                              if (index > 0) {
                                const updatedChoices = [...choices];
                                const temp = updatedChoices[index];
                                updatedChoices[index] =
                                  updatedChoices[index - 1];
                                updatedChoices[index - 1] = temp;
                                setChoices(questionId, updatedChoices);
                              }
                            }}
                            disabled={index === 0}
                            className="p-1 rounded-md bg-gray-100 hover:bg-gray-200 disabled:opacity-50"
                          >
                            <ChevronUpIcon className="h-4 w-4 text-gray-600" />
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              if (index < choices.length - 1) {
                                const updatedChoices = [...choices];
                                const temp = updatedChoices[index];
                                updatedChoices[index] =
                                  updatedChoices[index + 1];
                                updatedChoices[index + 1] = temp;
                                setChoices(questionId, updatedChoices);
                              }
                            }}
                            disabled={index === choices.length - 1}
                            className="p-1 rounded-md bg-gray-100 hover:bg-gray-200 disabled:opacity-50"
                          >
                            <ChevronDownIcon className="h-4 w-4 text-gray-600" />
                          </button>
                        </div>

                        {type === "SINGLE_CORRECT" ? (
                          <input
                            type="radio"
                            name={`correctChoice-${question.id ?? questionId}`}
                            checked={choice.isCorrect}
                            onChange={() => handleChoiceToggle(index)}
                            disabled={preview}
                            className="focus:ring-violet-500 text-violet-600"
                          />
                        ) : (
                          <input
                            type="checkbox"
                            checked={choice.isCorrect}
                            onChange={() => handleChoiceToggle(index)}
                            disabled={preview}
                            className="focus:ring-violet-500 text-violet-600"
                          />
                        )}
                      </div>
                    )}
                  </td>

                  <td className="p-3 border-r">
                    {loading ? (
                      <div className="animate-pulse bg-gray-200 h-5 w-full rounded"></div>
                    ) : (
                      <div className="flex items-center">
                        <textarea
                          ref={(el) => {
                            pointsTextAreaRefs.current[index] = el;
                          }}
                          id={`points-${questionId}-${index}`}
                          value={localPoints[index]}
                          onChange={(e) => {
                            const updatedPoints = [...localPoints];
                            updatedPoints[index] = e.target.value;
                            setLocalPoints(updatedPoints);
                            resizeTextArea(e.target);
                          }}
                          onBlur={() =>
                            handleChoiceChange(index, {
                              points: parseInt(localPoints[index], 10) || 0,
                            })
                          }
                          placeholder="Points"
                          className="w-full border-none bg-transparent placeholder-gray-400 text-gray-900 focus:outline-none resize-none overflow-hidden min-h-[24px]"
                          disabled={preview}
                          onKeyDown={(event) =>
                            handleKeyDown(index, "points", event)
                          }
                          rows={1}
                        />

                        <div className="flex flex-col items-center space-y-1">
                          <button
                            type="button"
                            onClick={() => {
                              const updatedPoints = [...localPoints];
                              updatedPoints[index] = (
                                parseInt(localPoints[index], 10) || 0
                              ).toString();
                              handleChoiceChange(index, {
                                points: parseInt(updatedPoints[index], 10) + 1,
                              });
                              setLocalPoints(updatedPoints);
                            }}
                            className="p-1 rounded-md bg-gray-100 hover:bg-gray-200 disabled:opacity-50"
                          >
                            <ChevronUpIcon className="h-4 w-4 text-gray-600" />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              const updatedPoints = [...localPoints];
                              updatedPoints[index] = (
                                parseInt(localPoints[index], 10) || 0
                              ).toString();
                              handleChoiceChange(index, {
                                points: parseInt(updatedPoints[index], 10) - 1,
                              });
                              setLocalPoints(updatedPoints);
                            }}
                            className="p-1 rounded-md bg-gray-100 hover:bg-gray-200 disabled:opacity-50"
                          >
                            <ChevronDownIcon className="h-4 w-4 text-gray-600" />
                          </button>
                        </div>
                      </div>
                    )}
                  </td>

                  <td className="p-3 border-r">
                    {loading ? (
                      <div className="animate-pulse bg-gray-200 h-5 w-full rounded"></div>
                    ) : (
                      <textarea
                        ref={(el) => {
                          textAreaRefs.current[index] = el;
                        }}
                        id={`choice-${questionId}-${index}`}
                        value={localChoices[index]}
                        onChange={(e) => {
                          const updatedChoices = [...localChoices];
                          updatedChoices[index] = e.target.value;
                          setLocalChoices(updatedChoices);
                          resizeTextArea(e.target);
                        }}
                        onBlur={() =>
                          handleChoiceChange(index, {
                            choice: localChoices[index],
                          })
                        }
                        placeholder="Enter a choice."
                        className="w-full border-none bg-transparent placeholder-gray-400 text-gray-900 focus:outline-none resize-none overflow-hidden min-h-[24px]"
                        disabled={preview}
                        onKeyDown={(event) =>
                          handleKeyDown(index, "choice", event)
                        }
                        rows={1}
                      />
                    )}
                  </td>
                  <td className="p-3">
                    {loading ? (
                      <div className="animate-pulse bg-gray-200 h-5 w-full rounded"></div>
                    ) : (
                      <div className="flex items-center gap-x-2">
                        <textarea
                          ref={(el) => {
                            feedbackTextAreaRefs.current[index] = el;
                          }}
                          id={`feedback-${questionId}-${index}`}
                          value={localFeedback[index]}
                          onChange={(e) => {
                            const updatedFeedback = [...localFeedback];
                            updatedFeedback[index] = e.target.value;
                            setLocalFeedback(updatedFeedback);
                            resizeTextArea(e.target);
                          }}
                          onBlur={() =>
                            handleChoiceChange(index, {
                              feedback: localFeedback[index],
                            })
                          }
                          placeholder="Provide feedback for this choice."
                          className="w-full border-none bg-transparent placeholder-gray-400 text-gray-900 focus:outline-none resize-none overflow-hidden min-h-[24px]"
                          disabled={preview}
                          onKeyDown={(event) =>
                            handleKeyDown(index, "feedback", event)
                          }
                          rows={1}
                        />

                        <button
                          type="button"
                          onClick={() => handleRemoveChoice(index)}
                          disabled={preview}
                        >
                          <XMarkIcon className="h-5 w-5 text-gray-400 hover:text-gray-600" />
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            {!preview && (
              <tfoot>
                <tr>
                  <td colSpan={4}>
                    <button
                      type="button"
                      disabled={disableAddChoice}
                      className="w-full text-left text-sm text-gray-600 p-3 hover:bg-gray-100 flex items-center"
                      onClick={handleAddChoice}
                    >
                      <PlusIcon className="h-4 w-4 mr-2 text-gray-500" />
                      Add Option
                    </button>
                  </td>
                </tr>
              </tfoot>
            )}
          </>
        ) : (
          <tbody>
            <tr className="border-b border-gray-200 w-full">
              <td colSpan={4} className="py-2 px-4 text-center">
                <div className="flex justify-center items-center gap-x-4">
                  {loading ? (
                    <div className="animate-pulse bg-gray-200 h-5 w-full rounded"></div>
                  ) : !preview ? (
                    <>
                      <button
                        className="text-gray-500"
                        onClick={handleAiClick}
                        disabled={loading}
                      >
                        <SparklesIcon className="w-4 h-4 inline-block mr-2 stroke-violet-600 fill-violet-600" />
                        Generate choices with AI
                      </button>
                      <span className="text-gray-500">OR</span>
                      <button
                        className="text-gray-500"
                        onClick={() => {
                          setCriteriaMode(questionId, "CUSTOM");
                          handleManualChoices();
                        }}
                        disabled={loading}
                      >
                        <PencilIcon className="w-4 h-4 inline-block mr-2 stroke-gray-500" />
                        Create choices from scratch
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
          </tbody>
        )}
      </table>
      <WarningAlert
        isOpen={modalOpen}
        onClose={handleCancel}
        onConfirm={handleConfirm}
        description="This will overwrite your current rubric. Are you sure you want to proceed?"
        confirmText="Confirm"
        cancelText="Cancel"
      />
    </div>
  );
}

export default Section;
