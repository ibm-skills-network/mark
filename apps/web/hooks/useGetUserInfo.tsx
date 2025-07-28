import { User } from "@/config/types";
import { getUser } from "@/lib/talkToBackend";
import { useState, useEffect, useCallback } from "react";

interface useGetUserInfoInterface {
  user?: User;
  loading: boolean;
  error?: string;
  refetch: (cookies?: string) => Promise<void>;
}

export function useGetUserInfo(
  initialCookies?: string,
): useGetUserInfoInterface {
  const [user, setUser] = useState<User | undefined>(undefined);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [cookies, setCookies] = useState<string | undefined>(initialCookies);

  const fetchUser = useCallback(
    async (newCookies?: string) => {
      if (newCookies) {
        setCookies(newCookies);
      }
      setLoading(true);
      setError(undefined);
      try {
        const userData = await getUser(newCookies ?? cookies);
        setUser(userData);
      } catch (err: unknown) {
        if (err instanceof Error) {
          setError(err.message);
        } else {
          setError("Failed to fetch user");
        }
      } finally {
        setLoading(false);
      }
    },
    [cookies],
  );

  useEffect(() => {
    void fetchUser();
  }, [fetchUser]);

  return { user, loading, error, refetch: fetchUser };
}
