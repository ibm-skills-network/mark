"use client";

import ErrorPage from "@/components/ErrorPage";

export default function Error({ error }: { error: Error }) {
  return <ErrorPage error={error} />;
}
