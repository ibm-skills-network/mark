"use client";

import { usePathname } from "next/navigation";

const WarningBeforeUnload = () => {
  const pathname = usePathname();
  const showConfirmation = () => {
    if (!window) return;

    if (pathname === "/author/[1-9]d*/questions") {
      return "Are you sure you want to leave this page? You will lose any unsaved changes.";
    }
  };

  return null;
};

export default WarningBeforeUnload;
