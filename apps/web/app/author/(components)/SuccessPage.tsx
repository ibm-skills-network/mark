"use client";

import { decodeFields } from "@/app/Helpers/decoder";
import ExitIcon from "@/components/svgs/ExitIcon";
import { getAssignment, getUser } from "@/lib/talkToBackend";
import { mergeData } from "@/lib/utils";
import { useAssignmentConfig } from "@/stores/assignmentConfig";
import { useAssignmentFeedbackConfig } from "@/stores/assignmentFeedbackConfig";
import { useAuthorStore } from "@/stores/author";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { use, useEffect, useState, type ComponentPropsWithoutRef } from "react";

interface Props extends ComponentPropsWithoutRef<"section"> {}

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
  ] = useAuthorStore((state) => [
    state.setActiveAssignmentId,
    state.questions,
    state.setPageState,
    state.setAuthorStore,
    state.activeAssignmentId,
    state.name,
  ]);
  const [setAssignmentConfigStore] = useAssignmentConfig((state) => [
    state.setAssignmentConfigStore,
  ]);
  const [setAssignmentFeedbackConfigStore] = useAssignmentFeedbackConfig(
    (state) => [state.setAssignmentFeedbackConfigStore],
  );
  const fetchAssignment = async () => {
    const assignment = await getAssignment(activeAssignmentId);
    if (assignment) {
      // Decode specific fields
      const decodedFields = decodeFields({
        introduction: assignment.introduction,
        instructions: assignment.instructions,
        gradingCriteriaOverview: assignment.gradingCriteriaOverview,
      });

      // Merge decoded fields back into assignment
      const decodedAssignment = {
        ...assignment,
        ...decodedFields,
      };

      useAuthorStore.getState().setOriginalAssignment(decodedAssignment);

      // Author store
      const mergedAuthorData = mergeData(
        useAuthorStore.getState(),
        decodedAssignment,
      );
      const { updatedAt, ...cleanedAuthorData } = mergedAuthorData;
      setAuthorStore({
        ...cleanedAuthorData,
      });
      const mergedAssignmentConfigData = mergeData(
        useAssignmentConfig.getState(),
        decodedAssignment,
      );
      if (decodedAssignment.questionVariationNumber !== undefined) {
        setAssignmentConfigStore({
          questionVariationNumber: decodedAssignment.questionVariationNumber,
        });
      }
      const {
        updatedAt: authorStoreUpdatedAt,
        ...cleanedAssignmentConfigData
      } = mergedAssignmentConfigData;
      setAssignmentConfigStore({
        ...cleanedAssignmentConfigData,
      });
      // Merge assignment feedback config data.
      const mergedAssignmentFeedbackData = mergeData(
        useAssignmentFeedbackConfig.getState(),
        decodedAssignment,
      );
      const {
        updatedAt: assignmentFeedbackUpdatedAt,
        ...cleanedAssignmentFeedbackData
      } = mergedAssignmentFeedbackData;
      setAssignmentFeedbackConfigStore({
        ...cleanedAssignmentFeedbackData,
      });

      useAuthorStore.getState().setName(decodedAssignment.name);
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
        console.error(err);
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
      {/* <div className="flex items-center justify-center w-6 h-6 mr-2 bg-yellow-500 rounded-full">
        <ExclamationCircleIcon className="w-4 h-6 text-white" />
      </div> */}
      {/* <div className="text-sm text-yellow-700">You have</div> */}
      <div className="justify-start items-start gap-3.5 inline-flex">
        <Link
          href={pathname.split("?")[0]}
          className="px-4 py-2 bg-blue-700 hover:bg-blue-600 transition-colors rounded-md shadow justify-end items-center gap-2.5 flex"
        >
          <ExitIcon className="w-6 h-6 text-white" />
          <div className="text-white text-base font-medium">
            Continue editing assignment
          </div>
        </Link>
        {returnUrl && (
          <Link
            href={returnUrl}
            className="px-4 py-2 bg-blue-700 hover:bg-blue-600 transition-colors rounded-md shadow justify-end items-center gap-2.5 flex"
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
