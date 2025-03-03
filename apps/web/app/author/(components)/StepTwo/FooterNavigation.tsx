"use client";

import { handleScrollToFirstErrorField } from "@/app/Helpers/handleJumpToErrors";
import Button from "@/components/Button";
import { useAssignmentConfig } from "@/stores/assignmentConfig";
import { useAuthorStore } from "@/stores/author";
import { ChevronRightIcon } from "@heroicons/react/24/outline";
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
  const goToNextStep = () => {
    if (isSubmitting) return; // Prevent multiple clicks
    setIsSubmitting(true);

    // Perform validation and wait for it to complete
    const isAssignmentConfigValid = validateAssignmentConfig();

    if (isAssignmentConfigValid) {
      router.push(`/author/${activeAssignmentId}/questions`);
    } else {
      handleScrollToFirstErrorField(); // Scroll to the first error field
      setIsSubmitting(false); // Reset the submit state to allow retry
    }
  };

  return (
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
  );
};
