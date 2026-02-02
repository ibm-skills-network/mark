"use client";

import React, { useState } from "react";
import HighlightedText from "./HighlightedText";
import { HighlightLevel, ResponseHighlighting } from "@/config/types";

interface HighlightedResponseProps {
  /** Response highlighting data */
  highlighting?: ResponseHighlighting;

  /** Fallback text if no highlighting */
  originalText?: string;

  /** Custom class name */
  className?: string;
}

/**
 * HighlightedResponse Component
 * Displays a learner's response with AI-generated highlights and feedback
 */
export const HighlightedResponse: React.FC<HighlightedResponseProps> = ({
  highlighting,
  originalText,
  className = "",
}) => {
  const [selectedPage, setSelectedPage] = useState(0);
  const [showLegend, setShowLegend] = useState(true);

  if (!highlighting || !highlighting.pages || highlighting.pages.length === 0) {
    if (!originalText) return null;

    return (
      <div className={`bg-gray-50 p-6 rounded-lg ${className}`}>
        <div className="prose max-w-none">
          <pre className="whitespace-pre-wrap font-mono text-sm">
            {originalText}
          </pre>
        </div>
      </div>
    );
  }

  const pages = highlighting.pages;
  const currentPage = pages[selectedPage] || pages[0];

  const totalHighlights = currentPage.highlights.length;
  const correctCount = currentPage.highlights.filter(
    (h) => h.level === HighlightLevel.CORRECT,
  ).length;
  const partialCount = currentPage.highlights.filter(
    (h) => h.level === HighlightLevel.PARTIAL,
  ).length;
  const incorrectCount = currentPage.highlights.filter(
    (h) => h.level === HighlightLevel.INCORRECT,
  ).length;

  return (
    <div
      className={`bg-white border border-gray-200 rounded-lg shadow-sm ${className}`}
    >
      {/* Header with stats */}
      <div className="bg-gradient-to-r from-blue-50 to-indigo-50 px-6 py-4 border-b border-gray-200">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">
              Your Response - AI Analysis
            </h3>
            <p className="text-sm text-gray-600 mt-1">
              Hover over highlighted sections to see AI feedback
            </p>
          </div>

          {/* Correctness Score */}
          <div className="bg-white px-4 py-2 rounded-lg shadow-sm border border-gray-200">
            <div className="text-2xl font-bold text-indigo-600">
              {Math.round(currentPage.correctnessScore)}%
            </div>
            <div className="text-xs text-gray-600 mt-1">Overall Score</div>
          </div>
        </div>

        {/* Stats Bar */}
        <div className="mt-4 grid grid-cols-3 gap-4">
          <div className="bg-green-50 px-3 py-2 rounded-lg border border-green-200">
            <div className="flex items-center gap-2">
              <span className="text-green-600 text-xl">✓</span>
              <div>
                <div className="text-lg font-semibold text-green-700">
                  {correctCount}
                </div>
                <div className="text-xs text-green-600">Correct</div>
              </div>
            </div>
          </div>

          <div className="bg-yellow-50 px-3 py-2 rounded-lg border border-yellow-200">
            <div className="flex items-center gap-2">
              <span className="text-yellow-600 text-xl">⚠</span>
              <div>
                <div className="text-lg font-semibold text-yellow-700">
                  {partialCount}
                </div>
                <div className="text-xs text-yellow-600">Partial</div>
              </div>
            </div>
          </div>

          <div className="bg-red-50 px-3 py-2 rounded-lg border border-red-200">
            <div className="flex items-center gap-2">
              <span className="text-red-600 text-xl">✗</span>
              <div>
                <div className="text-lg font-semibold text-red-700">
                  {incorrectCount}
                </div>
                <div className="text-xs text-red-600">Needs Work</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Page Selector (if multiple pages) */}
      {pages.length > 1 && (
        <div className="px-6 py-3 bg-gray-50 border-b border-gray-200">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-700">Page:</span>
            <div className="flex gap-2">
              {pages.map((page, index) => (
                <button
                  key={page.pageNumber}
                  onClick={() => setSelectedPage(index)}
                  className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
                    index === selectedPage
                      ? "bg-indigo-600 text-white"
                      : "bg-white text-gray-700 hover:bg-gray-100 border border-gray-300"
                  }`}
                >
                  {page.pageNumber}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Legend Toggle */}
      <div className="px-6 py-3 bg-gray-50 border-b border-gray-200">
        <button
          onClick={() => setShowLegend(!showLegend)}
          className="flex items-center gap-2 text-sm text-gray-700 hover:text-gray-900 transition-colors"
        >
          <span>{showLegend ? "▼" : "▶"}</span>
          <span className="font-medium">Legend</span>
        </button>

        {showLegend && (
          <div className="mt-3 grid grid-cols-3 gap-4">
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 bg-green-100 border-b-2 border-green-400 rounded"></div>
              <span className="text-sm text-gray-700">Correct</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 bg-yellow-100 border-b-2 border-yellow-400 rounded"></div>
              <span className="text-sm text-gray-700">Partially Correct</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 bg-red-100 border-b-2 border-red-400 rounded"></div>
              <span className="text-sm text-gray-700">Needs Improvement</span>
            </div>
          </div>
        )}
      </div>

      {/* Highlighted Text Content */}
      <div className="px-6 py-6 bg-white">
        <HighlightedText
          text={currentPage.originalText}
          highlights={currentPage.highlights}
          className="max-w-4xl"
        />
      </div>

      {/* Footer tip */}
      <div className="px-6 py-3 bg-gray-50 border-t border-gray-200">
        <p className="text-xs text-gray-600 italic">
          💡 Tip: Hover over any highlighted section to see detailed AI feedback
        </p>
      </div>
    </div>
  );
};

export default HighlightedResponse;
