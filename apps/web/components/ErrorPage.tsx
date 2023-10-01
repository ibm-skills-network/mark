"use client";

import { useEffect } from "react";

export default function Error({ error }: { error: Error | string }) {
  useEffect(() => {
    // Log the error to an error reporting service
    console.error(error);
  }, [error]);

  return (
    <div className="flex h-full w-full flex-col items-center justify-center min-h-screen gap-y-4">
      <h1 className="text-6xl font-bold text-destructive text-indigo-500">
        500
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
