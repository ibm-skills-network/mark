"use client";

import { handleScrollToFirstErrorField } from "@/app/Helpers/handleJumpToErrors";
import Button from "@/components/Button";
import { useAssignmentConfig } from "@/stores/assignmentConfig";
import { useAuthorStore } from "@/stores/author";
import {
  ChevronRightIcon,
  ExclamationTriangleIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import { useRouter } from "next/navigation";
import { useState } from "react";

export const FooterNavigation = () => {
  const router = useRouter();
  const [activeAssignmentId] = useAuthorStore((state) => [
    state.activeAssignmentId,
  ]);
  const validateAssignmentConfig = useAssignmentConfig(
    (state) => state.validate,
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showErrorModal, setShowErrorModal] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const goToNextStep = () => {
    if (isSubmitting) return;
    setIsSubmitting(true);

    const isAssignmentConfigValid = validateAssignmentConfig();

    if (isAssignmentConfigValid) {
      router.push(`/author/${activeAssignmentId}/review`);
    } else {
      // Check if error is on current page
      const firstErrorField = document.querySelector('[aria-invalid="true"]');

      if (firstErrorField) {
        // Error is on current page, just scroll to it
        handleScrollToFirstErrorField();
      } else {
        // Error might be on another page
        setErrorMessage("Please fix all validation errors before proceeding.");
        setShowErrorModal(true);
      }

      setIsSubmitting(false);
    }
  };

  return (
    <>
      <footer className="flex gap-5 justify-end max-w-full text-base font-medium leading-6 text-violet-800 whitespace-nowrap max-md:flex-wrap">
        <Button
          version="secondary"
          RightIcon={ChevronRightIcon}
          onClick={goToNextStep}
          disabled={isSubmitting}
        >
          Next
        </Button>
      </footer>

      {/* Error Modal */}
      {showErrorModal && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex items-center justify-center min-h-screen px-4">
            {/* Backdrop */}
            <div
              className="fixed inset-0 bg-black bg-opacity-50 transition-opacity"
              onClick={() => setShowErrorModal(false)}
            />

            {/* Modal Content */}
            <div className="relative bg-white rounded-lg shadow-xl max-w-md w-full p-6">
              {/* Close button */}
              <button
                onClick={() => setShowErrorModal(false)}
                className="absolute top-4 right-4 text-gray-400 hover:text-gray-600"
              >
                <XMarkIcon className="h-6 w-6" />
              </button>

              {/* Modal Header */}
              <div className="flex items-center mb-4">
                <ExclamationTriangleIcon className="h-6 w-6 text-red-500 mr-2" />
                <h3 className="text-lg font-semibold text-gray-900">
                  Configuration Error
                </h3>
              </div>

              {/* Modal Body */}
              <div className="mb-6">
                <p className="text-gray-600">{errorMessage}</p>
              </div>

              {/* Modal Footer */}
              <div className="flex justify-end">
                <button
                  onClick={() => setShowErrorModal(false)}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-400"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
