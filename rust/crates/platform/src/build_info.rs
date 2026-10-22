//! Build identity baked into the binary.
//!
//! `MARK_BUILD_SHA` and `MARK_BUILD_REF` are read at compile time; the
//! Dockerfile passes them as build args so every image can report exactly
//! which commit it was built from. Local builds report `unknown`.

/// Immutable build identity.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BuildInfo {
    pub crate_version: &'static str,
    pub git_sha: &'static str,
    pub git_ref: &'static str,
}

pub const BUILD: BuildInfo = BuildInfo {
    crate_version: env!("CARGO_PKG_VERSION"),
    git_sha: match option_env!("MARK_BUILD_SHA") {
        Some(sha) => sha,
        None => "unknown",
    },
    git_ref: match option_env!("MARK_BUILD_REF") {
        Some(r) => r,
        None => "unknown",
    },
};
