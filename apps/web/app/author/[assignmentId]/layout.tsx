"use client";

import ErrorPage from "@/components/ErrorPage";
import { useAuthorStore } from "@/stores/author";
import { getAssignmentIdFromURL } from "@/stores/learner";
import type { ComponentPropsWithoutRef, FC } from "react";

type Props = ComponentPropsWithoutRef<"div">;

const Layout: FC<Props> = ({ children }) => {
  const [pageState] = useAuthorStore((state) => [state.pageState]);
  const assignmentId = getAssignmentIdFromURL("author");
  useAuthorStore.setState({ activeAssignmentId: parseInt(assignmentId) });
  if (pageState === "error") {
    return <ErrorPage error="Assignment error" />;
  }
  return <div className="">{children}</div>;
};

export default Layout;
