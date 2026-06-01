import { useParams } from "next/navigation";

/**
 * Read the assignmentId route segment. The URL is authoritative: a store
 * populated only on the overview route is null on deep links / hard refreshes,
 * which would otherwise gate off submission. Owning the URL->number parse in one
 * place keeps Header and Timer (which both gate submission on this id) from
 * drifting if the parse/validation ever changes.
 *
 * `assignmentId` is `Math.trunc(Number(...))`, so a missing/non-numeric segment
 * yields `NaN`; callers guard with `if (!assignmentId)`, which catches both 0
 * and NaN. `assignmentIdParam` is returned raw for logging/diagnostics.
 */
export function useAssignmentId(): {
  assignmentId: number;
  assignmentIdParam?: string;
} {
  const { assignmentId: assignmentIdParam } = useParams<{
    assignmentId: string;
  }>();
  return {
    assignmentId: Math.trunc(Number(assignmentIdParam)),
    assignmentIdParam,
  };
}
