"use client";

import React from "react";
import { AlertTriangle, Save, ArrowRight } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface UnsavedChangesModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaveAndProceed: () => void;
  onProceedWithoutSaving: () => void;
  actionType: "checkout" | "loadDraft";
  targetName?: string;
}

export function UnsavedChangesModal({
  isOpen,
  onClose,
  onSaveAndProceed,
  onProceedWithoutSaving,
  actionType,
  targetName,
}: UnsavedChangesModalProps) {
  const actionText = actionType === "checkout" ? "checkout" : "load draft";
  const actionTitle = actionType === "checkout" ? "Check it out" : "Load Draft";

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50"
            onClick={onClose}
          />

          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ type: "spring", damping: 25, stiffness: 400 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
          >
            <div className="bg-white/95 backdrop-blur-md rounded-2xl shadow-2xl border border-gray-200/60 max-w-md w-full">
              <div className="p-6">
                <div className="flex items-center space-x-3 mb-4">
                  <div className="p-2 bg-amber-100 rounded-lg">
                    <AlertTriangle className="h-5 w-5 text-amber-600" />
                  </div>
                  <h2 className="text-lg font-semibold text-gray-900">
                    Unsaved Changes Detected
                  </h2>
                </div>

                <div className="space-y-4">
                  <p className="text-gray-600">
                    You have unsaved changes that will be lost if you{" "}
                    {actionText}
                    {targetName && (
                      <span className="font-medium"> to {targetName}</span>
                    )}
                    . What would you like to do?
                  </p>

                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                    <div className="flex items-start space-x-2">
                      <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
                      <p className="text-sm text-amber-700">
                        <strong>Warning:</strong> Any unsaved changes to your
                        current work will be permanently lost.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="flex flex-col space-y-3 mt-6">
                  <button
                    onClick={onSaveAndProceed}
                    className="flex items-center justify-center space-x-2 w-full px-4 py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-lg transition-colors"
                  >
                    <Save className="h-4 w-4" />
                    <span>Save Changes First</span>
                  </button>

                  <button
                    onClick={onProceedWithoutSaving}
                    className="flex items-center justify-center space-x-2 w-full px-4 py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium rounded-lg transition-colors"
                  >
                    <ArrowRight className="h-4 w-4" />
                    <span>Proceed Without Saving</span>
                  </button>

                  <button
                    onClick={onClose}
                    className="w-full px-4 py-2 text-gray-500 hover:text-gray-700 font-medium transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
