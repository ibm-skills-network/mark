"use client";

import { useEffect, useState } from "react";
import ErrorModal from "@/components/ErrorModal";
import { useAuthorStore } from "@/stores/author";
import { getAssignmentIdFromURL } from "@/stores/learner";
import { getUser } from "@/lib/shared";
import type { ComponentPropsWithoutRef, FC } from "react";

type Props = ComponentPropsWithoutRef<"div">;

const Layout: FC<Props> = ({ children }) => {
  const [showRoleError, setShowRoleError] = useState(false);
  const [pageState] = useAuthorStore((state) => [state.pageState]);
  const assignmentId = getAssignmentIdFromURL("author");
  useAuthorStore.setState({ activeAssignmentId: parseInt(assignmentId) });

  useEffect(() => {
    const checkRole = async () => {
      try {
        const user = await getUser();
        if (!user || user.role !== "author") {
          setShowRoleError(true);
        }
      } catch {
        setShowRoleError(true);
      }
    };
    void checkRole();
  }, []);

  if (pageState === "error") {
    return (
      <ErrorModal
        error="Assignment error"
        statusCode={500}
        headline="Author workspace unavailable"
        userSteps={[
          { title: "Refresh the page" },
          { title: "Return to your assignments", cta: "Go to assignments" },
        ]}
        primaryActionHref="/learner"
      />
    );
  }

  if (showRoleError) {
    return (
      <ErrorModal
        statusCode={403}
        headline="Author access required"
        error="You tried to open the author workspace as a learner. Switch back to the learner view for this assignment."
        userSteps={[
          {
            title: "Open learner view",
            description:
              "We'll send you to the learner version of this assignment.",
            cta: "Go to learner view",
          },
          {
            title: "If you should be an author",
            description: "Ask your admin to grant you author permissions.",
          },
        ]}
        primaryActionHref={`/learner/${assignmentId}`}
        primaryActionLabel="Go to learner view"
      />
    );
  }
  return <div className="">{children}</div>;
};

export default Layout;
