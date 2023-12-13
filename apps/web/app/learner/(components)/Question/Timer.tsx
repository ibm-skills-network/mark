import useCountdown from "@/hooks/use-countdown";
import { useLearnerStore } from "@/stores/learner";
import { type ComponentPropsWithoutRef, useEffect } from "react";
import { toast } from "sonner";

interface Props extends ComponentPropsWithoutRef<"div"> {
  expiresAt: string
}

function Timer(props: Props) {
  const { expiresAt,...restOfProps } = props;

  // const activeAttemptId = useLearnerStore((state) => state.activeAttemptId);
  const submitAssignmentRef = useLearnerStore(
    (state) => state.submitAssignmentRef
  );
  const { countdown } = useCountdown(Date.parse(expiresAt));
  const seconds = Math.floor((countdown / 1000) % 60);
  const minutes = Math.floor((countdown / (1000 * 60)) % 60);
  const hours = Math.floor((countdown / (1000 * 60 * 60)) % 24);
  const twoDigit = (num: number) => {
    return num < 10 ? `0${num}` : num;
  };

  // if assignment runs out of time, automatically submit
  if (countdown <= 0 && submitAssignmentRef.current) {
    toast.message("Time's up! Submitting your assignment...");
    // click the submit button
    submitAssignmentRef.current.click();
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
        className={
          "text-base font-bold leading-tight " +
          (hours === 0 && minutes < 5 ? "text-red-500" : "text-blue-600")
        }
      >
        {twoDigit(hours)}:{twoDigit(minutes)}:{twoDigit(seconds)}
      </div>
      {/* show a modal that tells the user that they cannot submit any more questions */}
      {/* {!timerExpired && <TimerExpiredModal />} */}
    </div>
  );
}

export default Timer;
