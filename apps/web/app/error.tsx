"use client";

import ErrorModal from "@/components/ErrorModal";

export default function Error({
  error,
  reset,
}: {
  error: Error;
  reset?: () => void;
}) {
  return (
    <ErrorModal
      statusCode={500}
      headline="Unexpected error"
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
