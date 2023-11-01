import Tooltip from "@/components/Tooltip";
import { ChevronRightIcon } from "@heroicons/react/24/outline";
import Link from "next/link";
import { type ComponentPropsWithoutRef, type FC } from "react";
import { twMerge } from "tailwind-merge";
import Button from "../Button";

interface Props extends ComponentPropsWithoutRef<"div"> {
  assignmentState: string;
  assignmentId: number;
}

const BeginTheAssignment: FC<Props> = (props) => {
  const { assignmentState, assignmentId, className } = props;

  return (
    // if the assignment is completed(no more attempts), then show the "View Results" button */}
    // {assignmentState === "completed" ? (
    //   <Button className="group flex gap-x-2" onClick={handleViewResults}>
    //     View Results
    //     <ChevronRightIcon className="w-5 h-5 group-hover:translate-x-0.5 transition-transform duration-200 disabled:opacity-50" />
    //   </Button>
    // ) : (
    // it's either "not-started" or "in-progress"
    <Tooltip
      className=""
      distance={3}
      disabled={assignmentState !== "not-published"}
      content="This assignment has not been published yet."
    >
      <Link
        href={`/learner/${assignmentId}/questions`}
        className={twMerge("", className)}
      >
        <Button
          className="group flex gap-x-2 disabled:opacity-50"
          disabled={assignmentState === "not-published"}
        >
          {assignmentState === "in-progress" ? "Resume " : "Begin "}the
          Assignment
          <ChevronRightIcon className="w-5 h-5 group-hover:translate-x-0.5 transition-transform duration-200" />
        </Button>
      </Link>
    </Tooltip>
  );
};

export default BeginTheAssignment;
