// Sends identical synthetic requests to the legacy and v3 backends and compares
// status and raw body. Run inside the gateway pod: see "Comparing backends" in README.md.
const legacyBase = process.env.MARK_API_ENDPOINT;
const v3Base = process.env.MARK_V3_API_ENDPOINT;
if (!legacyBase || !v3Base) {
  process.stderr.write(
    "MARK_API_ENDPOINT and MARK_V3_API_ENDPOINT must both be set\n",
  );
  process.exit(2);
}

const TIMEOUT_MS = 10000;
const CONTEXT = 40;

// Same escaping as the gateway's asciiJson, so the header is pure ASCII.
const asciiJson = (value) =>
  JSON.stringify(value).replaceAll(
    /[\u007F-￿]/g,
    (c) => "\\u" + c.codePointAt(0).toString(16).padStart(4, "0"),
  );

const base = { userId: "a@b.co", role: "learner" };
const sessions = [
  [
    "full learner",
    {
      ...base,
      groupId: "g",
      assignmentId: 7,
      returnUrl: "https://x.org/r",
      launch_presentation_locale: "fr",
      lisOutcomeServiceUrl: "https://WWW.Coursera.org/lti",
    },
  ],
  [
    "author with assignment",
    { ...base, role: "author", groupId: "g", assignmentId: 7 },
  ],
  ["explicit nulls", { ...base, assignmentId: null, returnUrl: null }],
  [
    "non-http scheme",
    { ...base, assignmentId: 7, lisOutcomeServiceUrl: "ftp://h.org" },
  ],
  [
    "padded url with www.www",
    {
      ...base,
      assignmentId: 7,
      lisOutcomeServiceUrl: "  http://www.www.h.org:8080/p ",
    },
  ],
  [
    "non-ASCII locale",
    { ...base, assignmentId: 7, launch_presentation_locale: "été" },
  ],
  ["non-string returnUrl", { ...base, assignmentId: 7, returnUrl: 5 }],
  ["author, no assignment", { ...base, role: "author" }],
];

const paths = ["/api/v1/user-session", "/api/v1/ai-status"];
const CASES = paths.flatMap((path) =>
  sessions.map(([label, session]) => ({
    name: `${path.split("/").pop()} ${label}`,
    method: "GET",
    path,
    session,
  })),
);

async function call(baseUrl, testCase, n) {
  const res = await fetch(baseUrl + testCase.path, {
    method: testCase.method,
    headers: {
      "user-session": asciiJson(testCase.session),
      "x-request-id": `compare-${n}`,
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  return { status: res.status, body: await res.text() };
}

function firstDiff(a, b) {
  const max = Math.min(a.length, b.length);
  let i = 0;
  while (i < max && a[i] === b[i]) i += 1;
  return i;
}

const snippet = (text, at) =>
  JSON.stringify(text.slice(Math.max(0, at - CONTEXT), at + CONTEXT));

let failures = 0;
for (const [index, testCase] of CASES.entries()) {
  try {
    const [legacy, v3] = await Promise.all([
      call(legacyBase, testCase, index),
      call(v3Base, testCase, index),
    ]);
    if (legacy.status === v3.status && legacy.body === v3.body) {
      process.stdout.write(`MATCH ${testCase.name} ${legacy.status}\n`);
      continue;
    }
    failures += 1;
    process.stdout.write(
      `DIFF ${testCase.name} ${legacy.status}/${v3.status}\n`,
    );
    if (legacy.body !== v3.body) {
      const at = firstDiff(legacy.body, v3.body);
      process.stdout.write(
        `  first differing offset ${at}\n  legacy: ${snippet(legacy.body, at)}\n  v3:     ${snippet(v3.body, at)}\n`,
      );
    }
  } catch (error) {
    failures += 1;
    const reason = error instanceof Error ? error.name : "unknown error";
    process.stdout.write(`ERROR ${testCase.name} ${reason}\n`);
  }
}

process.stdout.write(
  `${CASES.length - failures}/${CASES.length} cases match\n`,
);
process.exit(failures === 0 ? 0 : 1);
