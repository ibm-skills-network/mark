"use client";

import PageWithStickySides from "@/app/components/PageWithStickySides";
import ExitIcon from "@/components/svgs/ExitIcon";
import { useAssignmentDetails, useLearnerStore } from "@/stores/learner";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, type ComponentPropsWithoutRef } from "react";
import Question from "./Question";

interface Props extends ComponentPropsWithoutRef<"section"> {}

function SuccessPage(props: Props) {
  const {} = props;
  const pathname = usePathname();
  const router = useRouter();
  const [questions] = useLearnerStore((state) => [state.questions]);
  const [{ passingGrade=50 }, grade] = useAssignmentDetails(
    (state) => [state.assignmentDetails, state.grade],
  );
  // const questions = [
  //   {
  //     id: 1,
  //     totalPoints: 3,
  //     numRetries: null,
  //     maxWords: null,
  //     type: "TEXT",
  //     question:
  //       "Write a brief note about the significance of the Pythagoras theorem in mathematics.",
  //     questionResponses: [
  //       {
  //         id: 10,
  //         points: 1,
  //         feedback: [
  //           {
  //             feedback:
  //               "The learner's response does not provide a basic description of the Pythagoras theorem. Please provide a more detailed explanation of the significance of the theorem in mathematics.",
  //           },
  //         ],
  //         learnerResponse: "ass",
  //         questionId: 1,
  //         assignmentAttemptId: 4,
  //       },
  //     ],
  //     learnerTextResponse: "ass",
  //   },
  //   {
  //     id: 2,
  //     totalPoints: 2,
  //     numRetries: 5,
  //     maxWords: null,
  //     type: "TEXT",
  //     question: "hello is it tall?",
  //     questionResponses: [
  //       {
  //         id: 13,
  //         points: 2,
  //         feedback: [
  //           {
  //             feedback:
  //               "Great job! Your response aligns perfectly with the criteria provided. You answered 'yes' to the question 'hello is it tall?', which is the correct response according to the given scoring criteria. Keep up the good work!",
  //           },
  //         ],
  //         learnerResponse: "yes",
  //         questionId: 2,
  //         assignmentAttemptId: 4,
  //       },
  //     ],
  //     learnerTextResponse: "yes",
  //   },
  //   {
  //     id: 3,
  //     totalPoints: 8,
  //     numRetries: null,
  //     maxWords: null,
  //     type: "MULTIPLE_CORRECT",
  //     question: "yeah or hell?",
  //     choices: ["yes", "hell"],
  //     questionResponses: [
  //       {
  //         id: 11,
  //         points: 0,
  //         feedback: [
  //           {
  //             choice: "yes",
  //             feedback:
  //               "Your choice of 'yes' is incorrect. The correct choices for this question are 'yeah' or 'hell'. Please review the question and select the appropriate option.",
  //           },
  //         ],
  //         questionId: 3,
  //         assignmentAttemptId: 4,
  //       },
  //     ],
  //     learnerChoices: ["yes"],
  //   },
  //   {
  //     id: 4,
  //     totalPoints: 1,
  //     numRetries: 1,
  //     maxWords: null,
  //     type: "URL",
  //     question: "yay",
  //     questionResponses: [
  //       {
  //         id: 12,
  //         points: 0,
  //         feedback: [
  //           {
  //             feedback: "nay",
  //           },
  //         ],
  //         questionId: 4,
  //         assignmentAttemptId: 4,
  //       },
  //     ],
  //     learnerUrlResponse: "bro",
  //   },
  // ] as QuestionStore[];
  // TODO: uncomment this
  useEffect(() => {
    if (!questions || questions.length === 0) {
      router.push(pathname.split("?")[0]);
    }
  }, []);

  const totalPoints = useMemo(
    () => questions.reduce((acc, curr) => acc + curr.totalPoints, 0),
    [questions]
  );

  return (
    <div className="flex flex-col items-center justify-center w-full h-full gap-y-10 py-10">
      <div className="py-10">
        <PageWithStickySides
          leftStickySide={
            <svg viewBox="0 0 36 36" className="h-24">
              <path
                fill="none"
                className="stroke-gray-200"
                strokeWidth={2.6}
                d="M18 2.0845
          a 15.9155 15.9155 0 0 1 0 31.831
          a 15.9155 15.9155 0 0 1 0 -31.831"
              />
              <path
                fill="none"
                className=""
                stroke={
                  grade >= passingGrade * 100 ? "#10B981" : "#EF4444"
                }
                strokeDasharray={`${grade}, 100`}
                strokeWidth={2}
                strokeLinecap="round"
                d="M18 2.0845
          a 15.9155 15.9155 0 0 1 0 31.831
          a 15.9155 15.9155 0 0 1 0 -31.831"
              />
              <text
                x="10"
                y="20.35"
                className=" text-center text-slate-500 text-[0.4rem] font-semibold"
              >
                {grade.toFixed(1)}%
              </text>
            </svg>
          }
          mainContent={
            <>
              <h1 className="text-4xl font-extrabold py-2">
                Congrats! Your assignment was submitted successfully.
              </h1>
              <p>
                Here is a summary of all the questions below. You are now free
                to exit this page and return to the course.
              </p>
            </>
          }
        />
        <div className="justify-center gap-3.5 flex pt-5">
          <Link
            href={pathname.split("?")[0]} // remove the query params
            className="px-4 py-2 bg-blue-700 hover:bg-blue-600 rounded-md shadow justify-end items-center gap-2.5 flex"
          >
            <ExitIcon className="w-6 h-6 text-white" />
            <div className="text-white text-base font-medium">
              Back to Assignment
            </div>
          </Link>
          <Link
            href={`https://author.skills.network/courses`}
            className="px-4 py-2 bg-blue-700 hover:bg-blue-600 rounded-md shadow justify-end items-center gap-2.5 flex"
          >
            <ExitIcon className="w-6 h-6 text-white" />
            <div className="text-white text-base font-medium">
              Back to course
            </div>
          </Link>
        </div>
      </div>
      {/* show the list of questions with their feedback */}
      <div className="flex flex-col gap-y-20">
        {questions.map((question, index) => (
          <Question key={question.id} number={index + 1} question={question} />
        ))}
      </div>
    </div>
  );
}

export default SuccessPage;
