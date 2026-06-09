// Decay constant for the terminal ease up to 100% once grading completes.
// K_FINISH = 7 brings the wheel to ~99.9% within ~630ms, comfortably inside
// the modal's 700ms success-icon delay.
const K_FINISH = 7;

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
