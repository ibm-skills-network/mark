import { useDebugLog } from "@/lib/utils";
import { useEffect, useState } from "react";

interface CountdownResult {
  countdown: number;
  timerExpired: boolean;
  resetCountdown: (newExpiresAt: number) => void;
}

/**
 *
 * @param expiresAt the time at which the countdown should expire (in milliseconds)
 * @returns the number of milliseconds remaining until the countdown expires and a boolean indicating whether the countdown has expired
 */
const useCountdown = (expiresAt: number): CountdownResult => {
  const [countdown, setCountdown] = useState(expiresAt - Date.now());
  const [timerExpired, setTimerExpired] = useState(false);
  const debugLog = useDebugLog();

  const resetCountdown = (newExpiresAt: number) => {
    if (newExpiresAt === expiresAt) {
      return;
    }
    debugLog("resetting countdown", new Date(newExpiresAt).toLocaleString());
    setCountdown(newExpiresAt - Date.now());
    setTimerExpired(false);
  };

  useEffect(() => {
    if (!expiresAt) return;
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
