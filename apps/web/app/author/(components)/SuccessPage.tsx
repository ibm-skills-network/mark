"use client";

import {
  getAssignmentConfigHydration,
  getAssignmentFeedbackHydration,
} from "@/app/author/utils/assignmentHydration";
import ExitIcon from "@/components/svgs/ExitIcon";
import { getAssignment, getUser } from "@/lib/talkToBackend";
import { useAssignmentConfig } from "@/stores/assignmentConfig";
import { useAssignmentFeedbackConfig } from "@/stores/assignmentFeedbackConfig";
import { useAuthorStore } from "@/stores/author";
import type { QuestionAuthorStore } from "@/config/types";
import { extractAssignmentId } from "@/lib/strings";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

function SuccessPage() {
  const pathname = usePathname();
  const [setPageState, activeAssignmentId, hydrateAuthorStore] = useAuthorStore(
    (state) => [
      state.setPageState,
      state.activeAssignmentId,
      state.hydrateAuthorStore,
    ],
  );
  const [setAssignmentConfigStore] = useAssignmentConfig((state) => [
    state.setAssignmentConfigStore,
  ]);
  const [setAssignmentFeedbackConfigStore] = useAssignmentFeedbackConfig(
    (state) => [state.setAssignmentFeedbackConfigStore],
  );
  const fetchAssignment = async () => {
    const checkedOutVersion = useAuthorStore.getState().checkedOutVersion;

    if (checkedOutVersion) {
      try {
        const { checkoutVersion } = useAuthorStore.getState();
        await checkoutVersion(
          checkedOutVersion.id,
          checkedOutVersion.versionNumber,
        );
        setPageState("success");
        return;
      } catch (error) {
        setPageState("error");
        return;
      }
    }

    const routeAssignmentId = Number.parseInt(
      extractAssignmentId(pathname) ?? "",
      10,
    );
    const resolvedAssignmentId = Number.isFinite(routeAssignmentId)
      ? routeAssignmentId
      : typeof activeAssignmentId === "number" &&
          Number.isFinite(activeAssignmentId)
        ? activeAssignmentId
        : Number.NaN;

    if (!Number.isFinite(resolvedAssignmentId)) {
      setPageState("error");
      return;
    }

    const assignment = await getAssignment(resolvedAssignmentId);
    if (assignment) {
      const authorSafeAssignment = {
        ...assignment,
        currentVersion: undefined,
      };
      const { updatedAt, ...cleanedAuthorData } = authorSafeAssignment;
      void updatedAt;
      const fetchedQuestions = (assignment.questions ??
        []) as QuestionAuthorStore[];
      hydrateAuthorStore({
        ...cleanedAuthorData,
        originalAssignment: assignment,
        questions: fetchedQuestions,
        questionOrder:
          assignment.questionOrder ??
          fetchedQuestions.map((question) => question.id),
        activeAssignmentId: assignment.id,
        name: assignment.name,
      });
      if (assignment.questionVariationNumber !== undefined) {
        setAssignmentConfigStore({
          questionVariationNumber: assignment.questionVariationNumber,
        });
      }
      setAssignmentConfigStore({
        ...getAssignmentConfigHydration(assignment),
      });

      setAssignmentFeedbackConfigStore({
        ...getAssignmentFeedbackHydration(assignment),
      });

      setPageState("success");
    } else {
      setPageState("error");
    }
  };
  const [returnUrl, setReturnUrl] = useState<string>("");
  useEffect(() => {
    let cancelled = false;
    const fetchUser = async () => {
      try {
        const user = await getUser();
        if (!cancelled) setReturnUrl(user.returnUrl || "");
      } catch (err) {
        console.error("Failed to fetch user data", err);
      }
    };

    void fetchUser();
    void fetchAssignment();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="flex flex-col items-center justify-center w-full h-full gap-y-6">
      <h1 className="text-2xl font-bold">
        Congratulations! Your assignment was updated
      </h1>

      <div className="justify-start items-start gap-3.5 inline-flex">
        <Link
          href={pathname.split("?")[0]}
          className="px-4 py-2 bg-purple-700 hover:bg-purple-600 transition-colors rounded-md shadow justify-end items-center gap-2.5 flex"
        >
          <ExitIcon className="w-6 h-6 text-white" />
          <div className="text-white text-base font-medium">
            Continue editing assignment
          </div>
        </Link>
        {returnUrl && (
          <Link
            href={returnUrl}
            className="px-4 py-2 bg-purple-700 hover:bg-purple-600 transition-colors rounded-md shadow justify-end items-center gap-2.5 flex"
          >
            <ExitIcon className="w-6 h-6 text-white" />
            <div className="text-white text-base font-medium">
              Back to course
            </div>
          </Link>
        )}
      </div>
    </section>
  );
}

export default SuccessPage;
