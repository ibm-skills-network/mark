// Minimal CJS-compatible stub for the ESM-only `file-type` package.
//
// Why this exists: `ibm-cloud-sdk-core/lib/helper.js` does
// `require('file-type')` at module load. The real package (v21+) is ESM-only
// (`"type": "module"`), so the CommonJS `require` call throws under jest's
// default Node module resolution. The DI smoke test in this workspace only
// resolves providers — it never calls into `file-type` runtime helpers — so
// returning an inert object is sufficient to satisfy the eager require.
//
// If a future test in this workspace exercises ibm-cloud-sdk-core helpers
// that actually call `FileType.fromBuffer(...)` or similar, expand this stub
// to cover those call sites with explicit jest.fn() mocks.

const fileTypeFromBuffer = async (): Promise<undefined> => undefined;
const fileTypeFromStream = async (): Promise<undefined> => undefined;
const fileTypeFromBlob = async (): Promise<undefined> => undefined;

module.exports = {
  fileTypeFromBuffer,
  fileTypeFromStream,
  fileTypeFromBlob,
  default: { fileTypeFromBuffer, fileTypeFromStream, fileTypeFromBlob },
};
