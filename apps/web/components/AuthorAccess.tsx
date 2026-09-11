"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { getUser } from "@/lib/shared";
import { APIError } from "@/lib/api-client";
import { useAuthorStore } from "@/stores/author";
import { bindAuthorSession } from "@/lib/author-session";
import ErrorModal from "@/components/ErrorModal";

type Status =
  | "checking"
  | "ready"
  | "signin"
  | "unavailable"
  | "accountchanged";

export default function AuthorAccess({
  children,
  assignmentId,
  awbUrl,
  providerId,
}: {
  children: ReactNode;
  assignmentId: number;
  awbUrl: string;
  providerId?: string;
}) {
  const pageState = useAuthorStore((state) => state.pageState);
  const mounted = useRef(true);
  const editorUser = useRef<string | undefined>(undefined);
  const generation = useRef(0);
  const [status, setStatus] = useState<Status>("checking");
  const [loaded, setLoaded] = useState(false);
  const checking = useRef(false);
  const checkSession = useCallback(async () => {
    if (checking.current) return;
    checking.current = true;
    const startedAt = generation.current;
    try {
      const user = await getUser();
      if (!mounted.current || startedAt !== generation.current) return;
      if (user?.role === "author" && user.assignmentId === assignmentId) {
        if (editorUser.current && editorUser.current !== user.userId) {
          setStatus("accountchanged");
          return;
        }
        editorUser.current = user.userId;
        bindAuthorSession(assignmentId, user.userId);
        setStatus("ready");
        setLoaded(true);
      } else setStatus("signin");
    } catch (error) {
      if (!mounted.current || startedAt !== generation.current) return;
      setStatus(
        error instanceof APIError && error.status === 401
          ? "signin"
          : "unavailable",
      );
    } finally {
      checking.current = false;
    }
  }, [assignmentId]);

  useEffect(() => {
    mounted.current = true;
    if (Number.isSafeInteger(assignmentId) && assignmentId > 0) {
      useAuthorStore.setState({ activeAssignmentId: assignmentId });
    }
    void checkSession();
    const onFocus = () => {
      void checkSession();
    };
    const onUnauthorized = () => {
      generation.current += 1;
      setStatus("signin");
    };
    window.addEventListener("focus", onFocus);
    window.addEventListener("mark-author-auth-required", onUnauthorized);
    const timer = window.setInterval(onFocus, 30000);
    return () => {
      mounted.current = false;
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("mark-author-auth-required", onUnauthorized);
      window.clearInterval(timer);
    };
  }, [assignmentId, checkSession]);

  const recovery = new URL(`/assignments/from-mark/${assignmentId}`, awbUrl);
  if (providerId) recovery.searchParams.set("provider_id", providerId);

  return (
    <>
      {/* Keep an opened editor mounted during reauthentication so its unsaved state survives. */}
      {loaded && (
        <div hidden={status !== "ready" || pageState === "error"}>
          {children}
        </div>
      )}
      {status === "ready" && pageState === "error" && (
        <ErrorModal
          error="Assignment error"
          statusCode={500}
          headline="Author workspace unavailable"
          userSteps={[
            { title: "Refresh the page" },
            { title: "Return to your assignments", cta: "Go to assignments" },
          ]}
          primaryActionHref={awbUrl}
        />
      )}
      {status !== "ready" && (
        <section
          role="status"
          className="mx-auto my-16 max-w-xl rounded-xl border bg-white p-8 text-slate-900 shadow"
        >
          <h1 className="text-xl font-semibold">
            {status === "checking"
              ? "Checking author access…"
              : status === "accountchanged"
                ? "Your signed-in account changed"
                : status === "unavailable"
                  ? "Unable to check your session"
                  : "Sign in to edit this quiz"}
          </h1>
          {status !== "checking" && (
            <>
              <p className="my-4">
                {status === "accountchanged"
                  ? "Sign back in with the account that opened this editor to recover your unsaved changes."
                  : status === "unavailable"
                    ? "The service could not be reached. Retry the session check."
                    : "This link needs an author session. Open the quiz from Author Workbench, or use Edit Quiz in Context Manager if you created it there."}
              </p>
              {loaded && (
                <p className="my-4">
                  Keep this tab open to preserve your unsaved changes. Sign in
                  in the new tab, then return here.
                </p>
              )}
              {(status === "signin" || status === "accountchanged") && (
                <a
                  className="mr-4 underline"
                  href={recovery.toString()}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Sign in through Author Workbench
                </a>
              )}
              <button
                className="rounded border px-4 py-2"
                onClick={() => void checkSession()}
              >
                Check access again
              </button>
            </>
          )}
        </section>
      )}
    </>
  );
}
