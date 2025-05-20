// components/admin/FlaggedSubmissions.tsx
"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ExclamationTriangleIcon,
  MagnifyingGlassIcon,
  FunnelIcon,
  ArrowsUpDownIcon,
  CheckCircleIcon,
  UserIcon,
  DocumentTextIcon,
  ClockIcon,
  QuestionMarkCircleIcon,
  XMarkIcon,
  LightBulbIcon,
} from "@heroicons/react/24/outline";
import animationData from "@/animations/LoadSN.json";
import { FlaggedSubmission } from "@/config/types";
import FlaggedSubmissionModal from "./FlaggedSubmissionModal";
import LoadingSpinner from "../Loading";
import {
  useGetFlaggedSubmissionsQuery,
  useDismissFlaggedSubmissionMutation,
} from "@/lib/admin";

export default function FlaggedSubmissions() {
  const [searchTerm, setSearchTerm] = useState("");
  const [reasonFilter, setReasonFilter] = useState<
    "all" | "plagiarism" | "time" | "ai"
  >("all");
  const [sortBy, setSortBy] = useState<"date" | "assignment">("date");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");

  const [selectedSubmission, setSelectedSubmission] =
    useState<FlaggedSubmission | null>(null);
  const [isDetailsModalOpen, setIsDetailsModalOpen] = useState(false);

  // RTK Query hooks
  const {
    data: flaggedSubmissions = [],
    isLoading,
    error,
  } = useGetFlaggedSubmissionsQuery();

  const [dismissSubmission, { isLoading: isDismissing }] =
    useDismissFlaggedSubmissionMutation();

  // Helper to determine reason type from text
  const getReasonType = (
    reason: string,
  ): "plagiarism" | "time" | "ai" | "other" => {
    const lowerReason = reason.toLowerCase();
    if (lowerReason.includes("plagia") || lowerReason.includes("similar"))
      return "plagiarism";
    if (
      lowerReason.includes("time") ||
      lowerReason.includes("fast") ||
      lowerReason.includes("minutes")
    )
      return "time";
    if (lowerReason.includes("ai") || lowerReason.includes("generated"))
      return "ai";
    return "other";
  };

  // Filter and sort submissions
  const filteredSubmissions = flaggedSubmissions
    .filter((submission) => {
      // Apply search filter (user ID or reason)
      if (
        searchTerm &&
        !submission.userId
          .toLowerCase()
          .includes(searchTerm.toLowerCase()) &&
        !submission.reason.toLowerCase().includes(searchTerm.toLowerCase())
      ) {
        return false;
      }

      // Apply reason filter
      if (reasonFilter !== "all") {
        const reasonType = getReasonType(submission.reason);
        if (reasonFilter !== reasonType) {
          return false;
        }
      }

      return true;
    })
    .sort((a, b) => {
      // Apply sorting
      if (sortBy === "date") {
        const dateA = new Date(a.createdAt).getTime();
        const dateB = new Date(b.createdAt).getTime();
        return sortDirection === "asc" ? dateA - dateB : dateB - dateA;
      }

      if (sortBy === "assignment") {
        return sortDirection === "asc"
          ? a.assignmentId - b.assignmentId
          : b.assignmentId - a.assignmentId;
      }

      return 0;
    });

  const handleSort = (key: "date" | "assignment") => {
    if (sortBy === key) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortBy(key);
      setSortDirection("asc");
    }
  };

  const handleOpenDetails = (submission: FlaggedSubmission) => {
    setSelectedSubmission(submission);
    setIsDetailsModalOpen(true);
  };

  const handleDismissSubmission = async (submissionId: number) => {
    try {
      await dismissSubmission(submissionId).unwrap();
      setIsDetailsModalOpen(false);
      // Success toast could be added here
    } catch (error) {
      console.error("Failed to dismiss submission:", error);
      // Error toast could be added here
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "numeric",
      hour12: true,
    }).format(date);
  };

  const getReasonIcon = (reason: string) => {
    const reasonType = getReasonType(reason);

    switch (reasonType) {
      case "plagiarism":
        return (
          <span className="inline-flex items-center justify-center p-1.5 bg-red-100 rounded-full text-red-600">
            <DocumentTextIcon className="h-5 w-5" />
          </span>
        );
      case "time":
        return (
          <span className="inline-flex items-center justify-center p-1.5 bg-amber-100 rounded-full text-amber-600">
            <ClockIcon className="h-5 w-5" />
          </span>
        );
      case "ai":
        return (
          <span className="inline-flex items-center justify-center p-1.5 bg-blue-100 rounded-full text-blue-600">
            <LightBulbIcon className="h-5 w-5" />
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center justify-center p-1.5 bg-gray-100 rounded-full text-gray-600">
            <QuestionMarkCircleIcon className="h-5 w-5" />
          </span>
        );
    }
  };

  const getReasonLabel = (reason: string) => {
    const reasonType = getReasonType(reason);

    switch (reasonType) {
      case "plagiarism":
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
            Plagiarism
          </span>
        );
      case "time":
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800">
            Time Anomaly
          </span>
        );
      case "ai":
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
            AI-Generated
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
            Other
          </span>
        );
    }
  };

  // Show error state
  if (error) {
    return (
      <div className="p-6 bg-red-50 text-red-600 rounded-md">
        Error loading flagged submissions: {error.toString()}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Filters & Actions */}
      <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-100">
        <div className="flex flex-col sm:flex-row justify-between gap-4">
          <div className="flex flex-1 items-center">
            <div className="relative flex-1 max-w-md">
              <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
                <MagnifyingGlassIcon className="h-5 w-5 text-gray-400" />
              </div>
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10 pr-3 py-2 w-full border border-gray-300 rounded-md focus:ring-violet-500 focus:border-violet-500"
                placeholder="Search by user ID or reason..."
                disabled={isLoading}
              />
            </div>

            <div className="ml-2">
              <button
                onClick={() => {
                  setReasonFilter(
                    reasonFilter === "all"
                      ? "plagiarism"
                      : reasonFilter === "plagiarism"
                        ? "time"
                        : reasonFilter === "time"
                          ? "ai"
                          : "all",
                  );
                }}
                className="inline-flex items-center px-3 py-2 border border-gray-300 rounded-md bg-white text-gray-700 hover:bg-gray-50"
                disabled={isLoading}
              >
                <FunnelIcon className="h-5 w-5 mr-2" />
                <span>
                  {reasonFilter === "all"
                    ? "All Flags"
                    : reasonFilter === "plagiarism"
                      ? "Plagiarism"
                      : reasonFilter === "time"
                        ? "Time Anomalies"
                        : "AI-Generated"}
                </span>
              </button>
            </div>

            <div className="ml-2">
              <button
                onClick={() =>
                  handleSort(sortBy === "date" ? "assignment" : "date")
                }
                className="inline-flex items-center px-3 py-2 border border-gray-300 rounded-md bg-white text-gray-700 hover:bg-gray-50"
                disabled={isLoading}
              >
                <ArrowsUpDownIcon className="h-5 w-5 mr-2" />
                <span>
                  Sort by {sortBy === "date" ? "Date" : "Assignment"}{" "}
                  {sortDirection === "asc" ? "↑" : "↓"}
                </span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Flagged Submissions List */}
      {isLoading ? (
        <div className="flex justify-center items-center h-64">
          <LoadingSpinner animationData={animationData} />
        </div>
      ) : filteredSubmissions.length > 0 ? (
        <div className="space-y-4">
          <AnimatePresence>
            {filteredSubmissions.map((submission, index) => (
              <motion.div
                key={submission.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ duration: 0.3, delay: index * 0.05 }}
                className="bg-white p-6 rounded-lg shadow-sm border border-gray-100 hover:shadow-md transition-shadow duration-300"
              >
                <div className="flex justify-between items-start">
                  <div className="flex">
                    {getReasonIcon(submission.reason)}
                    <div className="ml-4">
                      <h3 className="text-lg font-medium text-gray-900">
                        Assignment ID: {submission.assignmentId}
                      </h3>
                      <p className="text-sm text-gray-500 mt-1">
                        <span className="inline-flex items-center">
                          <UserIcon className="h-4 w-4 mr-1" />
                          User: {submission.userId}
                        </span>
                        <span className="inline-flex items-center ml-3">
                          <DocumentTextIcon className="h-4 w-4 mr-1" />
                          Question ID: {submission.questionId}
                        </span>
                      </p>
                      <p className="text-sm text-gray-500 mt-1">
                        Flagged: {formatDate(submission.createdAt)}
                      </p>
                    </div>
                  </div>
                  <div>{getReasonLabel(submission.reason)}</div>
                </div>

                <div className="mt-4">
                  <h4 className="text-sm font-medium text-gray-700 mb-1">
                    Flag Reason:
                  </h4>
                  <p className="text-sm text-gray-600 line-clamp-2">
                    {submission.reason}
                  </p>
                </div>

                <div className="mt-4 flex justify-end">
                  <button
                    onClick={() => handleOpenDetails(submission)}
                    className="inline-flex items-center px-3 py-1.5 border border-violet-500 text-violet-600 bg-white hover:bg-violet-50 rounded-md text-sm font-medium transition-colors"
                    disabled={isDismissing}
                  >
                    Review Submission
                  </button>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      ) : (
        <div className="bg-white p-12 rounded-lg shadow-sm border border-gray-100 text-center">
          <ExclamationTriangleIcon className="w-16 h-16 mx-auto text-gray-400" />
          <h3 className="mt-4 text-lg font-medium text-gray-900">
            No flagged submissions found
          </h3>
          <p className="mt-2 text-gray-500">
            {searchTerm || reasonFilter !== "all"
              ? "Try adjusting your search or filters"
              : "All flagged submissions will appear here"}
          </p>
        </div>
      )}

      {/* Flagged Submission Modal */}
      {selectedSubmission && isDetailsModalOpen && (
        <FlaggedSubmissionModal
          submission={selectedSubmission}
          isOpen={isDetailsModalOpen}
          onClose={() => setIsDetailsModalOpen(false)}
          onDismiss={handleDismissSubmission}
        />
      )}
    </div>
  );
}