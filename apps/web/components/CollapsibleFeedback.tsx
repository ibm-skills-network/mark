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
  nextStep?: string;
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

  const allCriteriaMet = [
    "All grading criteria fully satisfied.",
    "All assessed criteria were fully met.",
  ].includes(guidance);

  return (
    <div className={`space-y-3 ${className}`}>
      {/* Summary Section */}
      {summary && (
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <h3 className="mb-1 text-sm font-semibold text-slate-900">
            Feedback summary
          </h3>
          <p className="text-sm text-slate-700">{summary}</p>
        </div>
      )}

      {/* Criterion Details - Collapsible */}
      {showSubQuestions && (criteriaSection || parsedCriteria.length > 0) && (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <button
            onClick={() => setShowDetails(!showDetails)}
            className="flex w-full items-center justify-between px-5 py-4 text-left hover:bg-slate-50"
          >
            <div className="flex items-center gap-3">
              <div className="text-left">
                <span className="font-bold text-gray-900 text-base block">
                  Rubric feedback
                </span>
                <span className="text-xs text-gray-600">
                  {parsedCriteria.length > 0
                    ? `${parsedCriteria.length} criteria evaluated`
                    : "Review each assessed criterion"}
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
            <div className="border-t border-slate-200 bg-slate-50 p-4">
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
      {guidance && !allCriteriaMet && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
          <h3 className="mb-2 text-sm font-semibold text-amber-950">
            What to work on next
          </h3>
          <FeedbackFormatter className="text-amber-900 text-sm">
            {guidance}
          </FeedbackFormatter>
        </div>
      )}

      {/* Perfect Score Message */}
      {allCriteriaMet && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
          <p className="text-sm font-semibold text-emerald-950">
            All assessed criteria were fully met.
          </p>
        </div>
      )}
    </div>
  );
}
