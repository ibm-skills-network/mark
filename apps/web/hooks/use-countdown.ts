import { useDebugLog } from "@/lib/utils";
import { useEffect, useState } from "react";

interface CountdownResult {
  countdown: number | undefined;
  timerExpired: boolean;
  resetCountdown: (newExpiresAt?: number) => void;
}

/**
 *
 * @param expiresAt the time at which the countdown should expire (in milliseconds)
 * @returns the number of milliseconds remaining until the countdown expires and a boolean indicating whether the countdown has expired
 */
const useCountdown = (expiresAt?: number): CountdownResult => {
  const [countdown, setCountdown] = useState<number | undefined>(
    typeof expiresAt === "number" ? expiresAt - Date.now() : undefined,
  );
  const [timerExpired, setTimerExpired] = useState(false);
  const debugLog = useDebugLog();

  const resetCountdown = (newExpiresAt?: number) => {
    if (newExpiresAt === expiresAt) {
      return;
    }

    if (typeof newExpiresAt !== "number") {
      setCountdown(undefined);
      setTimerExpired(false);
      return;
    }

    debugLog("resetting countdown", new Date(newExpiresAt).toLocaleString());
    setCountdown(newExpiresAt - Date.now());
    setTimerExpired(false);
  };

  useEffect(() => {
    if (typeof expiresAt !== "number") {
      setCountdown(undefined);
      setTimerExpired(false);
      return;
    }

    const interval = setInterval(() => {
      const now = Date.now();
      if (now >= expiresAt) {
        clearInterval(interval);
        setTimerExpired(true);
      } else {
        setCountdown(expiresAt - now);
      }
    }, 1000);

    return () => {
      setCountdown(undefined);
      clearInterval(interval);
    };
  }, [expiresAt]);

  return { countdown, timerExpired, resetCountdown };
};

export default useCountdown;
