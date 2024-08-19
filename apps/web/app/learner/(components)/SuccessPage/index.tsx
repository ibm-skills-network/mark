"use client";

import PageWithStickySides from "@/app/components/PageWithStickySides";
import ExitIcon from "@/components/svgs/ExitIcon";
import { getUser } from "@/lib/talkToBackend";
import { useAssignmentDetails, useLearnerStore } from "@/stores/learner";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ComponentPropsWithoutRef } from "react";
import Question from "./Question";

function SuccessPage() {
  const pathname = usePathname();
  const router = useRouter();
  const [questions] = useLearnerStore((state) => [state.questions]);
  const [{ passingGrade = 50 }, grade] = useAssignmentDetails((state) => [
    state.assignmentDetails,
    state.grade,
  ]);
  console.log("questions", grade);
  const [returnUrl, setReturnUrl] = useState<string>("");

  useEffect(() => {
    if (!questions || questions.length === 0) {
      router.push(pathname.split("?")[0]);
    }
    const fetchUser = async () => {
      try {
        const user = await getUser();
        setReturnUrl(user.returnUrl || "");
      } catch (err) {
        console.error(err);
      }
    };

    void fetchUser();
  }, []);

  // Not needed as long as returnUrl is not null(it is initialized to "")
  // if (returnUrl === null) {
  //   return null;
  // }

  return (
    <div className="flex flex-col items-center justify-center w-full h-full gap-y-10 py-10">
      <div className="py-10">
        <PageWithStickySides
          leftStickySide={
            <>
              {typeof grade === "number" ? (
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
                    stroke={grade >= passingGrade ? "#10B981" : "#EF4444"}
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
                    {grade === 100 || grade === 0 ? grade : grade.toFixed(1)}%
                  </text>
                </svg>
              ) : null}
            </>
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
              Retake assignment
            </div>
          </Link>
          {returnUrl && (
            <Link
              href={returnUrl}
              className="px-4 py-2 bg-blue-700 hover:bg-blue-600 rounded-md shadow justify-end items-center gap-2.5 flex"
            >
              <ExitIcon className="w-6 h-6 text-white" />
              <div className="text-white text-base font-medium">
                Back to course
              </div>
            </Link>
          )}
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
