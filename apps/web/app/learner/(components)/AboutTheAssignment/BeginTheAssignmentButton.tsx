import Tooltip from "@/components/Tooltip";
import { cn } from "@/lib/strings";
import { useLearnerStore } from "@/stores/learner";
import { ChevronRightIcon } from "@heroicons/react/24/outline";
import Button from "../../../../components/Button";

interface Props extends React.ComponentPropsWithoutRef<"div"> {
  assignmentState: string;
  assignmentId: number;
  role?: string;
  attemptsLeft: number;
}

const BeginTheAssignment: React.FC<Props> = (props) => {
  const { assignmentState, assignmentId, className, role, attemptsLeft } =
    props;
  const userPreferedLanguage = useLearnerStore(
    (state) => state.userPreferedLanguage,
  );
  const setUserPreferedLanguage = useLearnerStore(
    (state) => state.setUserPreferedLanguage,
  );
  const MoveToQuestionPage = () => {
    setUserPreferedLanguage(userPreferedLanguage);
    const url =
      role === "learner"
        ? `/learner/${assignmentId}/questions`
        : `/learner/${assignmentId}/questions?authorMode=true`;

    window.location.href = url;
  };

  return (
    <div className={cn(className, "w-full lg:w-auto")}>
      <Tooltip
        distance={3}
        disabled={
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
        <Button
          className="group flex items-center justify-center w-full sm:w-auto gap-x-2 disabled:opacity-50 text-center bg-violet-500 text-white px-4 py-2 rounded-md"
          disabled={
            (assignmentState === "not-published" && role === "learner") ||
            role === undefined ||
            attemptsLeft === 0
          }
          onClick={MoveToQuestionPage}
        >
          {assignmentState === "in-progress" ? "Resume " : "Begin "}the
          Assignment
          <ChevronRightIcon className="w-5 h-5 group-hover:translate-x-0.5 transition-transform duration-200" />
        </Button>
      </Tooltip>
    </div>
  );
};

export default BeginTheAssignment;
