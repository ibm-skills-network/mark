/** Resolve the documented Excel template by header, never by answer position. */
export function normalizeExcelQuizRows(rows: unknown[][]): string[][] {
  const text = (value: unknown) => String(value ?? "").trim();
  const normalize = (value: unknown) =>
    text(value)
      .toLowerCase()
      .replace(/[_\s]+/g, " ");
  const headers = (rows[0] ?? []).map(normalize);
  const columns = [
    ["question text", "question"],
    ["correct answer"],
    ["answer 2"],
    ["answer 3"],
    ["answer 4"],
    ["answer location"],
    ["additional info"],
  ];
  const indices = columns.map((names, column) => {
    const matches = headers.flatMap((header, index) =>
      names.includes(header) ? [index] : [],
    );
    if (matches.length > 1) {
      throw new Error(`Duplicate Excel header: "${names[0]}".`);
    }
    if (matches.length === 0 && column < 5) {
      throw new Error(
        `Missing Excel header: "${names[0]}". Use Question text, Correct answer, Answer 2, Answer 3, and Answer 4. Correct answer must contain the answer text, not an option letter or number.`,
      );
    }
    return matches[0] ?? -1;
  });

  return [
    columns.map(([name]) => name),
    ...rows.slice(1).map((row, index) => {
      const mapped = indices.map((column) => text(row[column]));
      if (row.every((cell) => !text(cell))) return mapped;
      const fail = (message: string): never => {
        throw new Error(`Excel row ${index + 2}: ${message}`);
      };
      if (!mapped[0]) fail("Question text is required.");
      if (!mapped[1]) fail("Correct answer text is required.");
      const choices = mapped.slice(1, 5).filter(Boolean);
      if (choices.length < 2) fail("At least two answer choices are required.");
      if (new Set(choices.map(normalize)).size !== choices.length) {
        fail(
          "Answer choices must be distinct; the correct answer is ambiguous.",
        );
      }
      return mapped;
    }),
  ];
}
