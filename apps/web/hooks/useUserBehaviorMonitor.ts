"use client";

import { useState, useEffect, useRef, useCallback } from "react";

export interface UserBehaviorData {
  pageLoadTime: number;
  timeOnCurrentQuestion: number;
  timeIdle: number;
  lastActivityTime: number;

  hasTypedRecently: boolean;
  hasScrolledRecently: boolean;
  hasClickedRecently: boolean;
  mouseMovements: number;

  currentContext: {
    userRole: "author" | "learner" | null;
    assignmentName?: string;
    currentQuestionIndex?: number;
    totalQuestions?: number;
    detectedSubject?: string;
    isOnQuestionPage?: boolean;
    isStuck?: boolean;
    hasBeenIdleTooLong?: boolean;
  };

  shouldOfferHelp: boolean;
  helpReason: string;
  suggestedMessage: string;
}

export interface BehaviorTriggers {
  idleTimeThreshold: number;
  stuckTimeThreshold: number;
  helpOfferCooldown: number;
}

const defaultTriggers: BehaviorTriggers = {
  idleTimeThreshold: 15000,
  stuckTimeThreshold: 45000,
  helpOfferCooldown: 60000,
};

export const useUserBehaviorMonitor = (
  userRole: "author" | "learner" | null,
  contextData: {
    assignmentName?: string;
    questions?: any[];
    focusedQuestionId?: string | number;
    activeAssignmentId?: string | number;

    currentQuestion?: any;
    assignmentMeta?: any;
    currentQuestionIndex?: number;
    totalQuestions?: number;
    isGradedAssignment?: boolean;
    isFeedbackMode?: boolean;
  } = {},
  triggers: Partial<BehaviorTriggers> = {},
) => {
  const config = { ...defaultTriggers, ...triggers };

  const [behaviorData, setBehaviorData] = useState<UserBehaviorData>({
    pageLoadTime: Date.now(),
    timeOnCurrentQuestion: 0,
    timeIdle: 0,
    lastActivityTime: Date.now(),
    hasTypedRecently: false,
    hasScrolledRecently: false,
    hasClickedRecently: false,
    mouseMovements: 0,
    currentContext: {
      userRole,
      isStuck: false,
      hasBeenIdleTooLong: false,
    },
    shouldOfferHelp: false,
    helpReason: "",
    suggestedMessage: "",
  });

  const lastHelpOfferTime = useRef(0);
  const mouseMovementTimer = useRef<NodeJS.Timeout | null>(null);
  const questionStartTime = useRef(Date.now());
  const activityTimers = useRef({
    typing: null as NodeJS.Timeout | null,
    scrolling: null as NodeJS.Timeout | null,
    clicking: null as NodeJS.Timeout | null,
  });

  const getContextualInfo = useCallback(() => {
    let subject = "this topic";
    let context = "";
    let questionInfo = "";

    if (userRole === "author") {
      const assignmentName = contextData.assignmentName || "";
      const focusedQuestion = contextData.focusedQuestionId;
      const totalQuestions = contextData.questions?.length || 0;

      if (assignmentName) {
        subject = assignmentName;
        context = `working on "${assignmentName}"`;
      }

      if (focusedQuestion && totalQuestions > 0 && contextData.questions) {
        const questionIndex = contextData.questions?.findIndex(
          (q) => q.id === focusedQuestion || q.questionId === focusedQuestion,
        );
        if (questionIndex !== undefined && questionIndex >= 0) {
          questionInfo = `Question ${questionIndex + 1} of ${totalQuestions}`;
          context = `editing ${questionInfo} in "${assignmentName}"`;
        }
      } else if (totalQuestions > 0) {
        context = `creating an assignment with ${totalQuestions} questions`;
      }
    } else if (userRole === "learner") {
      const assignmentName = contextData.assignmentMeta?.name || "";
      const currentIndex = contextData.currentQuestionIndex;
      const totalQuestions = contextData.totalQuestions || 0;
      const isGraded = contextData.isGradedAssignment;
      const isFeedback = contextData.isFeedbackMode;

      if (assignmentName) {
        subject = assignmentName;
        context = `working on "${assignmentName}"`;
      }

      if (currentIndex !== undefined && totalQuestions > 0) {
        questionInfo = `Question ${currentIndex} of ${totalQuestions}`;
        context = `on ${questionInfo} of "${assignmentName}"`;
      }

      if (isFeedback) {
        context = `reviewing feedback for "${assignmentName}"`;
      } else if (isGraded) {
        context = `taking the graded "${assignmentName}" assessment`;
      }
    }

    return { subject, context, questionInfo };
  }, [userRole, contextData]);

  const trackMouseMovement = useCallback(() => {
    setBehaviorData((prev) => ({
      ...prev,
      mouseMovements: prev.mouseMovements + 1,
      lastActivityTime: Date.now(),
      timeIdle: 0,
    }));

    if (mouseMovementTimer.current) {
      clearTimeout(mouseMovementTimer.current);
    }
    mouseMovementTimer.current = setTimeout(() => {
      setBehaviorData((prev) => ({ ...prev, mouseMovements: 0 }));
    }, 5000);
  }, []);

  const trackTyping = useCallback(() => {
    setBehaviorData((prev) => ({
      ...prev,
      hasTypedRecently: true,
      lastActivityTime: Date.now(),
      timeIdle: 0,
    }));

    if (activityTimers.current.typing) {
      clearTimeout(activityTimers.current.typing);
    }
    activityTimers.current.typing = setTimeout(() => {
      setBehaviorData((prev) => ({ ...prev, hasTypedRecently: false }));
    }, 10000);
  }, []);

  const trackScrolling = useCallback(() => {
    setBehaviorData((prev) => ({
      ...prev,
      hasScrolledRecently: true,
      lastActivityTime: Date.now(),
      timeIdle: 0,
    }));

    if (activityTimers.current.scrolling) {
      clearTimeout(activityTimers.current.scrolling);
    }
    activityTimers.current.scrolling = setTimeout(() => {
      setBehaviorData((prev) => ({ ...prev, hasScrolledRecently: false }));
    }, 10000);
  }, []);

  const trackClicking = useCallback(() => {
    setBehaviorData((prev) => ({
      ...prev,
      hasClickedRecently: true,
      lastActivityTime: Date.now(),
      timeIdle: 0,
    }));

    if (activityTimers.current.clicking) {
      clearTimeout(activityTimers.current.clicking);
    }
    activityTimers.current.clicking = setTimeout(() => {
      setBehaviorData((prev) => ({ ...prev, hasClickedRecently: false }));
    }, 10000);
  }, []);

  const generateHelpSuggestion = useCallback(
    (behaviorContext: UserBehaviorData["currentContext"], reason: string) => {
      const { subject, context, questionInfo } = getContextualInfo();

      if (userRole === "learner") {
        switch (reason) {
          case "idle_too_long":
            return questionInfo
              ? `${questionInfo} taking a while? I can help! 💡`
              : `I noticed you've been looking at "${subject}" for a while. Need help? 🤔`;
          case "stuck_on_question":
            return questionInfo
              ? `${questionInfo} giving you trouble? Let me guide you! 🎯`
              : `Having trouble with this question? I can provide hints! 💭`;
          case "long_time_on_page":
            return `You've been ${context} for a while. Want some guidance? 📚`;
          default:
            return `I'm here if you need help with "${subject}"! 🤓`;
        }
      } else if (userRole === "author") {
        switch (reason) {
          case "idle_too_long":
            return questionInfo
              ? `${questionInfo} needs work? I can help! 🔧`
              : `I see you're ${context}. I'm an expert - click me! 🎓`;
          case "long_time_on_page":
            return `${context.charAt(0).toUpperCase() + context.slice(1)}? I can help generate ideas! 💭`;
          case "stuck_on_question":
            return questionInfo
              ? `Want to improve ${questionInfo}? I've got suggestions! ⚡`
              : `Need help crafting better questions? Click me! 🚀`;
          default:
            return `I can help you create better questions for "${subject}"! 📝`;
        }
      }

      return "Hey! I can help if you need anything! 😊";
    },
    [userRole, getContextualInfo],
  );

  const generateChatMessage = useCallback(
    (behaviorContext: UserBehaviorData["currentContext"], reason: string) => {
      const { subject, context, questionInfo } = getContextualInfo();

      if (userRole === "learner") {
        switch (reason) {
          case "idle_too_long":
            return questionInfo
              ? `I've been staring at ${questionInfo} in "${subject}" for a while and I'm not sure how to approach it. Can you help me understand the concepts?`
              : `I've been looking at "${subject}" for a while and I'm not sure how to proceed. Can you help me understand what I'm missing?`;
          case "stuck_on_question":
            return questionInfo
              ? `I'm stuck on ${questionInfo} in "${subject}". Can you give me a hint to get started?`
              : `I'm stuck on this question in "${subject}". Can you guide me through it?`;
          case "long_time_on_page":
            return `I've been ${context} and I'm struggling. Can you help me understand what I might be missing?`;
          default:
            return `I need help with "${subject}". Can you guide me through what I should be focusing on?`;
        }
      } else if (userRole === "author") {
        switch (reason) {
          case "idle_too_long":
            return questionInfo
              ? `I'm working on ${questionInfo} for "${subject}" and I'm looking for ways to improve it. Can you help me craft better questions?`
              : `I'm creating "${subject}" and I'm looking for ideas. Can you help me come up with good questions?`;
          case "long_time_on_page":
            return `I'm ${context} but I'm not sure if they're well-structured. Can you review and suggest improvements?`;
          case "stuck_on_question":
            return questionInfo
              ? `I'm struggling with ${questionInfo} in "${subject}". Can you help me make it test the right concepts effectively?`
              : `I'm struggling to write good questions for "${subject}" that test the right concepts. Can you help me craft them?`;
          default:
            return `I'm creating questions for "${subject}" and could use your expertise. Can you help me improve them?`;
        }
      }

      return `I could use some help with what I'm working on. Can you assist me?`;
    },
    [userRole, getContextualInfo],
  );

  useEffect(() => {
    const monitoringInterval = setInterval(() => {
      const now = Date.now();
      const timeSinceLastActivity = now - behaviorData.lastActivityTime;
      const timeOnCurrentQuestion = now - questionStartTime.current;

      setBehaviorData((prev) => {
        const { subject, context } = getContextualInfo();

        const newContext = {
          ...prev.currentContext,
          userRole,
          assignmentName: contextData.assignmentName,
          currentQuestionIndex: contextData.currentQuestionIndex,
          totalQuestions:
            contextData.totalQuestions || contextData.questions?.length,
          detectedSubject: subject,
          contextDescription: context,
          isOnQuestionPage: window.location.pathname.includes("/questions"),
          isStuck: timeOnCurrentQuestion > config.stuckTimeThreshold,
          hasBeenIdleTooLong: timeSinceLastActivity > config.idleTimeThreshold,
        };

        const timeSinceLastHelpOffer = now - lastHelpOfferTime.current;
        const canOfferHelp = timeSinceLastHelpOffer > config.helpOfferCooldown;

        let shouldOfferHelp = false;
        let helpReason = "";

        if (canOfferHelp) {
          if (newContext.hasBeenIdleTooLong) {
            shouldOfferHelp = true;
            helpReason = "idle_too_long";
          } else if (newContext.isStuck && userRole === "learner") {
            shouldOfferHelp = true;
            helpReason = "stuck_on_question";
          } else if (timeOnCurrentQuestion > config.stuckTimeThreshold * 1.2) {
            shouldOfferHelp = true;
            helpReason = "long_time_on_page";
          }
        }

        if (shouldOfferHelp && !prev.shouldOfferHelp) {
          lastHelpOfferTime.current = now;
        }

        return {
          ...prev,
          timeOnCurrentQuestion,
          timeIdle: timeSinceLastActivity,
          currentContext: newContext,
          shouldOfferHelp,
          helpReason,
          suggestedMessage: shouldOfferHelp
            ? generateHelpSuggestion(newContext, helpReason)
            : prev.suggestedMessage,
        };
      });
    }, 2000);

    return () => clearInterval(monitoringInterval);
  }, [
    userRole,
    config,
    behaviorData.lastActivityTime,
    getContextualInfo,
    generateHelpSuggestion,
  ]);

  useEffect(() => {
    document.addEventListener("mousemove", trackMouseMovement);
    document.addEventListener("keydown", trackTyping);
    document.addEventListener("scroll", trackScrolling);
    document.addEventListener("click", trackClicking);

    return () => {
      document.removeEventListener("mousemove", trackMouseMovement);
      document.removeEventListener("keydown", trackTyping);
      document.removeEventListener("scroll", trackScrolling);
      document.removeEventListener("click", trackClicking);
    };
  }, [trackMouseMovement, trackTyping, trackScrolling, trackClicking]);

  useEffect(() => {
    return () => {
      if (mouseMovementTimer.current) clearTimeout(mouseMovementTimer.current);
      Object.values(activityTimers.current).forEach((timer) => {
        if (timer) clearTimeout(timer);
      });
    };
  }, []);

  const resetHelpOffer = useCallback(() => {
    setBehaviorData((prev) => ({
      ...prev,
      shouldOfferHelp: false,
      helpReason: "",
      suggestedMessage: "",
    }));
  }, []);

  const getChatMessage = useCallback(() => {
    return generateChatMessage(
      behaviorData.currentContext,
      behaviorData.helpReason,
    );
  }, [
    behaviorData.currentContext,
    behaviorData.helpReason,
    generateChatMessage,
  ]);

  const markQuestionStart = useCallback(() => {
    questionStartTime.current = Date.now();
    setBehaviorData((prev) => ({
      ...prev,
      timeOnCurrentQuestion: 0,
    }));
  }, []);

  return {
    behaviorData,
    resetHelpOffer,
    getChatMessage,
    markQuestionStart,
  };
};
