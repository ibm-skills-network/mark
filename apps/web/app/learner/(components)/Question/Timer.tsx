import useCountdown from "@/hooks/use-countdown";
import { cn } from "@/lib/strings";
import { submitAssignment } from "@/lib/talkToBackend";
import { useAssignmentDetails, useLearnerStore } from "@/stores/learner";
import { useRouter } from "next/navigation";
import { type ComponentPropsWithoutRef } from "react";
import { toast } from "sonner";

interface Props extends ComponentPropsWithoutRef<"div"> {
  expiresAt: string;
}

function Timer(props: Props) {
  const { expiresAt, ...restOfProps } = props;
  const router = useRouter();

  // const activeAttemptId = useLearnerStore((state) => state.activeAttemptId);
  const activeAttemptId = useLearnerStore((state) => state.activeAttemptId);
  const [assignmentDetails, setGrade] = useAssignmentDetails((state) => [
    state.assignmentDetails,
    state.setGrade,
  ]);
  const assignmentId = assignmentDetails?.id;
  const { countdown } = useCountdown(Date.parse(expiresAt));
  const seconds = Math.floor((countdown / 1000) % 60);
  const minutes = Math.floor((countdown / (1000 * 60)) % 60);
  const hours = Math.floor((countdown / (1000 * 60 * 60)) % 24);
  const twoDigit = (num: number) => {
    return num < 10 ? `0${num}` : num;
  };

  async function handleSubmitAssignment() {
    const grade = await submitAssignment(assignmentId, activeAttemptId);
    if (!grade || grade <= 0 || grade >= 1) {
      toast.error("Failed to submit assignment.");
      return;
    }
    setGrade(grade * 100);
    // ${grade >= passingGrade ? "You passed!" : "You failed."}`);
    const currentTime = Date.now();
    console.log("currentTime", currentTime);
    router.push(`/learner/${assignmentId}?submissionTime=${currentTime}`);
  }

  // if assignment runs out of time, automatically submit
  if (countdown <= 0) {
    toast.message("Time's up! Submitting your assignment...");
    void handleSubmitAssignment();
    return null;
  }

  // const countdown = usePersistentCountdown({
  //   keyString: `assignment-${assignmentId}-attempt-${activeAttemptId}-countdown`,
  //   initialCountdown: timeInSecs,
  // });

  return (
    <div className="flex items-center space-x-2" {...restOfProps}>
      <div className="text-gray-600 text-base font-medium leading-tight">
        Time Remaining:
      </div>
      <div
        className={cn(
          "text-base font-bold leading-tight",
          hours === 0 && minutes < 5 ? "text-red-500" : "text-blue-600",
        )}
      >
        {twoDigit(hours)}:{twoDigit(minutes)}:{twoDigit(seconds)}
      </div>
      {/* show a modal that tells the user that they cannot submit any more questions */}
      {/* {!timerExpired && <TimerExpiredModal />} */}
    </div>
  );
}

export default Timer;
