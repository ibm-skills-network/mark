"use client";

import { useEffect } from "react";
import ErrorModal from "@/components/ErrorModal";
import { APIError } from "@/lib/api-client";
import { toast } from "sonner";

export default function Error({
  error,
  reset,
}: {
  error: Error;
  reset?: () => void;
}) {
  const isAPIError = error instanceof APIError;

  useEffect(() => {
    if (!isAPIError) {
      toast.error("An error occurred", {
        description:
          error?.message || "Something went wrong. Please try again.",
        duration: 5000,
      });
    }
  }, [error, isAPIError]);

  if (!isAPIError) {
    return null;
  }

  return (
    <ErrorModal
      statusCode={error.status || 500}
      headline={error.statusText || "Server error"}
      error={error?.message || "Something went wrong"}
      userSteps={[
        {
          title: "Try again",
          description: "Close the modal and retry your last action.",
        },
        {
          title: "Report issue",
          description: "Use the Report button to send details to support.",
        },
      ]}
      debugDetails={[]}
      onClose={reset}
      primaryActionLabel="Reload"
      primaryActionHref="/"
    />
  );
}
