const fs = require("fs");
const path = require("path");
const https = require("https");
const { mkdirp } = require("mkdirp");

const MODEL_BASE_PATH = path.join(__dirname, "..", "models");
const MODEL_PATHS = {
  face_expression_model: [
    "https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights/face_expression_model-weights_manifest.json",
    "https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights/face_expression_model-shard1",
  ],
  tiny_face_detector_model: [
    "https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights/tiny_face_detector_model-weights_manifest.json",
    "https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights/tiny_face_detector_model-shard1",
  ],
};

async function downloadFile(url, outputPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(outputPath);
    https
      .get(url, (response) => {
        if (response.statusCode !== 200) {
          reject(
            new Error(
              `Failed to download ${url} - Status: ${response.statusCode}`,
            ),
          );
          return;
        }
        response.pipe(file);
        file.on("finish", () => {
          file.close(resolve);
        });
      })
      .on("error", (err) => {
        fs.unlinkSync(outputPath);
        reject(err);
      });
  });
}

async function main() {
  try {
    await mkdirp(MODEL_BASE_PATH);

    for (const modelDir of Object.keys(MODEL_PATHS)) {
      const fullPath = path.join(MODEL_BASE_PATH, modelDir);
      if (!fs.existsSync(fullPath)) {
        fs.mkdirSync(fullPath, { recursive: true });
      }
    }

    for (const [modelDir, urls] of Object.entries(MODEL_PATHS)) {
      for (const url of urls) {
        const filename = url.split("/").pop();
        const outputPath = path.join(MODEL_BASE_PATH, modelDir, filename);

        await downloadFile(url, outputPath);
      }
    }
  } catch (error) {
    process.exit(1);
  }
}

main();
