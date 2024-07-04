"use client";

import ErrorPage from "@/components/ErrorPage";
import Loading from "@/components/Loading";
import Title from "@/components/Title";
import {
  GradingData,
  QuestionAuthorStore,
  ReplaceAssignmentRequest,
} from "@/config/types";
import useBeforeUnload from "@/hooks/use-before-unload";
import {
  getAssignment,
  replaceAssignment,
  updateAssignment,
} from "@/lib/talkToBackend";
import { useAuthorStore } from "@/stores/author";
import IntroductionSection from "@authorComponents/ReusableSections/IntroductionSection";
import { ChevronRightIcon } from "@heroicons/react/24/outline";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import PageTitle from "./PageTitle";

interface Props {
  assignmentId: number;
}

const AuthorIntroduction = (props: Props) => {
  const { assignmentId } = props;
  const router = useRouter();
  useBeforeUnload(
    "Are you sure you want to leave this page? You will lose any unsaved changes."
  );
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
    numAttempts: -1,
    passingGrade: 60,
    timeEstimateMinutes: 30,
    // allotedTimeMinutes: null,
  });
  const [published, setPublished] = useState(false);
  const [gradingCriteriaOverview, setGradingCriteriaOverview] = useState("");

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
        // if assignment exists, set it as the active assignment
        setActiveAssignmentId(assignmentId);
        // update the state of the introduction page with the assignment details from the backend
        setAssignmentTitle(assignment.name || "Untitiled assignment");
        setIntroduction(assignment.introduction || "");
        setInstructions(assignment.instructions || "");
        setGradingCriteriaOverview(assignment.gradingCriteriaOverview || "");
        setGrading((oldGrading) => ({
          ...oldGrading,
          // only change the values that are not null or undefined
          graded: assignment.graded ?? oldGrading.graded,
          numAttempts: assignment.numAttempts ?? oldGrading.numAttempts,
          passingGrade: assignment.passingGrade ?? oldGrading.passingGrade,
          allotedTimeMinutes:
            assignment.allotedTimeMinutes ?? oldGrading.allotedTimeMinutes,
          timeEstimateMinutes:
            assignment.timeEstimateMinutes ?? oldGrading.timeEstimateMinutes,
        }));
        setPublished(assignment.published);

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
        console.log(questionsWithAddedValues);
        setQuestions(questionsWithAddedValues.sort((a, b) => a.id - b.id)); // TODO: might wanna remove this later
        setShowPage("success");
      } else {
        // if assignment does not exist, show error page
        setShowPage("error");
      }
    }
    void InitializeAssignment(assignmentId);
    setGrading((oldGrading) => ({
      ...oldGrading,
      questionRetries:
        ~~localStorage.getItem(`${assignmentId}-defaultQuestionRetries`) ||
        oldGrading.questionRetries,
    }));
    // }
  }, []);

  /**
   * Updates the assignment with the details from the introduction page
   * and redirects to the questions page
   * */
  async function handleGoToQuestions() {
    const assignment: Partial<ReplaceAssignmentRequest> = {
      timeEstimateMinutes: grading.timeEstimateMinutes,
      allotedTimeMinutes: grading.allotedTimeMinutes,
      instructions: instructions,
      introduction: introduction,
      gradingCriteriaOverview: gradingCriteriaOverview,
      graded: grading.graded,
      passingGrade: grading.passingGrade,
      published: published,
    };
    // if attempts is -1, it means unlimited attempts, so we don't send that to the backend(default is unlimited)
    const unlimitedAttempts = grading.numAttempts === -1;
    assignment.numAttempts = unlimitedAttempts ? null : grading.numAttempts;
    const modified = await updateAssignment(assignment, activeAssignmentId);
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
  }
  if (showPage === "loading") {
    return <Loading />;
  }
  return (
    <>
      <PageTitle
        title="Let's set up your assignment!"
        description="Responses in this section will be shown to learners."
      />
      <IntroductionSection
        sectionId="introduction"
        value={introduction}
        setValue={setIntroduction}
      />
      <IntroductionSection
        sectionId="instructions"
        value={instructions}
        setValue={setInstructions}
      />
      <IntroductionSection
        sectionId="overview"
        value={gradingCriteriaOverview}
        setValue={setGradingCriteriaOverview}
      />
      <IntroductionSection
        sectionId="grading"
        value={grading}
        setValue={setGrading}
      />
      <footer className="mx-auto items-center flex flex-col">
        <button
          ref={updateAssignmentButtonRef}
          className="mt-4 group flex gap-x-1 transition-colors items-center pl-4 pr-3 py-2 bg-blue-700 hover:bg-blue-600 text-white rounded-md"
          onClick={handleGoToQuestions}
        >
          Add Questions
          <ChevronRightIcon className="w-5 h-5 transition-transform group-hover:translate-x-0.5 duration-200" />
        </button>
      </footer>
    </>
  );
};

export default AuthorIntroduction;
