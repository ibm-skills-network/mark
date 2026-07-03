"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import MarkFace from "@/public/MarkFace.svg";
import { useChatbot } from "@/hooks/useChatbot";

const AUTHOR_LABELS = [
  "Mark Assistant",
  "Need help?",
  "Generate Questions",
  "Ask Mark",
  "Question ideas?",
  "Stuck on a rubric?",
  "Brainstorm with Mark",
];

const LEARNER_LABELS = [
  "Mark Assistant",
  "Need help?",
  "Ask Mark",
  "Stuck? Ask Mark",
  "Have a question?",
  "Get a hint",
  "Explain this to me",
];

interface Props {
  role: "author" | "learner";
  className?: string;
}

export function MarkChatToggleButton({ role, className = "" }: Props) {
  const toggle = useChatbot((s) => s.toggle);
  const labels = role === "author" ? AUTHOR_LABELS : LEARNER_LABELS;
  const [label, setLabel] = useState<string>(labels[0]);

  useEffect(() => {
    setLabel(labels[Math.floor(Math.random() * labels.length)]);
  }, [role]);

  return (
    <button
      type="button"
      onClick={toggle}
      title="Open Mark AI Assistant"
      className={`shrink-0 inline-flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium text-violet-700 dark:text-violet-300 bg-violet-50 dark:bg-violet-900/30 border border-violet-200 dark:border-violet-800 rounded-lg hover:bg-violet-100 dark:hover:bg-violet-900/50 hover:border-violet-300 dark:hover:border-violet-700 transition-all duration-200 shadow-sm hover:shadow-md whitespace-nowrap ${className}`}
    >
      <Image
        src={MarkFace}
        alt=""
        width={20}
        height={20}
        draggable={false}
        className="pointer-events-none select-none shrink-0"
      />
      <span className="hidden sm:inline whitespace-nowrap">{label}</span>
    </button>
  );
}
