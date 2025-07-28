"use client";

import { REPORT_TYPE } from "@/config/types";
import { submitReportAuthor, submitReportLearner } from "@/lib/talkToBackend";
import { Dialog, DialogPanel, DialogTitle } from "@headlessui/react";
import { XMarkIcon } from "@heroicons/react/24/outline";
import { motion } from "framer-motion";
import React, { FC, useState } from "react";
import { toast } from "sonner";

const ReportModal: FC<{
  assignmentId: number;
  isReportModalOpen: boolean;
  setIsReportModalOpen: (isOpen: boolean) => void;
  isAuthor: boolean;
  attemptId?: number;
}> = ({
  assignmentId,
  isReportModalOpen,
  setIsReportModalOpen,
  isAuthor,
  attemptId,
}) => {
  const [issueType, setReportIssueType] = useState<REPORT_TYPE>(
    REPORT_TYPE.BUG,
  );
  const [description, setDescription] = useState("");

  const handleSubmitReport = async () => {
    if (!description.trim()) {
      toast.error("Please provide a description for the report.");
      return;
    }

    try {
      const response = isAuthor
        ? await submitReportAuthor(assignmentId, issueType, description)
        : await submitReportLearner(
            assignmentId,
            attemptId,
            issueType,
            description,
          );
      if (response) {
        toast.success("Report submitted successfully!");
        setIsReportModalOpen(false);
      }
    } catch (error) {
      console.error("Error submitting report:", error);
      toast.error("Failed to submit the report. Please try again.");
    }
  };
  return (
    <Dialog
      as={motion.div}
      static
      className="fixed inset-0 z-50 overflow-y-auto bg-black bg-opacity-50"
      open={isReportModalOpen}
      onClose={() => setIsReportModalOpen(false)}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <div className="min-h-screen px-4 text-center">
        <span className="inline-block h-screen align-middle" aria-hidden="true">
          &#8203;
        </span>
        <motion.div
          className="inline-block w-full max-w-md p-6 my-8 overflow-hidden text-left align-middle transition-all transform bg-white shadow-xl rounded-lg"
          initial={{ scale: 0.9 }}
          animate={{ scale: 1 }}
          exit={{ scale: 0.9 }}
        >
          <DialogPanel>
            <DialogTitle
              as="h3"
              className="text-lg font-medium leading-6 text-gray-900 mb-4"
            >
              <div className="flex justify-between items-center">
                Report an issue
                <XMarkIcon
                  className="w-6 h-6 text-gray-500 hover:cursor-pointer"
                  onClick={() => setIsReportModalOpen(false)}
                />
              </div>
            </DialogTitle>
            <span className="text-gray-600 ">
              Report issues, bugs, or provide feedback about the assignment. Our
              team will review your report and take action as needed.
            </span>
            <div className="space-y-4">
              <div>
                <label className="block text-gray-700 font-semibold my-2">
                  Issue Type
                </label>
                <select
                  className="w-full p-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                  value={issueType}
                  onChange={(e) =>
                    setReportIssueType(e.target.value as REPORT_TYPE)
                  }
                >
                  <option value="BUG">I found a bug</option>
                  <option value="FEEDBACK">I want to provide a feedback</option>
                  <option value="SUGGESTION">
                    I have a suggestion to improve the assingment
                  </option>
                  <option value="PERFORMANCE">
                    My assignment was having performance issues
                  </option>
                  <option value="FALSE_MARKING">
                    I think the AI marked my assignment wrong
                  </option>
                  <option value="OTHER">Other (specify in field)</option>
                </select>
              </div>
              <div>
                <label className="block text-gray-700 font-semibold mb-2">
                  Description of the issue
                </label>
                <textarea
                  className="w-full p-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                  rows={5}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Provide details about the issue..."
                ></textarea>
              </div>
              <div className="text-center">
                <button
                  onClick={handleSubmitReport}
                  className="px-6 py-2 bg-violet-600 hover:bg-violet-500 text-white rounded-md transition shadow-lg"
                >
                  Submit Report
                </button>
              </div>
            </div>
          </DialogPanel>
        </motion.div>
      </div>
    </Dialog>
  );
};

export default ReportModal;
