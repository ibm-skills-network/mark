"use client";

import { useEffect } from "react";
import { twMerge } from "tailwind-merge";

export default function Error({
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
      className={twMerge(
        "flex flex-col items-center justify-center gap-y-4",
        className
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
