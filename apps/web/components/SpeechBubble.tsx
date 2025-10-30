"use client";

import { motion, AnimatePresence } from "framer-motion";
import { XMarkIcon } from "@heroicons/react/24/solid";
import { SpeechBubble as SpeechBubbleType } from "@/hooks/useMarkSpeech";

interface SpeechBubbleProps {
  bubble: SpeechBubbleType | null;
  onDismiss: () => void;
  position: { x: number; y: number };
}

const SpeechBubble = ({ bubble, onDismiss, position }: SpeechBubbleProps) => {
  if (!bubble) return null;

  const getBubbleStyle = (type: SpeechBubbleType["type"]) => {
    switch (type) {
      case "dizzy":
        return "bg-yellow-100 border-yellow-300 text-yellow-800";
      case "excited":
        return "bg-purple-100 border-purple-300 text-purple-800";
      case "warning":
        return "bg-red-100 border-red-300 text-red-800";
      case "funny":
        return "bg-green-100 border-green-300 text-green-800";
      default:
        return "bg-blue-100 border-blue-300 text-blue-800";
    }
  };

  const getAnimationProps = (type: SpeechBubbleType["type"]) => {
    switch (type) {
      case "dizzy":
        return {
          initial: { scale: 0, rotate: -10 },
          animate: {
            scale: 1,
            rotate: [0, -2, 2, -2, 0],
            transition: {
              scale: { type: "spring", stiffness: 300, damping: 20 },
              rotate: { repeat: 3, duration: 0.5 },
            },
          },
        };
      case "excited":
        return {
          initial: { scale: 0, y: 20 },
          animate: {
            scale: [1, 1.05, 1],
            y: [0, -5, 0],
            transition: {
              scale: { times: [0, 0.5, 1], duration: 0.6 },
              y: { repeat: 2, duration: 0.8 },
            },
          },
        };
      default:
        return {
          initial: { scale: 0, opacity: 0 },
          animate: { scale: 1, opacity: 1 },
        };
    }
  };

  const markSize = 66;
  const bubbleOffset = 20;
  const bubbleWidth = 280;

  const isNearLeftEdge = position.x < bubbleWidth + 50;
  const isNearRightEdge =
    typeof window !== "undefined" &&
    position.x > window.innerWidth - markSize - 50;

  let bubbleX, bubbleY, arrowPosition, arrowClasses;

  if (isNearLeftEdge) {
    bubbleX = position.x + markSize + bubbleOffset;
    bubbleY = position.y + markSize / 2;
    arrowPosition = "left";
    arrowClasses = `absolute -left-2 top-1/2 transform -translate-y-1/2 w-4 h-4 rotate-45 border-l-2 border-t-2`;
  } else {
    bubbleX = position.x - bubbleOffset;
    bubbleY = position.y + markSize / 2;
    arrowPosition = "right";
    arrowClasses = `absolute -right-2 top-1/2 transform -translate-y-1/2 w-4 h-4 rotate-45 border-r-2 border-b-2`;
  }

  return (
    <AnimatePresence>
      <motion.div
        key={bubble.id}
        className="fixed z-[60] pointer-events-auto"
        style={{
          [arrowPosition === "right" ? "right" : "left"]:
            arrowPosition === "right"
              ? typeof window !== "undefined"
                ? window.innerWidth - bubbleX
                : 0
              : bubbleX,
          top: bubbleY - 25,
        }}
        {...getAnimationProps(bubble.type)}
        exit={{ scale: 0, opacity: 0 }}
        animate={{
          ...getAnimationProps(bubble.type).animate,

          transition: {
            ...getAnimationProps(bubble.type).animate?.transition,
            x: { type: "spring", stiffness: 200, damping: 20 },
            y: { type: "spring", stiffness: 200, damping: 20 },
          },
        }}
      >
        <div
          className={`relative max-w-xs p-3 rounded-lg border-2 shadow-lg ${getBubbleStyle(bubble.type)}`}
        >
          <div className={`${arrowClasses} ${getBubbleStyle(bubble.type)}`} />

          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-medium leading-tight pr-2">
              {bubble.message}
            </p>
            <button
              onClick={onDismiss}
              className="flex-shrink-0 p-1 rounded-full opacity-60 hover:opacity-100 transition-opacity"
            >
              <XMarkIcon className="w-3 h-3" />
            </button>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
};

export default SpeechBubble;
