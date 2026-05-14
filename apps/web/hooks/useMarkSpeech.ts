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

  return {
    activeBubble,
    speak,
    dismiss,

    sayMotionSick,
    sayExcited,
    sayHello,
    sayWarning,
    sayInfo,
  };
};
