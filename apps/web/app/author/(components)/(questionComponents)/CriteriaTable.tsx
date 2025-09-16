"use client";

import Tooltip from "@/components/Tooltip";
import { useAuthorStore } from "@/stores/author";
import { PlusIcon } from "@heroicons/react/24/outline";
import { PencilIcon, SparklesIcon } from "@heroicons/react/24/solid";
import React, { FC, useEffect, useRef, useState } from "react";

interface CriteriaRowProps {
  initialPoints: number;
  loading: boolean;
  initialDescription: string;
  index: number;
  preview: boolean;
  maxPoints: number;
  onPointsChange: (index: number, value: string) => void;
  onCriteriaBlur: () => void;
  onRemoveCriteria: (index: number) => void;
  onShiftCriteria: (index: number) => void;
  swapping: boolean;
  isLast: boolean;
  handleUpdateCriteriaDesc: (criteriaIndex: number, value: string) => void;
  rowsRef: React.RefObject<(HTMLTableRowElement | null)[]>;
}

const CriteriaRow: FC<CriteriaRowProps> = ({
  initialPoints,
  loading,
  initialDescription,
  index,
  preview,
  maxPoints,
  onPointsChange,
  onCriteriaBlur,
  onRemoveCriteria,
  onShiftCriteria,
  swapping,
  isLast,
  handleUpdateCriteriaDesc,
  rowsRef,
}) => {
  const [points, setPoints] = useState<number>(initialPoints);
  const [description, setDescription] = useState<string>(initialDescription);

  useEffect(() => {
    setPoints(initialPoints);
  }, [initialPoints]);

  useEffect(() => {
    setDescription(initialDescription);
  }, [initialDescription]);

  return (
    <React.Fragment>
      <tr
        ref={(el) => {
          rowsRef.current[index] = el;
        }}
        className={isLast ? "" : "border-b"}
        style={{
          transition: swapping ? "transform 0.3s ease" : "none",
        }}
      >
        {loading ? (
          <>
            <div className="animate-pulse bg-gray-200 mt-1 mx-3 h-6 rounded"></div>
          </>
        ) : (
          <th className="py-2 px-4 text-left w-1/6 h-min border-r border-gray-200">
            <div className="flex flex-col">
              <input
                type="number"
                disabled={preview}
                className="border-none w-full text-left focus:outline-none focus:ring-0 px-0 py-0 text-gray-600"
                value={points}
                min={0}
                max={maxPoints}
                onChange={(e) => {
                  setPoints(parseInt(e.target.value, 10));
                }}
                onBlur={() => onPointsChange(index, points.toString())}
                onKeyPress={(e) => {
                  if (e.key === "Enter") {
                    onPointsChange(index, points.toString());
                  }
                }}
              />
            </div>
          </th>
        )}
        <th
          className="relative text-left typography-body size-4 w-full py-2 pl-6 pr-10 align-top"
          style={{ verticalAlign: "top" }}
        >
          {loading ? (
            <>
              <div className="animate-pulse bg-gray-200 h-5 w-full rounded"></div>
            </>
          ) : preview ? (
            <div>{description}</div>
          ) : (
            <textarea
              className="border-none placeholder-gray-500 focus:outline-none focus:ring-0 px-0 pr-2 py-0 w-full text-left scrollbar-hide resize-none"
              style={{
                height: "auto",
                minHeight: `${
                  Math.max(
                    2,
                    description
                      .split(/\r?\n/)
                      .reduce(
                        (acc, line) => acc + Math.ceil(line.length / 120),
                        0,
                      ),
                  ) * 1.5
                }rem`,
                wordBreak: "break-word",
                whiteSpace: "pre-wrap",
                overflow: "hidden",
              }}
              placeholder="Click here to add criteria"
              value={description}
              disabled={preview}
              onChange={(e) => {
                setDescription(e.target.value);
              }}
              onBlur={() => {
                handleUpdateCriteriaDesc(index, description);
              }}
            />
          )}
          {!preview && (
            <button
              className="absolute top-1/2 transform -translate-y-1/2 right-4"
              onClick={() => onRemoveCriteria(index)}
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
      {isLast && !preview && (
        <tr className="border-t border-gray-200 w-full">
          <td colSpan={2} className="py-2 px-4 text-left">
            <div
              className="text-gray-600 w-full flex items-center gap-x-1.5 text-left text-base full-width cursor-pointer"
              onClick={() => {
                onShiftCriteria(index);
              }}
            >
              <PlusIcon className="w-4 h-4 inline-block mr-2 stroke-gray-500" />
              <p className="text-gray-600 typography-body">
                Click to add new criterion
              </p>
            </div>
          </td>
        </tr>
      )}
    </React.Fragment>
  );
};

interface Criterion {
  id: number;
  description: string;
  points: number;
}

export interface Rubric {
  rubricQuestion: string;
  criteria: Criterion[];
}

interface CriteriaTableProps {
  rubric: Rubric;
  rubricIndex: number;
  preview: boolean;
  loading: boolean;
  criteriaMode: string;
  onPointsChange: (index: number, value: string) => void;
  onCriteriaChange: (index: number, value: string) => void;
  onCriteriaBlur: () => void;
  onRemoveCriteria: (index: number) => void;
  onShiftCriteria: () => void;
  onAiClick: () => void;
  handleUpdateCriteriaDesc: (
    rubricIndex: number,
    criteriaIndex: number,
    value: string,
  ) => void;
  maxPointsEver?: number;
  rowsRef: React.RefObject<(HTMLTableRowElement | null)[]>;
  swappingIndices: number[];
}

const CriteriaTable: React.FC<CriteriaTableProps> = ({
  rubric,
  rubricIndex,
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
  maxPointsEver = 100000,
  rowsRef,
  swappingIndices,
}) => {
  return (
    <div className="mx-auto min-w-full border rounded border-solid border-gray-200">
      <table className="min-w-full bg-white">
        <thead>
          <tr className="border-b border-gray-200 w-full">
            <th className="py-2 px-4 text-left bg-gray-100 w-1/6 h-min border-r border-gray-200">
              <div className="flex flex-col">
                <p className="typography-body text-gray-600">Points</p>
              </div>
            </th>
            <th className="py-2 px-4 text-left bg-gray-100 w-full h-min">
              <div className="flex justify-between">
                <div className="flex flex-col">
                  <p className="typography-body text-gray-600">Criteria</p>
                </div>

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
                        onClick={onAiClick}
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
          {rubric.criteria && rubric.criteria.length > 0 ? (
            rubric.criteria.map((criterion, index) =>
              criterion ? (
                <CriteriaRow
                  key={index}
                  loading={loading}
                  initialPoints={criterion.points}
                  initialDescription={criterion.description}
                  index={index}
                  preview={preview}
                  maxPoints={
                    maxPointsEver ? Math.min(maxPointsEver, 100000) : 100000
                  }
                  rowsRef={rowsRef}
                  onPointsChange={onPointsChange}
                  onCriteriaBlur={onCriteriaBlur}
                  onRemoveCriteria={onRemoveCriteria}
                  onShiftCriteria={onShiftCriteria}
                  swapping={swappingIndices.includes(index)}
                  isLast={index === rubric.criteria.length - 1}
                  handleUpdateCriteriaDesc={(criteriaIndex, value: string) =>
                    handleUpdateCriteriaDesc(rubricIndex, criteriaIndex, value)
                  }
                />
              ) : null,
            )
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
                        onClick={onAiClick}
                        disabled={loading}
                      >
                        <SparklesIcon className="w-4 h-4 inline-block mr-2 stroke-violet-600 fill-violet-600" />
                        Generate a rubric with AI
                      </button>
                      <span className="text-gray-500">OR</span>
                      <button
                        className="text-gray-500"
                        onClick={() => {
                          onShiftCriteria();
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
  );
};

export default CriteriaTable;
