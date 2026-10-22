#!/usr/bin/env bash
# Runs the same Rust checks as the "Rust" CI workflow.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

if ! command -v cargo >/dev/null 2>&1; then
  echo "cargo not found. Install Rust via rustup: https://rustup.rs" >&2
  echo "rust-toolchain.toml pins the toolchain; rustup installs it on first use." >&2
  exit 127
fi

cd "${REPO_ROOT}/rust"

echo "==> cargo fmt --all --check"
cargo fmt --all --check

echo "==> cargo clippy --all-targets --locked -- -D warnings"
cargo clippy --all-targets --locked -- -D warnings

echo "==> cargo test --locked"
cargo test --locked

echo "==> cargo build --locked"
cargo build --locked

echo "Rust checks passed."
