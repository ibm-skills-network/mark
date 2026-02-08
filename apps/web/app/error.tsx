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
  const status =
    (error as { status?: number; statusCode?: number }).status ??
    (error as { statusCode?: number }).statusCode;
  const statusText = (error as { statusText?: string }).statusText;
  const isAPIError = error instanceof APIError || error.name === "APIError";
  const shouldShowModal =
    isAPIError || (typeof status === "number" && status >= 500);

  useEffect(() => {
    if (!shouldShowModal) {
      toast.error("An error occurred", {
        description:
          error?.message || "Something went wrong. Please try again.",
        duration: 5000,
      });
    }
  }, [error, shouldShowModal]);

  if (!shouldShowModal) {
    return null;
  }

  return (
    <ErrorModal
      statusCode={status || 500}
      headline={statusText || "Server error"}
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
