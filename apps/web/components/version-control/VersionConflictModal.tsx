"use client";

import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  AlertTriangle,
  RefreshCw,
  Plus,
  Clock,
  User,
  Tag,
} from "lucide-react";

interface VersionConflictModalProps {
  isOpen: boolean;
  onClose: () => void;
  onUpdate: () => void;
  onCreateNew: () => void;
  existingVersion: {
    id: number;
    versionNumber: string;
    versionDescription?: string;
    isDraft: boolean;
    createdBy: string;
    createdAt: Date;
    questionCount: number;
  };
  requestedVersion: string;
}

export function VersionConflictModal({
  isOpen,
  onClose,
  onUpdate,
  onCreateNew,
  existingVersion,
  requestedVersion,
}: VersionConflictModalProps) {
  const formatVersionAge = (date: Date) => {
    const now = new Date();
    const diffMs = now.getTime() - new Date(date).getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 60) return `${diffMins} minutes ago`;
    if (diffHours < 24) return `${diffHours} hours ago`;
    return `${diffDays} days ago`;
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[9999] overflow-y-auto">
          <div className="flex items-center justify-center min-h-screen px-4 py-8">
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/50 backdrop-blur-sm"
              onClick={onClose}
            />

            {/* Modal */}
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              transition={{ type: "spring", damping: 25, stiffness: 400 }}
              className="relative w-full max-w-lg bg-white rounded-xl shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-6">
                {/* Header */}
                <div className="flex items-center justify-between mb-6">
                  <div className="flex items-center space-x-3">
                    <div className="p-2 bg-amber-100 rounded-lg">
                      <AlertTriangle className="h-5 w-5 text-amber-600" />
                    </div>
                    <div>
                      <h2 className="text-xl font-semibold text-gray-900">
                        Version Already Exists
                      </h2>
                      <p className="text-sm text-gray-500">
                        Choose how to proceed
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={onClose}
                    className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                  >
                    <X className="h-5 w-5 text-gray-400" />
                  </button>
                </div>

                {/* Conflict Details */}
                <div className="mb-6 p-4 bg-amber-50 rounded-lg border border-amber-200">
                  <div className="flex items-start space-x-3">
                    <Tag className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
                    <div className="flex-1">
                      <p className="text-sm font-medium text-amber-800">
                        Version{" "}
                        <span className="font-mono">{requestedVersion}</span>{" "}
                        already exists
                      </p>
                      <p className="text-xs text-amber-700 mt-1">
                        This version was created previously and contains{" "}
                        {existingVersion.questionCount} questions
                      </p>
                    </div>
                  </div>
                </div>

                {/* Existing Version Info */}
                <div className="mb-6 p-4 bg-gray-50 rounded-lg">
                  <h3 className="text-sm font-medium text-gray-900 mb-3">
                    Existing Version Details
                  </h3>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <div className="flex items-center space-x-2">
                        <Tag className="h-3 w-3 text-gray-500" />
                        <span className="text-gray-600">Version</span>
                      </div>
                      <span className="font-mono font-medium text-gray-900">
                        {existingVersion.versionNumber}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <div className="flex items-center space-x-2">
                        <Clock className="h-3 w-3 text-gray-500" />
                        <span className="text-gray-600">Created</span>
                      </div>
                      <span className="text-gray-900">
                        {formatVersionAge(existingVersion.createdAt)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <div className="flex items-center space-x-2">
                        <User className="h-3 w-3 text-gray-500" />
                        <span className="text-gray-600">Created by</span>
                      </div>
                      <span className="text-gray-900">
                        {existingVersion.createdBy}
                      </span>
                    </div>
                    {existingVersion.versionDescription && (
                      <div className="text-xs">
                        <div className="flex items-center space-x-2 mb-1">
                          <span className="text-gray-600">Description</span>
                        </div>
                        <p className="text-gray-900 bg-white p-2 rounded border text-xs">
                          {existingVersion.versionDescription}
                        </p>
                      </div>
                    )}
                    <div className="flex space-x-1 pt-1">
                      {existingVersion.isDraft && (
                        <span className="px-2 py-1 text-xs bg-amber-100 text-amber-700 rounded-full">
                          Draft
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Action Options */}
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      onClick={onUpdate}
                      className="flex items-center justify-center space-x-2 px-4 py-3 bg-amber-600 text-white text-sm font-medium rounded-lg hover:bg-amber-700 transition-colors"
                    >
                      <RefreshCw className="h-4 w-4" />
                      <span>Update Existing</span>
                    </button>
                    <button
                      onClick={onCreateNew}
                      className="flex items-center justify-center space-x-2 px-4 py-3 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors"
                    >
                      <Plus className="h-4 w-4" />
                      <span>Create New</span>
                    </button>
                  </div>

                  <button
                    onClick={onClose}
                    className="w-full px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 border border-gray-300 rounded-lg transition-colors"
                  >
                    Cancel
                  </button>
                </div>

                {/* Help Text */}
                <div className="mt-4 p-3 bg-blue-50 rounded-lg">
                  <div className="text-xs text-blue-700">
                    <p className="font-medium mb-1">What happens next?</p>
                    <ul className="space-y-1 text-xs">
                      <li>
                        <strong>Update Existing:</strong> Replaces the current
                        version with your changes
                      </li>
                      <li>
                        <strong>Create New:</strong> Let system suggest a new
                        version number
                      </li>
                    </ul>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        </div>
      )}
    </AnimatePresence>
  );
}
