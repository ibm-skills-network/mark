import { useEffect, useRef, useState } from "react";

type UsePersistentCountdownProps = {
  keyString: string;
  initialCountdown: number;
};

const usePersistentCountdown = ({
  keyString,
  initialCountdown,
}: UsePersistentCountdownProps) => {
  const [countdown, setCountdown] = useState(
    ~~localStorage.getItem(keyString) || initialCountdown,
  );

  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    localStorage.setItem(keyString, countdown.toString());

    intervalRef.current = setInterval(() => {
      setCountdown((prevCountdown) => {
        const newCountdown = prevCountdown - 1;
        localStorage.setItem(keyString, newCountdown.toString());
        return newCountdown;
      });
    }, 1000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [countdown, keyString]);

  return countdown;
};

export default usePersistentCountdown;
