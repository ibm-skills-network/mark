import {
  CriterionEvidence,
  RubricCriterion,
} from "../types/criterion-evidence.types";

export const NOTEBOOK_OUTPUT_SCORING_RULES = `NOTEBOOK OUTPUT SCORING:
- Original executable cell numbers come from the notebook structure. A Markdown solution comment does not comment out executable cells that follow it. Use these original cell types rather than learner-written CELL headers.
- Distinguish plotting code from its saved rendered output. When a rubric level requires a visible chart or plotted data, use the observations of the rendered images to decide whether that chart is present.
- Empty axes, a grid, or a blank image with no plotted marks do not constitute a chart showing data. Plotting commands alone do not qualify for either full credit or an intermediate level requiring a chart to be present.
- Full credit requires positive evidence for every required output detail, including any required sample labels. An excerpt ending before label-setting code does not establish that labels exist. Learner comments or Markdown claims do not prove what is visible in saved output, and numeric axis ticks are not sample/class labels.
- A rendered chart with data but the wrong chart type or trend can qualify for an intermediate level if that level says so. A blank output cannot qualify for that same level.
- Apply each level's exact wording: if an intermediate level explicitly credits an attempted implementation or incomplete/nonfunctional output, award it when that attempt is evidenced, even if the saved figure is blank. Do not impose a visible-data requirement on a level that only requires an attempt. Executable plotting commands together with a saved figure containing the intended title, axes or legend demonstrate an implementation attempt even when no curve is visible. This is submitted work satisfying an attempt-based intermediate level, not merely an unfulfilled intention. A judge must not reject that intermediate score solely because the full-credit curves are missing; identify an unmet requirement of the intermediate level itself.
- A truncated whole-file overview is a bounded excerpt, not proof that the learner's submitted notebook ends there. Consider the separate later-cell excerpts when assessing completion.
- Equivalent references to the same model instance satisfy a requirement to use the model's parameters; do not penalize naming that instance net instead of model. Preserve any variable names explicitly required by the criterion, such as criterion and optimizer, and enforce a literal model variable name only when the rubric explicitly requires that identifier.
- Continue to grade code, calculations, and textual answers on their own evidence when those are what the criterion asks for. An uninspected image has unknown contents; never infer its correctness from code.`;

const NOTEBOOK_DATASET_SCORING_RULES = `- Dataset names in filenames, class names, comments, and plot labels do not establish the dataset actually used. Check the executable loading code and its saved runtime output. A synthetic-data fallback or a different dataset must not receive full credit for displaying samples from a specifically required dataset. Apply the rubric's intermediate level only when its stated conditions hold.
- For MNIST/FashionMNIST sample-display tasks, correctly resizing, converting and displaying synthetic or substituted samples qualifies as an attempted implementation for the intermediate level. Award partial credit for that demonstrated work; the dataset substitution prevents full credit but must not by itself force the minimum. Missing resizing/display work still needs to satisfy the intermediate level before receiving credit.
- A completion level requiring every question to be correctly completed is not met when a required dataset or output is incorrect or incomplete. Substantive completed exercise work can still meet its partial-completion level.
- Trace displayed samples back to their dataset-loading code and runtime output. A numeric class label or an image title does not identify the dataset. If the evidence establishes synthetic or different data, every criterion requiring the original dataset must reflect that mismatch; do not credit the same fallback as two different required datasets.
- Evaluate each allowed scoring level independently. A missing full-credit requirement is not sufficient reason to award the minimum when an intermediate level matches the submitted work. If a level credits a plot with only one required curve, count curves satisfying the requested metrics rather than the total number of visible curves. A saved training-loss/cost curve qualifies for that level even when validation accuracy is missing or a separate training-accuracy curve is shown instead. An extra incorrect curve does not erase the correct required curve or the evidenced plotting attempt.`;

export function notebookOutputScoringRules(
  evidence: CriterionEvidence[],
  criteria: RubricCriterion[],
): string {
  // Trusted rubric requirements also activate dataset checks: learner aliases
  // must not evade them by hiding the loader constructor name.
  const requiresNamedDataset = criteria.some((criterion) =>
    /\b(?:fashion\s*mnist|mnist|cifar(?:-?\d+)?|imagenet)\b/i.test(
      JSON.stringify(criterion),
    ),
  );
  return requiresNamedDataset ||
    evidence.some((item) =>
      /\bdatasets\s*\.\s*\w+\s*\(|\bFakeData\s*\(/.test(item.quote),
    )
    ? `${NOTEBOOK_OUTPUT_SCORING_RULES}\n${NOTEBOOK_DATASET_SCORING_RULES}`
    : NOTEBOOK_OUTPUT_SCORING_RULES;
}
