import useCountdown from "@/hooks/use-countdown";
import { useLearnerStore } from "@/stores/learner";
import { type ComponentPropsWithoutRef } from "react";
import { twMerge } from "tailwind-merge";

interface Props extends ComponentPropsWithoutRef<"div"> {
  timeInSecs: number;
  assignmentId: number;
}

function Timer(props: Props) {
  const { assignmentId } = props;

  // const activeAttemptId = useLearnerStore((state) => state.activeAttemptId);
  const expiresAt = useLearnerStore((state) => state.expiresAt);
  const { countdown, timerExpired } = useCountdown(Date.parse(expiresAt));
  const seconds = Math.floor((countdown / 1000) % 60);
  const minutes = Math.floor((countdown / (1000 * 60)) % 60);
  const hours = Math.floor((countdown / (1000 * 60 * 60)) % 24);
  const twoDigit = (num: number) => {
    return num < 10 ? `0${num}` : num;
  };

  // const countdown = usePersistentCountdown({
  //   keyString: `assignment-${assignmentId}-attempt-${activeAttemptId}-countdown`,
  //   initialCountdown: timeInSecs,
  // });

  return (
    <div className="flex items-center space-x-2">
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
      {timerExpired && (
        <div className="fixed text-red-500 text-base font-medium leading-tight">
          Time Expired
        </div>
      )}
    </div>
  );
}

export default Timer;
