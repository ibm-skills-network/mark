import { useDebugLog } from "@/lib/utils";
import { useEffect, useState } from "react";

interface CountdownResult {
  countdown: number | undefined;
  timerExpired: boolean;
  resetCountdown: (newExpiresAt?: number) => void;
}

/** An offset is only usable if it is a real, finite number of milliseconds. */
const usableOffset = (offsetMs?: number): number =>
  typeof offsetMs === "number" && Number.isFinite(offsetMs) ? offsetMs : 0;

/**
 * Countdown to an absolute deadline set by the server.
 *
 * @param expiresAt the time at which the countdown should expire (in milliseconds)
 * @param serverTimeOffsetMs `serverNow - deviceNow`, measured once when the
 *   attempt payload arrived. `expiresAt` is a server timestamp, so comparing it
 *   to a bare `Date.now()` charges the learner for however far their device
 *   clock runs ahead — a clock a few minutes fast silently eats the exam, and a
 *   clock past the deadline expires the attempt on arrival. Applying the offset
 *   makes the countdown read the server's clock. Defaults to 0, which is the
 *   old behaviour, for payloads that carry no server timestamp.
 * @returns the number of milliseconds remaining until the countdown expires
 *   (never negative) and a boolean indicating whether it has expired
 */
const useCountdown = (
  expiresAt?: number,
  serverTimeOffsetMs?: number,
): CountdownResult => {
  const offset = usableOffset(serverTimeOffsetMs);
  const [countdown, setCountdown] = useState<number | undefined>(
    typeof expiresAt === "number"
      ? Math.max(0, expiresAt - (Date.now() + offset))
      : undefined,
  );
  const [timerExpired, setTimerExpired] = useState(false);
  const debugLog = useDebugLog();

  const resetCountdown = (newExpiresAt?: number) => {
    if (typeof newExpiresAt !== "number") {
      setCountdown(undefined);
      setTimerExpired(false);
      return;
    }

    debugLog("resetting countdown", new Date(newExpiresAt).toLocaleString());
    setCountdown(Math.max(0, newExpiresAt - (Date.now() + offset)));
    setTimerExpired(false);
  };

  useEffect(() => {
    if (typeof expiresAt !== "number") {
      setCountdown(undefined);
      setTimerExpired(false);
      return;
    }

    setCountdown(Math.max(0, expiresAt - (Date.now() + offset)));

    const interval = setInterval(() => {
      const serverNow = Date.now() + offset;
      if (serverNow >= expiresAt) {
        clearInterval(interval);
        setCountdown(0);
        setTimerExpired(true);
      } else {
        setCountdown(expiresAt - serverNow);
      }
    }, 1000);

    return () => {
      setCountdown(undefined);
      clearInterval(interval);
    };
  }, [expiresAt, offset]);

  return { countdown, timerExpired, resetCountdown };
};

export default useCountdown;
