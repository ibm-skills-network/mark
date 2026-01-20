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
  // Check if this is an API error (server error) or a client-side error
  const isAPIError = error instanceof APIError;

  // For client-side errors, show a toast instead of the error modal
  useEffect(() => {
    if (!isAPIError) {
      toast.error("An error occurred", {
        description: error?.message || "Something went wrong. Please try again.",
        duration: 5000,
      });
    }
  }, [error, isAPIError]);

  // Only render the error modal for API errors (server errors)
  if (!isAPIError) {
    return null;
  }

  // For API errors, show the full error modal with status code
  return (
    <ErrorModal
      statusCode={(error as APIError).status || 500}
      headline={(error as APIError).statusText || "Server error"}
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
