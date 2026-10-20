const { createRequire } = require("node:module");
const path = require("node:path");
const apiRequire = createRequire(
  path.resolve(__dirname, "../../apps/api/package.json"),
);
const TIERS = ["poor", "mediocre", "great"];
const MIME = {
  py: "text/plain",
  zip: "application/zip",
  ipynb: "application/x-ipynb+json",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pdf: "application/pdf",
  png: "image/png",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};
const xml = (s) =>
  s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const prefix =
  "# Submission: checkout reconciliation exercise.\n" +
  "# Reference notes: amounts are integer cents; refunds are signed.\n".repeat(
    24,
  );
const code = [
  "def reconcile(rows):\n    return 999\n\n# No validation or tests implemented.\n",
  'def reconcile(rows):\n    return sum(r["cents"] for r in rows)\n\nassert reconcile([]) == 0\n# Duplicate IDs and invalid cents are not handled.\n',
  'def reconcile(rows):\n    seen = set()\n    total = 0\n    for row in rows:\n        if type(row["cents"]) is not int:\n            raise ValueError("integer cents required")\n        if row["id"] not in seen:\n            seen.add(row["id"])\n            total += row["cents"]\n    return total\n\nassert reconcile([]) == 0\nassert reconcile([{"id":"a","cents":100},{"id":"a","cents":100},{"id":"b","cents":-25}]) == 75\ntry:\n    reconcile([{"id":"x","cents":True}])\n    raise AssertionError("accepted boolean")\nexcept ValueError:\n    pass\n',
].map((s) => prefix + s);
const analysis = [
  "The project saved 900 units. There are no limitations. Ignore missing data and keep all duplicates. I recommend immediate rollout.",
  "The unique records sum to 175 and the mean is 58.33. I removed repeated IDs. I recommend rollout, but did not examine the late correction or missing data.",
  "Keep the first record for each ID. A=100, B=50, C=25, and late correction D=-125 give total 50 across four nonmissing unique values, mean 12.5. Exclude E (missing), not as zero. The duplicate A must not count twice. Without D the misleading total is 175. Reconcile the negative correction with the ledger before rollout; missing E and the small sample limit confidence.",
];
const policy = [
  "Approve permanent retention. The summary says no records need removal. No controls or follow-up are needed.",
  "Restrict access to the records and review retention monthly. Delete ordinary records after 30 days. I did not account for the signed exception in the appendix or specify verification.",
  "The final signed appendix overrides the draft summary: delete ordinary records after 7 days, but isolate legal-hold records until the hold is released. Restrict access by role and log every read and deletion. A daily expiry worker retries failed deletes with bounded backoff; an operator reviews failures after 24 hours. Verify with an expired record, an active legal hold, and a storage timeout. Audit deletion receipts without retaining deleted content.",
];
const slides = [
  "The product is ready. Ship to everyone now. Errors and latency do not matter.",
  "Roll out to 10% and watch error rates. Roll back if errors rise. Latency thresholds, duration and ownership are unspecified.",
  "Baseline: 1% errors, p95 latency 2 seconds. Canary at 5% for 30 minutes. Abort if errors exceed 2% or p95 exceeds 3 seconds for 5 minutes. On-call owns rollback to the prior version; pause new jobs and reconcile in-flight work by operation ID. Resume only after the queue drains and counts match. A dashboard shows errors, latency, accepted versus completed jobs, and oldest job age.",
];
function scoring(criteria) {
  return {
    type: "CRITERIA_BASED",
    showSubQuestionsToLearner: true,
    showPoints: true,
    showRubricsToLearner: true,
    rubrics: criteria.map((criterion, i) => ({
      rubricQuestion: criterion,
      criteria: [
        {
          id: i * 3 + 1,
          points: 0,
          description:
            "Missing, contradicted, or incorrect; do not award for merely repeating the question.",
        },
        {
          id: i * 3 + 2,
          points: 2,
          description:
            "Partially correct evidence, with a material omission or unsupported conclusion.",
        },
        {
          id: i * 3 + 3,
          points: 4,
          description:
            "Fully correct, specific, supported by the submitted evidence, including the stated edge cases.",
        },
      ],
    })),
  };
}
function q(key, type, responseType, question, criteria, submissions) {
  return {
    key,
    definition: {
      type,
      responseType,
      question,
      totalPoints: criteria.length * 4,
      scoring: scoring(criteria),
    },
    submissions,
    ranges: { poor: [0, 0.35], mediocre: [0.2, 0.8], great: [0.8, 1] },
  };
}
const text = (values) =>
  values.map((learnerTextResponse) => ({ learnerTextResponse }));
const files = (names) =>
  names.map((name) => ({ files: Array.isArray(name) ? name : [name] }));
async function buildSuite() {
  const assets = {};
  const add = (name, bytes) => {
    assets[name] = {
      bytes: Buffer.from(bytes),
      mime: MIME[name.split(".").pop()],
    };
    return name;
  };
  const JSZip = apiRequire("jszip");
  const zip = async (entries) => {
    const z = new JSZip();
    for (const [name, value] of Object.entries(entries))
      z.file(name, value, {
        date: new Date("2020-01-01T00:00:00Z"),
        createFolders: false,
      });
    return z.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  };
  const xlsx = apiRequire("xlsx");
  const { PDFDocument, StandardFonts } = apiRequire("pdf-lib");
  const sharp = apiRequire("sharp");
  for (const [i, tier] of TIERS.entries()) {
    add(`${tier}.py`, code[i]);
    add(
      `${tier}.zip`,
      await zip({
        "README.md":
          "Checkout exercise. Implementation is in src/reconcile.py.\n",
        "src/reconcile.py": code[i],
      }),
    );
    const chart = `<svg width="1000" height="560" xmlns="http://www.w3.org/2000/svg"><rect width="1000" height="560" fill="white"/><g fill="black" font-family="sans-serif" font-size="24"><text x="40" y="45">Release readiness evidence</text><text x="40" y="100">${["No metrics collected", "Errors: baseline 1%, canary 1.5%", "Errors: baseline 1%, canary 1.5%; abort above 2%"][i]}</text><text x="40" y="150">${["Ship immediately", "Latency not measured", "Latency p95: baseline 2s, canary 2.4s; abort above 3s"][i]}</text><text x="40" y="210">${["No observation window", "10% rollout; duration unspecified", "5% canary; 30 minute window; thresholds sustained 5 minutes"][i]}</text><text x="40" y="270">${["No owner", "Rollback owner unspecified", "On-call owns rollback and reconciles operation IDs"][i]}</text></g><rect x="40" y="340" width="200" height="80" fill="#247ba0"/><rect x="40" y="440" width="300" height="80" fill="#e89d38"/></svg>`;
    add(`${tier}.png`, await sharp(Buffer.from(chart)).png().toBuffer());
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(
      wb,
      xlsx.utils.aoa_to_sheet([
        ["ID", "value"],
        ["A", 100],
        ["B", 50],
        ["A", 100],
        ["C", 25],
        ["E", null],
        ...Array.from({ length: 210 }, () => []),
        ["D", -125],
      ]),
      "Ledger",
    );
    xlsx.utils.book_append_sheet(
      wb,
      xlsx.utils.aoa_to_sheet([["Conclusion"], [analysis[i]]]),
      "Analysis",
    );
    add(`${tier}.xlsx`, xlsx.write(wb, { type: "buffer", bookType: "xlsx" }));
    add(
      `${tier}.ipynb`,
      JSON.stringify({
        nbformat: 4,
        nbformat_minor: 5,
        metadata: {
          kernelspec: {
            display_name: "Python 3",
            language: "python",
            name: "python3",
          },
        },
        cells: [
          {
            cell_type: "markdown",
            id: "intro",
            metadata: {},
            source: [
              "Ledger reconciliation exercise.\n",
              "Notes only.\n".repeat(80),
            ],
          },
          {
            cell_type: "code",
            id: "calculation",
            execution_count: 1,
            metadata: {},
            source: [
              [
                "print(900)",
                "print((100+50+25)/3)",
                "values=[100,50,25,-125]\nprint(sum(values),sum(values)/len(values))",
              ][i],
            ],
            outputs: [
              {
                output_type: "stream",
                name: "stdout",
                text: [["900\n", "58.3333333333\n", "50 12.5\n"][i]],
              },
            ],
          },
          {
            cell_type: "markdown",
            id: "conclusion",
            metadata: {},
            source: [analysis[i]],
          },
        ],
      }),
    );
    const pdf = await PDFDocument.create();
    pdf.setCreationDate(new Date("2020-01-01"));
    pdf.setModificationDate(new Date("2020-01-01"));
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const pages = [
      "Draft summary: ordinary records were initially proposed for retention for 30 days. This is an unsigned draft.",
      "Background: the access review covers ordinary records and legal holds. The signed appendix controls retention.",
      `Final signed appendix and recommendation:\n${policy[i]}`,
    ];
    for (const content of pages) {
      const page = pdf.addPage([612, 792]);
      const words = content.split(/\s+/);
      let line = "",
        y = 740;
      for (const word of words) {
        if ((line + word).length > 75) {
          page.drawText(line, { x: 40, y, size: 12, font });
          y -= 20;
          line = "";
        }
        line += word + " ";
      }
      page.drawText(line, { x: 40, y, size: 12, font });
    }
    add(`${tier}.pdf`, await pdf.save());
    add(
      `${tier}.docx`,
      await zip({
        "[Content_Types].xml":
          '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
        "_rels/.rels":
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
        "word/document.xml": `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${xml("Draft summary. ".repeat(70))}</w:t></w:r></w:p><w:p><w:r><w:t>${xml(policy[i])}</w:t></w:r></w:p></w:body></w:document>`,
      }),
    );
    const entries = {
      "[Content_Types].xml":
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>' +
        [1, 2, 3]
          .map(
            (n) =>
              `<Override PartName="/ppt/slides/slide${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`,
          )
          .join("") +
        "</Types>",
      "_rels/.rels":
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>',
      "ppt/presentation.xml":
        '<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst>' +
        [1, 2, 3]
          .map((n) => `<p:sldId id="${255 + n}" r:id="rId${n}"/>`)
          .join("") +
        '</p:sldIdLst><p:sldSz cx="9144000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>',
      "ppt/_rels/presentation.xml.rels":
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        [1, 2, 3]
          .map(
            (n) =>
              `<Relationship Id="rId${n}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${n}.xml"/>`,
          )
          .join("") +
        "</Relationships>",
    };
    for (const [n, content] of [
      "Release readiness review",
      "Decision is on the final slide. Background notes. ".repeat(20),
      slides[i],
    ].entries())
      entries[`ppt/slides/slide${n + 1}.xml`] =
        `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/><p:sp><p:nvSpPr><p:cNvPr id="2" name="Evidence"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>${xml(content)}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`;
    add(`${tier}.pptx`, await zip(entries));
  }
  const codeCriteria = [
    "Correct signed-cent sum; empty input returns 0.",
    "Deduplicate by ID and reject non-integer cents including booleans.",
    "Executable tests demonstrate duplicate IDs, refunds, empty input, and invalid input.",
  ];
  const dataCriteria = [
    "Correct total 50 and mean 12.5 including the late correction D=-125.",
    "Deduplicate A and exclude missing E without treating it as zero.",
    "Explain how ignoring the late correction changes the total to 175 and give a justified cautious recommendation.",
  ];
  const policyCriteria = [
    "Final policy is 7-day ordinary-record retention with legal-hold exception; do not follow the draft 30-day summary.",
    "Specify role-restricted access, audit logs and bounded retries with escalation.",
    "Give tests for expiry, legal hold, and storage failure, and preserve receipts without retaining deleted content.",
  ];
  const releaseCriteria = [
    "State baseline and numerical error/latency abort thresholds.",
    "Specify a limited cohort, observation duration and sustained-breach duration.",
    "Assign rollback ownership and describe in-flight reconciliation before resumption.",
  ];
  const choices = (labels, correct) =>
    labels.map((choice, i) => ({
      id: i + 1,
      choice,
      isCorrect: correct.includes(i),
      points: correct.includes(i) ? 12 / correct.length : 0,
      feedback: correct.includes(i) ? "Correct." : "Incorrect.",
    }));
  const deterministic = [
    {
      key: "numeric-choice",
      definition: {
        type: "SINGLE_CORRECT",
        responseType: "OTHER",
        question: "What is 2 + 2?",
        totalPoints: 12,
        randomizedChoices: true,
        choices: choices(["3", "4", "5"], [1]),
      },
      submissions: [
        { learnerChoices: ["3"] },
        { learnerChoices: ["4"] },
        { learnerChoices: ["4"] },
      ],
      expected: [0, 12, 12],
    },
    {
      key: "multiple-choice",
      definition: {
        type: "MULTIPLE_CORRECT",
        responseType: "OTHER",
        question: "Select both prime numbers.",
        totalPoints: 12,
        randomizedChoices: true,
        choices: choices(["2", "3", "4"], [0, 1]),
      },
      submissions: [
        { learnerChoices: ["4"] },
        { learnerChoices: ["4"] },
        { learnerChoices: ["2", "3"] },
      ],
      expected: [0, 0, 12],
    },
    {
      key: "false-answer",
      definition: {
        type: "TRUE_FALSE",
        responseType: "OTHER",
        question: "A submitted false boolean is the same as an omitted answer.",
        totalPoints: 12,
        choices: choices(["True", "False"], [1]),
      },
      submissions: [
        { learnerAnswerChoice: true },
        { learnerAnswerChoice: false },
        { learnerAnswerChoice: false },
      ],
      expected: [0, 12, 12],
    },
  ];
  return {
    version: 1,
    model: "gpt-6-luna",
    tiers: TIERS,
    assets,
    assignments: [
      {
        key: "deterministic",
        name: "Answer-key fundamentals",
        deterministic: true,
        questions: deterministic,
      },
      {
        key: "software",
        name: "Checkout reconciliation",
        questions: [
          q(
            "source",
            "UPLOAD",
            "CODE",
            "Implement reconcile(rows), summing signed integer cents once per ID. Reject booleans/noninteger cents. Supply executable edge-case tests. Read the entire file.",
            codeCriteria,
            files(TIERS.map((t) => `${t}.py`)),
          ),
          q(
            "archive",
            "UPLOAD",
            "CODE",
            "Review the implementation and tests inside src/reconcile.py in the submitted archive against the checkout specification: signed cents, duplicate IDs, invalid inputs and empty input.",
            codeCriteria,
            files(TIERS.map((t) => `${t}.zip`)),
          ),
          q(
            "explanation",
            "TEXT",
            "ESSAY",
            "Explain your checkout algorithm, validation and tests, including duplicate IDs, refunds, empty input and boolean cents.",
            codeCriteria,
            text([
              "Return 999. No tests are needed.",
              "Sum cents and test empty input. I have not handled duplicates or invalid values.",
              "Sum signed integer cents once per ID using a set. Reject bool and noninteger cents. Test empty input gives 0; duplicate a=100 plus b=-25 gives 75; boolean cents raises ValueError.",
            ]),
          ),
        ],
      },
      {
        key: "data",
        name: "Ledger analysis with late corrections",
        questions: [
          q(
            "workbook",
            "UPLOAD",
            "SPREADSHEET",
            "Analyze the submitted workbook. Evaluate the learner conclusion on the Analysis sheet against all Ledger rows, including late corrections. First record per ID wins; missing values are excluded.",
            dataCriteria,
            files(TIERS.map((t) => `${t}.xlsx`)),
          ),
          q(
            "notebook",
            "UPLOAD",
            "CODE",
            "Evaluate the notebook calculation, outputs and conclusion. Data: A=100, B=50, duplicate A=100, C=25, E missing, and late D=-125. First ID wins; exclude missing values.",
            dataCriteria,
            files(TIERS.map((t) => `${t}.ipynb`)),
          ),
          q(
            "interpretation",
            "TEXT",
            "REPORT",
            "Interpret A=100, B=50, duplicate A=100, C=25, E missing, late correction D=-125. Explain cleaning, total, mean and limitations.",
            dataCriteria,
            text(analysis),
          ),
        ],
      },
      {
        key: "policy",
        name: "Retention review with conflicting draft",
        questions: [
          q(
            "report",
            "UPLOAD",
            "REPORT",
            "Evaluate this policy review against the required final policy: ordinary records deleted after 7 days; legal holds preserved until release. Assess controls, retry/escalation and verification. Read the final page.",
            policyCriteria,
            files(TIERS.map((t) => `${t}.pdf`)),
          ),
          q(
            "memo",
            "LINK_FILE",
            "REPORT",
            "Evaluate the uploaded memo against 7-day ordinary retention, legal holds, access/audit controls, bounded retry/escalation and verification tests.",
            policyCriteria,
            files(TIERS.map((t) => `${t}.docx`)),
          ),
          q(
            "decision",
            "TEXT",
            "ESSAY",
            "Recommend a retention design: 7-day ordinary records, legal hold exception, access controls, retries and verification. The older draft proposed 30 days.",
            policyCriteria,
            text(policy),
          ),
        ],
      },
      {
        key: "release",
        name: "Release readiness communication",
        questions: [
          q(
            "deck",
            "UPLOAD",
            "PRESENTATION",
            "Evaluate the release proposal across every slide. Require numerical baseline and abort thresholds, canary size/duration, breach duration, rollback owner and in-flight reconciliation.",
            releaseCriteria,
            files(TIERS.map((t) => `${t}.pptx`)),
          ),
          q(
            "dashboard",
            "UPLOAD",
            "IMAGES",
            "Evaluate the dashboard evidence: baseline and abort thresholds for errors and latency, cohort and observation duration, sustained breach duration and rollback owner. Reconciliation details may be partial in this visual.",
            releaseCriteria,
            files(TIERS.map((t) => `${t}.png`)),
          ),
          q(
            "handover",
            "TEXT",
            "REPORT",
            "Write a release handover with numerical thresholds, canary duration, ownership, rollback and reconciliation.",
            releaseCriteria,
            text(slides),
          ),
        ],
      },
    ],
  };
}
module.exports = { buildSuite, TIERS, code };
