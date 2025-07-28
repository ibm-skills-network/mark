"use client";

import { QuestionAuthorStore, Rubric } from "@/config/types";
import { useAuthorStore } from "@/stores/author";
import { TrashIcon } from "@heroicons/react/24/outline";
import { PencilIcon, PlusIcon, SparklesIcon } from "@heroicons/react/24/solid";
import React, { useState } from "react";
import CriteriaTable from "./CriteriaTable";

interface RubricSwitcherProps {
  questionType: string;
  questionIndex: number;
  preview: boolean;
  loading: boolean;
  criteriaMode: string;
  onPointsInputChange: (
    rubricIndex: number,
    criteriaIndex: number,
    value: string,
  ) => void;
  onPointsChange: (
    rubricIndex: number,
    criteriaIndex: number,
    value: string,
  ) => void;
  onCriteriaChange: (
    rubricIndex: number,
    criteriaIndex: number,
    value: string,
  ) => void;
  onCriteriaBlur: (rubricIndex: number) => void;
  onRemoveCriteria: (rubricIndex: number, criteriaIndex: number) => void;
  onShiftCriteria: (rubricIndex: number) => void;
  onAiClick: (rubricIndex?: number) => void;
  maxPointsEver: number;
  questionFromParent: QuestionAuthorStore;
  questionId: number;
  variantId?: number;
  rowsRef: React.MutableRefObject<HTMLTableRowElement[]>;
  swappingIndices: number[];
  inProgressRubricIndex: number;
  handleExtendRubric: (variantId?: number) => void;
}

interface QuestionCriteria {
  points: number[];
  criteriaDesc: string[];
  criteriaIds: number[];
}

interface RubricItemProps {
  rubricItem: Rubric;
  index: number;
  questionIndex?: number;
  questionId: number;
  variantId?: number;
  preview: boolean;
  loading: boolean;
  criteriaMode: string;
  onPointsChange: (
    rubricIndex: number,
    criteriaIndex: number,
    value: string,
  ) => void;
  onCriteriaChange: (
    rubricIndex: number,
    criteriaIndex: number,
    value: string,
  ) => void;
  onCriteriaBlur: (rubricIndex: number) => void;
  onRemoveCriteria: (rubricIndex: number, criteriaIndex: number) => void;
  onShiftCriteria: (rubricIndex: number) => void;
  onAiClick: (rubricIndex: number) => void;
  handleUpdateCriteriaDesc: (
    rubricIndex: number,
    criteriaIndex: number,
    value: string,
  ) => void;
  maxPointsEver: number;
  rowsRef: React.RefObject<(HTMLTableRowElement | null)[]>;
  swappingIndices: number[];
  inProgressRubricIndex: number;
}

const RubricItem: React.FC<RubricItemProps> = ({
  rubricItem,
  index,
  questionIndex,
  questionId,
  variantId,
  preview,
  loading,
  criteriaMode,
  onPointsChange,
  onCriteriaChange,
  onCriteriaBlur,
  onRemoveCriteria,
  onShiftCriteria,
  onAiClick,
  handleUpdateCriteriaDesc,
  maxPointsEver,
  rowsRef,
  swappingIndices,
  inProgressRubricIndex,
}) => {
  const setRubricQuestionText = useAuthorStore(
    (state) => state.setRubricQuestionText,
  );
  const [localRubricQuestion, setLocalRubricQuestion] = useState(
    rubricItem?.rubricQuestion ?? "",
  );
  const removeRubric = useAuthorStore((state) => state.removeRubric);

  const handleBlur = () => {
    setRubricQuestionText(questionId, variantId, index, localRubricQuestion);
  };

  const questionCriteria: QuestionCriteria = {
    points: [],
    criteriaDesc: [],
    criteriaIds: [],
  };
  rubricItem?.criteria.forEach((crit) => {
    if (!crit) return;
    questionCriteria.points.push(crit.points);
    questionCriteria.criteriaDesc.push(crit.description);
    questionCriteria.criteriaIds.push(crit.id);
  });
  return (
    <div
      key={`question-${questionId}-rubric-${index}`}
      className="bg-neutral-50 flex p-4 items-start gap-4 rounded-md border border-gray-200"
    >
      <div className="flex items-center gap-2">
        <span className="text-gray-600 typography-body">
          {questionIndex}.{index + 1}
        </span>
      </div>
      <div className="flex-1 flex flex-col ">
        {loading && inProgressRubricIndex === index ? (
          <div className="animate-pulse bg-gray-200 h-5 mb-2 w-full rounded"></div>
        ) : (
          <div
            className="flex items-center justify-between mb-2"
            onBlur={handleBlur}
          >
            <textarea
              className="title-placeholder placeholder-gray-500 w-full rounded-md p-2 border border-gray-200"
              value={localRubricQuestion}
              onChange={(e) => setLocalRubricQuestion(e.target.value)}
              placeholder="Question to evalutate rubric"
              readOnly={preview}
            />
          </div>
        )}
        <CriteriaTable
          preview={preview}
          loading={loading && inProgressRubricIndex === index}
          criteriaMode={criteriaMode}
          maxPointsEver={maxPointsEver}
          onAiClick={() => {
            onAiClick(index);
          }}
          rubric={rubricItem}
          rubricIndex={index}
          onPointsChange={(criteriaIndex: number, value: string) => {
            onPointsChange(index, criteriaIndex, value);
          }}
          onCriteriaChange={(criteriaIndex: number, value: string) => {
            onCriteriaChange(index, criteriaIndex, value);
          }}
          onCriteriaBlur={() => {
            onCriteriaBlur(index);
          }}
          onRemoveCriteria={(criteriaIndex: number) => {
            onRemoveCriteria(index, criteriaIndex);
          }}
          onShiftCriteria={() => {
            onShiftCriteria(index);
          }}
          handleUpdateCriteriaDesc={handleUpdateCriteriaDesc}
          rowsRef={rowsRef}
          swappingIndices={swappingIndices}
        />
      </div>
      <button
        onClick={() => {
          removeRubric(questionId, index, variantId);
        }}
        className="text-gray-500"
      >
        <TrashIcon width={20} height={20} />
      </button>
    </div>
  );
};

const RubricSwitcher: React.FC<RubricSwitcherProps> = ({
  questionType,
  questionIndex,
  preview,
  loading,
  criteriaMode,
  onPointsInputChange,
  onPointsChange,
  onCriteriaChange,
  onCriteriaBlur,
  onRemoveCriteria,
  onShiftCriteria,
  onAiClick,
  handleExtendRubric,
  maxPointsEver,
  questionFromParent,
  questionId,
  variantId,
  rowsRef,
  swappingIndices,
  inProgressRubricIndex,
}) => {
  const rubric = questionFromParent?.scoring?.rubrics || [];
  const setRubricCriteriaDescription = useAuthorStore(
    (state) => state.setRubricCriteriaDescription,
  );
  const [generatingRubric, setGeneratingRubric] = useState(false);
  const handleUpdateCriteriaDesc = (
    rubricIndex: number,
    criteriaIndex: number,
    value: string,
  ) => {
    setRubricCriteriaDescription(
      questionId,
      variantId,
      rubricIndex,
      criteriaIndex,
      value,
    );
  };
  const addOneRubric = useAuthorStore((state) => state.addOneRubric);
  return (
    <>
      {rubric.length > 0 ? (
        <>
          {rubric.map((rubricItem, index) => (
            <RubricItem
              key={index}
              rubricItem={rubricItem}
              index={index}
              questionId={questionId}
              variantId={variantId}
              preview={preview}
              loading={loading}
              criteriaMode={criteriaMode}
              onPointsChange={onPointsChange}
              onCriteriaChange={onCriteriaChange}
              onCriteriaBlur={onCriteriaBlur}
              onRemoveCriteria={onRemoveCriteria}
              onShiftCriteria={onShiftCriteria}
              onAiClick={onAiClick}
              maxPointsEver={maxPointsEver}
              handleUpdateCriteriaDesc={handleUpdateCriteriaDesc}
              rowsRef={rowsRef}
              swappingIndices={swappingIndices}
              inProgressRubricIndex={inProgressRubricIndex}
              questionIndex={questionIndex}
            />
          ))}
          {generatingRubric ? (
            <div className="flex items-center justify-center w-full gap-4">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
            </div>
          ) : (
            <div className="flex justify-center gap-x-4">
              <button
                onClick={() => {
                  addOneRubric(questionId, variantId);
                }}
                className="flex items-center flex-1 gap-2 border border-gray-200 rounded-md p-2 hover:bg-gray-100 py-2 px-4"
              >
                <PlusIcon className="w-4 h-4 text-gray-500" />
                <span className="text-gray-600 typography-body text-wrap">
                  Create Blank Rubric Table
                </span>
              </button>
              <button
                onClick={() => {
                  handleExtendRubric(variantId);
                  setGeneratingRubric(true);
                }}
                className="flex items-center gap-2 flex-1 border bg-violet-100 border-gray-200 rounded-md p-2 hover:bg-gray-100 py-2 px-4"
              >
                <SparklesIcon className="w-4 h-4 text-violet-500" />
                <span className="text-violet-900 typography-body text-wrap">
                  Let AI generate a rubric for me
                </span>
              </button>
            </div>
          )}
        </>
      ) : (
        <div className="flex justify-center items-center gap-x-4 border px-4 py-2">
          {loading ? (
            <>
              <div className="animate-pulse bg-gray-200 h-5 w-1/2 rounded"></div>
              <div className="animate-pulse bg-gray-200 h-5 w-1/2 rounded"></div>
            </>
          ) : !preview ? (
            <>
              <button
                className="text-gray-500"
                onClick={() => {
                  onAiClick();
                }}
                disabled={loading}
              >
                <SparklesIcon className="w-4 h-4 inline-block mr-2 stroke-violet-600 fill-violet-600" />
                Generate a rubric with AI
              </button>
              <span className="text-gray-500">OR</span>
              <button
                className="text-gray-500"
                onClick={() => {
                  onShiftCriteria(0);
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
      )}
    </>
  );
};

export default RubricSwitcher;
