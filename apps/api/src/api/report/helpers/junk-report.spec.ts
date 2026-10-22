import { classifyReportText, extractReporterText } from "./junk-report";

// How the report form composes a description: one "**Label:**" section per
// filled field, joined by blank lines (CRLF once it has crossed a form post).
const form = (fields: Record<string, string>): string =>
  Object.entries(fields)
    .map(([label, value]) => `**${label}:**\r\n${value}`)
    .join("\r\n\r\n");

describe("extractReporterText", () => {
  it("drops the form's section headings and keeps what the reporter typed", () => {
    expect(
      extractReporterText(
        form({
          "Steps to reproduce": "Open question 2",
          "Expected result": "It saves",
          "Actual result": "It spins",
        }),
      ),
    ).toBe("Open question 2\nIt saves\nIt spins");
  });

  it("drops headings that already had their markdown stripped", () => {
    expect(
      extractReporterText(
        "Steps to reproduce:\nclick submit\n\nEnvironment (browser/device):\nChrome",
      ),
    ).toBe("click submit\nChrome");
  });

  it("drops the metadata block appended for support", () => {
    expect(
      extractReporterText(
        [
          "nothing loads",
          "",
          "Issue type: BUG",
          "Reporter role: learner",
          "Severity: info",
          "Assignment ID: 42",
          "Attempt ID: N/A",
          "Diagnostics captured: attempt 84, language es, 1 of 3 recent requests failed. Full capture: Mark admin > Reports.",
        ].join("\n"),
      ),
    ).toBe("nothing loads");
  });

  it("keeps a line that starts with a metadata key but carries more text", () => {
    expect(extractReporterText("Assignment ID: 42 fails to load")).toBe(
      "Assignment ID: 42 fails to load",
    );
    expect(extractReporterText("Severity: high, my grade vanished")).toBe(
      "Severity: high, my grade vanished",
    );
  });

  it("keeps bold text that is not one of the form's own headings", () => {
    expect(extractReporterText("**Upload fails:**")).toContain("Upload fails");
  });

  it("drops pasted markup and the form's placeholder text", () => {
    expect(
      extractReporterText(
        form({
          "Steps to reproduce":
            '<textarea rows="3" placeholder="x"></textarea>\r\n1. ...\r\n2. ...',
        }),
      ),
    ).toBe("");
  });
});

describe("classifyReportText", () => {
  const junk: Array<[string, string, string]> = [
    ["empty", "", "no_letters"],
    ["whitespace", "   \n ", "no_letters"],
    ["a dot", ".", "no_letters"],
    ["punctuation", "?!?!", "no_letters"],
    ["digits", "12345", "no_letters"],
    ["emoji", "😡😡😡", "no_letters"],
    ["repeated letter", "aaaaaaa", "repeated_char"],
    ["repeated letter with spaces", "j j j j", "repeated_char"],
    ["ok", "ok", "filler_only"],
    ["okay with punctuation", "Okay.", "filler_only"],
    ["bug", "bug", "filler_only"],
    ["test", "test test", "filler_only"],
    ["hi", "Hi", "filler_only"],
    ["nothing", "nothing", "filler_only"],
    ["n/a", "n/a", "filler_only"],
    ["keyboard mash", "asdf", "filler_only"],
    ["spanish nothing", "nada", "filler_only"],
    ["french nothing", "rien", "filler_only"],
    ["german nothing", "nichts", "filler_only"],
    ["one stray letter", "x", "too_short"],
    ["only one- and two-letter fragments", "no\nno\nos\nx", "too_short"],
    ["a two-letter fragment", "fd", "too_short"],
    ["an elongated filler word", "nooo", "filler_only"],
    ["a longer keyboard run", "asdfghjkl", "filler_only"],
    ["a vague one-word rating", "bad", "filler_only"],
    ["a positive one-word rating", "good", "filler_only"],
    ["done", "Done", "filler_only"],
    ["an apology", "sorry", "filler_only"],
    ["fine", "fine", "filler_only"],
    ["a vowel-less keyboard mash", "sdrghdfn", "filler_only"],
    ["another keyboard mash", "hjbjhvg", "filler_only"],
    [
      "every field filled with filler",
      form({
        "Steps to reproduce": "no",
        "Expected result": "no",
        "Actual result": "nothing",
      }),
      "filler_only",
    ],
    [
      "fields echoing their own labels",
      form({
        "Steps to reproduce": "steps",
        "Expected result": "expected result",
        "Actual result": "actual",
      }),
      "filler_only",
    ],
  ];

  it.each(junk)("flags %s", (_name, description, reason) => {
    expect(classifyReportText(description)).toEqual({ junk: true, reason });
  });

  const real: Array<[string, string]> = [
    ["a short but specific report", "Q3 answer key wrong"],
    ["a terse grading complaint", "wrong grade"],
    ["a terse complaint", "not working"],
    ["a single meaningful word", "freezes"],
    ["a vague complaint with a subject", "bad grading"],
    ["a short error report", "error"],
    ["a terse disagreement", "wrong"],
    ["a network complaint", "network issue"],
    ["a four-letter acronym", "HTML"],
    ["a short vowel-less fragment", "kjkj"],
    ["a question number on its own", "Q7"],
    ["an acronym", "SQL"],
    ["japanese", "反映されていない"],
    ["chinese, two characters", "卡住"],
    ["vietnamese", "câu hỏi 2 không gõ được"],
    ["arabic", "لا يعمل"],
    ["spanish", "no carga la pregunta"],
    [
      "a templated report with one real field",
      form({
        "Steps to reproduce": "My steps to reproduce",
        "Expected result": "result",
        "Actual result": "actual result",
        "Additional context": "The editor is flashing black and white.",
      }),
    ],
    [
      "filler next to real words",
      form({
        "Steps to reproduce": "no",
        "Expected result": "no",
        "Actual result": "grade is 0",
      }),
    ],
    ["a bold label the form never emits", "**Upload fails:**"],
    [
      "a metadata key followed by a complaint",
      "Assignment ID: 42 fails to load",
    ],
    ["an HTTP status code", "500"],
    ["an HTTP status code in a form field", form({ "Actual result": "404" })],
    ["a Node error code", "ERR_NETWORK"],
    ["a socket error code", "ECONNRESET"],
    ["a database error code", "22P05"],
  ];

  it.each(real)("keeps %s", (_name, description) => {
    expect(classifyReportText(description)).toEqual({ junk: false });
  });

  it("never flags an error-dialog report, even when nothing was typed", () => {
    const description = form({
      "Steps to reproduce": [
        "1. I was using /learner/42 normally.",
        "2. The error dialog appeared.",
        "(Auto-filled — please describe what you were doing if you can.)",
      ].join("\r\n"),
      "Expected result": "The page keeps working without an error dialog.",
      "Actual result":
        "An error dialog appeared:\r\nStatus: 500 — Something went wrong",
    });
    expect(classifyReportText(description)).toEqual({ junk: false });
  });

  it("never flags the server-side error report", () => {
    const description = [
      "## Summary",
      "- Status: 500 — N/A",
      "- Message: N/A",
      "",
      "## Debug details",
      "No debug details captured.",
    ].join("\n");
    expect(classifyReportText(description)).toEqual({ junk: false });
  });

  it("never flags a report filed from an error dialog category", () => {
    expect(
      classifyReportText(".", { category: "Error Dialog Report" }),
    ).toEqual({ junk: false });
    expect(
      classifyReportText(".", {
        category: "Error Dialog Report (client network)",
      }),
    ).toEqual({ junk: false });
    expect(classifyReportText(".", { category: "UI Error" })).toEqual({
      junk: false,
    });
  });

  it("does not exempt other categories", () => {
    expect(classifyReportText(".", { category: "Flag Button Report" })).toEqual(
      { junk: true, reason: "no_letters" },
    );
  });

  it("copes with a non-string description from a hostile client", () => {
    expect(classifyReportText(undefined as unknown as string)).toEqual({
      junk: true,
      reason: "no_letters",
    });
  });
});
