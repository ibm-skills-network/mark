"use client";

import { ChevronDownIcon, ChevronUpIcon } from "@heroicons/react/24/outline";
import { useState } from "react";
import CriterionCard from "./CriterionCard";
import FeedbackFormatter from "./FeedbackFormatter";

export interface StructuredCriterion {
  name: string;
  pointsAwarded: number;
  maxPoints: number;
  evidence: string;
  feedback: string;
  status: "full" | "partial" | "none";
}

export interface StructuredFeedbackData {
  summary: string;
  criteria: StructuredCriterion[];
  guidance: string;
}

interface CollapsibleFeedbackProps {
  feedback: string | any;
  structuredFeedback?: StructuredFeedbackData | any;
  showSubQuestions?: boolean;
  showPoints?: boolean;
  className?: string;
}

/**
 * Component that displays structured grading feedback with collapsible criterion details.
 */
export default function CollapsibleFeedback({
  feedback,
  structuredFeedback,
  showSubQuestions = true,
  showPoints = true,
  className = "",
}: CollapsibleFeedbackProps) {
  const [showDetails, setShowDetails] = useState(false);

  const safeFeedback =
    typeof feedback === "string"
      ? feedback
      : typeof feedback === "object"
        ? JSON.stringify(feedback, null, 2)
        : String(feedback || "");

  let actualStructuredFeedback = structuredFeedback;
  if (typeof structuredFeedback === "string") {
    try {
      actualStructuredFeedback = JSON.parse(structuredFeedback);
    } catch (e) {
      actualStructuredFeedback = undefined;
    }
  }

  if (
    actualStructuredFeedback &&
    typeof actualStructuredFeedback === "object"
  ) {
    if (
      !actualStructuredFeedback.summary ||
      !Array.isArray(actualStructuredFeedback.criteria)
    ) {
      actualStructuredFeedback = undefined;
    }
  }

  const parseFeedback = (text: string) => {
    let summary = "";
    let criteriaSection = "";
    let guidance = "";

    const parts = text.split(/\n\n---\n\n/);

    if (parts.length >= 2) {
      summary = parts[0].trim();
      const remainder = parts.slice(1).join("\n\n---\n\n");

      const guidanceMatch = remainder.match(/\n\nGuidance:\s*([\s\S]+?)$/);
      if (guidanceMatch) {
        guidance = guidanceMatch[1].trim();
        criteriaSection = remainder.substring(0, guidanceMatch.index).trim();
      } else {
        criteriaSection = remainder.trim();
      }
    } else {
      const explanationMatch = text.match(/^Explanation:\s*([^\n]+)/m);
      const guidanceMatch = text.match(/\n\nGuidance:\s*([\s\S]+?)$/);

      if (explanationMatch) {
        summary = explanationMatch[1].trim();
      }

      if (guidanceMatch) {
        guidance = guidanceMatch[1].trim();
      }

      const startIndex = explanationMatch
        ? explanationMatch.index + explanationMatch[0].length
        : 0;
      const endIndex = guidanceMatch ? guidanceMatch.index : text.length;

      criteriaSection = text.substring(startIndex, endIndex).trim();

      if (!summary && !guidance) {
        criteriaSection = text;
      }
    }

    return { criteriaSection, summary, guidance };
  };

  let summary = "";
  let guidance = "";
  let parsedCriteria: StructuredCriterion[] = [];
  let criteriaSection = "";

  if (actualStructuredFeedback) {
    summary = String(actualStructuredFeedback.summary || "");
    guidance = String(actualStructuredFeedback.guidance || "");
    parsedCriteria = Array.isArray(actualStructuredFeedback.criteria)
      ? actualStructuredFeedback.criteria
      : [];
  } else {
    const parsed = parseFeedback(safeFeedback);
    summary = parsed.summary;
    guidance = parsed.guidance;
    criteriaSection = parsed.criteriaSection;

    const parseCriteria = (text: string): StructuredCriterion[] => {
      const criteria: StructuredCriterion[] = [];

      const criterionPattern =
        /([✓◐✗])\s+\*\*(.+?)\*\*\s+\((\d+)\/(\d+)\s+points\)\s*\n(?:Evidence:\s*"([^"]*?)"\s*\n)?([\s\S]*?)(?=\n\n[✓◐✗]|\n\n$|$)/g;

      let match;
      while ((match = criterionPattern.exec(text)) !== null) {
        const [, statusSymbol, name, awarded, max, evidence, feedbackText] =
          match;

        const pointsAwarded = parseInt(awarded, 10);
        const maxPoints = parseInt(max, 10);

        let status: "full" | "partial" | "none";
        if (statusSymbol === "✓") {
          status = "full";
        } else if (statusSymbol === "◐") {
          status = "partial";
        } else {
          status = "none";
        }

        criteria.push({
          name: name.trim(),
          pointsAwarded,
          maxPoints,
          evidence: evidence?.trim() || "",
          feedback: feedbackText?.trim() || "",
          status,
        });
      }

      return criteria;
    };

    parsedCriteria = criteriaSection ? parseCriteria(criteriaSection) : [];
  }

  if (
    !summary &&
    !criteriaSection &&
    !guidance &&
    parsedCriteria.length === 0
  ) {
    return (
      <FeedbackFormatter className={className}>
        {safeFeedback}
      </FeedbackFormatter>
    );
  }

  return (
    <div className={`space-y-3 ${className}`}>
      {/* Summary Section */}
      {summary && (
        <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border-2 border-blue-300 rounded-xl p-4 shadow-sm">
          <div className="flex items-start gap-3">
            <div className="flex-shrink-0">
              <div className="w-10 h-10 bg-blue-500 rounded-full flex items-center justify-center">
                <svg
                  className="w-6 h-6 text-white"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
                  />
                </svg>
              </div>
            </div>
            <div className="flex-1">
              <h3 className="font-bold text-blue-900 mb-2 text-lg">
                📊 Score Summary
              </h3>
              <p className="text-blue-900 font-semibold text-base">{summary}</p>
            </div>
          </div>
        </div>
      )}

      {/* Criterion Details - Collapsible */}
      {showSubQuestions && (criteriaSection || parsedCriteria.length > 0) && (
        <div className="border-2 border-gray-300 rounded-xl overflow-hidden shadow-sm">
          <button
            onClick={() => setShowDetails(!showDetails)}
            className="w-full flex items-center justify-between px-5 py-4 bg-gradient-to-r from-gray-50 to-slate-50 hover:from-gray-100 hover:to-slate-100 transition-all"
          >
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-purple-500 rounded-lg flex items-center justify-center">
                <svg
                  className="w-5 h-5 text-white"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"
                  />
                </svg>
              </div>
              <div className="text-left">
                <span className="font-bold text-gray-900 text-base block">
                  📋 Detailed Criterion-by-Criterion Breakdown
                </span>
                <span className="text-xs text-gray-600">
                  {parsedCriteria.length > 0
                    ? `${parsedCriteria.length} criteria evaluated`
                    : "Click to view details"}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-600 font-medium">
                {showDetails ? "Hide" : "Show"} details
              </span>
              {showDetails ? (
                <ChevronUpIcon className="w-5 h-5 text-gray-600" />
              ) : (
                <ChevronDownIcon className="w-5 h-5 text-gray-600" />
              )}
            </div>
          </button>

          {showDetails && (
            <div className="p-4 bg-gray-50 border-t border-gray-200">
              {parsedCriteria.length > 0 ? (
                <div className="space-y-4">
                  {parsedCriteria.map((criterion, index) => (
                    <CriterionCard
                      key={index}
                      criterion={criterion}
                      showPoints={showPoints}
                    />
                  ))}
                </div>
              ) : (
                <FeedbackFormatter className="text-sm">
                  {criteriaSection}
                </FeedbackFormatter>
              )}
            </div>
          )}
        </div>
      )}

      {/* Guidance Section */}
      {guidance && guidance !== "All grading criteria fully satisfied." && (
        <div className="bg-gradient-to-r from-amber-50 to-orange-50 border-2 border-amber-300 rounded-xl p-4 shadow-sm">
          <div className="flex items-start gap-3">
            <div className="flex-shrink-0">
              <div className="w-10 h-10 bg-amber-500 rounded-full flex items-center justify-center">
                <svg
                  className="w-6 h-6 text-white"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M13 10V3L4 14h7v7l9-11h-7z"
                  />
                </svg>
              </div>
            </div>
            <div className="flex-1">
              <h3 className="font-bold text-amber-900 mb-2 text-lg">
                💡 How to Improve Your Score
              </h3>
              <FeedbackFormatter className="text-amber-900 text-sm">
                {guidance}
              </FeedbackFormatter>
            </div>
          </div>
        </div>
      )}

      {/* Perfect Score Message */}
      {guidance === "All grading criteria fully satisfied." && (
        <div className="bg-gradient-to-r from-green-50 to-emerald-50 border-2 border-green-300 rounded-xl p-4 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="flex-shrink-0">
              <div className="w-10 h-10 bg-green-500 rounded-full flex items-center justify-center animate-pulse">
                <svg
                  className="w-6 h-6 text-white"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M5 13l4 4L19 7"
                  />
                </svg>
              </div>
            </div>
            <div className="flex-1">
              <p className="text-green-900 font-bold text-lg">
                🎉 Perfect! All grading criteria fully satisfied!
              </p>
              <p className="text-green-700 text-sm mt-1">
                Outstanding work - you've met all requirements completely.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
