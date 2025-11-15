"use client";

import { QuestionControls } from "@/config/types";
import { useEffect, useState } from "react";

interface SecurityMonitorProps {
  questionControls?: QuestionControls;
}

const SecurityMonitor: React.FC<SecurityMonitorProps> = ({
  questionControls,
}) => {
  const [showWarning, setShowWarning] = useState(false);
  const [warningMessage, setWarningMessage] = useState("");

  // Debug logging
  if (process.env.NODE_ENV === "development") {
    console.log("=== SecurityMonitor Debug ===");
    console.log("questionControls:", questionControls);
    console.log("- preventPrint:", questionControls?.preventPrint);
  }

  useEffect(() => {
    if (!questionControls) {
      if (process.env.NODE_ENV === "development") {
        console.log("SecurityMonitor: No questionControls provided");
      }
      return;
    }

    if (process.env.NODE_ENV === "development") {
      console.log("SecurityMonitor: Setting up event listeners");
      console.log("- preventPrint:", questionControls.preventPrint);
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
      const ctrlOrCmd = isMac ? e.metaKey : e.ctrlKey;

      // Prevent Print (Ctrl/Cmd + P)
      if (questionControls.preventPrint && ctrlOrCmd && e.key === "p") {
        e.preventDefault();
        e.stopPropagation();
        showWarningToast("Printing is disabled for this assignment");
        return false;
      }
    };

    const handleBeforePrint = (e: Event) => {
      if (questionControls.preventPrint) {
        e.preventDefault();
        e.stopPropagation();
        showWarningToast("Printing is disabled for this assignment");
      }
    };

    // Register event listeners
    document.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("beforeprint", handleBeforePrint);

    // Cleanup
    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("beforeprint", handleBeforePrint);
    };
  }, [questionControls]);

  const showWarningToast = (message: string) => {
    setWarningMessage(message);
    setShowWarning(true);
    setTimeout(() => {
      setShowWarning(false);
    }, 3000);
  };

  if (!showWarning) return null;

  return (
    <div className="fixed top-4 right-4 z-50 animate-in slide-in-from-top-2 fade-in">
      <div className="bg-orange-500 text-white px-6 py-3 rounded-lg shadow-lg flex items-center gap-3 max-w-md">
        <svg
          className="w-6 h-6 flex-shrink-0"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
          />
        </svg>
        <p className="text-sm font-medium">{warningMessage}</p>
      </div>
    </div>
  );
};

export default SecurityMonitor;
