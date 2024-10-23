import Tooltip from "@/components/Tooltip";
import { cn } from "@/lib/strings";
import { ChevronRightIcon } from "@heroicons/react/24/outline";
import Link from "next/link";
import type { ComponentPropsWithoutRef, FC } from "react";
import Button from "../../../../components/Button";

interface Props extends ComponentPropsWithoutRef<"div"> {
  assignmentState: string;
  assignmentId: number;
  role?: string;
  attemptsLeft: number;
}

const BeginTheAssignment: FC<Props> = (props) => {
  const { assignmentState, assignmentId, className, role, attemptsLeft } =
    props;
  return (
    // if the assignment is completed(no more attempts), then show the "View Results" button */}
    // {assignmentState === "completed" ? (
    //   <Button className="group flex gap-x-2" onClick={handleViewResults}>
    //     View Results
    //     <ChevronRightIcon className="w-5 h-5 group-hover:translate-x-0.5 transition-transform duration-200 disabled:opacity-50" />
    //   </Button>
    // ) : (
    // it's either "not-started" or "in-progress"

    <div className={className}>
      <Tooltip
        distance={3}
        disabled={
          // disable should be true if the assignment is not published and the role is learner or if the role is undefined
          (assignmentState !== "not-published" || role === "learner") &&
          role !== undefined &&
          attemptsLeft !== 0
        }
        content={
          attemptsLeft === 0
            ? "You have reached the maximum number of attempts for this assignment, if you need more attempts, please contact the author"
            : "The assignment is not published yet"
        }
      >
        <Link
          href={
            role === "learner"
              ? `/learner/${assignmentId}/questions`
              : `/learner/${assignmentId}/questions?authorMode=true`
          }
        >
          <Button
            className="group flex gap-x-2 disabled:opacity-50"
            disabled={
              (assignmentState === "not-published" && role === "learner") ||
              role === undefined ||
              attemptsLeft === 0
            }
          >
            {assignmentState === "in-progress" ? "Resume " : "Begin "}the
            Assignment
            <ChevronRightIcon className="w-5 h-5 group-hover:translate-x-0.5 transition-transform duration-200" />
          </Button>
        </Link>
      </Tooltip>
    </div>
  );
};

export default BeginTheAssignment;
