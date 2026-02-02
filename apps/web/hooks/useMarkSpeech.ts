"use client";

import { useState, useCallback, useRef } from "react";
import { useChatbot } from "./useChatbot";

export interface SpeechBubble {
  id: string;
  message: string;
  type: "info" | "warning" | "funny" | "excited" | "dizzy";
  duration?: number;
}

export const useMarkSpeech = () => {
  const [activeBubble, setActiveBubble] = useState<SpeechBubble | null>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const { isMuted } = useChatbot();

  const speak = useCallback(
    (message: string, type: SpeechBubble["type"] = "info", duration = 3000) => {
      // Don't show speech bubbles if muted
      if (isMuted) {
        return;
      }

      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      const bubble: SpeechBubble = {
        id: `bubble-${Date.now()}`,
        message,
        type,
        duration,
      };

      setActiveBubble(bubble);

      timeoutRef.current = setTimeout(() => {
        setActiveBubble(null);
      }, duration);
    },
    [isMuted],
  );

  const dismiss = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    setActiveBubble(null);
  }, []);

  const sayMotionSick = useCallback(() => {
    const messages = [
      "Whoa! Slow down there, I'm getting dizzy! 🌀",
      "Too fast! I get motion sickness! 😵‍💫",
      "Easy there! I'm not a ping pong ball! 🏓",
      "Hold up! My pixels are getting scrambled! 🤪",
      "Ahh! Stop shaking me like a snow globe! ❄️",
      "I think I'm gonna be sick... 🤢",
      "Could you be a little gentler? I bruise easily! 😵",
      "This is worse than a roller coaster! 🎢",
    ];

    const randomMessage = messages[Math.floor(Math.random() * messages.length)];
    speak(randomMessage, "dizzy", 4000);
  }, [speak]);

  const sayExcited = useCallback(() => {
    const messages = [
      "Ooh, I like this spot! 🌟",
      "Nice view from here! 👀",
      "This is my new favorite corner! ✨",
      "Perfect! Now I can see everything! 👁️",
      "Thanks for the relocation! 🏠",
    ];

    const randomMessage = messages[Math.floor(Math.random() * messages.length)];
    speak(randomMessage, "excited", 3000);
  }, [speak]);

  const sayHello = useCallback(() => {
    const messages = [
      "Hey there! Ready to learn? 📚",
      "What can I help you with today? 🤔",
      "I'm here whenever you need me! 💡",
      "Let's make this interesting! 🚀",
    ];

    const randomMessage = messages[Math.floor(Math.random() * messages.length)];
    speak(randomMessage, "excited", 3000);
  }, [speak]);

  const sayWarning = useCallback(
    (message: string) => {
      speak(message, "warning", 4000);
    },
    [speak],
  );

  const sayInfo = useCallback(
    (message: string) => {
      speak(message, "info", 3000);
    },
    [speak],
  );

  const offerHelp = useCallback(
    (message: string, userRole: "author" | "learner" | null = null) => {
      let helpType: SpeechBubble["type"] = "info";

      if (userRole === "learner") {
        helpType = "excited";
      } else if (userRole === "author") {
        helpType = "info";
      }

      speak(message, helpType, 6000);
    },
    [speak],
  );

  const sayProactiveHelp = useCallback(
    (subject: string, userRole: "author" | "learner" | null) => {
      if (userRole === "learner") {
        const learnerMessages = [
          `Need help with ${subject}? I'm here! 🤓`,
          `Stuck on this ${subject} problem? Click me! 💡`,
          `I can explain ${subject} concepts! 📚`,
          `Let me help you with ${subject}! 🎯`,
          `Having trouble? I know ${subject} well! 🧠`,
        ];

        const randomMessage =
          learnerMessages[Math.floor(Math.random() * learnerMessages.length)];
        offerHelp(randomMessage, "learner");
      } else if (userRole === "author") {
        const authorMessages = [
          `Creating ${subject} questions? I'm an expert! 🎓`,
          `Need ${subject} question ideas? Click me! 💭`,
          `I can help improve your ${subject} questions! ⚡`,
          `Struggling with ${subject} content? I got you! 🚀`,
          `Let me help craft better ${subject} assessments! 📝`,
        ];

        const randomMessage =
          authorMessages[Math.floor(Math.random() * authorMessages.length)];
        offerHelp(randomMessage, "author");
      }
    },
    [offerHelp],
  );

  const sayIdleHelp = useCallback(
    (userRole: "author" | "learner" | null) => {
      if (userRole === "learner") {
        const idleMessages = [
          "Taking your time? I can help! 🤔",
          "Need a hint to get started? 💡",
          "Stuck? Let's work through this together! 🤝",
          "I'm here when you're ready! 😊",
        ];

        const randomMessage =
          idleMessages[Math.floor(Math.random() * idleMessages.length)];
        offerHelp(randomMessage, "learner");
      } else if (userRole === "author") {
        const authorIdleMessages = [
          "Need inspiration? I have ideas! 💡",
          "Taking a break? I can help when ready! ☕",
          "Brainstorming questions? Click me! 🧠",
          "Writer's block? Let's collaborate! ✨",
        ];

        const randomMessage =
          authorIdleMessages[
            Math.floor(Math.random() * authorIdleMessages.length)
          ];

        offerHelp(randomMessage, "author");
      }
    },
    [offerHelp],
  );

  const sayStuckHelp = useCallback(
    (questionNumber?: number, userRole: "author" | "learner" | null = null) => {
      if (userRole === "learner") {
        const stuckMessages = [
          questionNumber
            ? `Question ${questionNumber} giving you trouble? 🤯`
            : "This one's tricky, huh? Let me help! 🎯",
          "Been here a while? I can guide you! 🗺️",
          "Need a different approach? Click me! 🔄",
          "Let's break this down together! 🧩",
        ];

        const randomMessage =
          stuckMessages[Math.floor(Math.random() * stuckMessages.length)];
        offerHelp(randomMessage, "learner");
      } else if (userRole === "author") {
        const authorStuckMessages = [
          questionNumber
            ? `Question ${questionNumber} needs work? I can help! 🔧`
            : "This question needs tweaking? 🛠️",
          "Want to make it more challenging? 📈",
          "Need better answer choices? 🎯",
          "Let's perfect this question! ✨",
        ];

        const randomMessage =
          authorStuckMessages[
            Math.floor(Math.random() * authorStuckMessages.length)
          ];

        offerHelp(randomMessage, "author");
      }
    },
    [offerHelp],
  );

  return {
    activeBubble,
    speak,
    dismiss,

    sayMotionSick,
    sayExcited,
    sayHello,
    sayWarning,
    sayInfo,

    offerHelp,
    sayProactiveHelp,
    sayIdleHelp,
    sayStuckHelp,
  };
};
