import { useEffect, useState, type Dispatch, type SetStateAction } from "react";

interface BeforeUnloadHook {
  showConfirmation: boolean;
  setShowConfirmation: Dispatch<SetStateAction<boolean>>;
  show: () => void;
  hide: () => void;
}

const useBeforeUnload = (message?: string): BeforeUnloadHook => {
  const [showConfirmation, setShowConfirmation] = useState(false);

  const show = () => setShowConfirmation(true);
  const hide = () => setShowConfirmation(false);

  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.returnValue = message || "Are you sure you want to leave this page?";
      return message;
    };

    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, []);

  return { showConfirmation, setShowConfirmation, show, hide };
};

export default useBeforeUnload;
