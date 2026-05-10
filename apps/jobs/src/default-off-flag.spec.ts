import { execSync } from "node:child_process";
import { resolve } from "node:path";

describe("Default-OFF policy: JOBS_EXECUTE_LOCALLY", () => {
  it("no tracked file commits a true value for JOBS_EXECUTE_LOCALLY", () => {
    // Spec lives at apps/jobs/src/default-off-flag.spec.ts → ../../.. is repo root
    const repoRoot = resolve(__dirname, "..", "..", "..");
    // Use `git -C <root> grep` (rather than `xargs grep` over `git ls-files`)
    // so the search is rooted at the repo regardless of jest's cwd. xargs grep
    // resolves paths against the caller's cwd; from apps/jobs/ that produces
    // false negatives because the listed paths (e.g. helm-chart/...) do not
    // exist relative to apps/jobs/.
    // The exit-code-2 fallback `|| true` keeps execSync from throwing when
    // grep finds no matches (the success case for this regression test).
    const cmd = `git -C ${repoRoot} grep --no-color --files-with-matches -E 'JOBS_EXECUTE_LOCALLY[:=][[:space:]]*"true"' -- ':!apps/jobs/src/default-off-flag.spec.ts' 2>/dev/null || true`;
    const output = execSync(cmd, { encoding: "utf8" }).trim();
    expect(output).toBe("");
  });
});
