"use client";

import {
  CheckCircleIcon,
  MinusCircleIcon,
  XCircleIcon,
  ChevronDownIcon,
  ChevronUpIcon,
} from "@heroicons/react/24/solid";
import { useState } from "react";

interface CriterionCardProps {
  criterion: {
    name: string;
    pointsAwarded: number;
    maxPoints: number;
    evidence: string;
    feedback: string;
    nextStep?: string;
    status: "full" | "partial" | "none";
  };
  showPoints?: boolean;
}

export default function CriterionCard({
  criterion,
  showPoints = true,
}: CriterionCardProps) {
  const [showEvidence, setShowEvidence] = useState(false);

  const {
    name,
    pointsAwarded,
    maxPoints,
    evidence,
    feedback,
    nextStep,
    status,
  } = criterion;
  const percentage = maxPoints > 0 ? (pointsAwarded / maxPoints) * 100 : 0;

  const statusConfig = {
    full: {
      icon: CheckCircleIcon,
      iconColor: "text-green-600",
      bgColor: "bg-white",
      borderColor: "border-green-300",
      progressColor: "bg-green-500",
      badgeColor: "bg-green-100 text-green-800",
      label: "Fully Met",
    },
    partial: {
      icon: MinusCircleIcon,
      iconColor: "text-amber-600",
      bgColor: "bg-white",
      borderColor: "border-amber-300",
      progressColor: "bg-amber-500",
      badgeColor: "bg-amber-100 text-amber-800",
      label: "Partially Met",
    },
    none: {
      icon: XCircleIcon,
      iconColor: "text-red-600",
      bgColor: "bg-white",
      borderColor: "border-red-300",
      progressColor: "bg-red-500",
      badgeColor: "bg-red-100 text-red-800",
      label: "Not Met",
    },
  };

  const config = statusConfig[status];
  const Icon = config.icon;

  const hasEvidence =
    evidence &&
    evidence.trim() !== "" &&
    !evidence.includes("No supporting evidence found");

  return (
    <div
      className={`rounded-lg border ${config.borderColor} ${config.bgColor} p-4`}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-start gap-3 flex-1">
          <Icon
            className={`w-6 h-6 ${config.iconColor} flex-shrink-0 mt-0.5`}
          />
          <div className="flex-1">
            <h4 className="mb-1 text-base font-semibold text-slate-900">
              {name}
            </h4>
            <span
              className={`inline-block px-2 py-1 rounded-full text-xs font-semibold ${config.badgeColor}`}
            >
              {config.label}
            </span>
          </div>
        </div>

        {/* Points Badge */}
        {showPoints && (
          <div className="flex flex-col items-end ml-3">
            <div className="text-2xl font-bold text-gray-900">
              {pointsAwarded}
              <span className="text-lg text-gray-500">/{maxPoints}</span>
            </div>
            <div className="text-xs text-gray-600">
              {Math.round(percentage)}%
            </div>
          </div>
        )}
      </div>

      {/* Progress Bar */}
      {showPoints && (
        <div className="mb-3">
          <div className="w-full bg-gray-200 rounded-full h-2.5 overflow-hidden">
            <div
              className={`h-2.5 ${config.progressColor} rounded-full transition-all duration-500`}
              style={{ width: `${percentage}%` }}
            />
          </div>
        </div>
      )}

      {/* Feedback */}
      <div className="mb-3">
        <p className="text-gray-800 text-sm leading-relaxed">{feedback}</p>
      </div>

      {nextStep && status !== "full" && (
        <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 p-3">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-amber-900">
            Next step
          </p>
          <p className="text-sm leading-relaxed text-amber-950">{nextStep}</p>
        </div>
      )}

      {/* Evidence Section - Collapsible */}
      {hasEvidence && (
        <div className="mt-3 border-t border-gray-300 pt-3">
          <button
            onClick={() => setShowEvidence(!showEvidence)}
            className="flex items-center gap-2 text-sm font-semibold text-gray-700 hover:text-gray-900 transition-colors w-full"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
              />
            </svg>
            <span>Evidence from your submission</span>
            {showEvidence ? (
              <ChevronUpIcon className="w-4 h-4 ml-auto" />
            ) : (
              <ChevronDownIcon className="w-4 h-4 ml-auto" />
            )}
          </button>

          {showEvidence && (
            <div className="mt-2 p-3 bg-white border border-gray-200 rounded-md">
              <p className="text-sm text-gray-700 italic leading-relaxed">
                "{evidence}"
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
