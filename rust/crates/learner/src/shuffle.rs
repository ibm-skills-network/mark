//! Question subset and order for a new attempt.
//!
//! Port of the legacy `deterministicShuffle` and seeds. Exact parity with
//! the legacy backend only matters if both ever derive the same attempt; the
//! result is persisted at creation and never re-derived, but matching it
//! keeps the two backends interchangeable.

/// `attemptId ^ assignmentId` as JS int32.
pub fn selection_seed(attempt_id: i32, assignment_id: i32) -> i32 {
    attempt_id ^ assignment_id
}

/// `Math.imul(selectionSeed, 2654435761) >>> 0`.
pub fn ordering_seed(selection_seed: i32) -> u32 {
    selection_seed.cast_unsigned().wrapping_mul(2_654_435_761)
}

/// Fisher-Yates from the end driven by the LCG
/// `s = (s * 9301 + 49297) % 233280`, `j = floor(s / 233280 * (i + 1))`;
/// seed 0 becomes 1. Integer arithmetic is exact (JS stays below 2^53).
///
/// JS reference:
/// ```js
/// function ds(items, seed) {
///   const r = [...items]; let s = seed || 1;
///   for (let i = r.length - 1; i > 0; i--) {
///     s = (s * 9301 + 49297) % 233280;
///     const j = Math.floor(s / 233280 * (i + 1));
///     [r[i], r[j]] = [r[j], r[i]];
///   }
///   return r;
/// }
/// ```
pub fn deterministic_shuffle<T>(items: &mut [T], seed: i64) {
    let mut s: i64 = if seed == 0 { 1 } else { seed };
    for i in (1..items.len()).rev() {
        s = (s * 9301 + 49_297) % 233_280;
        #[allow(clippy::cast_precision_loss)]
        // |s| < 233280 and i < 2^31: both exact in f64.
        let rand = s as f64 / 233_280.0;
        #[allow(clippy::cast_precision_loss)]
        let scaled = (rand * (i + 1) as f64).floor();
        #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
        // scaled is in [0, i] for the non-negative seeds this crate passes;
        // the clamp keeps a hostile seed from indexing out of bounds.
        let j = (scaled.max(0.0) as usize).min(i);
        items.swap(i, j);
    }
}

/// Listed ids first in list order (unknown and repeated ids dropped), then
/// the rest in their original order. Port of `applyQuestionOrder`.
pub fn apply_question_order<T>(items: Vec<T>, order: &[i32], id: impl Fn(&T) -> i32) -> Vec<T> {
    let mut slots: Vec<Option<T>> = items.into_iter().map(Some).collect();
    let mut out = Vec::with_capacity(slots.len());
    for wanted in order {
        if let Some(slot) = slots
            .iter_mut()
            .find(|s| s.as_ref().is_some_and(|t| id(t) == *wanted))
        {
            out.extend(slot.take());
        }
    }
    out.extend(slots.into_iter().flatten());
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn shuffled(items: &[i32], seed: i64) -> Vec<i32> {
        let mut v = items.to_vec();
        deterministic_shuffle(&mut v, seed);
        v
    }

    #[test]
    fn matches_js_reference_vectors() {
        // node: ds([1,2,3,4,5], 7) -> [2,4,1,5,3]
        assert_eq!(shuffled(&[1, 2, 3, 4, 5], 7), vec![2, 4, 1, 5, 3]);
        // node: ds([1,2,3], 0) -> [3,2,1] (seed 0 behaves as 1)
        assert_eq!(shuffled(&[1, 2, 3], 0), vec![3, 2, 1]);
        assert_eq!(shuffled(&[1, 2, 3], 1), vec![3, 2, 1]);
    }

    #[test]
    fn seeds_match_js() {
        // node: 123 ^ 45 -> 86; Math.imul(86, 2654435761) >>> 0 -> 648208758
        let sel = selection_seed(123, 45);
        assert_eq!(sel, 86);
        let ord = ordering_seed(sel);
        assert_eq!(ord, 648_208_758);
        // node: ds([1..8], 648208758) -> [6,4,8,2,1,3,7,5]
        assert_eq!(
            shuffled(&[1, 2, 3, 4, 5, 6, 7, 8], i64::from(ord)),
            vec![6, 4, 8, 2, 1, 3, 7, 5]
        );
    }

    #[test]
    fn short_inputs_are_untouched() {
        assert_eq!(shuffled(&[], 5), Vec::<i32>::new());
        assert_eq!(shuffled(&[9], 5), vec![9]);
    }

    #[test]
    fn question_order_puts_listed_ids_first() {
        let ordered = apply_question_order(vec![1, 2, 3, 4], &[3, 99, 1, 3], |x| *x);
        assert_eq!(ordered, vec![3, 1, 2, 4]);
        assert_eq!(apply_question_order(vec![1, 2], &[], |x| *x), vec![1, 2]);
    }
}
