// components/admin/FlaggedSubmissionModal.tsx
"use client";
import { useState, Fragment } from "react";
import { Dialog, Transition, Tab } from "@headlessui/react";
import {
  XMarkIcon,
  DocumentTextIcon,
  UserIcon,
  ClockIcon,
} from "@heroicons/react/24/outline";
import { FlaggedSubmission } from "@/config/types";

interface FlaggedSubmissionModalProps {
  submission: FlaggedSubmission;
  isOpen: boolean;
  onClose: () => void;
  onDismiss: (submissionId: number) => Promise<void>;
}

export default function FlaggedSubmissionModal({
  submission,
  isOpen,
  onClose,
  onDismiss,
}: FlaggedSubmissionModalProps) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [dismissReason, setDismissReason] = useState("");

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
    setIsProcessing(true);
    try {
      await onDismiss(submission.id);
    } catch (error) {
      console.error("Failed to process submission:", error);
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
            <div className="inline-block w-full max-w-3xl p-6 my-8 overflow-hidden text-left align-middle transition-all transform bg-white shadow-xl rounded-lg">
              <Dialog.Title
                as="div"
                className="flex justify-between items-center"
              >
                <h3 className="text-lg font-medium text-gray-900">
                  Flagged Submission Review
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
                {/* Submission Details */}
                <div className="bg-gray-50 p-4 rounded-md border border-gray-200">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <h4 className="text-sm font-medium text-gray-500">
                        Assignment ID
                      </h4>
                      <p className="text-gray-900">{submission.assignmentId}</p>
                    </div>
                    <div>
                      <h4 className="text-sm font-medium text-gray-500">
                        User ID
                      </h4>
                      <p className="text-gray-900">{submission.userId}</p>
                    </div>
                    <div>
                      <h4 className="text-sm font-medium text-gray-500">
                        Attempt ID
                      </h4>
                      <p className="text-gray-900">{submission.attemptId}</p>
                    </div>
                    <div>
                      <h4 className="text-sm font-medium text-gray-500">
                        Flagged
                      </h4>
                      <p className="text-gray-900">
                        {formatDate(submission.createdAt)}
                      </p>
                    </div>
                  </div>

                  <div className="mt-4">
                    <h4 className="text-sm font-medium text-gray-500">
                      Flag Reason
                    </h4>
                    <p className="text-gray-900 mt-1 whitespace-pre-line">
                      {submission.reason}
                    </p>
                  </div>
                </div>

                {/* Tabbed Content */}
                <Tab.Group>
                  <Tab.List className="flex p-1 space-x-1 bg-violet-50 rounded-lg">
                    <Tab
                      className={({ selected }) =>
                        `w-full py-2.5 text-sm font-medium rounded-lg
                       ${
                         selected
                           ? "bg-white text-violet-700 shadow"
                           : "text-violet-500 hover:text-violet-700 hover:bg-white/[0.12]"
                       }`
                      }
                    >
                      Submission
                    </Tab>
                    <Tab
                      className={({ selected }) =>
                        `w-full py-2.5 text-sm font-medium rounded-lg
                       ${
                         selected
                           ? "bg-white text-violet-700 shadow"
                           : "text-violet-500 hover:text-violet-700 hover:bg-white/[0.12]"
                       }`
                      }
                    >
                      Evidence
                    </Tab>
                    <Tab
                      className={({ selected }) =>
                        `w-full py-2.5 text-sm font-medium rounded-lg
                       ${
                         selected
                           ? "bg-white text-violet-700 shadow"
                           : "text-violet-500 hover:text-violet-700 hover:bg-white/[0.12]"
                       }`
                      }
                    >
                      Learner History
                    </Tab>
                  </Tab.List>
                  <Tab.Panels className="mt-2">
                    <Tab.Panel className="rounded-lg bg-white p-3">
                      {/* Submission Content */}
                      <div className="space-y-4">
                        <div className="p-4 border border-gray-200 rounded-md">
                          <h5 className="text-sm font-medium text-gray-700 mb-2">
                            Question
                          </h5>
                          <p className="text-sm text-gray-600 mb-4">
                            Given two sorted arrays nums1 and nums2 of size m
                            and n respectively, write a function to merge the
                            two arrays into a single sorted array.
                          </p>

                          <h5 className="text-sm font-medium text-gray-700 mb-2">
                            Student's Answer
                          </h5>
                          <div className="p-3 bg-gray-50 rounded-md border border-gray-200 font-mono text-sm overflow-x-auto">
                            <pre className="whitespace-pre-wrap">{`function merge(nums1, nums2) {
  const result = [];
  let i = 0, j = 0;
  
  while (i < nums1.length && j < nums2.length) {
    if (nums1[i] <= nums2[j]) {
      result.push(nums1[i]);
      i++;
    } else {
      result.push(nums2[j]);
      j++;
    }
  }
  
  // Add remaining elements
  while (i < nums1.length) {
    result.push(nums1[i]);
    i++;
  }
  
  while (j < nums2.length) {
    result.push(nums2[j]);
    j++;
  }
  
  return result;
}`}</pre>
                          </div>
                        </div>

                        <div className="p-4 border border-gray-200 rounded-md">
                          <h5 className="text-sm font-medium text-gray-700 mb-2">
                            Grading
                          </h5>
                          <div className="flex justify-between items-center mb-2">
                            <span className="text-sm text-gray-600">
                              Score Awarded:
                            </span>
                            <span className="font-medium">100%</span>
                          </div>
                          <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-green-500"
                              style={{ width: "100%" }}
                            ></div>
                          </div>
                          <p className="mt-3 text-sm text-gray-600">
                            Grading Time: 12 seconds (significantly faster than
                            average: 4.5 minutes)
                          </p>
                        </div>
                      </div>
                    </Tab.Panel>

                    <Tab.Panel className="rounded-lg bg-white p-3">
                      {/* Evidence Information */}
                      <div className="space-y-4">
                        <div className="p-4 border border-gray-200 rounded-md">
                          <h5 className="text-sm font-medium text-gray-700 mb-2">
                            Similarity Analysis
                          </h5>
                          <div className="flex justify-between items-center mb-2">
                            <span className="text-sm text-gray-600">
                              Similarity Score:
                            </span>
                            <span className="font-medium text-amber-600">
                              85%
                            </span>
                          </div>
                          <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-amber-500"
                              style={{ width: "85%" }}
                            ></div>
                          </div>
                          <div className="mt-4">
                            <h6 className="text-sm font-medium text-gray-700 mb-2">
                              Similar Submission
                            </h6>
                            <div className="flex items-start space-x-2">
                              <div className="flex-shrink-0">
                                <UserIcon className="h-5 w-5 text-gray-400" />
                              </div>
                              <div>
                                <p className="text-sm text-gray-900">
                                  User ID: user6782
                                </p>
                                <p className="text-sm text-gray-500">
                                  Submitted: May 3, 2025
                                </p>
                              </div>
                            </div>
                            <div className="mt-2 p-3 bg-red-50 rounded-md border border-red-200 font-mono text-sm overflow-x-auto">
                              <pre className="whitespace-pre-wrap text-red-700">{`function merge(nums1, nums2) {
  let result = [];
  let i = 0, j = 0;
  
  while (i < nums1.length && j < nums2.length) {
    if (nums1[i] <= nums2[j]) {
      result.push(nums1[i]);
      i++;
    } else {
      result.push(nums2[j]);
      j++;
    }
  }
  
  // Add remaining elements
  while (i < nums1.length) {
    result.push(nums1[i]);
    i++;
  }
  
  while (j < nums2.length) {
    result.push(nums2[j]);
    j++;
  }
  
  return result;
}`}</pre>
                            </div>
                          </div>
                        </div>

                        <div className="p-4 border border-gray-200 rounded-md">
                          <h5 className="text-sm font-medium text-gray-700 mb-2">
                            Time Anomaly
                          </h5>
                          <div className="flex flex-col space-y-2">
                            <div className="flex justify-between">
                              <span className="text-sm text-gray-600">
                                Average time spent on this question:
                              </span>
                              <span className="font-medium">4 min 32 sec</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-sm text-gray-600">
                                This student's time:
                              </span>
                              <span className="font-medium text-red-600">
                                48 sec
                              </span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-sm text-gray-600">
                                Percentile:
                              </span>
                              <span className="font-medium">99.8th</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </Tab.Panel>

                    <Tab.Panel className="rounded-lg bg-white p-3">
                      {/* Learner History */}
                      <div className="space-y-4">
                        <div className="p-4 border border-gray-200 rounded-md">
                          <h5 className="text-sm font-medium text-gray-700 mb-2">
                            Previous Submissions
                          </h5>
                          <table className="min-w-full divide-y divide-gray-200">
                            <thead className="bg-gray-50">
                              <tr>
                                <th
                                  scope="col"
                                  className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                                >
                                  Assignment
                                </th>
                                <th
                                  scope="col"
                                  className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                                >
                                  Date
                                </th>
                                <th
                                  scope="col"
                                  className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                                >
                                  Score
                                </th>
                                <th
                                  scope="col"
                                  className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                                >
                                  Flags
                                </th>
                              </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                              <tr>
                                <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-900">
                                  Data Structures
                                </td>
                                <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-500">
                                  Apr 28, 2025
                                </td>
                                <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-900">
                                  92%
                                </td>
                                <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-900">
                                  1
                                </td>
                              </tr>
                              <tr>
                                <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-900">
                                  Python Basics
                                </td>
                                <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-500">
                                  Apr 15, 2025
                                </td>
                                <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-900">
                                  88%
                                </td>
                                <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-900">
                                  0
                                </td>
                              </tr>
                              <tr>
                                <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-900">
                                  Algorithms
                                </td>
                                <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-500">
                                  Mar 22, 2025
                                </td>
                                <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-900">
                                  95%
                                </td>
                                <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-900">
                                  2
                                </td>
                              </tr>
                            </tbody>
                          </table>
                        </div>

                        <div className="p-4 border border-gray-200 rounded-md">
                          <h5 className="text-sm font-medium text-gray-700 mb-2">
                            Flag History
                          </h5>
                          <div className="space-y-3">
                            <div className="flex items-start space-x-3">
                              <ClockIcon className="h-5 w-5 text-amber-500 flex-shrink-0 mt-0.5" />
                              <div>
                                <p className="text-sm font-medium text-gray-900">
                                  Time Anomaly - Mar 22, 2025
                                </p>
                                <p className="text-sm text-gray-600">
                                  Completed assignment in unusually short time
                                  (15 minutes vs avg 1 hour)
                                </p>
                              </div>
                            </div>
                            <div className="flex items-start space-x-3">
                              <DocumentTextIcon className="h-5 w-5 text-red-500 flex-shrink-0 mt-0.5" />
                              <div>
                                <p className="text-sm font-medium text-gray-900">
                                  Plagiarism - Mar 22, 2025
                                </p>
                                <p className="text-sm text-gray-600">
                                  Code submission matched answer from online
                                  source (92% similarity)
                                </p>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </Tab.Panel>
                  </Tab.Panels>
                </Tab.Group>

                {/* Decision Section */}
                <div className="border-t border-gray-200 pt-4">
                  <h4 className="font-medium text-gray-700 mb-3">Decision</h4>
                  <div className="p-4 bg-gray-50 rounded-md border border-gray-200">
                    <div className="mb-3">
                      <label
                        htmlFor="dismissReason"
                        className="block text-sm font-medium text-gray-700 mb-1"
                      >
                        Notes (optional)
                      </label>
                      <textarea
                        id="dismissReason"
                        rows={3}
                        value={dismissReason}
                        onChange={(e) => setDismissReason(e.target.value)}
                        placeholder="Add any notes about this submission..."
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-violet-500 focus:border-violet-500 text-sm"
                      />
                    </div>

                    <div className="flex space-x-3">
                      <button
                        type="button"
                        onClick={handleSubmit}
                        disabled={isProcessing}
                        className="inline-flex justify-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-red-600 hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
                      >
                        {isProcessing
                          ? "Processing..."
                          : "Mark as Academic Integrity Violation"}
                      </button>

                      <button
                        type="button"
                        onClick={handleSubmit}
                        disabled={isProcessing}
                        className="inline-flex justify-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-yellow-500 hover:bg-yellow-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-yellow-500"
                      >
                        {isProcessing
                          ? "Processing..."
                          : "Request Explanation from Student"}
                      </button>

                      <button
                        type="button"
                        onClick={handleSubmit}
                        disabled={isProcessing}
                        className="inline-flex justify-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-violet-500"
                      >
                        {isProcessing ? "Processing..." : "Dismiss Flag"}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </Transition.Child>
        </div>
      </Dialog>
    </Transition>
  );
}
