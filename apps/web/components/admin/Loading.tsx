"use client";
import { motion } from "framer-motion";

export default function LoadingSpinner() {
  return (
    <div className="flex items-center justify-center h-64">
      <motion.div
        className="h-12 w-12 border-4 border-violet-200 rounded-full border-t-violet-600"
        animate={{ rotate: 360 }}
        transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
      />
    </div>
  );
}
