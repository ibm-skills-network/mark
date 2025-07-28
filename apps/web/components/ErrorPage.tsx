"use client";
import { cn } from "@/lib/strings";
import { useEffect } from "react";

export default function ErrorPage({
  error,
  statusCode = 500,
  className,
}: {
  error: Error | string | { message: string };
  statusCode?: number;
  className?: string;
}) {
  useEffect(() => {
    localStorage.clear();
  }, [error]);

  const errorMessage =
    typeof error === "string"
      ? error
      : error instanceof Error
        ? error.message
        : error.message || "Unknown error";

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-y-4",
        className,
      )}
    >
      <h1 className="text-6xl font-bold text-destructive text-indigo-500">
        {statusCode}
      </h1>
      <h2 className="text-4xl font-bold text-destructive">
        {{
          404: "Page not found",
          403: "Forbidden",
          401: "Unauthorized",
          422: "Unprocessable Entity",
          500: "Internal Server Error",
        }[statusCode] || "Error"}
      </h2>
      <h4 className="font-bold">
        An error occurred, please refresh the page to try again. If the problem
        persists, please contact support.
      </h4>
      <p className="text-gray-500">{errorMessage}</p>
    </div>
  );
}
