"use client";

import ExitIcon from "@/components/svgs/ExitIcon";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ComponentPropsWithoutRef } from "react";

interface Props extends ComponentPropsWithoutRef<"section"> {}

function SuccessPage(props: Props) {
  const {} = props;
  const pathname = usePathname();
  const courseId = 400;

  return (
    <section className="flex flex-col items-center justify-center w-full h-full gap-y-6">
      <h1 className="text-2xl font-bold">
        Congrats! Your assignment was updated
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
            Back to Assignment
          </div>
        </Link>
        <Link
          href={`https://author.skills.network/courses`}
          className="px-4 py-2 bg-blue-700 hover:bg-blue-600 transition-colors rounded-md shadow justify-end items-center gap-2.5 flex"
        >
          <ExitIcon className="w-6 h-6 text-white" />
          <div className="text-white text-base font-medium">Back to course</div>
        </Link>
      </div>
    </section>
  );
}

export default SuccessPage;
