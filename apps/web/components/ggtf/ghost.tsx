"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";

export function GhostSvg({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 72" className={className} aria-hidden="true">
      <path
        d="M32 2C16 2 6 14 6 30v36l7-6 6 6 7-6 6 6 6-6 7 6 6-6 7 6V30C58 14 48 2 32 2Z"
        fill="currentColor"
        opacity="0.92"
      />
      <ellipse cx="23" cy="30" rx="4.5" ry="6" fill="#050a07" />
      <ellipse cx="41" cy="30" rx="4.5" ry="6" fill="#050a07" />
      <ellipse cx="32" cy="46" rx="5" ry="3.5" fill="#050a07" />
    </svg>
  );
}

/** A ghost that rises and fades when the link connects. */
export function ConnectGhost({ show }: { show: boolean }) {
  const reduce = useReducedMotion();
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          key="ghost"
          className="pointer-events-none fixed inset-0 z-50 grid place-items-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.4 }}
        >
          <motion.div
            className="text-primary drop-shadow-[0_0_40px_oklch(0.86_0.19_150/60%)]"
            initial={reduce ? { opacity: 0 } : { y: 120, scale: 0.6, opacity: 0 }}
            animate={reduce ? { opacity: 1 } : { y: [-10, -40, -10], scale: 1, opacity: 1 }}
            exit={reduce ? { opacity: 0 } : { y: -200, opacity: 0 }}
            transition={{ duration: 1.6, ease: "easeOut" }}
          >
            <GhostSvg className="size-40" />
            <p className="mt-2 text-center font-display text-3xl text-primary glow">connected</p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
