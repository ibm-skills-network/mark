import type { Part, RubricCriterion } from "./contracts";
import type { GradingModelClient, GradingModelRequest } from "./model-client";
import {
  classifyRubric,
  materializeSignals,
  RubricClassificationError,
  wouldEscalate,
} from "./rubric-classifier";

const criteria: RubricCriterion[] = [
  { id: "c1", description: "Explains the chart", maxPoints: 2 },
  { id: "c2", description: "Total revenue is correct", maxPoints: 2 },
  { id: "c3", description: "The tests pass", maxPoints: 2 },
];

const question = { questionText: "Analyse the sales data." };

class FakeClient implements GradingModelClient {
  readonly requests: GradingModelRequest[] = [];
  constructor(private readonly replies: Array<unknown>) {}
  complete(request: GradingModelRequest) {
    this.requests.push(request);
    const reply = this.replies.shift();
    return Promise.resolve({
      outputText: typeof reply === "string" ? reply : JSON.stringify(reply),
      usage: {
        inputTokens: 100,
        cachedInputTokens: 0,
        outputTokens: 20,
        reasoningTokens: 5,
      },
      model: "fake-model",
    });
  }
}

const reply = {
  criteria: [
    { id: "c1", kind: "read", reason: "Judged by looking." },
    { id: "c2", kind: "compute", reason: "Needs summing." },
    { id: "c3", kind: "execute", reason: "Needs the tests run." },
  ],
};

describe("classifyRubric", () => {
  it("classifies every criterion in one strict, low-effort call", async () => {
    const client = new FakeClient([reply]);
    const result = await classifyRubric(question, { criteria }, client);
    expect(result.criteria).toEqual(reply.criteria);
    expect(result.model).toBe("fake-model");
    expect(result.usage.inputTokens).toBe(100);
    expect(client.requests).toHaveLength(1);
    const request = client.requests[0];
    expect(request.effort).toBe("low");
    const schema = JSON.stringify(request.jsonSchema);
    expect(schema).toContain('"enum":["read","compute","execute"]');
    expect(schema).toContain('"additionalProperties":false');
    const prompt = JSON.stringify(request.messages);
    expect(prompt).toContain("Total revenue is correct");
    expect(prompt).toContain("Analyse the sales data.");
  });

  it("returns criteria in rubric order", async () => {
    const client = new FakeClient([
      { criteria: [...reply.criteria].reverse() },
    ]);
    const result = await classifyRubric(question, { criteria }, client);
    expect(result.criteria.map((item) => item.id)).toEqual(["c1", "c2", "c3"]);
  });

  it.each([
    ["a missing criterion", { criteria: reply.criteria.slice(0, 2) }],
    [
      "an unknown criterion",
      {
        criteria: [...reply.criteria, { id: "c9", kind: "read", reason: "x" }],
      },
    ],
    [
      "a duplicate criterion",
      { criteria: [...reply.criteria, reply.criteria[0]] },
    ],
    [
      "an unknown kind",
      {
        criteria: [
          reply.criteria[0],
          reply.criteria[1],
          { id: "c3", kind: "guess", reason: "x" },
        ],
      },
    ],
    ["output that is not JSON", "not json"],
  ])("rejects %s", async (_label, bad) => {
    await expect(
      classifyRubric(question, { criteria }, new FakeClient([bad])),
    ).rejects.toBeInstanceOf(RubricClassificationError);
  });
});

describe("wouldEscalate", () => {
  const noSignals = { abridgedDataFiles: [], filesNotSent: [] };
  const kinds = (...values: Array<"read" | "compute" | "execute">) =>
    values.map((kind, index) => ({ id: `c${index + 1}`, kind }));

  it("escalates when any criterion needs verification", () => {
    const result = wouldEscalate({
      kinds: kinds("read"),
      needsVerification: [{ criterionId: "c1", reason: "r" }],
      materializeSignals: noSignals,
    });
    expect(result.escalate).toBe(true);
    expect(result.reasons).toEqual(["needs_verification:c1"]);
  });

  it("escalates a compute criterion when a data file was abridged", () => {
    const result = wouldEscalate({
      kinds: kinds("read", "compute"),
      needsVerification: [],
      materializeSignals: {
        abridgedDataFiles: ["sales.csv"],
        filesNotSent: [],
      },
    });
    expect(result).toEqual({
      escalate: true,
      reasons: ["compute_with_abridged_data:c2"],
    });
  });

  it("escalates an execute criterion when files were not sent", () => {
    const result = wouldEscalate({
      kinds: kinds("execute"),
      needsVerification: [],
      materializeSignals: { abridgedDataFiles: [], filesNotSent: ["a.py"] },
    });
    expect(result).toEqual({
      escalate: true,
      reasons: ["execute_with_files_not_sent:c1"],
    });
  });

  it("does not escalate compute or execute criteria when everything was sent whole", () => {
    expect(
      wouldEscalate({
        kinds: kinds("compute", "execute"),
        needsVerification: [],
        materializeSignals: noSignals,
      }),
    ).toEqual({ escalate: false, reasons: [] });
  });

  it("does not escalate read-only criteria on abridged or unsent files", () => {
    expect(
      wouldEscalate({
        kinds: kinds("read", "read"),
        needsVerification: [],
        materializeSignals: {
          abridgedDataFiles: ["sales.csv"],
          filesNotSent: ["big.pdf"],
        },
      }),
    ).toEqual({ escalate: false, reasons: [] });
  });

  it("does not escalate with no kinds and no flags", () => {
    expect(
      wouldEscalate({
        kinds: [],
        needsVerification: [],
        materializeSignals: noSignals,
      }),
    ).toEqual({ escalate: false, reasons: [] });
  });
});

describe("materializeSignals", () => {
  it("finds abridged data parts and files that were not sent", () => {
    const parts: Part[] = [
      {
        name: "book.xlsx › Sales",
        kind: "text",
        mimeType: "text/csv",
        text: '[abridged: 900 data rows × 4 columns; rows 201–880 omitted]\nSheet "Sales"',
      },
      {
        name: "data.json",
        kind: "text",
        mimeType: "application/json",
        text: "[abridged: 300000 characters, about 85715 tokens; the middle 1 characters are omitted]\n{",
      },
      {
        name: "essay.md",
        kind: "text",
        text: "[abridged: 300000 characters, about 85715 tokens; the middle 1 characters are omitted]\nOnce",
      },
      { name: "small.csv", kind: "text", mimeType: "text/csv", text: "a,b" },
      {
        name: "skipped files",
        kind: "text",
        text: "3 file(s) in the submission were not read or not sent to the grader:\n- package-lock.json: lockfile or system file\n- huge.pdf: not sent: about 200000 tokens, over the 160000-token per-file cap\n- extra.py: not sent (budget)",
      },
    ];
    expect(materializeSignals(parts)).toEqual({
      abridgedDataFiles: ["book.xlsx › Sales", "data.json"],
      filesNotSent: ["huge.pdf", "extra.py"],
    });
  });

  it("reports nothing for a submission sent whole", () => {
    expect(
      materializeSignals([{ name: "answer", kind: "text", text: "42" }]),
    ).toEqual({ abridgedDataFiles: [], filesNotSent: [] });
  });
});
