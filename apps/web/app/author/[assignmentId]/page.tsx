"use client";

import ErrorPage from "@/components/ErrorPage";
import Title from "@/components/Title";
import { GradingData, QuestionAuthorStore } from "@/config/types";
import { getAssignment, modifyAssignment } from "@/lib/talkToBackend";
import { useAuthorStore } from "@/stores/author";
import { IntroductionSection } from "@authorComponents/IntroductionSection";
import { ExclamationCircleIcon } from "@heroicons/react/outline";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

const AuthorIntroduction = ({
  params,
}: {
  params: { assignmentId: string };
}) => {
  const router = useRouter();
  const [introduction, setIntroduction] = useState("");
  const [showPage, setShowPage] = useState<"loading" | "error" | "success">(
    "loading"
  );
  const [assignmentTitle, setAssignmentTitle] = useAuthorStore((state) => [
    state.assignmentTitle,
    state.setAssignmentTitle,
  ]);

  const [instructions, setInstructions] = useState("");
  const [grading, setGrading] = useState<GradingData>({
    graded: true,
    questionRetries: 1,
    attempts: 1,
    passingGrade: null,
    timeEstimate: null,
  });

  const [activeAssignmentId, setActiveAssignmentId] = useAuthorStore(
    (state) => [state.activeAssignmentId, state.setActiveAssignmentId]
  );
  const updateAssignmentButtonRef = useAuthorStore(
    (state) => state.updateAssignmentButtonRef
  );
  const setQuestions = useAuthorStore((state) => state.setQuestions);
  useEffect(() => {
    // if there is no active assignment, check if we are able to fetch the details of the assignmentId from the url
    async function InitializeAssignment(assignmentId: number) {
      const assignment = await getAssignment(assignmentId);
      if (assignment) {
        console.log(assignment);
        // if assignment exists, set it as the active assignment
        setActiveAssignmentId(assignmentId);
        // update the state of the introduction page with the assignment details from the backend
        setAssignmentTitle(assignment.name || "Introduction");
        setIntroduction(assignment.introduction || "");
        setInstructions(assignment.instructions || "");
        setGrading((oldGrading) => ({
          ...oldGrading,
          // only change the values that are not null or undefined
          graded: assignment.graded ?? oldGrading.graded,
          attempts: assignment.numAttempts ?? oldGrading.attempts,
          passingGrade: assignment.passingGrade ?? oldGrading.passingGrade,
          timeEstimate:
            assignment.allotedTimeMinutes ?? oldGrading.timeEstimate,
        }));

        const questionsWithAddedValues = assignment.questions.map(
          (question: QuestionAuthorStore) => {
            return {
              ...question,
              // and for the questions that the author adds during the
              // assignment creation process, we set alreadyInBackend to be false for them
              alreadyInBackend: true,
              scoring: {
                // TODO: hardcoded for now but we need to find a way to add the type
                type: "CRITERIA_BASED",
                ...question.scoring,
              },
            };
          }
        );
        setQuestions(questionsWithAddedValues.sort((a, b) => a.id - b.id));
        setShowPage("success");
      } else {
        // if assignment does not exist, show error page
        setShowPage("error");
      }
    }
    void InitializeAssignment(~~params.assignmentId);
    // }
  }, []);

  /**
   * Updates the assignment with the details from the introduction page
   * and redirects to the questions page
   * */
  async function updateAssignment() {
    const assignment = {
      allotedTimeMinutes: grading.timeEstimate,
      instructions: instructions,
      introduction: introduction,
      graded: grading.graded,
      passingGrade: grading.passingGrade,
    };
    // if attempts is -1, it means unlimited attempts, so we don't send that to the backend(default is unlimited)
    if (grading.attempts !== -1) {
      assignment["numAttempts"] = grading.attempts;
    }
    const modified = await modifyAssignment(assignment, activeAssignmentId);
    if (modified) {
      router.push(
        `/author/${activeAssignmentId}/questions?defaultQuestionRetries=${grading.questionRetries}`
      );
    } else {
      setShowPage("error");
    }
  }

  if (showPage === "error") {
    return <ErrorPage error="Assignment error" />;
  } else if (showPage === "loading") {
    return <div>Loading...</div>;
  }

  return (
    <main className="flex flex-col gap-y-11 mx-auto max-w-6xl py-20">
      <Title
        text={assignmentTitle}
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
          ref={updateAssignmentButtonRef}
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
