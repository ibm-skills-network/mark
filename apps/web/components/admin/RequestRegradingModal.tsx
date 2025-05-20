
// components/admin/RegradingDetailsModal.tsx
"use client"

import { useState, Fragment } from "react";
import { Dialog, Transition, RadioGroup } from "@headlessui/react";
import {
  XMarkIcon,
  CheckCircleIcon,
  XCircleIcon,
} from "@heroicons/react/24/outline";
import { motion } from "framer-motion";
import { RegradingRequest } from "@/config/types";

interface RegradingDetailsModalProps {
  request: RegradingRequest;
  isOpen: boolean;
  onClose: () => void;
  onApprove: (requestId: number, newGrade: number) => Promise<void>;
  onReject: (requestId: number, reason: string) => Promise<void>;
}

export default function RegradingDetailsModal({
  request,
  isOpen,
  onClose,
  onApprove,
  onReject,
}: RegradingDetailsModalProps) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [decision, setDecision] = useState<"approve" | "reject" | null>(null);
  const [newGrade, setNewGrade] = useState(75); // Default to 75%
  const [rejectionReason, setRejectionReason] = useState("");

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

  const handleSubmit = async () => {
    if (!decision) return;

    setIsProcessing(true);
    try {
      if (decision === "approve") {
        await onApprove(request.id, newGrade);
      } else {
        await onReject(request.id, rejectionReason);
      }
    } catch (error) {
      console.error("Failed to process request:", error);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <Transition appear show={isOpen} as={Fragment}>
      <Dialog
        as="div"
        className="fixed inset-0 z-50 overflow-y-auto"
        onClose={onClose}
      >
        <div className="min-h-screen px-4 text-center">
          <Transition.Child
            as={Fragment}
            enter="ease-out duration-300"
            enterFrom="opacity-0"
            enterTo="opacity-100"
            leave="ease-in duration-200"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <div className="fixed inset-0 bg-black opacity-30" />
          </Transition.Child>

          <span
            className="inline-block h-screen align-middle"
            aria-hidden="true"
          >
            &#8203;
          </span>

          <Transition.Child
            as={Fragment}
            enter="ease-out duration-300"
            enterFrom="opacity-0 scale-95"
            enterTo="opacity-100 scale-100"
            leave="ease-in duration-200"
            leaveFrom="opacity-100 scale-100"
            leaveTo="opacity-0 scale-95"
          >
            <div className="inline-block w-full max-w-2xl p-6 my-8 overflow-hidden text-left align-middle transition-all transform bg-white shadow-xl rounded-lg">
              <Dialog.Title
                as="div"
                className="flex justify-between items-center"
              >
                <h3 className="text-lg font-medium text-gray-900">
                  Regrading Request Details
                </h3>
                <button
                  type="button"
                  className="text-gray-400 hover:text-gray-500"
                  onClick={onClose}
                >
                  <XMarkIcon className="h-6 w-6" />
                </button>
              </Dialog.Title>

              <div className="mt-4 space-y-6">
                {/* Request Details */}
                <div className="bg-gray-50 p-4 rounded-md border border-gray-200">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <h4 className="text-sm font-medium text-gray-500">
                        Assignment ID
                      </h4>
                      <p className="text-gray-900">{request.assignmentId}</p>
                    </div>
                    <div>
                      <h4 className="text-sm font-medium text-gray-500">
                        User ID
                      </h4>
                      <p className="text-gray-900">{request.userId}</p>
                    </div>
                    <div>
                      <h4 className="text-sm font-medium text-gray-500">
                        Attempt ID
                      </h4>
                      <p className="text-gray-900">{request.attemptId}</p>
                    </div>
                    <div>
                      <h4 className="text-sm font-medium text-gray-500">
                        Submitted
                      </h4>
                      <p className="text-gray-900">
                        {formatDate(request.createdAt)}
                      </p>
                    </div>
                  </div>

                  <div className="mt-4">
                    <h4 className="text-sm font-medium text-gray-500">
                      Reason for Regrading
                    </h4>
                    <p className="text-gray-900 mt-1 whitespace-pre-line">
                      {request.reason}
                    </p>
                  </div>
                </div>

                {/* Submission Preview (Mockup) */}
                <div className="rounded-md border border-gray-200">
                  <div className="p-3 bg-gray-50 border-b border-gray-200">
                    <h4 className="font-medium text-gray-700">
                      Submission Preview
                    </h4>
                  </div>
                  <div className="p-4">
                    <div className="bg-gray-50 p-3 border border-gray-200 rounded-md">
                      <h5 className="text-sm font-medium text-gray-700 mb-2">
                        Question 3
                      </h5>
                      <p className="text-sm text-gray-600 mb-3">
                        Explain the differences between TCP and UDP protocols.
                      </p>
                      <div className="mt-2 p-3 bg-white border border-gray-300 rounded-md">
                        <p className="text-sm text-gray-900">
                          TCP and UDP are both transport layer protocols. TCP is
                          connection-oriented, reliable, and ensures ordered
                          data delivery with flow control. It establishes a
                          connection before data transfer and confirms delivery.
                          UDP is connectionless, faster, and has less overhead.
                          It doesn't guarantee delivery or order but is suitable
                          for real-time applications where speed is prioritized
                          over reliability.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Decision Section */}
                <div>
                  <h4 className="font-medium text-gray-700 mb-3">
                    Make a Decision
                  </h4>

                  <RadioGroup value={decision} onChange={setDecision}>
                    <div className="space-y-4">
                      <RadioGroup.Option
                        value="approve"
                        className={({ checked }) =>
                          `${
                            checked
                              ? "bg-green-50 border-green-200"
                              : "bg-white border-gray-200"
                          } relative border rounded-lg shadow-sm px-4 py-3 cursor-pointer focus:outline-none`
                        }
                      >
                        {({ checked }) => (
                          <div className="flex items-center justify-between">
                            <div className="flex items-center">
                              <div className="text-sm">
                                <RadioGroup.Label
                                  as="p"
                                  className={`font-medium ${
                                    checked ? "text-green-900" : "text-gray-900"
                                  }`}
                                >
                                  Approve Request
                                </RadioGroup.Label>
                                <RadioGroup.Description
                                  as="span"
                                  className={`inline ${
                                    checked ? "text-green-700" : "text-gray-500"
                                  }`}
                                >
                                  Adjust the grade for this submission
                                </RadioGroup.Description>
                              </div>
                            </div>
                            <div
                              className={`${checked ? "text-green-600" : "text-gray-400"}`}
                            >
                              <CheckCircleIcon className="h-6 w-6" />
                            </div>
                          </div>
                        )}
                      </RadioGroup.Option>

                      {decision === "approve" && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: "auto" }}
                          exit={{ opacity: 0, height: 0 }}
                          className="ml-6 p-3 bg-green-50 border border-green-100 rounded-md"
                        >
                          <label
                            htmlFor="newGrade"
                            className="block text-sm font-medium text-green-800 mb-1"
                          >
                            New Grade (%)
                          </label>
                          <div className="flex items-center">
                            <input
                              type="range"
                              id="newGrade"
                              min="0"
                              max="100"
                              step="1"
                              value={newGrade}
                              onChange={(e) =>
                                setNewGrade(parseInt(e.target.value))
                              }
                              className="w-full h-2 bg-green-200 rounded-lg appearance-none cursor-pointer"
                            />
                            <span className="ml-3 w-10 text-center text-green-800 font-medium">
                              {newGrade}%
                            </span>
                          </div>
                        </motion.div>
                      )}

                      <RadioGroup.Option
                        value="reject"
                        className={({ checked }) =>
                          `${
                            checked
                              ? "bg-red-50 border-red-200"
                              : "bg-white border-gray-200"
                          } relative border rounded-lg shadow-sm px-4 py-3 cursor-pointer focus:outline-none`
                        }
                      >
                        {({ checked }) => (
                          <div className="flex items-center justify-between">
                            <div className="flex items-center">
                              <div className="text-sm">
                                <RadioGroup.Label
                                  as="p"
                                  className={`font-medium ${
                                    checked ? "text-red-900" : "text-gray-900"
                                  }`}
                                >
                                  Reject Request
                                </RadioGroup.Label>
                                <RadioGroup.Description
                                  as="span"
                                  className={`inline ${
                                    checked ? "text-red-700" : "text-gray-500"
                                  }`}
                                >
                                  Keep the original grade for this submission
                                </RadioGroup.Description>
                              </div>
                            </div>
                            <div
                              className={`${checked ? "text-red-600" : "text-gray-400"}`}
                            >
                              <XCircleIcon className="h-6 w-6" />
                            </div>
                          </div>
                        )}
                      </RadioGroup.Option>

                      {decision === "reject" && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: "auto" }}
                          exit={{ opacity: 0, height: 0 }}
                          className="ml-6 p-3 bg-red-50 border border-red-100 rounded-md"
                        >
                          <label
                            htmlFor="rejectionReason"
                            className="block text-sm font-medium text-red-800 mb-1"
                          >
                            Reason for Rejection
                          </label>
                          <textarea
                            id="rejectionReason"
                            rows={3}
                            value={rejectionReason}
                            onChange={(e) => setRejectionReason(e.target.value)}
                            placeholder="Explain why the original grade is appropriate..."
                            className="w-full px-3 py-2 border border-red-200 rounded-md focus:outline-none focus:ring-red-500 focus:border-red-500 bg-white text-sm"
                          />
                        </motion.div>
                      )}
                    </div>
                  </RadioGroup>
                </div>

                {/* Action Buttons */}
                <div className="flex justify-end gap-3 border-t border-gray-100 pt-4">
                  <button
                    type="button"
                    onClick={onClose}
                    className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-violet-500 text-sm font-medium"
                  >
                    Cancel
                  </button>

                  <button
                    type="button"
                    onClick={handleSubmit}
                    disabled={
                      !decision ||
                      isProcessing ||
                      (decision === "reject" && !rejectionReason)
                    }
                    className={`px-4 py-2 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-offset-2 text-sm font-medium
                      ${
                        decision === "approve"
                          ? "bg-green-600 hover:bg-green-700 focus:ring-green-500"
                          : decision === "reject"
                            ? "bg-red-600 hover:bg-red-700 focus:ring-red-500"
                            : "bg-gray-300 cursor-not-allowed"
                      }`}
                  >
                    {isProcessing
                      ? "Processing..."
                      : decision === "approve"
                        ? "Approve & Update Grade"
                        : decision === "reject"
                          ? "Reject Request"
                          : "Submit Decision"}
                  </button>
                </div>
              </div>
            </div>
          </Transition.Child>
        </div>
      </Dialog>
    </Transition>
  );
}
