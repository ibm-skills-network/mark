"use client";

import React, { useState } from "react";
import { TextHighlight, HighlightLevel } from "@/config/types";

interface HighlightedTextProps {
  /** Original text to display */
  text: string;

  /** Highlights to apply */
  highlights: TextHighlight[];

  /** Custom class name */
  className?: string;
}

/**
 * HighlightedText Component
 * Renders text with colored highlights and interactive tooltips showing AI feedback
 */
export const HighlightedText: React.FC<HighlightedTextProps> = ({
  text,
  highlights,
  className = "",
}) => {
  const [activeTooltip, setActiveTooltip] = useState<number | null>(null);

  const sortedHighlights = [...highlights].sort((a, b) => a.start - b.start);

  const segments: Array<{ text: string; highlight?: TextHighlight }> = [];
  let currentPos = 0;

  for (const highlight of sortedHighlights) {
    if (currentPos < highlight.start) {
      segments.push({
        text: text.substring(currentPos, highlight.start),
      });
    }

    segments.push({
      text: text.substring(highlight.start, highlight.end),
      highlight,
    });

    currentPos = highlight.end;
  }

  if (currentPos < text.length) {
    segments.push({
      text: text.substring(currentPos),
    });
  }

  /**
   * Get background color class based on highlight level
   */
  const getHighlightClass = (level: HighlightLevel): string => {
    switch (level) {
      case HighlightLevel.CORRECT:
        return "bg-green-100 hover:bg-green-200 border-b-2 border-green-400";
      case HighlightLevel.PARTIAL:
        return "bg-yellow-100 hover:bg-yellow-200 border-b-2 border-yellow-400";
      case HighlightLevel.INCORRECT:
        return "bg-red-100 hover:bg-red-200 border-b-2 border-red-400";
      default:
        return "";
    }
  };

  /**
   * Get icon for highlight level
   */
  const getIcon = (level: HighlightLevel): string => {
    switch (level) {
      case HighlightLevel.CORRECT:
        return "✓";
      case HighlightLevel.PARTIAL:
        return "⚠";
      case HighlightLevel.INCORRECT:
        return "✗";
      default:
        return "";
    }
  };

  return (
    <div
      className={`relative whitespace-pre-wrap font-mono text-sm leading-relaxed ${className}`}
    >
      {segments.map((segment, index) => {
        if (!segment.highlight) {
          return <span key={index}>{segment.text}</span>;
        }

        const { highlight } = segment;
        const isActive = activeTooltip === index;

        return (
          <span
            key={index}
            className={`relative cursor-pointer transition-all duration-200 ${getHighlightClass(highlight.level)} px-1 rounded`}
            onMouseEnter={() => setActiveTooltip(index)}
            onMouseLeave={() => setActiveTooltip(null)}
          >
            {segment.text}

            {/* Tooltip */}
            {isActive && highlight.comment && (
              <div className="absolute z-50 w-80 p-4 mt-2 bg-white border-2 border-gray-200 rounded-lg shadow-xl animate-fadeIn left-0 top-full">
                {/* Icon and level indicator */}
                <div className="flex items-center gap-2 mb-2">
                  <span
                    className={`text-2xl ${
                      highlight.level === HighlightLevel.CORRECT
                        ? "text-green-600"
                        : highlight.level === HighlightLevel.PARTIAL
                          ? "text-yellow-600"
                          : "text-red-600"
                    }`}
                  >
                    {getIcon(highlight.level)}
                  </span>
                  <span
                    className={`text-xs font-semibold uppercase tracking-wide ${
                      highlight.level === HighlightLevel.CORRECT
                        ? "text-green-700"
                        : highlight.level === HighlightLevel.PARTIAL
                          ? "text-yellow-700"
                          : "text-red-700"
                    }`}
                  >
                    {highlight.level === HighlightLevel.CORRECT
                      ? "Correct"
                      : highlight.level === HighlightLevel.PARTIAL
                        ? "Partially Correct"
                        : "Needs Improvement"}
                  </span>
                </div>

                {/* AI Comment */}
                <div className="text-sm text-gray-700 leading-relaxed">
                  {highlight.comment}
                </div>

                {/* Criterion ID (if available) */}
                {highlight.criterionId && (
                  <div className="mt-2 pt-2 border-t border-gray-200 text-xs text-gray-500">
                    Criterion: {highlight.criterionId}
                  </div>
                )}
              </div>
            )}
          </span>
        );
      })}
    </div>
  );
};

export default HighlightedText;
