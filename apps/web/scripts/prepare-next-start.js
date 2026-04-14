const fs = require("node:fs");
const path = require("node:path");

const manifestPaths = [
  path.join(".next", "required-server-files.json"),
  path.join(".next", "routes-manifest.json"),
];

const apiGatewayHost = process.env.API_GATEWAY_HOST;

if (!apiGatewayHost) {
  throw new Error("API_GATEWAY_HOST must be set before preparing Next.js.");
}

for (const manifestPath of manifestPaths) {
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Missing Next.js build artifact: ${manifestPath}`);
  }

  const contents = fs.readFileSync(manifestPath, "utf-8");
  const updatedContents = contents.replaceAll(
    "http://{API_GATEWAY_HOST}",
    apiGatewayHost,
  );

  fs.writeFileSync(manifestPath, updatedContents, "utf-8");
}
