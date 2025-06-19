"use client";

import { usePathname } from "next/navigation";

const WarningBeforeUnload = () => {
  const pathname = usePathname();
  const showConfirmation = () => {
    if (!window) return;
    // regex to check if pathname is /author/[assignmentId]/questions
    if (pathname === "/author/[1-9]d*/questions") {
      return "Are you sure you want to leave this page? You will lose any unsaved changes.";
    }
  };
  // check if there are any unsaved changes
  // const { showConfirmation, setShowConfirmation, show, hide } =
  return null;
};

export default WarningBeforeUnload;
