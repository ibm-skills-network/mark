"use client";

import ExitIcon from "@/components/svgs/ExitIcon";
import { getAssignment, getUser } from "@/lib/talkToBackend";
import { mergeData } from "@/lib/utils";
import { useAssignmentConfig } from "@/stores/assignmentConfig";
import { useAssignmentFeedbackConfig } from "@/stores/assignmentFeedbackConfig";
import { useAuthorStore } from "@/stores/author";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ComponentPropsWithoutRef } from "react";

type Props = ComponentPropsWithoutRef<"section">;

function SuccessPage(props: Props) {
  const {} = props;
  const pathname = usePathname();
  const [
    setActiveAssignmentId,
    questions,
    setPageState,
    setAuthorStore,
    activeAssignmentId,
    name,
    setQuestionOrder,
  ] = useAuthorStore((state) => [
    state.setActiveAssignmentId,
    state.questions,
    state.setPageState,
    state.setAuthorStore,
    state.activeAssignmentId,
    state.name,
    state.setQuestionOrder,
  ]);
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
        console.error("Failed to fetch checked out version:", error);
        setPageState("error");
        return;
      }
    }

    const assignment = await getAssignment(activeAssignmentId);
    if (assignment) {
      useAuthorStore.getState().setOriginalAssignment(assignment);

      const mergedAuthorData = mergeData(useAuthorStore.getState(), assignment);
      const { updatedAt, ...cleanedAuthorData } = mergedAuthorData;
      setAuthorStore({
        ...cleanedAuthorData,
      });
      if (assignment.questionOrder) {
        setQuestionOrder(assignment.questionOrder);
      } else {
        setQuestionOrder(questions.map((question) => question.id));
      }
      const mergedAssignmentConfigData = mergeData(
        useAssignmentConfig.getState(),
        assignment,
      );
      if (assignment.questionVariationNumber !== undefined) {
        setAssignmentConfigStore({
          questionVariationNumber: assignment.questionVariationNumber,
        });
      }
      const {
        updatedAt: authorStoreUpdatedAt,
        ...cleanedAssignmentConfigData
      } = mergedAssignmentConfigData;
      setAssignmentConfigStore({
        ...cleanedAssignmentConfigData,
      });

      const mergedAssignmentFeedbackData = mergeData(
        useAssignmentFeedbackConfig.getState(),
        assignment,
      );
      const {
        updatedAt: assignmentFeedbackUpdatedAt,
        ...cleanedAssignmentFeedbackData
      } = mergedAssignmentFeedbackData;
      setAssignmentFeedbackConfigStore({
        ...cleanedAssignmentFeedbackData,
      });

      useAuthorStore.getState().setName(assignment.name);
      setPageState("success");
    } else {
      setPageState("error");
    }
  };
  const [returnUrl, setReturnUrl] = useState<string>("");
  useEffect(() => {
    const fetchUser = async () => {
      try {
        const user = await getUser();
        setReturnUrl(user.returnUrl || "");
      } catch (err) {
        console.error("Error fetching user:", err);
      }
    };

    void fetchUser();
    void fetchAssignment();
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
