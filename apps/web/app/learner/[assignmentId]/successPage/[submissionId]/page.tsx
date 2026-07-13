"use client";

import animationData from "@/animations/LoadSN.json";
import Loading from "@/components/Loading";
import {
  AssignmentAttemptWithQuestions,
  AssignmentDetails,
  AssignmentFeedback,
  QuestionStore,
} from "@/config/types";
import {
  getCompletedAttempt,
  getFeedback,
  getAttempts,
  getUser,
  submitFeedback,
} from "@/lib/talkToBackend";
import { resolveStoreGrade } from "@/lib/gradeDisplay";
import Crown from "@/public/Crown.svg";
import { useAssignmentDetails, useLearnerStore } from "@/stores/learner";
import { Rating, RoundedStar } from "@smastrom/react-rating";
import { IconRefresh } from "@tabler/icons-react";
import { Particles } from "@tsparticles/react";
import { AnimatePresence, motion } from "framer-motion";
import dynamic from "next/dynamic";
import Image, { StaticImageData } from "next/image";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  buildStyles,
  CircularProgressbarWithChildren,
} from "react-circular-progressbar";
import Question from "../Question";
import "@smastrom/react-rating/style.css";

import Button from "@/components/Button";
import ReportModal from "@/components/ReportModal";
import { Dialog, DialogPanel, DialogTitle } from "@headlessui/react";
import { XMarkIcon } from "@heroicons/react/24/outline";
import { toast } from "sonner";
import ErrorModal from "@/components/ErrorModal";
import GradeSyncStatus from "@/components/GradeSyncStatus";
import PromoBanner from "@/components/promo/PromoBanner";
import { PROMO_COMPLETION_MIN_SCORE } from "@/config/promo";

const DynamicConfetti = dynamic(() => import("react-confetti"), {
  ssr: false,
});

function SuccessPage() {
  const pathname: string = usePathname();
  const attemptId = parseInt(pathname.split("/")?.[4], 10);
  const assignmentId = parseInt(pathname.split("/")?.[2], 10);

  const [questions, setQuestions] = useState([]);
  const [grade, setGrade] = useState(0);
  const [totalPointsEarned, setTotalPointsEarned] = useState(0);
  const [totalPoints, setTotalPoints] = useState(0);
  const [assignmentDetails, setAssignmentDetails] =
    useState<AssignmentDetails>();
  const [showSubmissionFeedback, setShowSubmissionFeedback] =
    useState<boolean>(false);
  const [correctAnswerVisibility, setCorrectAnswerVisibility] = useState<
    "NEVER" | "ALWAYS" | "ON_PASS"
  >("ALWAYS");
  const [zustandShowSubmissionFeedback, zustandShowQuestions] =
    useAssignmentDetails((state) => [
      state.assignmentDetails?.showSubmissionFeedback ?? true,
      state.assignmentDetails?.showQuestions ?? true,
    ]);
  const [zustandQuestions, zustandTotalPointsEarned, zustandTotalPoints] =
    useLearnerStore((state) => [
      state.questions,
      state.totalPointsEarned,
      state.totalPointsPossible,
    ]);
  const [zustandAssignmentDetails, zustandGrade] = useAssignmentDetails(
    (state) => [state.assignmentDetails, state.grade],
  );

  const [showQuestions, setShowQuestions] = useState<boolean>(false);

  const [pageHeight, setPageHeight] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState<"learner" | "author" | "undefined">(
    "undefined",
  );
  const [init, setInit] = useState(false);
  const [playAnimations, setPlayAnimations] = useState(true);

  const [comments, setComments] = useState("");
  const [aiGradingRating, setAiGradingRating] = useState(0);
  const [assignmentRating, setAssignmentRating] = useState(0);
  const [isFeedbackModalOpen, setIsFeedbackModalOpen] = useState(false);
  const [allowContact, setAllowContact] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  useEffect(() => {
    window.dispatchEvent(new Event("resize"));
  }, [isFeedbackModalOpen]);

  const [isReportModalOpen, setIsReportModalOpen] = useState(false);
  const [BackendComments, setBackendComments] = useState("");
  const [userId, setUserId] = useState<string>(null);
  const [errorConfig, setErrorConfig] = useState<{
    message: string;
    headline?: string;
    statusCode?: number;
    primaryActionHref?: string;
  } | null>(null);
  const [stateTimeline, setStateTimeline] = useState<
    { step: string; detail?: string; timestamp?: string }[]
  >([]);

  const [userPreferredLanguage, setUserPreferredLanguage] = useState("en");

  const logState = (step: string, detail?: string) => {
    setStateTimeline((prev) => [
      ...prev,
      { step, detail, timestamp: new Date().toISOString() },
    ]);
  };

  useEffect(() => {
    logState(
      "Start loading success page",
      `Assignment ${assignmentId}, attempt ${attemptId}`,
    );
    const fetchData = async () => {
      const user = await getUser();
      if (cancelled) return;
      setRole(user.role);
      setUserId(user.userId);
      logState("User loaded", `Role: ${user.role}`);
      if (user.role === "learner") {
        try {
          const submissionDetails: AssignmentAttemptWithQuestions =
            await getCompletedAttempt(assignmentId, attemptId);
          if (!submissionDetails) {
            logState("Attempt fetch failed", "Attempt not found or not owned");
            let resolvedHref: string | undefined = `/learner/${assignmentId}`;
            try {
              logState("Looking up other attempts for learner");
              const attempts = await getAttempts(assignmentId);
              const submittedAttempt =
                attempts?.find((att) => att.submitted) || attempts?.[0];
              if (submittedAttempt) {
                logState(
                  "Found fallback attempt",
                  `Attempt ${submittedAttempt.id}`,
                );
                resolvedHref = `/learner/${assignmentId}/successPage/${submittedAttempt.id}`;
              }
            } catch {
              logState("Failed to fetch other attempts for learner");
            }

            setErrorConfig({
              statusCode: 404,
              headline: "Attempt not found",
              message:
                "This submission does not belong to your account or no longer exists. Please open the assignment from your course to view your own attempts.",
              primaryActionHref: resolvedHref,
            });
            setLoading(false);
            return;
          }
          logState("Attempt fetched", `Attempt ${submissionDetails.id}`);
          setQuestions(submissionDetails.questions);
          setBackendComments(submissionDetails.comments || "");
          setShowSubmissionFeedback(
            submissionDetails.showSubmissionFeedback || false,
          );
          setCorrectAnswerVisibility(
            submissionDetails.correctAnswerVisibility ?? "ALWAYS",
          );
          setShowQuestions(submissionDetails.showQuestions);
          setUserPreferredLanguage(submissionDetails.preferredLanguage);

          if (submissionDetails.showAssignmentScore === false) {
            setGrade(Number.NaN);
            setTotalPoints(0);
            setTotalPointsEarned(0);
          } else {
            const rawGrade = submissionDetails.grade;
            // Prefer the server-computed totals: when showQuestions=false the
            // questions array is stripped, and reducing it yields 0 / 0.
            const possible =
              typeof submissionDetails.totalPossiblePoints === "number"
                ? submissionDetails.totalPossiblePoints
                : submissionDetails.questions.reduce(
                    (acc, question) => acc + (question.totalPoints ?? 0),
                    0,
                  );
            const earned =
              typeof submissionDetails.totalPointsEarned === "number"
                ? submissionDetails.totalPointsEarned
                : typeof rawGrade === "number"
                  ? possible * rawGrade
                  : 0;

            setGrade(
              typeof rawGrade === "number" ? rawGrade * 100 : Number.NaN,
            );
            setTotalPoints(possible);
            setTotalPointsEarned(earned);
          }
          setAssignmentDetails({
            passingGrade: submissionDetails.passingGrade,
            id: submissionDetails.id,
            name: submissionDetails.name,
          });
          const response = await getFeedback(assignmentId, attemptId);
          if (response) {
            logState("Feedback loaded");
            setComments(response.comments || "");
            setAiGradingRating(response.aiGradingRating || 0);
            setAssignmentRating(response.assignmentRating || 0);
          }
          setInit(true);
        } finally {
          logState("Finished learner load");
          setLoading(false);
        }
      } else if (user.role === "author") {
        logState("Author mode load");
        const submissionDetails = await getCompletedAttempt(
          assignmentId,
          attemptId,
        );

        if (submissionDetails) {
          setQuestions(submissionDetails.questions);
          setBackendComments(submissionDetails.comments || "");
          setShowSubmissionFeedback(
            submissionDetails.showSubmissionFeedback || false,
          );
          setCorrectAnswerVisibility(
            submissionDetails.correctAnswerVisibility ?? "ALWAYS",
          );
          setShowQuestions(submissionDetails.showQuestions);

          if (submissionDetails.showAssignmentScore === false) {
            setGrade(Number.NaN);
            setTotalPoints(0);
            setTotalPointsEarned(0);
          } else {
            const rawGrade = submissionDetails.grade;
            const possible =
              typeof submissionDetails.totalPossiblePoints === "number"
                ? submissionDetails.totalPossiblePoints
                : submissionDetails.questions.reduce(
                    (acc, question) => acc + (question.totalPoints ?? 0),
                    0,
                  );
            const earned =
              typeof submissionDetails.totalPointsEarned === "number"
                ? submissionDetails.totalPointsEarned
                : typeof rawGrade === "number"
                  ? possible * rawGrade
                  : 0;

            setGrade(
              typeof rawGrade === "number" ? rawGrade * 100 : Number.NaN,
            );
            setTotalPoints(possible);
            setTotalPointsEarned(earned);
          }
          setAssignmentDetails({
            passingGrade: submissionDetails.passingGrade,
            id: assignmentId,
            name: submissionDetails.name ?? "Assignment",
          });
          logState("Loaded author success data from backend");
        } else {
          setShowSubmissionFeedback(zustandShowSubmissionFeedback);
          setQuestions(zustandQuestions);
          setShowQuestions(zustandShowQuestions);
          // A never-set store grade must render the hidden-score view, not 0%.
          setGrade(resolveStoreGrade(zustandGrade));
          setTotalPointsEarned(zustandTotalPointsEarned);
          setTotalPoints(zustandTotalPoints);
          setAssignmentDetails(zustandAssignmentDetails);
          setCorrectAnswerVisibility(
            zustandAssignmentDetails?.correctAnswerVisibility ?? "ALWAYS",
          );
          logState("Loaded from author store");
        }
        setLoading(false);
      } else {
        logState("Unknown role", user.role);
        setLoading(false);
      }
    };
    let cancelled = false;
    void fetchData();
    return () => {
      cancelled = true;
    };
  }, [
    assignmentId,
    attemptId,
    zustandQuestions,
    zustandGrade,
    zustandTotalPointsEarned,
    zustandTotalPoints,
    zustandAssignmentDetails,
  ]);

  useEffect(() => {
    setPlayAnimations(true);
    const timeout = setTimeout(() => setPlayAnimations(false), 5000);
    return () => clearTimeout(timeout);
  }, [grade]);

  const crownAnimation = {
    initial: { y: -250, x: 0, opacity: 0 },
    animate: { y: 0, opacity: 1 },
    transition: { type: "spring", stiffness: 50, damping: 10, duration: 1 },
  };

  const fireworksOptions = {
    fullScreen: {
      zIndex: 1,
    },
    particles: {
      number: {
        value: 50,
      },
      color: {
        value: ["#ff0000", "#ffcc00", "#00ff00", "#00aaff"],
      },
      shape: {
        type: ["circle"],
      },
      opacity: {
        value: 1,
      },
      size: {
        value: { min: 3, max: 7 },
      },
      emitters: {
        direction: "bottom",
        position: {
          x: 50,
          y: 0,
        },
        rate: {
          quantity: 0,
          delay: 0,
        },
      },
      move: {
        enable: true,
        speed: 60,
        direction: "none" as const,
        random: true,
        straight: false,
        outModes: {
          default: "destroy" as const,
        },
      },
      life: {
        duration: {
          sync: true,
          value: 2,
        },
      },
      explode: {
        enable: true,
      },
      gravity: {
        enable: false,
      },
    },
  };

  useEffect(() => {
    const updatePageHeight = () => {
      setPageHeight(window.innerHeight);
    };

    updatePageHeight();

    window.addEventListener("resize", updatePageHeight);
    return () => {
      window.removeEventListener("resize", updatePageHeight);
    };
  }, []);

  const sparkleOptions = {
    fullScreen: {
      zIndex: 1,
    },
    frameRate: 30,
    particles: {
      number: {
        value: 20,
      },
      color: {
        value: ["#FFD700"],
      },
      shape: {
        type: ["star"],
      },
      opacity: {
        value: 1,
      },
      size: {
        value: { min: 3, max: 8 },
      },
      move: {
        enable: true,
        speed: { min: 20, max: 30 },
        direction: "none" as const,
        random: true,
        straight: false,
        outModes: {
          default: "destroy" as const,
        },
      },
      life: {
        duration: {
          sync: true,
          value: 2,
        },
      },
      rotate: {
        value: { min: 0, max: 360 },
        direction: "random",
        animation: {
          enable: true,
          speed: 20,
        },
      },
      gravity: {
        enable: false,
      },
    },
  };

  if (errorConfig) {
    return (
      <ErrorModal
        statusCode={errorConfig.statusCode ?? 404}
        headline={errorConfig.headline ?? "Attempt not available"}
        error={errorConfig.message}
        userSteps={[
          {
            title: "Open your assignments",
            description:
              "Return to your assignments list and open your own submission.",
            cta: "Go to my assignments",
          },
          {
            title: "Check you are logged in",
            description:
              "Make sure you are signed in with the correct account.",
          },
        ]}
        primaryActionHref={`/learner/${assignmentId}`}
        primaryActionLabel="Go to my assignments"
        debugDetails={[
          { label: "AssignmentId", value: String(assignmentId) },
          { label: "AttemptId", value: String(attemptId) },
        ]}
        primaryActionHrefOverride={errorConfig.primaryActionHref}
        stateTimeline={stateTimeline}
      />
    );
  }

  if (loading) {
    return <Loading animationData={animationData} />;
  }
  const { passingGrade } = assignmentDetails || {
    passingGrade: 50,
    id: null,
  };

  const getGradeMessage = (grade: number): string => {
    if (BackendComments !== "") {
      return "Your submission was late";
    }
    if (grade >= 80) return "Impressive Mastery! ";
    if (grade >= 70) return "Strong Progress! ";
    if (grade >= 60) return "Solid Effort! ";
    if (grade >= 50) return "Steady Improvement! ";
    return "Keep Pushing Forward!";
  };

  const handleSubmitFeedback = async () => {
    if (assignmentId === null || attemptId === null) {
      return;
    }
    if (comments === "") {
      toast.error("Please provide your feedback comments.");
      return;
    }
    if (aiGradingRating === 0 || assignmentRating === 0) {
      toast.error("Please rate the assignment and AI grading.");
      return;
    }

    if (allowContact && (!firstName || !lastName || !email)) {
      toast.error("Please provide your contact information.");
      return;
    }

    const feedbackData: AssignmentFeedback = {
      assignmentId: assignmentDetails?.id || assignmentId,
      userId: userId,
      comments,
      aiGradingRating,
      assignmentRating,
      allowContact,
      firstName: allowContact ? firstName : undefined,
      lastName: allowContact ? lastName : undefined,
      email: allowContact ? email : undefined,
    };

    try {
      const response = await submitFeedback(
        assignmentId,
        attemptId,
        feedbackData,
      );
      if (response === true) {
        toast.success("Feedback submitted successfully!");
        setIsFeedbackModalOpen(false);
      } else {
        toast.error("Failed to submit feedback. Please try again.");
      }
    } catch (error) {
      toast.error("Failed to submit feedback. Please try again.");
    }
  };

  return (
    <div className="relative pt-12 md:pt-16 flex flex-col items-center justify-start w-full min-h-screen gap-y-6 bg-gradient-to-b overflow-y-auto">
      {init && grade >= 90 && playAnimations && (
        <Particles
          id="fireworks"
          options={fireworksOptions}
          className="absolute inset-0 z-0"
        />
      )}

      {init && grade >= 60 && grade < 90 && playAnimations && (
        <Particles
          id="sparkles"
          options={sparkleOptions}
          className="absolute inset-0 z-0"
        />
      )}

      {grade >= passingGrade && (
        <DynamicConfetti
          recycle={false}
          numberOfPieces={200}
          width={window.innerWidth}
          height={pageHeight}
        />
      )}
      <div className="w-full max-w-4xl z-10 px-4 sm:px-6 md:px-8">
        <div className="flex flex-col items-center text-center gap-y-6">
          {!Number.isNaN(grade) ? (
            <>
              <div className="w-full flex flex-col md:flex-row md:items-center justify-center gap-6 md:gap-16 bg-white p-6 rounded-lg shadow-md">
                <div className="flex flex-col items-start gap-4">
                  <motion.h1
                    className="text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-extrabold text-gray-800 text-center"
                    initial={{ opacity: 0, y: -30 }}
                    animate={{ opacity: 1, y: 0 }}
                  >
                    {grade >= 90
                      ? "Legendary Performance! 🏆"
                      : getGradeMessage(grade)}
                  </motion.h1>

                  <motion.p
                    className="text-xl text-left text-gray-600"
                    initial={{ opacity: 0, y: 30 }}
                    animate={{ opacity: 1, y: 0 }}
                  >
                    {BackendComments === "" ? (
                      grade >= passingGrade ? (
                        <>
                          <strong className="text-green-600">
                            Congratulations on successfully completing this
                            assignment!
                          </strong>{" "}
                          Your grade has been recorded. Feel free to close this
                          tab and return to the main course page.
                        </>
                      ) : (
                        <>
                          <strong>
                            Keep going! Mistakes are opportunities to learn and
                            grow.
                          </strong>{" "}
                          Review your answers and{" "}
                          <strong
                            className="cursor-pointer underline"
                            onClick={() =>
                              (window.location.href = `/learner/${assignmentId}/`)
                            }
                          >
                            try again
                          </strong>{" "}
                          to achieve your best result.
                        </>
                      )
                    ) : (
                      <>
                        <p>{BackendComments}</p>
                      </>
                    )}
                  </motion.p>

                  <motion.p
                    className="text-xl text-black"
                    initial={{ opacity: 0, y: 30 }}
                    animate={{ opacity: 1, y: 0 }}
                  >
                    Required passing grade: {passingGrade}%
                  </motion.p>

                  <motion.p
                    className="text-xl "
                    initial={{ opacity: 0, y: 30 }}
                    animate={{ opacity: 1, y: 0 }}
                  >
                    Status:
                    <span
                      className={`ml-1 font-semibold
                        ${
                          grade >= passingGrade
                            ? "text-green-600"
                            : "text-red-600"
                        }`}
                    >
                      {grade >= passingGrade ? "Passed" : "Failed"}
                    </span>
                  </motion.p>
                  <motion.p
                    className="text-xl "
                    initial={{ opacity: 0, y: 30 }}
                    animate={{ opacity: 1, y: 0 }}
                  >
                    Final Score: {Math.round(totalPointsEarned)} /{" "}
                    {Math.round(totalPoints)} ({Math.round(grade)}%)
                  </motion.p>
                </div>
                <motion.div className="flex flex-col items-center h-full mb-10 ">
                  {Math.round(grade) === 100 && (
                    <motion.div
                      {...crownAnimation}
                      className="w-full h-full flex items-center justify-center mb-2"
                    >
                      <Image
                        src={Crown as StaticImageData}
                        alt="Crown"
                        width={96}
                        height={96}
                      />
                    </motion.div>
                  )}
                  <motion.div
                    initial={{ scale: 0.8 }}
                    animate={{ scale: 1 }}
                    transition={{ duration: 0.5, type: "spring" }}
                    className="w-36 h-36 md:w-48 md:h-30 mx-auto"
                  >
                    <CircularProgressbarWithChildren
                      value={Math.round(grade)}
                      styles={buildStyles({
                        pathColor:
                          grade >= passingGrade ? "#10B981" : "#EF4444",
                        textColor: "#374151",
                        trailColor: "#D1D5DB",
                        backgroundColor: "#fff",
                      })}
                    >
                      <div className="text-[35px] font-bold text-gray-500">
                        {Math.round(grade)}%
                      </div>
                    </CircularProgressbarWithChildren>
                  </motion.div>
                </motion.div>
              </div>
            </>
          ) : (
            <motion.h1
              className="text-5xl font-extrabold text-gray-800"
              initial={{ opacity: 0, y: -30 }}
              animate={{ opacity: 1, y: 0 }}
            >
              Grades are currently unavailable as the author has disabled
              viewing them.
            </motion.h1>
          )}
        </div>

        {role === "learner" && !Number.isNaN(grade) && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="w-full"
          >
            <GradeSyncStatus
              attemptId={attemptId}
              assignmentId={assignmentId}
            />
          </motion.div>
        )}

        {role === "learner" &&
          grade >= passingGrade &&
          grade > PROMO_COMPLETION_MIN_SCORE && (
            <div className="w-full mt-4">
              <PromoBanner placement="completion" />
            </div>
          )}

        {role === "learner" && (
          <div className="flex flex-col sm:flex-row items-center gap-y-4 sm:gap-y-0 gap-x-4 justify-center p-4">
            <button
              onClick={() => setIsFeedbackModalOpen(true)}
              className="px-6 py-3 bg-violet-100 hover:bg-violet-200 text-violet-800 rounded-md transition "
            >
              <div className="flex items-center gap-x-2">
                Provide Assignment Feedback
              </div>
            </button>
          </div>
        )}

        {(role === "learner" && showQuestions) ||
        (role === "author" && showQuestions) ? (
          <div className="mt-4">
            {questions.map((question: QuestionStore, index: number) => (
              <motion.div
                className="p-4 sm:p-6  bg-white rounded-lg shadow-lg w-full max-w-4xl mx-auto mb-6"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                key={question.id}
              >
                <Question
                  number={index + 1}
                  question={question}
                  language={userPreferredLanguage}
                  showSubmissionFeedback={showSubmissionFeedback}
                  correctAnswerVisibility={correctAnswerVisibility}
                  showCorrectAnswer={(() => {
                    if (correctAnswerVisibility === "NEVER") return false;
                    if (correctAnswerVisibility === "ALWAYS") return true;
                    if (correctAnswerVisibility === "ON_PASS")
                      return grade >= passingGrade;
                    return false;
                  })()}
                />
              </motion.div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center mt-4 sm:p-6  bg-white rounded-lg shadow-lg w-full max-w-4xl mx-auto mb-6">
            <h2 className="text-2xl font-bold text-gray-800 mb-4">
              Questions are hidden
            </h2>
            <p className="text-gray-600">
              The author has chosen to hide the questions for this assignment.
            </p>
          </div>
        )}

        <div className="flex flex-wrap justify-between mb-10 px-5">
          {role === "learner" && (
            <div className="flex items-center gap-x-4 justify-center">
              <button
                onClick={() => setIsReportModalOpen(true)}
                className="px-6 py-3 bg-violet-100 hover:bg-violet-200 text-violet-800 rounded-md transition mb-2 sm:mb-0"
              >
                <div className="flex items-center gap-x-2">Report an issue</div>
              </button>
            </div>
          )}
          <Button
            onClick={() =>
              role?.toLowerCase() === "learner"
                ? (window.location.href = `/learner/${assignmentId}/`)
                : role?.toLowerCase() === "author"
                  ? (window.location.href = `/learner/${assignmentId}/?authorMode=true`)
                  : (window.location.href = "/")
            }
            className="px-6 py-3 bg-violet-600 hover:bg-violet-500 text-white rounded-md transition flex items-center gap-2 shadow-lg mt-2"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <IconRefresh className="w-6 h-6 text-white" />
            </svg>
            Retake Assignment
          </Button>
        </div>
      </div>

      <AnimatePresence>
        {isFeedbackModalOpen && (
          <Dialog
            as={motion.div}
            static
            className="fixed inset-0 z-50 overflow-y-auto bg-black bg-opacity-50"
            open={isFeedbackModalOpen}
            onClose={() => setIsFeedbackModalOpen(false)}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <div className="min-h-screen px-4 text-center">
              <span
                className="inline-block h-screen align-middle"
                aria-hidden="true"
              >
                &#8203;
              </span>
              <motion.div
                className="inline-block w-full max-w-md p-6 my-8 overflow-hidden text-left align-middle transition-all transform bg-white shadow-xl rounded-lg"
                initial={{ scale: 0.9 }}
                animate={{ scale: 1 }}
                exit={{ scale: 0.9 }}
              >
                <DialogPanel>
                  <DialogTitle
                    as="h3"
                    className="text-lg font-medium leading-6 text-gray-900 mb-4"
                  >
                    <div className="flex justify-between items-center">
                      We Value Your Feedback
                      <XMarkIcon
                        className="w-6 h-6 text-gray-500 hover:cursor-pointer"
                        onClick={() => setIsFeedbackModalOpen(false)}
                      />
                    </div>
                  </DialogTitle>

                  <div className="flex flex-col items-center gap-4 mb-4">
                    <div className="text-center">
                      <label className="block text-gray-700 font-semibold mb-2">
                        Rate the Assignment
                      </label>
                      <Rating
                        key={`assignment-rating-${assignmentRating}-${String(
                          isFeedbackModalOpen,
                        )}`}
                        value={assignmentRating}
                        onChange={(value: number) => setAssignmentRating(value)}
                        style={{ maxWidth: 200 }}
                        itemStyles={{
                          itemShapes: RoundedStar,
                          activeFillColor: "#7C3AED",
                          inactiveFillColor: "#72777C",
                        }}
                      />
                    </div>

                    <div className="text-center">
                      <label className="block text-gray-700 font-semibold mb-2">
                        Rate the AI Grading
                      </label>
                      <Rating
                        key={`assignment-rating-${assignmentRating}-${String(
                          isFeedbackModalOpen,
                        )}`}
                        value={aiGradingRating}
                        onChange={(value: number) => setAiGradingRating(value)}
                        style={{ maxWidth: 200 }}
                        itemStyles={{
                          itemShapes: RoundedStar,
                          activeFillColor: "#7C3AED",
                          inactiveFillColor: "#72777C",
                        }}
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-gray-700 font-semibold mb-2">
                      Your Comments:
                    </label>
                    <textarea
                      className="w-full p-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                      rows={3}
                      value={comments}
                      onChange={(e) => setComments(e.target.value)}
                      placeholder="Share your thoughts or suggestions..."
                    ></textarea>
                  </div>

                  <div className="flex items-center mt-4">
                    <input
                      type="checkbox"
                      id="allowContact"
                      checked={allowContact}
                      onChange={(e) => setAllowContact(e.target.checked)}
                      className="mr-2 h-4 w-4 text-violet-600 focus:ring-violet-500 border-gray-300 rounded"
                    />

                    <label htmlFor="allowContact" className="text-gray-700">
                      I would like to be contacted regarding my feedback
                    </label>
                  </div>

                  {allowContact && (
                    <div className="mt-4 space-y-3">
                      <div>
                        <label className="block text-gray-700 font-semibold mb-2">
                          First Name:
                        </label>
                        <input
                          type="text"
                          className="w-full p-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                          value={firstName}
                          onChange={(e) => setFirstName(e.target.value)}
                          placeholder="Enter your first name"
                        />
                      </div>
                      <div>
                        <label className="block text-gray-700 font-semibold mb-2">
                          Last Name:
                        </label>
                        <input
                          type="text"
                          className="w-full p-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                          value={lastName}
                          onChange={(e) => setLastName(e.target.value)}
                          placeholder="Enter your last name"
                        />
                      </div>
                      <div>
                        <label className="block text-gray-700 font-semibold mb-2">
                          Email:
                        </label>
                        <input
                          type="email"
                          className="w-full p-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          placeholder="Enter your email address"
                        />
                      </div>
                    </div>
                  )}

                  <div className="text-center">
                    <button
                      onClick={handleSubmitFeedback}
                      className="px-6 py-2 mt-4 bg-violet-600 hover:bg-violet-500 text-white rounded-md transition shadow-lg"
                    >
                      Submit Feedback
                    </button>
                  </div>
                </DialogPanel>
              </motion.div>
            </div>
          </Dialog>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {isReportModalOpen && (
          <ReportModal
            assignmentId={assignmentId}
            attemptId={attemptId}
            isReportModalOpen={isReportModalOpen}
            setIsReportModalOpen={setIsReportModalOpen}
            isAuthor={role === "author"}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

export default SuccessPage;
