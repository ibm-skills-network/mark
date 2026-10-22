const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
function forbiddenImports(text) {
  const source = ts.createSourceFile(
    "contract.ts",
    text,
    ts.ScriptTarget.Latest,
    true,
  );
  const invalid = [];
  function visit(node) {
    const specifier =
      ts.isImportDeclaration(node) || ts.isExportDeclaration(node)
        ? node.moduleSpecifier
        : ts.isCallExpression(node) &&
            (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
              node.expression.getText(source) === "require")
          ? node.arguments[0]
          : undefined;
    if (
      specifier &&
      (!ts.isStringLiteral(specifier) ||
        !(
          specifier.text === "zod" ||
          (specifier.text.startsWith("./") &&
            !specifier.text.split("/").includes(".."))
        ))
    )
      invalid.push(specifier.getText(source));
    ts.forEachChild(node, visit);
  }
  visit(source);
  return invalid;
}
test("contracts cannot import applications, Nest, storage, queue or model SDKs", () => {
  const root = path.join(__dirname, "../src");
  for (const file of fs.readdirSync(root))
    if (file.endsWith(".ts")) {
      assert.deepEqual(
        forbiddenImports(fs.readFileSync(path.join(root, file), "utf8")),
        [],
        file,
      );
    }
  for (const dependency of [
    "@nestjs/common",
    "bullmq",
    "openai",
    "../../../apps/api",
  ]) {
    assert.equal(
      forbiddenImports(`import { value } from '${dependency}';`).length,
      1,
    );
  }
});
