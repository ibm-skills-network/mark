"use client";

import MarkdownViewer from "@/components/MarkdownViewer";
import WarningAlert from "@/components/WarningAlert";
import type {
  Choice,
  QuestionAuthorStore,
  QuestionType,
  ResponseType,
  UpdateQuestionStateParams,
} from "@/config/types";
import { expandMarkingRubric, generateRubric } from "@/lib/talkToBackend";
import { useAuthorStore, useQuestionStore } from "@/stores/author";
import MarkdownEditor from "@components/MarkDownEditor";
import { InformationCircleIcon } from "@heroicons/react/24/outline";
import React, {
  FC,
  useEffect,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
} from "react";
import { toast } from "sonner";
import MultipleAnswerSection from "../Questions/QuestionTypes/MultipleAnswerSection";
import RubricSwitcher from "./RubricSwitcher";
import Tooltip from "@/components/Tooltip";
import { cn } from "@/lib/strings";

interface CheckboxWithTooltipProps {
  id: string;
  name: string;
  label: string;
  tooltipText: string;
  defaultChecked?: boolean;
  checked?: boolean;
  onChange?: (checked: boolean) => void;
}

const CheckboxWithTooltip: FC<CheckboxWithTooltipProps> = ({
  id,
  name,
  label,
  tooltipText,
  defaultChecked = false,
  checked,
  onChange,
}) => (
  <div className="flex items-center gap-x-2">
    <input
      type="checkbox"
      id={id}
      name={name}
      checked={typeof checked !== "undefined" ? checked : defaultChecked}
      onChange={(e) => onChange && onChange(e.target.checked)}
      className="h-4 w-4 text-purple-600 border-gray-300 rounded"
    />
    <label htmlFor={id} className="font-medium">
      {label}
    </label>
    <div className="tooltip">
      <span className="tooltiptext">{tooltipText}</span>
      <InformationCircleIcon className="h-5 w-5 text-gray-500 hover:text-gray-700 cursor-pointer" />
    </div>
  </div>
);
interface TimeLimitInputWithTooltipProps {
  id: string;
  name: string;
  label: string;
  tooltipText: string;
  defaultValue?: number;
  /** Controlled value */
  value?: number;
  min?: number;
  max?: number;
  onChange?: (value: number) => void;
}

const TimeLimitInputWithTooltip: FC<TimeLimitInputWithTooltipProps> = ({
  id,
  name,
  label,
  tooltipText,
  defaultValue = 120,
  value,
  min = 1,
  max = 600,
  onChange,
}) => {
  const [internalValue, setInternalValue] = useState<string>(
    value !== undefined ? String(value) : String(defaultValue),
  );

  useEffect(() => {
    setInternalValue(
      value !== undefined ? String(value) : String(defaultValue),
    );
  }, [value, defaultValue]);

  return (
    <div className="flex items-center gap-x-2">
      <label htmlFor={id} className="font-medium">
        {label}
      </label>
      <input
        type="number"
        id={id}
        name={name}
        value={internalValue}
        min={min}
        max={max}
        onChange={(e) => {
          setInternalValue(e.target.value);
        }}
        onBlur={() => {
          const newValue = Number(internalValue);
          if (newValue > max) {
            setInternalValue(String(max));
            onChange && onChange(max);
          } else if (newValue < min) {
            setInternalValue(String(min));
            onChange && onChange(min);
          } else if (!isNaN(newValue)) {
            onChange && onChange(newValue);
          }
        }}
        className="h-8 w-18 text-violet-600 border-gray-300 rounded"
      />
      <div className="tooltip">
        <span className="tooltiptext">{tooltipText}</span>
        <InformationCircleIcon className="h-5 w-5 text-gray-500 hover:text-gray-700 cursor-pointer" />
      </div>
    </div>
  );
};

interface PresentationOptionsProps {
  showRubricsToLearner?: boolean;
  questionType: string;
  responseType: "PRESENTATION" | "LIVE_RECORDING" | string;
  question: QuestionAuthorStore;
  setEvaluateBodyLanguage: (questionId: number, checked: boolean) => void;
  setRealTimeAiCoach: (questionId: number, checked: boolean) => void;
  setEvaluateTimeManagement: (
    questionId: number,
    checked: boolean,
    responseType: string,
  ) => void;
  setTargetTime: (
    questionId: number,
    time: number,
    responseType: ResponseType,
  ) => void;
  setEvaluateSlidesQuality: (questionId: number, checked: boolean) => void;
}

const PresentationOptions: FC<PresentationOptionsProps> = ({
  questionType,
  responseType,
  question,
  setEvaluateBodyLanguage,
  setRealTimeAiCoach,
  setEvaluateTimeManagement,
  setTargetTime,
  setEvaluateSlidesQuality,
}) => {
  if (
    questionType !== "UPLOAD" ||
    (responseType !== "PRESENTATION" && responseType !== "LIVE_RECORDING")
  ) {
    return null;
  }
  const questionId = question.id;
  useEffect(() => {
    if (
      question?.liveRecordingConfig?.targetTime === undefined &&
      responseType === "LIVE_RECORDING"
    ) {
      setTargetTime(questionId, 120, "LIVE_RECORDING");
    }
    if (
      question?.videoPresentationConfig?.targetTime === undefined &&
      responseType === "PRESENTATION"
    ) {
      setTargetTime(questionId, 120, "PRESENTATION");
    }
  }, [responseType]);
  return (
    <>
      <hr className="mt-2 border-gray-200 w-full" />
      <h2 className="text-lg font-semibold px-2">Presentation Options</h2>
      <div className="flex flex-wrap items-center gap-x-8 px-2 mt-2">
        {responseType === "LIVE_RECORDING" && (
          <>
            <CheckboxWithTooltip
              id="bodyLanguage"
              name="bodyLanguage"
              label="Evaluate Body Language"
              tooltipText="Evaluate the presenter's body language, including posture, gestures, and eye contact."
              onChange={(checked) =>
                setEvaluateBodyLanguage(questionId, checked)
              }
              checked={question?.liveRecordingConfig?.evaluateBodyLanguage}
            />
            <CheckboxWithTooltip
              id="aiAssistance"
              name="aiAssistance"
              label="Real-Time AI Coaching"
              tooltipText="Provide real-time feedback and suggestions to the presenter based on AI analysis of their presentation delivery."
              onChange={(checked) => setRealTimeAiCoach(questionId, checked)}
              checked={question?.liveRecordingConfig?.realTimeAiCoach}
            />
          </>
        )}
        {responseType === "PRESENTATION" && (
          <CheckboxWithTooltip
            id="slideQuality"
            name="slideQuality"
            label="Evaluate Slide Quality & Visual Appeal"
            tooltipText="Assess the quality of the presentation slides, including visual appeal, clarity, and overall design."
            onChange={(checked) =>
              setEvaluateSlidesQuality(questionId, checked)
            }
            checked={question?.videoPresentationConfig?.evaluateSlidesQuality}
          />
        )}
        <CheckboxWithTooltip
          id="timeManagement"
          name="timeManagement"
          label="Evaluate Time Management"
          tooltipText="Evaluate the presenter's ability to manage time effectively and stay within the allotted time frame."
          onChange={(checked) =>
            setEvaluateTimeManagement(questionId, checked, responseType)
          }
          checked={
            responseType === "PRESENTATION"
              ? question?.videoPresentationConfig?.evaluateTimeManagement
              : question?.liveRecordingConfig?.evaluateTimeManagement
          }
        />
        <TimeLimitInputWithTooltip
          id="timeLimit"
          name="timeLimit"
          label="Time Limit (sec):"
          tooltipText="Set a time limit for the presentation."
          onChange={(value) => setTargetTime(questionId, value, responseType)}
          value={
            responseType === "PRESENTATION"
              ? question?.videoPresentationConfig?.targetTime
              : question?.liveRecordingConfig?.targetTime
          }
        />
      </div>
      <hr className="my-2 border-gray-200 w-full" />
    </>
  );
};

interface QuestionWrapperProps extends ComponentPropsWithoutRef<"div"> {
  showRubricsToLearner?: boolean;
  showPoints?: boolean;
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
  handleUpdateQuestionState: (
    params: UpdateQuestionStateParams,
    variantMode?: boolean,
  ) => void;
  questionIndex: number;
  preview: boolean;
  questionFromParent: QuestionAuthorStore;
  variantMode: boolean;
  responseType: ResponseType;
  variantId?: number;
}

const QuestionWrapper: FC<QuestionWrapperProps> = ({
  showRubricsToLearner,
  showPoints,
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
  const [inProgressRubricIndex, setInProgressRubricIndex] = useState<number>(0);
  const addOneRubric = useAuthorStore((state) => state.addOneRubric);
  const setQuestionScoring = useAuthorStore(
    (state) => state.setQuestionScoring,
  );
  const modifyQuestion = useAuthorStore((state) => state.modifyQuestion);
  const [swappingIndices, setSwappingIndices] = useState<number[]>([]);
  const rowsRef = useRef<(HTMLTableRowElement | null)[]>([]);
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
    state.isItTrueOrFalse(questionId, variantId),
  );
  const TrueFalsePoints = useAuthorStore((state) =>
    state.getTrueFalsePoints(questionId),
  );
  const [localPoints, setLocalPoints] = useState<number>(TrueFalsePoints || 1);
  useEffect(() => {
    if (localPoints !== TrueFalsePoints) {
      setLocalPoints(TrueFalsePoints);
    }
  }, [TrueFalsePoints]);
  const handleSelectAnswer = (answer: boolean) => {
    addTrueFalseChoice(questionId, answer, variantId);
  };
  const getToggleTitle = useQuestionStore((state) => state.getToggleTitle);
  const setToggleTitle = useQuestionStore((state) => state.setToggleTitle);
  const showCriteriaHeader = useQuestionStore(
    (state) => state.questionStates.showCriteriaHeader ?? true,
  );
  const editVariant = useAuthorStore((state) => state.editVariant);
  const setShowCriteriaHeader = useQuestionStore(
    (state) => state.setShowCriteriaHeader,
  );
  const toggleTitle = getToggleTitle(
    questionId,
    variantMode ? variantId : undefined,
  );
  const toggleLoading = useQuestionStore((state) => state.toggleLoading);
  const maxPointsEver = 100000;

  useEffect(() => {
    const handleOutsideClick = (event: MouseEvent) => {
      if (
        titleRef.current &&
        !titleRef.current.contains(event.target as Node)
      ) {
        setToggleTitle(questionId, false, variantMode ? variantId : undefined);
        handleQuestionTitleChange(localQuestionTitle, false);
      }
    };
    document.addEventListener("mousedown", handleOutsideClick);
    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
    };
  }, [localQuestionTitle]);

  const handleQuestionTitleChange = (value: string, toggle: boolean) => {
    if (!toggle) {
      setQuestionTitle(value);
      handleUpdateQuestionState({ questionTitle: value }, variantMode);
    }
  };
  const setEvaluateBodyLanguage = useAuthorStore(
    (state) => state.setEvaluateBodyLanguage,
  );
  const setRealTimeAiCoach = useAuthorStore(
    (state) => state.setRealTimeAiCoach,
  );
  const setEvaluateTimeManagement = useAuthorStore(
    (state) => state.setEvaluateTimeManagement,
  );
  const setTargetTime = useAuthorStore((state) => state.setTargetTime);
  const setEvaluateSlidesQuality = useAuthorStore(
    (state) => state.setEvaluateSlidesQuality,
  );

  const handleCriteriaChange = (
    rubricIndex: number,
    criteriaIndex: number,
    value: string,
  ) => {
    const rubrics = questionFromParent.scoring?.rubrics
      ? [...questionFromParent.scoring.rubrics]
      : [];

    if (!rubrics[rubricIndex]) {
      rubrics[rubricIndex] = { rubricQuestion: "", criteria: [] };
    }
    const newCriteriaArray = [...rubrics[rubricIndex].criteria];

    newCriteriaArray[criteriaIndex] = {
      ...newCriteriaArray[criteriaIndex],
      description: value,
    };
    rubrics[rubricIndex].criteria = newCriteriaArray;

    setQuestionScoring(
      questionId,
      {
        rubrics,
        type: "CRITERIA_BASED",
      },
      variantId,
    );
    handleUpdateQuestionState({ rubrics }, variantMode);
  };

  const handleCriteriaBlur = (rubricIndex: number) => {
    const rubrics = questionFromParent.scoring?.rubrics
      ? [...questionFromParent.scoring.rubrics]
      : [];
    if (rubrics[rubricIndex]) {
      rubrics[rubricIndex].criteria = rubrics[rubricIndex].criteria.map(
        (crit) => ({
          ...crit,
          description: crit.description.trim(),
        }),
      );
      setQuestionScoring(
        questionId,
        {
          rubrics,
          type: "CRITERIA_BASED",
        },
        variantId,
      );
      handleUpdateQuestionState({ rubrics }, variantMode);
    }
  };

  const handleShiftCriteria = (rubricIndex: number) => {
    const rubrics = questionFromParent.scoring?.rubrics
      ? [...questionFromParent.scoring.rubrics]
      : [];
    if (!rubrics[rubricIndex]) {
      rubrics[rubricIndex] = { rubricQuestion: "", criteria: [] };
    }
    if (rubrics[rubricIndex].criteria.length === 0) {
      rubrics[rubricIndex].criteria = [
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
      ];
    } else {
      rubrics[rubricIndex].criteria = [
        ...rubrics[rubricIndex].criteria,
        {
          id: rubrics[rubricIndex].criteria.length + 1,
          description: "",
          points: 0,
        },
      ];
    }
    setQuestionScoring(
      questionId,
      {
        rubrics,
        type: "CRITERIA_BASED",
      },
      variantId,
    );
    handleUpdateQuestionState({ rubrics }, variantMode);
  };

  const handleRemoveCriteria = (rubricIndex: number, criteriaIndex: number) => {
    const rubrics = questionFromParent.scoring?.rubrics
      ? [...questionFromParent.scoring.rubrics]
      : [];
    if (rubrics[rubricIndex]) {
      rubrics[rubricIndex].criteria = rubrics[rubricIndex].criteria.filter(
        (_, idx) => idx !== criteriaIndex,
      );

      rubrics[rubricIndex].criteria = rubrics[rubricIndex].criteria.map(
        (crit, idx) => ({
          ...crit,
          id: idx + 1,
        }),
      );
      setQuestionScoring(
        questionId,
        {
          rubrics,
          type: "CRITERIA_BASED",
        },
        variantId,
      );
      const totalPoints = rubrics.reduce(
        (total, rubric) =>
          total +
          Math.max(...rubric.criteria.map((crit) => crit.points || 0), 0),
        0,
      );
      handleUpdateQuestionState(
        { rubrics, totalPoints: totalPoints },
        variantMode,
      );
    }
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
    setLoading(isloading);
  }, [isloading]);

  const handlePointsChange = (
    rubricIndex: number,
    criteriaIndex: number,
    value: string,
  ) => {
    let parsedValue = parseInt(value, 10);
    if (isNaN(parsedValue) || parsedValue < 0 || parsedValue > maxPointsEver) {
      parsedValue = Math.min(Math.max(parsedValue, 0), maxPointsEver);
      if (parsedValue === maxPointsEver) {
        toast.error("Maximum points allowed is 100000");
      }
    }

    const rubrics = questionFromParent.scoring?.rubrics
      ? [...questionFromParent.scoring.rubrics]
      : [];
    if (!rubrics[rubricIndex]) {
      rubrics[rubricIndex] = { rubricQuestion: "", criteria: [] };
    }
    const newCriteriaArray = [...rubrics[rubricIndex].criteria];
    newCriteriaArray[criteriaIndex] = {
      ...newCriteriaArray[criteriaIndex],
      points: parsedValue,
    };

    const pointsArray = newCriteriaArray.map((crit) => crit.points);

    const sortedIndices = pointsArray
      .map((val, idx) => ({ val, idx }))
      .sort((a, b) => b.val - a.val)
      .map(({ idx }) => idx);

    const fromIndex = criteriaIndex;
    const toIndex = sortedIndices.indexOf(criteriaIndex);

    if (toIndex !== fromIndex) {
      setSwappingIndices([fromIndex, toIndex]);

      const fromRow = rowsRef.current[fromIndex];
      const toRow = rowsRef.current[toIndex];

      if (fromRow && toRow) {
        const fromRect = fromRow.getBoundingClientRect();
        const toRect = toRow.getBoundingClientRect();
        const fromHeight = fromRect.height;
        const toHeight = toRect.height;

        fromRow.style.transform = `translateY(${toRect.top - fromRect.top}px)`;
        toRow.style.transform = `translateY(${fromRect.top - toRect.top}px)`;

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

        setTimeout(() => {
          rubrics[rubricIndex].criteria = sortedIndices.map(
            (idx) => newCriteriaArray[idx],
          );

          const totalPoints = rubrics.reduce(
            (total, rubric) =>
              total +
              Math.max(...rubric.criteria.map((crit) => crit.points || 0), 0),
            0,
          );

          setQuestionScoring(
            questionId,
            { rubrics, type: "CRITERIA_BASED" },
            variantId,
          );

          handleUpdateQuestionState({ rubrics, totalPoints }, variantMode);

          rowsRef.current.forEach((row) => {
            if (row) row.style.transform = "";
          });
          setSwappingIndices([]);
        }, 300);
      }
    } else {
      rubrics[rubricIndex].criteria = sortedIndices.map(
        (idx) => newCriteriaArray[idx],
      );
      const totalPoints = rubrics.reduce(
        (total, rubric) =>
          total +
          Math.max(...rubric.criteria.map((crit) => crit.points || 0), 0),
        0,
      );

      setQuestionScoring(
        questionId,
        { rubrics, type: "CRITERIA_BASED" },
        variantId,
      );

      handleUpdateQuestionState({ rubrics, totalPoints }, variantMode);
    }
  };

  const handlePointsInputChange = (
    rubricIndex: number,
    criteriaIndex: number,
    value: string,
  ) => {
    const parsedValue = parseInt(value, 10);
    if (!isNaN(parsedValue)) {
      const rubrics = questionFromParent.scoring?.rubrics
        ? [...questionFromParent.scoring.rubrics]
        : [];
      if (!rubrics[rubricIndex]) {
        rubrics[rubricIndex] = { rubricQuestion: "", criteria: [] };
      }
      const newCriteriaArray = [...rubrics[rubricIndex].criteria];
      newCriteriaArray[criteriaIndex] = {
        ...newCriteriaArray[criteriaIndex],
        points: parsedValue,
      };
      rubrics[rubricIndex].criteria = newCriteriaArray;
      setQuestionScoring(
        questionId,
        {
          rubrics,
          type: "CRITERIA_BASED",
        },
        variantId,
      );
      handleUpdateQuestionState({ rubrics }, variantMode);
    }
  };

  const fetchRubric = async (
    question: QuestionAuthorStore,
    rubricIndex?: number,
    variantId?: number,
  ) => {
    const assignmentId = useAuthorStore.getState().activeAssignmentId;
    try {
      const response = await generateRubric(
        question,
        assignmentId,
        rubricIndex,
      );
      if (response && Array.isArray(response)) {
        const parsedChoices = response.map((choice: Choice) => ({
          choice: choice.choice,
          isCorrect: choice.isCorrect,
          points: choice.points,
          feedback: choice.feedback,
        }));
        setChoices(questionId, parsedChoices, variantId);
      } else {
        if (response && "rubrics" in response && response.rubrics.length > 0) {
          const rubrics = response.rubrics;
          if (rubrics && rubricIndex) {
            question.scoring.rubrics[rubricIndex] = rubrics[0];
          } else {
            question.scoring.rubrics = rubrics;
          }
          setQuestionScoring(
            questionId,
            { rubrics: question.scoring.rubrics, type: "CRITERIA_BASED" },
            variantId,
          );
        }
      }
    } catch (error) {
      toast.error("Failed to generate rubric. Please try again.");
    } finally {
      setInProgressRubricIndex(null);
    }
  };

  const handleAiClick = (rubricIndex?: number) => {
    if (questionFromParent.scoring?.rubrics[rubricIndex]?.criteria.length > 0) {
      setModalOpen(true);
      setInProgressRubricIndex(rubricIndex);
    } else {
      void handleConfirm(rubricIndex);
    }
  };

  const handleConfirm = async (rubricIndex: number) => {
    setModalOpen(false);

    if (questionTitle?.trim() === "") {
      toast.error("Please enter a Question Title first.");
      return;
    }
    if (questionType === "EMPTY") {
      toast.error("Please select a Question Type first.");
      return;
    }
    setCriteriaMode(questionId, "AI_GEN");

    try {
      toggleLoading(questionId, true, variantMode ? variantId : undefined);
      await fetchRubric(questionFromParent, rubricIndex, variantId);
    } catch (error) {
      toast.error("Failed to generate rubric. Please try again.");
    } finally {
      toggleLoading(questionId, false, variantMode ? variantId : undefined);
    }
  };

  const handleCancel = () => {
    setModalOpen(false);
  };

  useEffect(() => {
    if (questionCriteria.points?.length > 0 && criteriaMode !== "CUSTOM") {
      setCriteriaMode(questionId, "CUSTOM");
    }
  }, [questionCriteria.points, criteriaMode]);

  const handleExtendRubric = async (variantId?: number) => {
    if (questionTitle?.trim() === "") {
      toast.error("Please enter a Question Title first.");
      return;
    }
    if (questionType === "EMPTY") {
      toast.error("Please select a Question Type first.");
      return;
    }
    try {
      const expandedQuestion = await expandMarkingRubric(
        questionFromParent,
        useAuthorStore.getState().activeAssignmentId,
      );
      if (variantId) {
        editVariant(questionId, variantId, expandedQuestion);
      } else {
        modifyQuestion(questionId, expandedQuestion);
      }
    } catch (error) {
      toast.error("Failed to expand rubric. Please try again.");
    } finally {
      toggleLoading(questionId, false, variantMode ? variantId : undefined);
    }
  };

  return (
    <div
      id={`question-title-${questionId}`}
      className="flex flex-col w-full gap-y-2"
    >
      {toggleTitle && !preview ? (
        <div ref={titleRef} className="w-full">
          <MarkdownEditor
            className="title-placeholder placeholder-gray-500 w-full"
            value={localQuestionTitle}
            setValue={(value) => setLocalQuestionTitle(value?.trim())}
            placeholder="Enter your question here..."
            onBlur={() => {
              setToggleTitle(
                questionId,
                false,
                variantMode ? variantId : undefined,
              );
              setQuestionTitle(localQuestionTitle);
              handleUpdateQuestionState(
                { questionTitle: localQuestionTitle },
                variantMode,
              );
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

      {/* Show Rubrics to Learner toggle, only for certain question types */}
      {["TEXT", "URL", "UPLOAD", "LINK_FILE"].includes(questionType) && (
        // outside div for text and 2 buttons
        <div className="flex flex-col justify-between gap-2 my-3">
          <div>
            <p className="text-gray-700  leading-7 text-lg font-semibold tracking-normal">
              Rubric
            </p>
          </div>
          {/* the section for 2 buttons */}
          <div className="flex lg:flex-row flex-col gap-2">
            <div className="flex items-center mr-4 gap-2 text-gray-600 text-nowrap">
              <span className="text-gray-600 typography-body">
                Show Rubrics to Learner
              </span>
              <Tooltip
                content="Show rubrics to learners"
                className="flex items-center"
              >
                <button
                  type="button"
                  onClick={() =>
                    handleUpdateQuestionState({
                      showRubricsToLearner: !showRubricsToLearner,
                    })
                  }
                  className={cn(
                    "relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none",
                    showRubricsToLearner ? "bg-violet-600" : "bg-gray-200",
                  )}
                  role="switch"
                  aria-checked={showRubricsToLearner}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      "pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out",
                      showRubricsToLearner ? "translate-x-5" : "translate-x-0",
                    )}
                  />
                </button>
              </Tooltip>
            </div>
            {showRubricsToLearner && (
              <div className="flex items-center mr-4 gap-2 text-gray-600 text-nowrap">
                <span className="text-gray-600 typography-body">
                  Display Rubric Points to Learners
                </span>
                <Tooltip
                  content="Display rubric points to learners"
                  className="flex items-center"
                >
                  <button
                    type="button"
                    onClick={() => {
                      //ensure the value is most current
                      const current = useAuthorStore
                        .getState()
                        .questions.find((q) => q.id === questionId);
                      handleUpdateQuestionState({
                        showRubricsToLearner:
                          current?.scoring?.showRubricsToLearner ?? false,
                        showPoints: !(current?.scoring?.showPoints ?? false),
                      });
                    }}
                    className={cn(
                      "relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none",
                      showPoints ? "bg-violet-600" : "bg-gray-200",
                    )}
                    role="switch"
                    aria-checked={showPoints}
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        "pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out",
                        showPoints ? "translate-x-5" : "translate-x-0",
                      )}
                    />
                  </button>
                </Tooltip>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Criteria Header displayed for the first question */}
      {showCriteriaHeader &&
        questionIndex === 1 &&
        !variantMode &&
        !preview && (
          <div className="flex justify-between bg-violet-100 rounded py-4 pl-3 pr-5">
            <div className="flex items-start h-full">
              <InformationCircleIcon className="stroke-white fill-violet-600 h-8 w-8 p-1" />
            </div>
            <p className="typography-body text-violet-800">
              Create multiple rubrics to evaluate students on the same
              submission. Learner's will <b>not </b>see rubric evaluation
              questions. Unless you toggle the "Show to Learners" option. If
              available
            </p>
            <div className="flex items-start h-full">
              <button
                className="text-gray-500"
                onClick={() => setShowCriteriaHeader(false)}
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
        )}

      {/* Render different question types */}
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

          {/* Points Input */}
          <div className="relative flex items-center">
            <input
              type="number"
              className="text-center w-16 px-3 py-2 rounded-lg border text-gray-700 focus:outline-none focus:ring-2 focus:ring-violet-500 transition-all duration-200"
              value={localPoints}
              disabled={preview}
              onChange={(e) => setLocalPoints(parseInt(e.target.value, 10))}
              min={1}
              onBlur={() => updatePointsTrueFalse(questionId, localPoints)}
              style={{ width: `${localPoints?.toString()?.length + 5}ch` }}
            />
            <span className="ml-2 text-gray-600">pts</span>
          </div>
        </div>
      ) : (
        <>
          <PresentationOptions
            questionType={questionType}
            responseType={responseType}
            question={questionFromParent}
            setEvaluateBodyLanguage={setEvaluateBodyLanguage}
            setRealTimeAiCoach={setRealTimeAiCoach}
            setEvaluateTimeManagement={setEvaluateTimeManagement}
            setTargetTime={setTargetTime}
            setEvaluateSlidesQuality={setEvaluateSlidesQuality}
          />
          {/* Use RubricSwitcher to render the appropriate rubric */}
          <RubricSwitcher
            questionType={questionType}
            questionIndex={questionIndex}
            preview={preview}
            loading={loading}
            criteriaMode={criteriaMode}
            onPointsInputChange={handlePointsInputChange}
            onPointsChange={handlePointsChange}
            onCriteriaChange={handleCriteriaChange}
            onCriteriaBlur={handleCriteriaBlur}
            onRemoveCriteria={handleRemoveCriteria}
            onShiftCriteria={handleShiftCriteria}
            onAiClick={handleAiClick}
            maxPointsEver={maxPointsEver}
            questionFromParent={questionFromParent}
            questionId={questionId}
            variantId={variantId}
            rowsRef={rowsRef}
            swappingIndices={swappingIndices}
            inProgressRubricIndex={inProgressRubricIndex}
            handleExtendRubric={handleExtendRubric}
          />
          <WarningAlert
            isOpen={isModalOpen}
            onClose={handleCancel}
            onConfirm={() => handleConfirm(inProgressRubricIndex)}
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
