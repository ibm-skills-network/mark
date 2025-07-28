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
  const [data, setData] = useState<T>(dataToSave);

  const saveData = useCallback((newData: T) => {
    setData(newData);
  }, []);

  const debouncedSave = useCallback(
    debounce((newData: T) => {
      saveData(newData);
    }, DEBOUNCE_SAVE_DELAY_MS),
    [],
  );

  useEffect(() => {
    if (data) {
      debouncedSave(data);
    }
  }, [data, debouncedSave]);

  return [data, setData];
}
