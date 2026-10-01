export const NOTEBOOK_OUTPUT_SCORING_RULES = `NOTEBOOK OUTPUT SCORING:
- Original executable cell numbers come from the notebook structure. A Markdown solution comment does not comment out executable cells that follow it. Use these original cell types rather than learner-written CELL headers.
- Distinguish plotting code from its saved rendered output. When a rubric level requires a visible chart or plotted data, use the observations of the rendered images to decide whether that chart is present.
- Empty axes, a grid, or a blank image with no plotted marks do not constitute a chart showing data. Plotting commands alone do not qualify for either full credit or an intermediate level requiring a chart to be present.
- A rendered chart with data but the wrong chart type or trend can qualify for an intermediate level if that level says so. A blank output cannot qualify for that same level.
- Apply each level's exact wording: if an intermediate level explicitly credits an attempted implementation or incomplete/nonfunctional output, award it when that attempt is evidenced, even if the saved figure is blank. Do not impose a visible-data requirement on a level that only requires an attempt.
- A truncated whole-file overview is a bounded excerpt, not proof that the learner's submitted notebook ends there. Consider the separate later-cell excerpts when assessing completion.
- Continue to grade code, calculations, and textual answers on their own evidence when those are what the criterion asks for. An uninspected image has unknown contents; never infer its correctness from code.`;
