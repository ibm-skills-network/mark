import React, { useEffect, useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { subscribeToGradingNotification } from "@/lib/learner";
import { toast } from "sonner";
import { getApiRoutes } from "@/config/constants";
import GradeSyncStatus from "@/components/GradeSyncStatus";

interface GradingProgressModalProps {
  isOpen: boolean;
  assignmentId: number;
  attemptId: number | null;
  gradingJobId: string | null;
}

interface ProgressState {
  status: "processing" | "completed" | "failed" | "idle";
  progress: number;
  currentStage: string;
  currentQuestion?: number;
  totalQuestions?: number;
}

export default function GradingProgressModal({
  isOpen,
  assignmentId,
  attemptId,
  gradingJobId,
}: GradingProgressModalProps) {
  const [progressData, setProgressData] = useState<ProgressState>({
    status: "idle",
    progress: 0,
    currentStage: "Preparing to grade your assignment...",
  });
  const [isSubscribing, setIsSubscribing] = useState(false);
  const [emailNotified, setEmailNotified] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!isOpen || !attemptId || !gradingJobId) return;

    const sseUrl = `${getApiRoutes().assignments}/${assignmentId}/attempts/${attemptId}/grading/${gradingJobId}/status-stream`;

    const eventSource = new EventSource(sseUrl, {
      withCredentials: true,
    });

    eventSourceRef.current = eventSource;

    const updateProgress = (data: any) => {
      const terminalStatus = data?.finalStatus ?? data?.status;

      if (data?.heartbeat) {
        return;
      }

      if (data?.message && data?.connectionId) {
        setProgressData((prev) => ({
          ...prev,
          status: "processing",
          progress: prev.progress ?? 0,
          currentStage: data.message,
        }));
        return;
      }

      const rawPercentage = data?.percentage;
      const parsedPercentage =
        typeof rawPercentage === "number"
          ? rawPercentage
          : Number(rawPercentage);
      const percentage = Number.isFinite(parsedPercentage)
        ? Math.max(0, Math.min(100, Math.round(parsedPercentage)))
        : 0;

      const message =
        data?.progress ||
        data?.message ||
        data?.currentStage ||
        "Processing...";

      const status: ProgressState["status"] =
        terminalStatus === "Completed"
          ? "completed"
          : terminalStatus === "Failed"
            ? "failed"
            : "processing";

      setProgressData({
        status,
        progress: status === "completed" ? 100 : percentage,
        currentStage: status === "completed" ? "Grading complete!" : message,
        currentQuestion: data?.currentQuestion,
        totalQuestions: data?.totalQuestions,
      });

      if (terminalStatus === "Completed" || terminalStatus === "Failed") {
        eventSource.close();
      }
    };

    const handleSseMessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        updateProgress(data);
      } catch (error) {
        // Failed to parse SSE message - ignore invalid data
      }
    };

    eventSource.onopen = () => {
      setProgressData({
        status: "processing",
        progress: 0,
        currentStage: "Connected to grading service...",
      });
    };

    eventSource.addEventListener("update", handleSseMessage as any);
    eventSource.addEventListener("finalize", handleSseMessage as any);
    eventSource.addEventListener("heartbeat", handleSseMessage as any);
    eventSource.addEventListener("error", (event: any) => {
      if (event?.data) {
        handleSseMessage(event as MessageEvent);
        return;
      }

      setProgressData((prev) => ({
        ...prev,
        status: "failed",
        currentStage: "Connection to grading service lost",
      }));
      eventSource.close();
    });

    eventSource.onmessage = handleSseMessage;

    return () => {
      eventSource.close();
      eventSourceRef.current = null;
    };
  }, [isOpen, assignmentId, attemptId, gradingJobId]);

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

  const { status, progress, currentStage: message } = progressData;
  const getStatusColor = () => {
    switch (status) {
      case "completed":
        return "bg-green-500";
      case "failed":
        return "bg-red-500";
      case "processing":
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

      default:
        return null;
    }
  };

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
            {/* Animated gradient background orbs */}
            <motion.div
              className="absolute top-1/4 left-1/4 w-96 h-96 bg-purple-500/30 rounded-full blur-3xl"
              animate={{
                scale: [1, 1.2, 1],
                opacity: [0.3, 0.5, 0.3],
              }}
              transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
            />
            <motion.div
              className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-blue-500/30 rounded-full blur-3xl"
              animate={{
                scale: [1.2, 1, 1.2],
                opacity: [0.3, 0.5, 0.3],
              }}
              transition={{
                duration: 4,
                repeat: Infinity,
                ease: "easeInOut",
                delay: 1,
              }}
            />

            {/* Main Modal Card */}
            <motion.div
              initial={{ scale: 0.8, opacity: 0, y: 50 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.8, opacity: 0, y: 50 }}
              transition={{ type: "spring", damping: 30, stiffness: 300 }}
              className="relative bg-gradient-to-br from-white via-white to-purple-50/50 rounded-3xl shadow-2xl p-8 max-w-md w-full backdrop-blur-xl border border-white/20"
              style={{
                boxShadow:
                  "0 25px 50px -12px rgba(0, 0, 0, 0.25), 0 0 0 1px rgba(255, 255, 255, 0.1)",
              }}
            >
              <div className="text-center relative">
                {/* Floating particles */}
                {status === "processing" && (
                  <>
                    {[...Array(6)].map((_, i) => (
                      <motion.div
                        key={i}
                        className="absolute w-2 h-2 bg-purple-400 rounded-full"
                        style={{
                          top: `${20 + i * 15}%`,
                          left: i % 2 === 0 ? "10%" : "90%",
                        }}
                        animate={{
                          y: [-20, 20, -20],
                          x: [0, i % 2 === 0 ? 10 : -10, 0],
                          opacity: [0.2, 0.6, 0.2],
                          scale: [0.8, 1.2, 0.8],
                        }}
                        transition={{
                          duration: 3 + i * 0.5,
                          repeat: Infinity,
                          ease: "easeInOut",
                          delay: i * 0.3,
                        }}
                      />
                    ))}
                  </>
                )}

                <div className="mb-8 relative">
                  {status === "processing" ? (
                    <div className="relative w-40 h-40 mx-auto">
                      {/* Outer glow ring */}
                      <motion.div
                        className="absolute inset-0 rounded-full bg-gradient-to-tr from-purple-500/20 to-blue-500/20 blur-xl"
                        animate={{
                          scale: [1, 1.1, 1],
                          opacity: [0.5, 0.8, 0.5],
                        }}
                        transition={{
                          duration: 2,
                          repeat: Infinity,
                          ease: "easeInOut",
                        }}
                      />

                      {/* Rotating gradient ring */}
                      <motion.div
                        animate={{ rotate: 360 }}
                        transition={{
                          duration: 3,
                          repeat: Infinity,
                          ease: "linear",
                        }}
                        className="absolute inset-4"
                      >
                        <svg className="w-full h-full" viewBox="0 0 100 100">
                          <defs>
                            <linearGradient
                              id="progressGradient"
                              x1="0%"
                              y1="0%"
                              x2="100%"
                              y2="100%"
                            >
                              <stop offset="0%" stopColor="#8b5cf6" />
                              <stop offset="50%" stopColor="#6366f1" />
                              <stop offset="100%" stopColor="#3b82f6" />
                            </linearGradient>
                          </defs>
                          <circle
                            cx="50"
                            cy="50"
                            r="42"
                            fill="none"
                            stroke="#e5e7eb"
                            strokeWidth="6"
                          />
                          <motion.circle
                            cx="50"
                            cy="50"
                            r="42"
                            fill="none"
                            stroke="url(#progressGradient)"
                            strokeWidth="6"
                            strokeDasharray={`${progress * 2.64} 264`}
                            strokeLinecap="round"
                            transform="rotate(-90 50 50)"
                            initial={{ strokeDasharray: "0 264" }}
                            animate={{
                              strokeDasharray: `${progress * 2.64} 264`,
                            }}
                            transition={{ duration: 0.5, ease: "easeOut" }}
                          />
                        </svg>
                      </motion.div>

                      {/* Center content with glassmorphism */}
                      <div className="absolute inset-0 flex items-center justify-center">
                        <div className="bg-white/80 backdrop-blur-md rounded-full w-24 h-24 shadow-xl flex flex-col items-center justify-center border border-white/50">
                          <motion.span
                            key={progress}
                            initial={{ scale: 1.3, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            transition={{
                              type: "spring",
                              damping: 20,
                              stiffness: 300,
                            }}
                            className="text-3xl font-bold bg-gradient-to-br from-purple-600 to-blue-600 bg-clip-text text-transparent"
                          >
                            {progress}%
                          </motion.span>
                          {progressData.currentQuestion &&
                            progressData.totalQuestions && (
                              <motion.span
                                initial={{ opacity: 0, y: 5 }}
                                animate={{ opacity: 1, y: 0 }}
                                className="text-xs text-gray-500 mt-1"
                              >
                                {progressData.currentQuestion}/
                                {progressData.totalQuestions}
                              </motion.span>
                            )}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <>
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
                          {[...Array(20)].map((_, i) => (
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
                                x: (Math.random() - 0.5) * 300,
                                y: (Math.random() - 0.5) * 300,
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
                    </>
                  )}
                </div>

                <motion.h3
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.2 }}
                  className="text-2xl font-bold mb-3 bg-gradient-to-r from-gray-800 via-gray-900 to-gray-800 bg-clip-text text-transparent"
                >
                  {status === "processing" && "Grading Your Assignment"}
                  {status === "completed" && "🎉 Grading Complete!"}
                  {status === "failed" && "Grading Failed"}
                </motion.h3>

                <motion.p
                  key={message}
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="text-gray-600 mb-6 min-h-[48px] flex items-center justify-center text-base px-4"
                >
                  {message}
                </motion.p>

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

                {status === "processing" && (
                  <>
                    {/* Modern linear progress bar */}
                    <motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.3 }}
                      className="mb-6"
                    >
                      <div className="relative bg-gray-100 rounded-full h-3 overflow-hidden shadow-inner">
                        <motion.div
                          initial={{ width: "0%" }}
                          animate={{ width: `${progress}%` }}
                          transition={{ duration: 0.5, ease: "easeOut" }}
                          className="h-full rounded-full bg-gradient-to-r from-purple-500 via-blue-500 to-purple-500 relative shadow-lg"
                          style={{
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
                        <p className="text-gray-500 text-sm">
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
