"use client";

import Title from "@/components/Title";
import { GradingData } from "@/config/types";
import { getAssignment, modifyAssignment } from "@/lib/talkToBackend";
import { useAuthorStore } from "@/stores/author";
import { IntroductionSection } from "@authorComponents/IntroductionSection";
import { ExclamationCircleIcon } from "@heroicons/react/outline";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

const AuthorIntroduction = ({
  params,
}: {
  params: { assignmentID: string };
}) => {
  const router = useRouter();
  const [introduction, setIntroduction] = useState("");
  const [instructions, setInstructions] = useState("");
  const [grading, setGrading] = useState<GradingData>({
    graded: true,
    attempts: 1,
    passingGrade: 50,
    timeEstimate: 50,
  });

  const [activeAssignmentID, setActiveAssignmentID] = useAuthorStore(
    (state) => [state.activeAssignmentID, state.setActiveAssignmentID]
  );

  useEffect(() => {
    // if there is no active assignment, check if we are able to fetch the details of the assignmentID from the url
    async function checkAssignmentExists(assignmentID: number) {
      const assignment = await getAssignment(assignmentID);
      if (assignment) {
        // if assignment exists, set it as the active assignment
        setActiveAssignmentID(assignmentID);
        // update the state of the introduction page with the assignment details from the backend
        setIntroduction(assignment.introduction);
        setInstructions(assignment.instructions);
        setGrading({
          graded: assignment.graded,
          attempts: assignment.numAttempts,
          passingGrade: assignment.passingGrade,
          timeEstimate: assignment.allotedTime,
        });
      } else {
        router.push("/");
      }
    }
    if (!activeAssignmentID) {
      const assignmentID = params.assignmentID;
      if (assignmentID !== undefined && !isNaN(Number(assignmentID))) {
        void checkAssignmentExists(parseInt(assignmentID));
      } else {
        router.push("/");
      }
    }
  }, []);

  /**
   * check if assignment exists, if it does, update it, if not, create it
   *
   * */
  async function updateAssignment() {
    const modified = await modifyAssignment(
      {
        allotedTime: grading.timeEstimate,
        instructions: instructions,
        introduction: introduction,
        graded: grading.graded,
        passingGrade: grading.passingGrade,
        numAttempts: grading.attempts,
      },
      activeAssignmentID
    );
    if (modified) {
      router.push(`/author/${activeAssignmentID}/questions`);
    } else {
      // TODO: show error message to user
      console.log("error");
    }
  }

  return (
    <main className="flex flex-col gap-y-11 mx-auto max-w-6xl py-20">
      <Title
        text="Introduction"
        className="text-gray-900 text-4xl leading-10 font-extrabold"
      />
      <IntroductionSection
        title="Introduction"
        value={introduction}
        setValue={setIntroduction}
      />

      <IntroductionSection
        title="Instructions"
        value={instructions}
        setValue={setInstructions}
      />

      <IntroductionSection
        title="Grading"
        value={grading}
        setValue={setGrading}
      />

      <footer className="mx-auto items-center flex flex-col">
        <ExclamationCircleIcon
          className="w-9 h-9 text-gray-400 "
          strokeWidth={1.5}
        />
        <p className="max-w-xl text-gray-500 text-center mt-1">
          To avoid confusion for your learners, please ensure that all important
          parts of the assignment are properly filled out.
        </p>
        <button
          className="mt-4 px-9 py-2 bg-blue-700 text-white shadow-md rounded-md"
          onClick={updateAssignment}
        >
          Next
        </button>
      </footer>
    </main>
  );
};

export default AuthorIntroduction;
