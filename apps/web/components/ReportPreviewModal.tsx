"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Dialog, DialogPanel, DialogTitle } from "@headlessui/react";
import { motion } from "framer-motion";
import {
  ExclamationTriangleIcon,
  XMarkIcon,
  ChatBubbleBottomCenterTextIcon,
  LightBulbIcon,
  QuestionMarkCircleIcon,
} from "@heroicons/react/24/outline";
import { toast } from "sonner";
import { useDropzone } from "react-dropzone";

interface ScreenshotDropzoneProps {
  file: File | null | undefined;
  onFileSelect: (file: File) => void;
  onFileRemove: () => void;
}

const ScreenshotDropzone: React.FC<ScreenshotDropzoneProps> = ({
  file,
  onFileSelect,
  onFileRemove,
}) => {
  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      if (acceptedFiles.length > 0) {
        onFileSelect(acceptedFiles[0]);
      }
    },
    [onFileSelect],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "image/*": [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg"],
    },
    multiple: false,
    maxSize: 10 * 1024 * 1024,
    onDropRejected: (rejectedFiles) => {
      const error = rejectedFiles[0]?.errors[0];
      if (error?.code === "file-too-large") {
        toast.error("File is too large. Maximum size is 10MB.");
      } else if (error?.code === "file-invalid-type") {
        toast.error("Invalid file type. Please select an image file.");
      } else {
        toast.error("File rejected. Please try another file.");
      }
    },
  });

  return (
    <div className="space-y-2">
      <div
        {...getRootProps()}
        className={`border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors ${
          isDragActive
            ? "border-blue-400 bg-blue-50 dark:bg-blue-900/20"
            : file
              ? "border-green-400 bg-green-50 dark:bg-green-900/20"
              : "border-gray-300 hover:border-gray-400 dark:border-gray-600"
        }`}
      >
        <input {...getInputProps()} />
        {file ? (
          <div className="space-y-2">
            <p className="text-sm text-green-700 dark:text-green-300">
              {file.name}
            </p>
            <p className="text-xs text-gray-600 dark:text-gray-400">
              Click to replace or drag new file
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-gray-600 dark:text-gray-300">
              Drag and drop an image, or click to select
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              PNG, JPG, GIF up to 10MB
            </p>
          </div>
        )}
      </div>
      {file && (
        <button
          onClick={(e) => {
            e.preventDefault();
            onFileRemove();
          }}
          className="text-xs text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300"
        >
          Remove file
        </button>
      )}
    </div>
  );
};

interface ReportPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  reportType: "report" | "feedback" | "suggestion" | "inquiry";
  initialData?: {
    assignmentId?: number;
    issueType?: string;
    description?: string;
    severity?: string;
    screenshot?: File | null;
    userEmail?: string;
  };
  isAuthor?: boolean;
  attemptId?: number;
  onSubmit: (action: string, value?: any) => void;
}

const ReportPreviewModal: React.FC<ReportPreviewModalProps> = ({
  isOpen,
  onClose,
  reportType,
  initialData,
  isAuthor = false,
  attemptId,
  onSubmit,
}) => {
  const [issueType, setIssueType] = useState(
    initialData?.issueType || getDefaultIssueType(reportType),
  );
  const [descriptionFields, setDescriptionFields] = useState<
    Record<string, string>
  >({});
  const [severity, setSeverity] = useState(initialData?.severity || "info");
  const [screenshot, setScreenshot] = useState<File | null>(
    initialData?.screenshot || null,
  );
  const [userEmail, setUserEmail] = useState(initialData?.userEmail || "");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (initialData) {
      setIssueType(initialData.issueType || getDefaultIssueType(reportType));
      setSeverity(initialData.severity || "info");
      setScreenshot(initialData.screenshot || null);
      setUserEmail(initialData.userEmail || "");
    } else {
      setIssueType(getDefaultIssueType(reportType));
      setSeverity("info");
      setScreenshot(null);
      setUserEmail("");
    }
  }, [initialData, reportType]);

  function getDefaultIssueType(type: string): string {
    switch (type) {
      case "feedback":
        return "FEEDBACK";
      case "suggestion":
        return "SUGGESTION";
      case "inquiry":
        return "OTHER";
      default:
        return "BUG";
    }
  }

  function getModalIcon() {
    switch (reportType) {
      case "feedback":
        return <ChatBubbleBottomCenterTextIcon className="w-5 h-5" />;
      case "suggestion":
        return <LightBulbIcon className="w-5 h-5" />;
      case "inquiry":
        return <QuestionMarkCircleIcon className="w-5 h-5" />;
      default:
        return <ExclamationTriangleIcon className="w-5 h-5" />;
    }
  }

  function getModalTitle() {
    switch (reportType) {
      case "feedback":
        return "Provide Feedback";
      case "suggestion":
        return "Share Your Suggestion";
      case "inquiry":
        return "Submit Inquiry";
      default:
        return "Report Issue";
    }
  }

  function getModalDescription() {
    switch (reportType) {
      case "feedback":
        return "Share your thoughts and feedback about your learning experience.";
      case "suggestion":
        return "Help us improve by sharing your ideas and suggestions.";
      case "inquiry":
        return "Ask a question or make a general inquiry.";
      default:
        return "Report a problem or issue you've encountered.";
    }
  }

  type DescriptionField = {
    key: string;
    label: string;
    placeholder: string;
    required?: boolean;
    rows?: number;
  };

  function getDescriptionFields(type: string): DescriptionField[] {
    switch (type) {
      case "feedback":
        return [
          {
            key: "liked",
            label: "What you liked",
            placeholder: "Share what worked well for you.",
            required: true,
            rows: 3,
          },
          {
            key: "improve",
            label: "What could be improved",
            placeholder: "What didn't work or could be better?",
            required: true,
            rows: 3,
          },
          {
            key: "why",
            label: "Why this matters",
            placeholder: "Explain the impact on your learning.",
            rows: 3,
          },
          {
            key: "context",
            label: "Additional context",
            placeholder: "Any extra details or links.",
            rows: 3,
          },
        ];
      case "suggestion":
        return [
          {
            key: "problem",
            label: "Problem or opportunity",
            placeholder: "Describe the gap or opportunity.",
            required: true,
            rows: 3,
          },
          {
            key: "proposal",
            label: "Proposed change",
            placeholder: "What change would you like to see?",
            required: true,
            rows: 3,
          },
          {
            key: "benefit",
            label: "Why this helps",
            placeholder: "Explain the expected benefit.",
            rows: 3,
          },
          {
            key: "examples",
            label: "Examples or references",
            placeholder: "Links, screenshots, or similar examples.",
            rows: 3,
          },
        ];
      case "inquiry":
        return [
          {
            key: "goal",
            label: "What you're trying to do",
            placeholder: "Describe your goal.",
            required: true,
            rows: 3,
          },
          {
            key: "tried",
            label: "What you've tried so far",
            placeholder: "Steps you already attempted.",
            rows: 3,
          },
          {
            key: "stuck",
            label: "Where you're stuck",
            placeholder: "Describe the blocker or error.",
            required: true,
            rows: 3,
          },
          {
            key: "links",
            label: "Relevant links or IDs",
            placeholder: "Assignment ID, URLs, or other references.",
            rows: 2,
          },
        ];
      default:
        return [
          {
            key: "steps",
            label: "Steps to reproduce",
            placeholder: "1. ...\n2. ...",
            required: true,
            rows: 4,
          },
          {
            key: "expected",
            label: "Expected result",
            placeholder: "What you expected to happen.",
            required: true,
            rows: 3,
          },
          {
            key: "actual",
            label: "Actual result",
            placeholder: "What actually happened.",
            required: true,
            rows: 3,
          },
          {
            key: "environment",
            label: "Environment (browser/device)",
            placeholder: "Browser, OS, device, network, etc.",
            rows: 2,
          },
          {
            key: "context",
            label: "Additional context",
            placeholder: "Anything else that helps us investigate.",
            rows: 3,
          },
        ];
    }
  }

  function getIssueTypeOptions() {
    switch (reportType) {
      case "feedback":
        return [
          { value: "FEEDBACK", label: "General Feedback" },
          { value: "PERFORMANCE", label: "Performance Feedback" },
          { value: "BUG", label: "Bug Report" },
          { value: "OTHER", label: "Other" },
        ];

      case "suggestion":
        return [
          { value: "SUGGESTION", label: "Feature Suggestion" },
          { value: "FEEDBACK", label: "Improvement Idea" },
          { value: "OTHER", label: "Other Suggestion" },
        ];

      case "inquiry":
        return [
          { value: "OTHER", label: "General Question" },
          { value: "FEEDBACK", label: "How-to Question" },
          { value: "BUG", label: "Technical Question" },
        ];

      default:
        return [
          { value: "BUG", label: "Bug/Technical Issue" },
          { value: "FALSE_MARKING", label: "Grading Issue" },
          { value: "PERFORMANCE", label: "Performance Issue" },
          { value: "OTHER", label: "Other" },
        ];
    }
  }

  const initializeDescriptionFields = useCallback(
    (prefill?: string) => {
      const fields = getDescriptionFields(reportType);
      const initialValues: Record<string, string> = {};
      fields.forEach((field) => {
        initialValues[field.key] = "";
      });
      if (prefill) {
        const contextField = fields.find((field) => field.key === "context");
        if (contextField) {
          initialValues[contextField.key] = prefill;
        }
      }
      setDescriptionFields(initialValues);
    },
    [reportType],
  );

  useEffect(() => {
    initializeDescriptionFields(initialData?.description);
  }, [initialData?.description, initializeDescriptionFields]);

  const handleFieldChange = (key: string, value: string) => {
    setDescriptionFields((prev) => ({ ...prev, [key]: value }));
  };

  const buildDescription = (): { text: string; missing: string[] } => {
    const fields = getDescriptionFields(reportType);
    const missing = fields
      .filter((field) => field.required)
      .filter((field) => !descriptionFields[field.key]?.trim())
      .map((field) => field.label);

    const text = fields
      .map((field) => {
        const value = descriptionFields[field.key]?.trim();
        if (!value) return null;
        return `**${field.label}:**\n${value}`;
      })
      .filter(Boolean)
      .join("\n\n");

    return { text, missing };
  };

  const handleSubmit = async () => {
    const { text, missing } = buildDescription();
    if (missing.length > 0) {
      toast.error(`Please fill: ${missing.join(", ")}`);
      return;
    }

    setIsSubmitting(true);
    try {
      onSubmit("submit", {
        issueType,
        description: text,
        severity,
        screenshot,
        userEmail,
        assignmentId: initialData?.assignmentId,
        attemptId: attemptId,
      });

      setIssueType(getDefaultIssueType(reportType));
      setSeverity("info");
      setScreenshot(null);
      setUserEmail("");
      initializeDescriptionFields();
      onClose();
    } catch (error) {
      console.error("Error submitting:", error);
      toast.error("Failed to submit. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel = () => {
    setIssueType(getDefaultIssueType(reportType));
    setSeverity("info");
    setScreenshot(null);
    setUserEmail("");
    initializeDescriptionFields();
    onClose();
  };

  return (
    <Dialog open={isOpen} onClose={onClose} className="relative z-50">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black bg-opacity-50"
      />

      <div className="fixed inset-0 flex items-center justify-center p-4">
        <motion.div
          initial={{ scale: 0.9 }}
          animate={{ scale: 1 }}
          exit={{ scale: 0.9 }}
          className="w-full max-w-2xl"
        >
          <DialogPanel className="bg-white dark:bg-gray-800 shadow-xl rounded-lg p-6 max-h-[90vh] overflow-y-auto">
            <DialogTitle
              as="h3"
              className="flex justify-between items-center text-lg font-medium leading-6 text-gray-900 dark:text-gray-100 mb-4"
            >
              <div className="flex items-center gap-2 text-blue-700 dark:text-blue-400">
                {getModalIcon()}
                {getModalTitle()}
              </div>
              <button
                onClick={handleCancel}
                className="rounded-full p-1 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 transition"
              >
                <XMarkIcon className="w-6 h-6" />
              </button>
            </DialogTitle>

            <p className="text-sm text-gray-600 dark:text-gray-300 mb-6">
              {getModalDescription()}
            </p>

            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Type
                </label>
                <select
                  value={issueType}
                  onChange={(e) => setIssueType(e.target.value)}
                  className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded-md p-3 bg-white dark:bg-gray-900 dark:text-gray-200 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  {getIssueTypeOptions().map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Description *
                </label>
                <div className="space-y-4">
                  {getDescriptionFields(reportType).map((field) => (
                    <div key={field.key}>
                      <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                        {field.label}
                        {field.required ? " *" : ""}
                      </label>
                      <textarea
                        value={descriptionFields[field.key] || ""}
                        onChange={(e) =>
                          handleFieldChange(field.key, e.target.value)
                        }
                        rows={field.rows || 3}
                        className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded-md p-3 bg-white dark:bg-gray-900 dark:text-gray-200 resize-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        placeholder={field.placeholder}
                      />
                    </div>
                  ))}
                </div>
              </div>

              {reportType === "report" && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Severity
                  </label>
                  <select
                    value={severity}
                    onChange={(e) => setSeverity(e.target.value)}
                    className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded-md p-3 bg-white dark:bg-gray-900 dark:text-gray-200 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  >
                    <option value="info">Info</option>
                    <option value="warning">Warning</option>
                    <option value="error">Error</option>
                    <option value="critical">Critical</option>
                  </select>
                </div>
              )}

              {initialData?.assignmentId && initialData.assignmentId !== 0 && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Assignment ID
                  </label>
                  <input
                    type="number"
                    value={initialData.assignmentId}
                    readOnly
                    className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded-md p-3 bg-gray-100 dark:bg-gray-700 dark:text-gray-300 cursor-not-allowed"
                  />
                </div>
              )}

              {userEmail && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Email
                  </label>
                  <input
                    type="email"
                    value={userEmail}
                    readOnly
                    className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded-md p-3 bg-gray-100 dark:bg-gray-700 dark:text-gray-300 cursor-not-allowed"
                  />
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Screenshot (optional)
                </label>
                <ScreenshotDropzone
                  file={screenshot}
                  onFileSelect={setScreenshot}
                  onFileRemove={() => setScreenshot(null)}
                />
              </div>

              <div className="flex gap-3 justify-end pt-4 border-t border-gray-200 dark:border-gray-700">
                <button
                  onClick={handleCancel}
                  disabled={isSubmitting}
                  className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 rounded-md transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={
                    isSubmitting || buildDescription().missing.length > 0
                  }
                  className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 rounded-md transition-colors disabled:opacity-50"
                >
                  {isSubmitting
                    ? "Submitting..."
                    : reportType === "feedback"
                      ? "Submit Feedback"
                      : reportType === "suggestion"
                        ? "Submit Suggestion"
                        : reportType === "inquiry"
                          ? "Submit Inquiry"
                          : "Submit Report"}
                </button>
              </div>
            </div>
          </DialogPanel>
        </motion.div>
      </div>
    </Dialog>
  );
};

export default ReportPreviewModal;
