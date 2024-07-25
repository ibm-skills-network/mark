"use client";

import { cn } from "@/lib/strings";
import { useEffect } from "react";

export default function ErrorPage({
  error,
  statusCode = 500,
  className,
}: {
  error: Error | string;
  statusCode?: number;
  className?: string;
}) {
  useEffect(() => {
    // Log the error to an error reporting service
    console.error(error);
  }, [error]);

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
      <h2 className=" text-4xl font-bold text-destructive">
        Something Went Wrong!
      </h2>
      <p className="text-gray-500">
        {typeof error === "string" ? error : error.message}
      </p>
    </div>
  );
}
