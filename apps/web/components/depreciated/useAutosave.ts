import { debounce } from "@/lib/utils";
import {
  SetStateAction,
  useCallback,
  useEffect,
  useState,
  type Dispatch,
} from "react";

const DEBOUNCE_SAVE_DELAY_MS = 1000;

export default function useAutosave<T>(
  dataToSave: T,
): [T, Dispatch<SetStateAction<T>>] {
  // This UI state mirrors what's in the database.
  const [data, setData] = useState<T>(dataToSave);

  // This is the side effect we want to run on users' changes.
  // It is responsible for persisting the changes in the database.
  // In this example, we use localStorage for simplicity.
  const saveData = useCallback((newData: T) => {
    setData(newData);
    console.log("Saved successfully!");
  }, []);

  const debouncedSave = useCallback(
    debounce((newData: T) => {
      saveData(newData);
    }, DEBOUNCE_SAVE_DELAY_MS),
    [],
  );

  // This effect runs only when `data` changes.
  // Effectively achieving the auto-save functionality we wanted.
  useEffect(() => {
    if (data) {
      debouncedSave(data);
    }
  }, [data, debouncedSave]);

  return [data, setData];
}
