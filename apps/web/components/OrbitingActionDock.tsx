"use client";

import { useChatbot } from "@/hooks/useChatbot";
import { SpeakerWaveIcon, SpeakerXMarkIcon } from "@heroicons/react/24/outline";
import { AnimatePresence, motion } from "framer-motion";
import { useState, useRef, useEffect } from "react";

interface OrbitingActionDockProps {
  isVisible: boolean;
  onActionClick?: (action: string) => void;
}

interface ActionButton {
  id: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  color: string;
  hoverColor: string;
  bgGradient: string;
  angle: number;
  onClick: () => void;
  isActive?: boolean;
}

export const OrbitingActionDock = ({
  isVisible,
  onActionClick,
}: OrbitingActionDockProps) => {
  const { isMuted, toggleMute } = useChatbot();
  const [isExpanded, setIsExpanded] = useState(false);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const orbitRadius = 70; // Distance from Mark's center
  const buttonSize = 44; // Size of action bubbles

  const handleAction = (actionId?: string, callback?: () => void) => {
    callback?.();
    onActionClick?.(actionId);
  };

  const actions: ActionButton[] = [
    {
      id: "mute",
      icon: isMuted ? SpeakerXMarkIcon : SpeakerWaveIcon,
      label: isMuted ? "Unmute notifications" : "Mute notifications",
      color: isMuted ? "text-red-600" : "text-blue-600",
      hoverColor: isMuted ? "hover:text-red-700" : "hover:text-blue-700",
      bgGradient: isMuted
        ? "from-red-400 to-red-600"
        : "from-blue-400 to-blue-600",
      angle: -90, // Top
      onClick: () => handleAction("mute", toggleMute),
      isActive: !isMuted,
    },
    // {
    //   id: "help",
    //   icon: QuestionMarkCircleIcon,
    //   label: "Quick help",
    //   color: "text-green-600",
    //   hoverColor: "hover:text-green-700",
    //   bgGradient: "from-green-400 to-green-600",
    //   angle: 0, // Right
    //   onClick: () => handleAction("help"),
    // },
    // {
    //   id: "magic",
    //   icon: SparklesIcon,
    //   label: "Quick actions",
    //   color: "text-purple-600",
    //   hoverColor: "hover:text-purple-700",
    //   bgGradient: "from-purple-400 to-purple-600",
    //   angle: 90, // Bottom
    //   onClick: () => handleAction("magic"),
    // },
    // {
    //   id: "settings",
    //   icon: Cog6ToothIcon,
    //   label: "Settings",
    //   color: "text-gray-600",
    //   hoverColor: "hover:text-gray-700",
    //   bgGradient: "from-gray-400 to-gray-600",
    //   angle: 180, // Left
    //   onClick: () => handleAction("settings"),
    // },
  ];

  const getOrbitPosition = (angle: number) => {
    const rad = (angle * Math.PI) / 180;
    return {
      x: Math.cos(rad) * orbitRadius,
      y: Math.sin(rad) * orbitRadius,
    };
  };

  const handleMouseEnter = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    setIsExpanded(true);
  };

  const handleMouseLeave = () => {
    // Keep expanded for a brief moment to allow reaching buttons
    timeoutRef.current = setTimeout(() => {
      setIsExpanded(false);
    }, 300);
  };

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  if (!isVisible) return null;

  return (
    <div
      className="absolute inset-0 pointer-events-none "
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <div
        className="absolute pointer-events-auto"
        onClick={() => handleAction()}
        style={{
          width: orbitRadius,
          height: orbitRadius,
          transform: "translate(-50%, -50%)",
          left: "50%",
          top: "50%",
          borderRadius: "50%",
        }}
      />

      {/* Action Bubbles */}
      <AnimatePresence>
        {actions.map((action, index) => {
          const orbitPos = getOrbitPosition(action.angle);
          const Icon = action.icon;

          return (
            <motion.div
              key={action.id}
              initial={{ scale: 0, opacity: 0, x: 0, y: 0 }}
              animate={
                isExpanded
                  ? {
                      scale: 1,
                      opacity: 1,
                      x: orbitPos.x,
                      y: orbitPos.y,
                    }
                  : {
                      scale: 0,
                      opacity: 0,
                      x: 0,
                      y: 0,
                    }
              }
              exit={{ scale: 0, opacity: 0, x: 0, y: 0 }}
              transition={{
                type: "spring",
                stiffness: 400,
                damping: 25,
                delay: isExpanded ? index * 0.08 : 0,
              }}
              className="absolute pointer-events-auto"
              style={{
                width: buttonSize,
                height: buttonSize,
                left: "50%",
                top: "50%",
                marginLeft: -buttonSize / 2,
                marginTop: -buttonSize / 2,
              }}
            >
              <div className="group relative h-full w-full">
                <motion.button
                  whileHover={{
                    scale: 1.3,
                    rotate: 10,
                  }}
                  whileTap={{
                    scale: 0.85,
                    rotate: -5,
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    action.onClick();
                  }}
                  className={`
                    w-full h-full rounded-full shadow-2xl
                    bg-gradient-to-br ${action.bgGradient}
                    flex items-center justify-center
                    transition-all duration-200
                    border-2 border-white dark:border-gray-800
                    cursor-pointer
                    hover:shadow-xl
                    relative overflow-hidden
                  `}
                  aria-label={action.label}
                  title={action.label}
                >
                  {/* Glossy overlay effect */}
                  <div className="absolute inset-0 rounded-full bg-gradient-to-b from-white/40 to-transparent opacity-50" />

                  <Icon className="w-6 h-6 text-white relative z-10 drop-shadow-md" />

                  {/* Active indicator pulse */}
                  {action.isActive && (
                    <>
                      <motion.span
                        className="absolute inset-0 rounded-full bg-white/30"
                        initial={{ scale: 1, opacity: 0.6 }}
                        animate={{ scale: 1.6, opacity: 0 }}
                        transition={{
                          duration: 2,
                          repeat: Infinity,
                          ease: "easeOut",
                        }}
                      />
                      <motion.span
                        className="absolute inset-0 rounded-full bg-white/20"
                        initial={{ scale: 1, opacity: 0.4 }}
                        animate={{ scale: 1.4, opacity: 0 }}
                        transition={{
                          duration: 2,
                          repeat: Infinity,
                          ease: "easeOut",
                          delay: 0.4,
                        }}
                      />
                    </>
                  )}
                </motion.button>
                <div className="pointer-events-none absolute bottom-[calc(100%+0.5rem)] left-1/2 z-50 -translate-x-1/2 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100">
                  <div className="whitespace-nowrap rounded-md bg-gray-950 px-2 py-1 text-xs font-semibold text-white shadow-lg">
                    {action.label}
                  </div>
                  <div className="mx-auto h-0 w-0 border-x-4 border-t-4 border-x-transparent border-t-gray-950" />
                </div>
              </div>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
};
