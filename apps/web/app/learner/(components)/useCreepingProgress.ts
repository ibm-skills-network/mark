import { useEffect, useRef } from "react";
import { useMotionValue, useReducedMotion } from "framer-motion";
import type { MotionValue } from "framer-motion";

// Decay constant for the terminal ease up to 100% once grading completes.
// K_FINISH = 7 brings the wheel to ~99.9% within ~630ms, comfortably inside
// the modal's 700ms success-icon delay.
const K_FINISH = 7;
// Creep decay range (per second). Re-rolled on every milestone change so the
// climb rate visibly varies between completions.
const K_MIN = 0.25;
const K_MAX = 0.6;
// Per-frame multiplicative jitter applied to k (+/- 15%).
const JITTER = 0.3;
// Clamp dt so a backgrounded tab doesn't produce one giant catch-up jump.
const MAX_DT = 0.1;
// The terminal ease is asymptotic and never returns exactly 100; once within
// this of 100 we snap to 100 and stop the loop.
const SETTLE_AT = 99.9;

/**
 * The two fields the creep needs from a grading snapshot. Kept structural (not
 * tied to the modal's GradingProgressDetails) so callers can pass that type
 * directly without a coupling import.
 */
interface CreepGradingState {
  total: number;
  completed: number;
}

interface CreepStepInput {
  /** Currently displayed percentage (0–100). */
  displayed: number;
  /** Latest real percentage from the backend (0–100). */
  realProgress: number;
  /** Latest grading snapshot, or undefined before questions are known. */
  gradingState: CreepGradingState | undefined;
  /** Render/real status; "completed" (or realProgress >= 100) is terminal. */
  status: string;
  /** Seconds elapsed since the previous frame. */
  dt: number;
  /** Decay constant for this frame's creep (randomized by the hook). */
  k: number;
}

/**
 * One frame of progress easing. Pure and deterministic given its inputs.
 *
 * Invariants:
 *  - never decreases (real value is a hard floor; only positive decay added)
 *  - never reaches the next-completion bound while grading (asymptotic decay)
 *  - converges to 100 (clamped) once terminal
 */
export function computeCreepStep({
  displayed,
  realProgress,
  gradingState,
  status,
  dt,
  k,
}: CreepStepInput): number {
  // Guard against a non-positive frame delta (e.g. a clock hiccup) so the
  // decay term can never invert and drive the value wildly off.
  const safeDt = Math.max(0, dt);
  const terminal = status === "completed" || realProgress >= 100;

  if (terminal) {
    // Ease the current value up toward 100 (never snapping), staying monotonic.
    const next =
      displayed + (100 - displayed) * (1 - Math.exp(-K_FINISH * safeDt));
    return Math.min(100, Math.max(displayed, next));
  }

  // Grading: real progress is a hard floor; creep above it toward the bound.
  let next = Math.max(displayed, realProgress);
  if (gradingState && gradingState.total > 0) {
    // Bound = where one more completion would put us; mirrors the backend's
    // 10%-reserved scale (completed/total*90).
    const bound = Math.min(
      90,
      ((gradingState.completed + 1) / gradingState.total) * 90,
    );
    if (bound > next) {
      next += (bound - next) * (1 - Math.exp(-k * safeDt));
    }
  }

  return next;
}

/**
 * Drives a smoothly creeping progress MotionValue from discrete backend
 * updates. Between real updates the value eases toward the next-completion
 * bound at a randomized rate, approaching but never reaching it, then leaps
 * forward when a real update lands. Honors prefers-reduced-motion.
 *
 * The loop only runs while `active` is true (e.g. the modal is open). The host
 * modal is always mounted, so each (re)activation also resets the baseline to
 * zero — otherwise a new grading run would inherit the previous run's settled
 * value.
 */
export function useCreepingProgress(
  realProgress: number,
  gradingState: CreepGradingState | undefined,
  status: string,
  active: boolean,
): MotionValue<number> {
  const motionValue = useMotionValue(0);
  const reduceMotion = useReducedMotion();

  // Latest inputs, read by the RAF loop without restarting it each render.
  const inputs = useRef({ realProgress, gradingState, status });
  inputs.current = { realProgress, gradingState, status };

  const displayed = useRef(0);
  const k = useRef(K_MIN);
  const boundKey = useRef("");

  // Reset the baseline whenever the modal (re)activates, so a new grading run
  // starts from zero rather than inheriting a previous run's value.
  useEffect(() => {
    if (!active) return;
    displayed.current = 0;
    boundKey.current = "";
    motionValue.set(0);
  }, [active, motionValue]);

  // Reduced motion: no creep — track the real value (or 100 when done).
  useEffect(() => {
    if (!active || !reduceMotion) return;
    const floor =
      status === "completed" || realProgress >= 100 ? 100 : realProgress;
    displayed.current = Math.max(displayed.current, floor);
    motionValue.set(displayed.current);
  }, [active, reduceMotion, realProgress, status, motionValue]);

  // Animated creep — only while active.
  useEffect(() => {
    if (!active || reduceMotion) return;
    let raf = 0;
    let last = performance.now();

    const tick = (now: number) => {
      const dt = Math.min(MAX_DT, (now - last) / 1000);
      last = now;
      const {
        realProgress: rp,
        gradingState: gsnap,
        status: st,
      } = inputs.current;

      // Re-roll the decay rate whenever the milestone/bound changes.
      const key = `${st}|${gsnap?.completed ?? -1}|${gsnap?.total ?? -1}|${
        rp >= 100
      }`;
      if (key !== boundKey.current) {
        boundKey.current = key;
        k.current = K_MIN + Math.random() * (K_MAX - K_MIN);
      }
      const jitteredK = k.current * (1 + (Math.random() - 0.5) * JITTER);

      const next = computeCreepStep({
        displayed: displayed.current,
        realProgress: rp,
        gradingState: gsnap,
        status: st,
        dt,
        k: jitteredK,
      });
      displayed.current = next;
      motionValue.set(next);

      // Once the terminal ease has visually reached 100, snap and stop looping.
      if ((st === "completed" || rp >= 100) && next >= SETTLE_AT) {
        displayed.current = 100;
        motionValue.set(100);
        return;
      }

      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active, reduceMotion, motionValue]);

  return motionValue;
}
