import React, { useEffect, useState, useMemo } from "react";
import { motion, AnimatePresence, useTransform } from "framer-motion";
import { subscribeToGradingNotification } from "@/lib/learner";
import type {
  GradingProgressDetails,
  GradingProgressStatus,
  QuestionGradingState,
  QuestionGradingStatus,
} from "@/lib/learner";
import { toast } from "sonner";
import GradeSyncStatus from "@/components/GradeSyncStatus";
import ReportErrorButton from "@/components/ReportErrorButton";
import { useCreepingProgress } from "./useCreepingProgress";

export interface ProgressState {
  status: GradingProgressStatus | "idle";
  progress: number;
  currentStage: string;
  currentQuestion?: number;
  totalQuestions?: number;
  gradingState?: GradingProgressDetails;
}

// Per-question status follows a monotonic lifecycle:
// pending → in_progress → completed/failed. The SSE stream is multi-source
// (the progress service registers one callback; the submission service
// passes its own callback into updateAssignmentAttempt), and a stale
// snapshot from one source can land after a fresher one from the other.
// Without this ratchet, the UI flashes a question from "Grading" back to
// "Queued" when the stale snapshot wins the race.
const STATUS_RANK: Record<QuestionGradingStatus, number> = {
  pending: 0,
  in_progress: 1,
  completed: 2,
  failed: 2,
};

function mergeQuestionStatus(
  prev: QuestionGradingStatus,
  next: QuestionGradingStatus,
): QuestionGradingStatus {
  return STATUS_RANK[next] >= STATUS_RANK[prev] ? next : prev;
}

function mergeGradingState(
  prev: GradingProgressDetails | undefined,
  next: GradingProgressDetails | undefined,
): GradingProgressDetails | undefined {
  if (!next) return prev;
  if (!prev) return next;

  const nextById = new Map(next.questions.map((q) => [q.id, q]));
  // Base on prev to preserve established order; apply next updates via ratchet.
  const merged = prev.questions.map((q) => {
    const incoming = nextById.get(q.id);
    if (!incoming) return q;
    const status = mergeQuestionStatus(q.status, incoming.status);
    return { ...incoming, status };
  });
  // Append any questions new in next that prev didn't have yet.
  const prevIds = new Set(prev.questions.map((q) => q.id));
  for (const q of next.questions) {
    if (!prevIds.has(q.id)) merged.push(q);
  }

  let completed = 0;
  let inFlight = 0;
  let failed = 0;
  let hasSlowInFlight = false;
  for (const q of merged) {
    if (q.status === "completed") completed += 1;
    else if (q.status === "in_progress") {
      inFlight += 1;
      if (q.slowType) hasSlowInFlight = true;
    } else if (q.status === "failed") failed += 1;
  }
  return {
    questions: merged,
    total: merged.length,
    completed,
    inFlight,
    failed,
    hasSlowInFlight,
  };
}

interface GradingProgressModalProps {
  isOpen: boolean;
  assignmentId: number;
  attemptId: number | null;
  progressData: ProgressState;
  /**
   * Navigates the learner to their results. Supplied only when there is
   * somewhere to go; the re-check action is hidden without it.
   */
  onCheckResults?: () => void;
}

export default function GradingProgressModal({
  isOpen,
  assignmentId,
  attemptId,
  progressData,
  onCheckResults,
}: GradingProgressModalProps) {
  const [isSubscribing, setIsSubscribing] = useState(false);
  const [emailNotified, setEmailNotified] = useState(false);

  const handleSubscribeToEmail = async () => {
    if (!attemptId) return;

    setIsSubscribing(true);
    try {
      const result = await subscribeToGradingNotification(
        assignmentId,
        attemptId,
      );
      if (result?.success) {
        toast.success(result.message);
        setEmailNotified(true);
      }
    } catch (error) {
      toast.error("Failed to subscribe to email notification");
    } finally {
      setIsSubscribing(false);
    }
  };

  const { progress, currentStage: message } = progressData;

  // Decouple render status from real status so the progress bar can animate
  // to 100% before the success/failure icon appears. "failed" surfaces immediately;
  // "completed" waits for the spring to settle first.
  const [displayStatus, setDisplayStatus] =
    useState<ProgressState["status"]>("processing");
  useEffect(() => {
    if (progressData.status === "completed") {
      setDisplayStatus("processing");
      const timer = setTimeout(() => setDisplayStatus("completed"), 700);
      return () => clearTimeout(timer);
    }
    setDisplayStatus(progressData.status);
  }, [progressData.status]);
  const status = displayStatus;

  const confettiParticles = useMemo(
    () =>
      Array.from({ length: 20 }, () => ({
        x: (Math.random() - 0.5) * 300,
        y: (Math.random() - 0.5) * 300,
      })),
    [],
  );

  // Raw status (not the delayed displayStatus) so the creep eases to 100 the
  // moment grading completes, finishing before the 700ms icon swap. `isOpen`
  // gates the RAF loop so it does no work while the always-mounted modal is
  // closed.
  const displayProgress = useCreepingProgress(
    progress,
    progressData.gradingState,
    progressData.status,
    isOpen,
  );
  const barWidth = useTransform(displayProgress, (v) => `${Math.round(v)}%`);
  // `stalled` keeps the working presentation on purpose: grading really is
  // still running, so anything red would be a lie.
  const isWorking = status === "processing" || status === "stalled";

  const getStatusColor = () => {
    switch (status) {
      case "completed":
        return "bg-green-500";
      case "failed":
        return "bg-red-500";
      case "disconnected":
        return "bg-amber-500";
      case "processing":
      case "stalled":
        return "bg-purple-500";
      default:
        return "bg-gray-400";
    }
  };

  const getStatusIcon = () => {
    switch (status) {
      case "completed":
        return (
          <svg
            className="w-16 h-16 text-white"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2.5}
              d="M5 13l4 4L19 7"
            />
          </svg>
        );

      case "failed":
        return (
          <svg
            className="w-16 h-16 text-white"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2.5}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        );

      case "disconnected":
        return (
          <svg
            className="w-16 h-16 text-white"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2.5}
              d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
            />
          </svg>
        );

      default:
        return null;
    }
  };

  // Memoized so the identity only changes when the content actually does.
  // ReportErrorButton feeds this straight into a useMemo keyed on this
  // object, which feeds ReportPreviewModal's field-reset effects — a fresh
  // object here on every render (this modal re-renders on several store
  // subscriptions upstream) silently wipes whatever the learner has typed
  // into an open report form.
  const errorReportContext = useMemo(
    () => ({
      statusCode: 0,
      headline:
        status === "stalled"
          ? "Grading stopped responding"
          : "Lost contact with the grading service",
      message: progressData.currentStage,
      context: `Assignment ${assignmentId}, attempt ${attemptId ?? "unknown"}`,
    }),
    [status, progressData.currentStage, assignmentId, attemptId],
  );

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop with blur */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Main Modal Card */}
            <motion.div
              initial={{ scale: 0.8, opacity: 0, y: 50 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.8, opacity: 0, y: 50 }}
              transition={{ type: "spring", damping: 30, stiffness: 300 }}
              className="relative bg-gradient-to-br from-white via-white to-purple-50/50 dark:from-gray-800 dark:via-gray-800 dark:to-purple-900/30 rounded-3xl shadow-2xl p-8 max-w-md w-full backdrop-blur-xl border border-white/20 dark:border-gray-700/50"
              style={{
                boxShadow:
                  "0 25px 50px -12px rgba(0, 0, 0, 0.25), 0 0 0 1px rgba(255, 255, 255, 0.1)",
              }}
            >
              <div className="text-center relative">
                {!isWorking && (
                  <div className="mb-8 relative">
                    {/* Success/Failure Icon with celebration */}
                    <motion.div
                      initial={{ scale: 0, rotate: -180 }}
                      animate={{ scale: 1, rotate: 0 }}
                      transition={{
                        type: "spring",
                        damping: 12,
                        stiffness: 200,
                        delay: 0.1,
                      }}
                      className="relative"
                    >
                      {/* Glow effect */}
                      <motion.div
                        className={`absolute inset-0 rounded-full blur-2xl ${
                          status === "completed"
                            ? "bg-green-500/40"
                            : status === "disconnected"
                              ? "bg-amber-500/40"
                              : "bg-red-500/40"
                        }`}
                        animate={{
                          scale: [1, 1.2, 1],
                          opacity: [0.5, 0.8, 0.5],
                        }}
                        transition={{ duration: 2, repeat: Infinity }}
                      />

                      <div
                        className={`relative w-32 h-32 mx-auto rounded-full ${getStatusColor()} flex items-center justify-center shadow-2xl`}
                      >
                        <motion.div
                          initial={{ scale: 0 }}
                          animate={{ scale: 1 }}
                          transition={{
                            delay: 0.3,
                            type: "spring",
                            damping: 10,
                          }}
                        >
                          {getStatusIcon()}
                        </motion.div>
                      </div>
                    </motion.div>

                    {/* Confetti effect for success */}
                    {status === "completed" && (
                      <>
                        {confettiParticles.map((p, i) => (
                          <motion.div
                            key={i}
                            className="absolute w-2 h-2 rounded-full"
                            style={{
                              top: "50%",
                              left: "50%",
                              background: [
                                "#8b5cf6",
                                "#6366f1",
                                "#3b82f6",
                                "#10b981",
                                "#f59e0b",
                              ][i % 5],
                            }}
                            initial={{ scale: 0, x: 0, y: 0 }}
                            animate={{
                              scale: [0, 1, 0.5],
                              x: p.x,
                              y: p.y,
                              opacity: [1, 1, 0],
                            }}
                            transition={{
                              duration: 1.5,
                              delay: i * 0.03,
                              ease: "easeOut",
                            }}
                          />
                        ))}
                      </>
                    )}
                  </div>
                )}

                <motion.h3
                  key={status}
                  translate="no"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.2 }}
                  className="text-2xl font-bold mb-3 bg-gradient-to-r from-gray-800 via-gray-900 to-gray-800 dark:from-gray-100 dark:via-white dark:to-gray-100 bg-clip-text text-transparent"
                >
                  {status === "processing" && "Grading Your Assignment"}
                  {status === "stalled" && "Still Grading"}
                  {status === "completed" && "🎉 Grading Complete!"}
                  {status === "failed" && "Grading Failed"}
                  {status === "disconnected" && "We Lost Contact With Grading"}
                </motion.h3>

                <motion.p
                  key={message}
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="text-gray-600 dark:text-gray-300 mb-6 min-h-[48px] flex items-center justify-center text-base px-4"
                >
                  {message}
                </motion.p>

                {status === "stalled" && (
                  <motion.div
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="mb-6 px-4 py-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-sm text-amber-900 dark:text-amber-200 text-left"
                    role="status"
                  >
                    <p className="font-semibold mb-1">
                      Grading is running long
                    </p>
                    <p>
                      Your answers are submitted and grading is still running.
                      You can keep waiting, ask for an email when it finishes,
                      or tell us about it.
                    </p>
                    <div className="mt-3">
                      <ReportErrorButton error={errorReportContext} />
                    </div>
                  </motion.div>
                )}

                {status === "disconnected" && (
                  <motion.div
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="mb-6 space-y-3 text-left"
                  >
                    <div className="px-4 py-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-sm text-amber-900 dark:text-amber-200">
                      <p className="font-semibold mb-1">
                        Your submission is safe
                      </p>
                      <p>
                        We stopped receiving updates, so we can&apos;t show you
                        live progress. Grading may have finished — check your
                        results, and report this if the grade isn&apos;t there.
                      </p>
                    </div>
                    <div className="flex flex-col sm:flex-row gap-2">
                      {onCheckResults && (
                        <button
                          type="button"
                          onClick={onCheckResults}
                          className="inline-flex items-center justify-center rounded-lg bg-purple-600 px-5 py-2.5 text-sm font-semibold text-white shadow-md transition hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2"
                        >
                          Check my results
                        </button>
                      )}
                      <ReportErrorButton error={errorReportContext} />
                    </div>
                  </motion.div>
                )}

                {/* Show grade sync status when grading is complete */}
                {status === "completed" && attemptId && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.5 }}
                    className="mb-6"
                  >
                    <GradeSyncStatus
                      attemptId={attemptId}
                      assignmentId={assignmentId}
                    />
                  </motion.div>
                )}

                {isWorking && progressData.gradingState && (
                  <QuestionGradingList state={progressData.gradingState} />
                )}

                {isWorking && (
                  <>
                    {/* Modern linear progress bar */}
                    <motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.3 }}
                      className="mb-6"
                    >
                      <div className="relative bg-gray-100 dark:bg-gray-700 rounded-full h-3 overflow-hidden shadow-inner">
                        <motion.div
                          className="h-full rounded-full bg-gradient-to-r from-purple-500 via-blue-500 to-purple-500 relative shadow-lg"
                          style={{
                            width: barWidth,
                            backgroundSize: "200% 100%",
                          }}
                        >
                          <motion.div
                            animate={{
                              backgroundPosition: [
                                "0% 50%",
                                "100% 50%",
                                "0% 50%",
                              ],
                            }}
                            transition={{
                              duration: 2,
                              repeat: Infinity,
                              ease: "linear",
                            }}
                            className="absolute inset-0 bg-gradient-to-r from-transparent via-white/40 to-transparent"
                          />
                        </motion.div>
                      </div>
                    </motion.div>

                    {/* Email notification section */}
                    {!emailNotified && (
                      <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.4 }}
                        className="space-y-3"
                      >
                        <p className="text-gray-500 dark:text-gray-400 text-sm">
                          Want to close this tab?
                        </p>
                        <motion.button
                          onClick={handleSubscribeToEmail}
                          disabled={isSubscribing}
                          whileHover={{ scale: 1.02, y: -2 }}
                          whileTap={{ scale: 0.98 }}
                          className="w-full px-6 py-3 bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-xl hover:from-blue-600 hover:to-blue-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-lg shadow-blue-500/30 font-medium"
                        >
                          <motion.svg
                            animate={isSubscribing ? { rotate: [0, 360] } : {}}
                            transition={{
                              duration: 1,
                              repeat: Infinity,
                              ease: "linear",
                            }}
                            className="w-5 h-5"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            {isSubscribing ? (
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                              />
                            ) : (
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                              />
                            )}
                          </motion.svg>
                          {isSubscribing
                            ? "Subscribing..."
                            : "Get email when done"}
                        </motion.button>
                      </motion.div>
                    )}

                    {emailNotified && (
                      <motion.div
                        initial={{ opacity: 0, scale: 0.9, y: 10 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        transition={{ type: "spring", damping: 20 }}
                        className="px-4 py-4 bg-gradient-to-br from-blue-50 to-blue-100/50 border-2 border-blue-200 rounded-2xl backdrop-blur-sm"
                      >
                        <div className="flex items-center gap-3">
                          <motion.div
                            animate={{ scale: [1, 1.2, 1] }}
                            transition={{
                              duration: 0.5,
                              repeat: Infinity,
                              repeatDelay: 2,
                            }}
                            className="flex-shrink-0 w-10 h-10 bg-blue-500 rounded-full flex items-center justify-center shadow-lg"
                          >
                            <svg
                              className="w-5 h-5 text-white"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                              />
                            </svg>
                          </motion.div>
                          <div className="text-left flex-1">
                            <p className="text-sm font-semibold text-blue-900">
                              Email notification active
                            </p>
                            <p className="text-xs text-blue-700 mt-0.5">
                              Feel free to close this tab
                            </p>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </>
                )}
              </div>
            </motion.div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

function QuestionGradingList({ state }: { state: GradingProgressDetails }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.15 }}
      className="mb-6"
    >
      {state.hasSlowInFlight && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="mb-3 px-4 py-2 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-sm text-amber-900 dark:text-amber-200 flex items-start gap-2"
          role="status"
        >
          <span aria-hidden="true">⏳</span>
          <span>File uploads take a bit longer — hang in there!</span>
        </motion.div>
      )}
      <ul className="space-y-1.5 max-h-48 overflow-y-auto pr-1 text-left">
        {state.questions.map((q) => (
          <QuestionGradingRow key={q.id} question={q} />
        ))}
      </ul>
    </motion.div>
  );
}

function QuestionGradingRow({ question }: { question: QuestionGradingState }) {
  const styles = ROW_STYLES[question.status];
  return (
    <li
      className={`flex items-center justify-between gap-2 px-3 py-1.5 rounded-md text-sm ${styles.container}`}
    >
      <span className="flex items-center gap-2 min-w-0">
        <span className={`flex-shrink-0 ${styles.icon}`} aria-hidden="true">
          {styles.glyph}
        </span>
        <span translate="no" className="truncate">
          Question {question.displayOrder + 1}
        </span>
      </span>
      {/* key={styles.text} forces a full DOM remount when the status text
          changes. Firefox's built-in page translation latches onto text
          nodes after first render and stops applying React's text updates
          (visible as a green/"Done" container with stale "Grading" text);
          remounting on text change breaks that latch. translate="no" alone
          is not reliable when the user has translate-from-English forced
          on at the browser level. */}
      <span
        key={styles.text}
        translate="no"
        className={`text-xs uppercase tracking-wide ${styles.label}`}
      >
        {styles.text}
      </span>
    </li>
  );
}

const ROW_STYLES: Record<
  QuestionGradingStatus,
  {
    container: string;
    icon: string;
    label: string;
    glyph: string;
    text: string;
  }
> = {
  pending: {
    container:
      "bg-gray-50 text-gray-600 dark:bg-gray-700/50 dark:text-gray-300",
    icon: "text-gray-400",
    label: "text-gray-500 dark:text-gray-400",
    glyph: "○",
    text: "Queued",
  },
  in_progress: {
    container:
      "bg-purple-50 text-purple-900 dark:bg-purple-900/30 dark:text-purple-200",
    icon: "text-purple-500 animate-pulse",
    label: "text-purple-600 dark:text-purple-300",
    glyph: "◐",
    text: "Grading",
  },
  completed: {
    container:
      "bg-green-50 text-green-900 dark:bg-green-900/30 dark:text-green-200",
    icon: "text-green-600",
    label: "text-green-700 dark:text-green-300",
    glyph: "✓",
    text: "Done",
  },
  failed: {
    container: "bg-red-50 text-red-900 dark:bg-red-900/30 dark:text-red-200",
    icon: "text-red-600",
    label: "text-red-700 dark:text-red-300",
    glyph: "✕",
    text: "Failed",
  },
};
