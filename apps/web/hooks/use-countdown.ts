import { useEffect, useState } from "react";

interface CountdownResult {
  countdown: number;
  timerExpired: boolean;
}

/**
 *
 * @param expiresAt the time at which the countdown should expire (in milliseconds)
 * @returns the number of milliseconds remaining until the countdown expires and a boolean indicating whether the countdown has expired
 */
const useCountdown = (expiresAt: number): CountdownResult => {
  const [countdown, setCountdown] = useState(expiresAt - Date.now());
  const [timerExpired, setTimerExpired] = useState(false);

  useEffect(() => {
    if (!expiresAt) return;
    const interval = setInterval(() => {
      const now = Date.now();
      if (now >= expiresAt) {
        // if the current time is past the expiration time
        clearInterval(interval);
        setTimerExpired(true);
      } else {
        setCountdown(expiresAt - now);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [expiresAt]);

  return { countdown, timerExpired };
};

export default useCountdown;
