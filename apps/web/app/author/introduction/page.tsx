"use client";

import Title from "@/components/Title";
import { GradingData } from "@/config/types";
import { createAssignment } from "@/lib/talkToBackend";
import { useAuthorStore } from "@/stores/authors";
import { ExclamationCircleIcon } from "@heroicons/react/outline";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { IntroductionSection } from "../(components)/IntroductionSection";

const AuthorIntroduction = () => {
  const router = useRouter();
  const [introduction, setIntroduction] = useState("");
  const [instructions, setInstructions] = useState("");
  const [grading, setGrading] = useState<GradingData>({
    isGraded: true,
    attempts: 1,
    passingGrade: 50,
    timeEstimate: 50,
  });

  const [activeAssignmentID, setActiveAssignmentID] = useAuthorStore(
    (state) => [state.activeAssignmentID, state.setActiveAssignmentID]
  );

  /**
   * check if assignment exists, if it does, update it, if not, create it
   *
   * */
  async function createOrUpdateAssignment() {
    // TODO: check if assignment exists, if it does, update it given the id, if not, create one
    if (activeAssignmentID) {
      // update assignment
    } else {
      const id = await createAssignment({
        name: "test",
        numAttempts: grading.attempts,
        passingGrade: grading.passingGrade,
        allotedTime: grading.timeEstimate,
      });
      if (!id) {
        // TODO: show error message
        console.log("assignment not created");
        return;
      }
      setActiveAssignmentID(id);
    }
    // at this point we know we have an assignment id so we can go to the next page(step)
    router.push(`/author/questions`);
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
          onClick={createOrUpdateAssignment}
        >
          Next
        </button>
      </footer>
    </main>
  );
};

export default AuthorIntroduction;
