import { decodeGithubFileContent } from "../github-file-content";

// GitHub's contents API returns base64 wrapped at 60 characters with "\n".
function githubBase64(text: string): string {
  const base64 = Buffer.from(text, "utf-8").toString("base64");
  return (base64.match(/.{1,60}/g) ?? []).join("\n") + "\n";
}

describe("decodeGithubFileContent", () => {
  it("decodes UTF-8 text such as accents, CJK and emoji intact", () => {
    const text =
      "# Análisis de datos\nprint('Привет, 世界 🌍')\n# Ñandú — café\n";
    expect(decodeGithubFileContent(githubBase64(text))).toBe(text);
  });

  it("decodes a notebook with non-English markdown to valid JSON text", () => {
    const notebook = JSON.stringify({
      cells: [{ cell_type: "markdown", source: ["## Données précises"] }],
    });
    const decoded = decodeGithubFileContent(githubBase64(notebook));
    expect(JSON.parse(decoded)).toEqual(JSON.parse(notebook));
  });

  it("keeps plain ASCII unchanged", () => {
    const text = "SELECT 1;\n";
    expect(decodeGithubFileContent(githubBase64(text))).toBe(text);
  });

  it("drops a leading byte-order mark", () => {
    const text = "﻿id,name\n1,Zoë\n";
    expect(decodeGithubFileContent(githubBase64(text))).toBe(
      "id,name\n1,Zoë\n",
    );
  });
});
