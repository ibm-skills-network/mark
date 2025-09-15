"use client";

import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { AlertCircle, CheckCircle, X } from "lucide-react";

interface UnpublishedActivationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onPublishAndActivate: () => void;
  onCancel: () => void;
  versionNumber: string;
  isSubmitting?: boolean;
}

export function UnpublishedActivationModal({
  isOpen,
  onClose,
  onPublishAndActivate,
  onCancel,
  versionNumber,
  isSubmitting = false,
}: UnpublishedActivationModalProps) {
  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center space-x-3">
                <div className="p-2 bg-yellow-100 rounded-lg">
                  <AlertCircle className="h-6 w-6 text-yellow-600" />
                </div>
                <h2 className="text-xl font-semibold text-gray-900">
                  {versionNumber.toString().includes("-rc")
                    ? "Release Candidate Ready for Publication"
                    : "Version Not Published"}
                </h2>
              </div>
              <button
                onClick={onClose}
                className="text-gray-400 hover:text-gray-600 transition-colors"
                disabled={isSubmitting}
              >
                <X className="h-6 w-6" />
              </button>
            </div>

            {/* Content */}
            <div className="mb-6">
              <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4 mb-4">
                <div className="flex">
                  <div className="flex-shrink-0">
                    <AlertCircle className="h-5 w-5 text-yellow-400" />
                  </div>
                  <div className="ml-3">
                    <p className="text-sm text-yellow-700">
                      <strong>Version {versionNumber}</strong> has not been
                      published yet.
                    </p>
                  </div>
                </div>
              </div>

              <p className="text-gray-600 text-sm mb-4">
                To proceed with the activation process, this version needs to be
                published first. Publishing will make the version available to
                learners and mark it as the active version.
              </p>

              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <div className="flex items-start space-x-3">
                  <CheckCircle className="h-5 w-5 text-blue-600 mt-0.5" />
                  <div>
                    <h4 className="text-sm font-medium text-blue-900 mb-1">
                      What happens when you publish and activate:
                    </h4>
                    <ul className="text-sm text-blue-800 space-y-1">
                      {versionNumber.toString().includes("-rc") ? (
                        <>
                          <li>
                            • RC version {versionNumber} will be published as
                            final version{" "}
                            {versionNumber.toString().replace(/-rc\d+$/, "")}
                          </li>
                          <li>
                            • Original RC version will be removed from timeline
                          </li>
                          <li>
                            • Final version will become the active version for
                            learners
                          </li>
                          <li>• Previous active version will be deactivated</li>
                          <li>• All questions and settings will be updated</li>
                        </>
                      ) : (
                        <>
                          <li>• Version {versionNumber} will be published</li>
                          <li>
                            • It will become the active version for learners
                          </li>
                          <li>• Previous active version will be deactivated</li>
                          <li>• All questions and settings will be updated</li>
                        </>
                      )}
                    </ul>
                  </div>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="flex justify-end space-x-3">
              <button
                onClick={onCancel}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={isSubmitting}
              >
                Cancel
              </button>
              <button
                onClick={onPublishAndActivate}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2"
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                    <span>Publishing...</span>
                  </>
                ) : (
                  <>
                    <CheckCircle className="h-4 w-4" />
                    <span>
                      {versionNumber.toString().includes("-rc")
                        ? "Publish Final Version"
                        : "Publish and Activate"}
                    </span>
                  </>
                )}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
