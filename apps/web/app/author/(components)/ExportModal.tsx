"use client";
import React, { useState } from "react";
import {
  XMarkIcon,
  DocumentArrowDownIcon,
  CheckIcon,
} from "@heroicons/react/24/outline";
import { cn } from "@/lib/strings";

interface ExportOption {
  id: string;
  label: string;
  description: string;
  enabled: boolean;
}

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onExport: (options: ExportOptions) => void;
}

export interface ExportOptions {
  format: "json" | "pdf" | "csv";
  includeAssignmentData: boolean;
  includeQuestions: boolean;
  includeConfig: boolean;
  includeFeedbackConfig: boolean;
  includeGradingCriteria: boolean;
  includeRubrics: boolean;
  includeQuestionChoices: boolean;
  includeVariants: boolean;
}

const ExportModal: React.FC<ExportModalProps> = ({
  isOpen,
  onClose,
  onExport,
}) => {
  const [format, setFormat] = useState<"json" | "pdf" | "csv">("json");
  const [exportOptions, setExportOptions] = useState<
    Omit<ExportOptions, "format">
  >({
    includeAssignmentData: true,
    includeQuestions: true,
    includeConfig: true,
    includeFeedbackConfig: true,
    includeGradingCriteria: true,
    includeRubrics: true,
    includeQuestionChoices: true,
    includeVariants: false,
  });

  const handleOptionChange = (optionId: keyof typeof exportOptions) => {
    setExportOptions((prev) => ({
      ...prev,
      [optionId]: !prev[optionId],
    }));
  };

  const handleExport = () => {
    onExport({
      format,
      ...exportOptions,
    });
    onClose();
  };

  const exportOptionsList: Array<{
    id: keyof typeof exportOptions;
    label: string;
    description: string;
  }> = [
    {
      id: "includeAssignmentData",
      label: "Assignment Data",
      description:
        "Basic assignment information, title, description, and metadata",
    },
    {
      id: "includeQuestions",
      label: "Questions",
      description: "All question content and structure",
    },
    {
      id: "includeConfig",
      label: "Assignment Configuration",
      description: "Settings like time limits, attempts, passing grade, etc.",
    },
    {
      id: "includeFeedbackConfig",
      label: "Feedback Configuration",
      description: "Feedback display settings and verbosity levels",
    },
    {
      id: "includeGradingCriteria",
      label: "Grading Criteria",
      description: "Overall grading criteria and guidelines",
    },
    {
      id: "includeRubrics",
      label: "Rubrics",
      description: "Detailed rubric criteria for each question",
    },
    {
      id: "includeQuestionChoices",
      label: "Question Choices",
      description: "Multiple choice options and correct answers",
    },
    {
      id: "includeVariants",
      label: "Question Variants",
      description: "Alternative versions of questions (if any)",
    },
  ];

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <DocumentArrowDownIcon className="w-6 h-6 text-purple-600" />
            <h2 className="text-xl font-semibold text-gray-900">
              Export Assignment
            </h2>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <XMarkIcon className="w-6 h-6" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          {/* Format Selection */}
          <div className="mb-6">
            <h3 className="text-lg font-medium text-gray-900 mb-4">
              Export Format
            </h3>
            <div className="grid grid-cols-3 gap-4">
              {[
                {
                  value: "json" as const,
                  label: "JSON",
                  description: "Machine-readable format for developers",
                },
                {
                  value: "pdf" as const,
                  label: "PDF",
                  description: "Human-readable document for sharing",
                },
                {
                  value: "csv" as const,
                  label: "CSV",
                  description: "Spreadsheet format for data analysis",
                },
              ].map((formatOption) => (
                <button
                  key={formatOption.value}
                  onClick={() => setFormat(formatOption.value)}
                  className={cn(
                    "p-4 border rounded-lg text-left transition-all",
                    format === formatOption.value
                      ? "border-purple-500 bg-purple-50 text-purple-900"
                      : "border-gray-200 hover:border-gray-300",
                  )}
                >
                  <div className="font-medium mb-1">{formatOption.label}</div>
                  <div className="text-sm text-gray-600">
                    {formatOption.description}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Export Options */}
          <div className="mb-6">
            <h3 className="text-lg font-medium text-gray-900 mb-4">
              What to Include
            </h3>
            <div className="space-y-3">
              {exportOptionsList.map((option) => (
                <div
                  key={option.id}
                  className="flex items-start gap-3 p-3 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  <button
                    onClick={() => handleOptionChange(option.id)}
                    className={cn(
                      "w-5 h-5 border-2 rounded flex items-center justify-center mt-0.5 transition-colors",
                      exportOptions[option.id]
                        ? "border-purple-500 bg-purple-500"
                        : "border-gray-300 hover:border-purple-400",
                    )}
                  >
                    {exportOptions[option.id] && (
                      <CheckIcon className="w-3 h-3 text-white" />
                    )}
                  </button>
                  <div className="flex-1">
                    <div className="font-medium text-gray-900">
                      {option.label}
                    </div>
                    <div className="text-sm text-gray-600">
                      {option.description}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Quick Select Options */}
          <div className="mb-6">
            <h3 className="text-lg font-medium text-gray-900 mb-4">
              Quick Select
            </h3>
            <div className="flex gap-2">
              <button
                onClick={() =>
                  setExportOptions({
                    includeAssignmentData: true,
                    includeQuestions: true,
                    includeConfig: true,
                    includeFeedbackConfig: true,
                    includeGradingCriteria: true,
                    includeRubrics: true,
                    includeQuestionChoices: true,
                    includeVariants: true,
                  })
                }
                className="px-4 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
              >
                Select All
              </button>
              <button
                onClick={() =>
                  setExportOptions({
                    includeAssignmentData: false,
                    includeQuestions: false,
                    includeConfig: false,
                    includeFeedbackConfig: false,
                    includeGradingCriteria: false,
                    includeRubrics: false,
                    includeQuestionChoices: false,
                    includeVariants: false,
                  })
                }
                className="px-4 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
              >
                Deselect All
              </button>
              <button
                onClick={() =>
                  setExportOptions({
                    includeAssignmentData: true,
                    includeQuestions: true,
                    includeConfig: false,
                    includeFeedbackConfig: false,
                    includeGradingCriteria: true,
                    includeRubrics: true,
                    includeQuestionChoices: true,
                    includeVariants: false,
                  })
                }
                className="px-4 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
              >
                Essential Only
              </button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-6 border-t border-gray-200 bg-gray-50">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleExport}
            className="px-4 py-2 text-sm font-medium text-white bg-purple-600 border border-transparent rounded-md hover:bg-purple-700 transition-colors flex items-center gap-2"
          >
            <DocumentArrowDownIcon className="w-4 h-4" />
            Export Assignment
          </button>
        </div>
      </div>
    </div>
  );
};

export default ExportModal;
