"use client";
import ErrorPage from "@/components/ErrorPage";
import { useAuthorStore } from "@/stores/author";
import type { ComponentPropsWithoutRef, FC } from "react";

interface Props extends ComponentPropsWithoutRef<"div"> {}

const Layout: FC<Props> = ({ children }) => {
  const [pageState] = useAuthorStore((state) => [state.pageState]);
  if (pageState === "error") {
    return <ErrorPage error="Assignment error" />;
  }
  return <div className="">{children}</div>;
};

export default Layout;
