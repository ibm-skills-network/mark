"use client";

import ExitIcon from "@/components/svgs/ExitIcon";
import { useLearnerStore } from "@/stores/learner";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ComponentPropsWithoutRef } from "react";
import Question from "./Question";

interface Props extends ComponentPropsWithoutRef<"section"> {}

function SuccessPage(props: Props) {
  const {} = props;
  const pathname = usePathname();
  const router = useRouter();
  const [questions] = useLearnerStore((state) => [state.questions]);
  // TODO: uncomment this
  // useEffect(() => {
  //   if (!questions || questions.length === 0) {
  //     router.push(pathname.split("?")[0]);
  //   }
  // }, []);
  const courseId = 400;
  console.log("questions", questions);

  return (
    <div className="flex flex-col items-center justify-center w-full h-full gap-y-6">
      <h1 className="text-2xl font-bold">
        Congrats! Your assignment was submitted successfully.
      </h1>
      {/* <div className="flex items-center justify-center w-6 h-6 mr-2 bg-yellow-500 rounded-full">
        <ExclamationCircleIcon className="w-4 h-6 text-white" />
      </div> */}
      {/* <div className="text-sm text-yellow-700">You have</div> */}
      <div className="justify-start items-start gap-3.5 inline-flex">
        <Link
          href={pathname.split("?")[0]} // remove the query params
          className="px-4 py-2 bg-blue-700 rounded-md shadow justify-end items-center gap-2.5 flex"
        >
          <ExitIcon className="w-6 h-6 text-white" />
          <div className="text-white text-base font-medium">
            Back to Assignment
          </div>
        </Link>
        <Link
          href={`https://author.skills.network/courses`}
          className="px-4 py-2 bg-blue-700 rounded-md shadow justify-end items-center gap-2.5 flex"
        >
          <ExitIcon className="w-6 h-6 text-white" />
          <div className="text-white text-base font-medium">Back to course</div>
        </Link>
      </div>
      {/* show the list of questions with their feedback */}
      {questions.map((question, index) => (
        <Question key={index} question={question} />
      ))}
    </div>
  );
}

export default SuccessPage;
