import {
  AUTHORING_DOCUMENT_ACCEPT,
  CODE_ACCEPT,
  getUploadAcceptMap,
  IMAGE_ACCEPT,
  UPLOAD_ACCEPT,
  type UploadAcceptMap,
} from "@/lib/upload-accept";

/** The MIME type each Office extension is actually registered under. */
const CANONICAL_TYPES: Record<string, string> = {
  ".doc": "application/msword",
  ".docx":
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx":
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".pdf": "application/pdf",
  ".csv": "text/csv",
};

function typesFor(map: UploadAcceptMap, extension: string): string[] {
  return Object.entries(map)
    .filter(([, extensions]) => extensions.includes(extension))
    .map(([mimeType]) => mimeType);
}

describe("upload accept maps", () => {
  describe.each([
    ["learner upload/report/spreadsheet", UPLOAD_ACCEPT],
    ["authoring document picker", AUTHORING_DOCUMENT_ACCEPT],
  ])("%s", (_label, map) => {
    it.each(Object.entries(CANONICAL_TYPES))(
      "declares %s under its own MIME type",
      (extension, expectedType) => {
        const declared = typesFor(map, extension);
        if (declared.length === 0) return;
        expect(declared).toEqual([expectedType]);
      },
    );

    it("offers the OOXML spreadsheet type so phone pickers show .xlsx", () => {
      expect(
        map[
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        ],
      ).toEqual([".xlsx"]);
    });

    it("never attaches .xlsx to the legacy Excel type", () => {
      expect(map["application/vnd.ms-excel"] ?? []).not.toContain(".xlsx");
    });
  });

  it("routes each response type to the right map", () => {
    expect(getUploadAcceptMap("UPLOAD", "CODE")).toBe(CODE_ACCEPT);
    expect(getUploadAcceptMap("UPLOAD", "IMAGES")).toBe(IMAGE_ACCEPT);
    expect(getUploadAcceptMap("UPLOAD", "SPREADSHEET")).toBe(UPLOAD_ACCEPT);
    expect(getUploadAcceptMap("UPLOAD", "REPORT")).toBe(UPLOAD_ACCEPT);
    expect(getUploadAcceptMap("UPLOAD", null)).toBe(UPLOAD_ACCEPT);
    expect(getUploadAcceptMap("UPLOAD", "OTHER")).toEqual({});
  });

  it("keeps image types selectable on upload questions", () => {
    for (const imageType of Object.keys(IMAGE_ACCEPT)) {
      expect(UPLOAD_ACCEPT[imageType]).toBeDefined();
    }
  });
});
