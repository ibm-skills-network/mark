//! Choosing a stored translation for a requested language.

/// The language family of a stored or requested code (`zh-CN` -> `zh`).
pub fn family_of(code: &str) -> String {
    let lower = code.trim().to_ascii_lowercase();
    lower.split('-').next().unwrap_or("").to_owned()
}

/// Whether a stored code is English (authored content, never served).
pub fn is_authored_code(code: &str) -> bool {
    family_of(code) == "en"
}

/// Exact code (case-insensitive) -> base code -> any sibling in the family,
/// scanning codes in sorted order so the choice is stable. Returns the
/// index into `codes` of the winner.
pub fn pick<S: AsRef<str>>(codes: &[S], language: &str) -> Option<usize> {
    let requested = language.trim().to_ascii_lowercase();
    let family = requested.split('-').next().unwrap_or("").to_owned();
    let mut order: Vec<usize> = (0..codes.len()).collect();
    order.sort_by(|a, b| codes[*a].as_ref().cmp(codes[*b].as_ref()));
    let lower = |i: &usize| codes[*i].as_ref().to_ascii_lowercase();
    order
        .iter()
        .find(|i| lower(i) == requested)
        .or_else(|| order.iter().find(|i| lower(i) == family))
        .or_else(|| order.iter().find(|i| family_of(&lower(i)) == family))
        .copied()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn picked<'a>(codes: &[&'a str], lang: &str) -> Option<&'a str> {
        pick(codes, lang).map(|i| codes[i])
    }

    #[test]
    fn exact_beats_base_beats_sibling() {
        let codes = ["zh-TW", "zh", "zh-CN"];
        assert_eq!(picked(&codes, "zh-cn"), Some("zh-CN"));
        assert_eq!(picked(&codes, "zh-hk"), Some("zh"));
        assert_eq!(picked(&["zh-TW", "zh-CN"], "zh-hk"), Some("zh-CN"));
        assert_eq!(picked(&["zh-TW", "zh-CN"], "zh"), Some("zh-CN"));
        assert_eq!(picked(&["FR"], "fr"), Some("FR"));
        assert_eq!(picked(&["fr"], "de"), None);
        assert_eq!(picked(&[], "de"), None);
    }

    #[test]
    fn family_ignores_prefix_collisions() {
        // A LIKE 'zh%' query also returns "zha"; it is not in the zh family.
        assert_eq!(picked(&["zha"], "zh"), None);
        assert!(is_authored_code("EN-us"));
        assert!(!is_authored_code("eng"));
    }
}
