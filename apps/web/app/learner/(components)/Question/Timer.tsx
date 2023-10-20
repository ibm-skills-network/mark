import usePersistentCountdown from "@/hooks/use-persistent-countdown";
import { useLearnerStore } from "@/stores/learner";
import { type ComponentPropsWithoutRef } from "react";

interface Props extends ComponentPropsWithoutRef<"div"> {
  timeInSecs: number;
  assignmentId: number;
}

function Timer(props: Props) {
  const { timeInSecs, assignmentId } = props;

  const activeAttemptId = useLearnerStore((state) => state.activeAttemptId);

  const countdown = usePersistentCountdown({
    keyString: `assignment-${assignmentId}-attempt-${activeAttemptId}-countdown`,
    initialCountdown: timeInSecs,
  });

  return (
    <div className="flex items-center space-x-2">
      <div className="text-gray-600 text-base font-medium leading-tight">
        Time Remaining:
      </div>
      <div className="text-blue-600 text-base font-bold leading-tight">
        {Math.floor(countdown / 60)}:
        {countdown % 60 < 10 ? `0${countdown % 60}` : countdown % 60}
      </div>
    </div>
  );
}

export default Timer;
