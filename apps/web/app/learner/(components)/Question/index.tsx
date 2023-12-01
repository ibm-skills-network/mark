"use client";

import Loading from "@/components/Loading";
import type {
  AssignmentAttemptWithQuestions,
  QuestionStore,
} from "@/config/types";
import { getAssignment } from "@/lib/talkToBackend";
import { useAssignmentDetails, useLearnerStore } from "@/stores/learner";
import Button from "@learnerComponents/Button";
import { useRouter } from "next/navigation";
import { useEffect, useState, type ComponentPropsWithoutRef } from "react";
import Overview from "./Overview";
import QuestionContainer from "./QuestionContainer";

interface Props extends ComponentPropsWithoutRef<"div"> {
  attempt: AssignmentAttemptWithQuestions;
  assignmentId: number;
}

function QuestionPage(props: Props) {
  const { attempt, assignmentId } = props;
  const { questions, id, expiresAt } = attempt;
  const router = useRouter();

  const questionsStore = useLearnerStore((state) => state.questions);
  const [assignmentDetails, setAssignmentDetails] = useAssignmentDetails(
    (state) => [state.assignmentDetails, state.setAssignmentDetails]
  );
  const [pageState, setPageState] = useState<
    "loading" | "success" | "no-questions"
  >("loading");

  useEffect(() => {
    if (!assignmentDetails || assignmentDetails.id !== assignmentId) {
      // if the current active assignment details are not stored in zustand store, then
      const fetchAssignment = async () => {
        // call the backend to get the assignment details
        const assignment = await getAssignment(assignmentId);
        if (assignment) {
          // if the assignment is found, then store it in zustand store
          setAssignmentDetails({
            id: assignment.id,
            name: assignment.name,
            numAttempts: assignment.numAttempts,
            passingGrade: assignment.passingGrade,
            allotedTimeMinutes: assignment.allotedTimeMinutes,
          });
        } else {
          // if the assignment details are not found, then redirect to the assignment overview page
          router.push(`/learner/${assignmentId}`);
        }
      };
      void fetchAssignment();
    }
    // store the questions in zustand store
    const allQuestions: QuestionStore[] = questions
      // .concat(questionsData)
      .map((question: QuestionStore) => {
        // get the info about previous attempts
        const previousAttempts = question.questionResponses.map((response) => ({
          points: response.points,
          learnerResponse: response.learnerResponse,
        }));
        // get the highest points earned for the question by finding the highest points earned for each response
        // const earnedPoints = previousAttempts.reduce(
        //   (highestPoints, response) => {
        //     return response.points > highestPoints.points
        //       ? response
        //       : highestPoints;
        //   }
        // );
        // get the last submission for the question
        const lastSubmission = previousAttempts.at(-1);

        // add the input field for the question
        switch (question.type) {
          case "TEXT":
            // Autofill the text response with the last submission if it exists
            question.learnerTextResponse =
              lastSubmission?.learnerResponse ?? "";
            break;
          // TODO: handle other types of questions
          case "URL":
            question.learnerUrlResponse = lastSubmission?.learnerResponse ?? "";
            break;
          case "SINGLE_CORRECT":
            question.learnerChoices = lastSubmission?.learnerResponse
              ? (JSON.parse(lastSubmission?.learnerResponse) as string[])
              : [];
            break;
          case "MULTIPLE_CORRECT":
            question.learnerChoices = lastSubmission?.learnerResponse
              ? (JSON.parse(lastSubmission?.learnerResponse) as string[])
              : [];
            break;
          case "TRUE_FALSE":
            // TODO: handle this
            question.learnerAnswerChoice = null;
            break;
          case "UPLOAD":
            // TODO: handle this
            question.learnerFileResponse = null;
            break;
          default:
            break;
        }
        return question;
      });

    useLearnerStore.setState({
      questions: allQuestions,
      activeAttemptId: id,
      expiresAt: expiresAt,
    });
    if (allQuestions.length) {
      setPageState("success");
    } else {
      setPageState("no-questions");
    }
  }, []);

  // useEffect(
  //   () =>
  //     useLearnerStore.subscribe((state) => {
  //       console.log(state.questions);
  //     }),
  //   []
  // );

  const [activeQuestionNumber] = useLearnerStore((state) => [
    state.activeQuestionNumber,
  ]);

  const [submitting, setSubmitting] = useState(false);
  const [showWarning, setShowWarning] = useState(false);
  if (pageState === "loading") {
    return <Loading />;
  } else if (pageState === "no-questions") {
    return (
      <div className="col-span-4 flex items-center justify-center h-full">
        <h1>No questions found.</h1>
      </div>
    );
  }

  return (
    <div className="flex gap-x-5">
      <div className="flex-1">
        {questionsStore.map((question, index) => (
          <QuestionContainer
            key={index}
            questionNumber={index + 1}
            className={`${index + 1 === activeQuestionNumber ? "" : "hidden"} `}
            questionId={question.id}
            // question={question}
          />
        ))}
      </div>
      <div className="">
        <Overview />
      </div>

      {/* Attempt Warning Modal */}
      {/* {showWarning && (
            <div className="fixed top-0 left-0 w-full h-full flex items-center justify-center bg-opacity-50 bg-black">
              <div className="bg-white p-8 rounded shadow-lg">
                <p>
                  Once submitted, no more changes can be made. Are you sure you
                  want to submit?
                </p>
                <div className="flex justify-end mt-4">
                  <Button onClick={() => setShowWarning(false)}>Cancel</Button>
              <Button className="ml-2" onClick={handleAttempt}>
                Yes, Submit
              </Button>
                </div>
              </div>
            </div>
          )} */}
    </div>
  );
}

export default QuestionPage;
