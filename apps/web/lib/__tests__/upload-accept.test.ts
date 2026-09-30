import {
  AUTHORING_DOCUMENT_ACCEPT,
  CODE_ACCEPT,
  getUploadAcceptMap,
  IMAGE_ACCEPT,
  isAndroidWebView,
  shouldOmitAcceptFilter,
  UPLOAD_ACCEPT,
  type UploadAcceptMap,
} from "@/lib/upload-accept";

const USER_AGENTS = {
  androidWebView:
    "Mozilla/5.0 (Linux; Android 13; Pixel 7 Build/TQ3A.230901.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/140.0.7339.51 Mobile Safari/537.36",
  androidWebViewReduced:
    "Mozilla/5.0 (Linux; Android 10; K; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/140.0.0.0 Mobile Safari/537.36",
  chromeAndroid:
    "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36",
  samsungInternet:
    "Mozilla/5.0 (Linux; Android 14; SAMSUNG SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36",
  firefoxAndroid:
    "Mozilla/5.0 (Android 14; Mobile; rv:131.0) Gecko/131.0 Firefox/131.0",
  desktopChrome:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
  iosSafari:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  iosWebView:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
};

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

describe("isAndroidWebView", () => {
  it.each([
    ["androidWebView", USER_AGENTS.androidWebView],
    ["androidWebViewReduced", USER_AGENTS.androidWebViewReduced],
  ])("detects %s", (_label, userAgent) => {
    expect(isAndroidWebView(userAgent)).toBe(true);
  });

  it.each([
    ["chromeAndroid", USER_AGENTS.chromeAndroid],
    ["samsungInternet", USER_AGENTS.samsungInternet],
    ["firefoxAndroid", USER_AGENTS.firefoxAndroid],
    ["desktopChrome", USER_AGENTS.desktopChrome],
    ["iosSafari", USER_AGENTS.iosSafari],
    ["iosWebView", USER_AGENTS.iosWebView],
    ["empty", ""],
  ])("ignores %s", (_label, userAgent) => {
    expect(isAndroidWebView(userAgent)).toBe(false);
  });
});

describe("shouldOmitAcceptFilter", () => {
  it.each([
    ["learner upload", UPLOAD_ACCEPT],
    ["code", CODE_ACCEPT],
    ["authoring documents", AUTHORING_DOCUMENT_ACCEPT],
  ])("drops the %s filter in an Android WebView", (_label, map) => {
    expect(shouldOmitAcceptFilter(map, USER_AGENTS.androidWebView)).toBe(true);
  });

  it("keeps an image-only filter in an Android WebView", () => {
    expect(
      shouldOmitAcceptFilter(IMAGE_ACCEPT, USER_AGENTS.androidWebView),
    ).toBe(false);
  });

  it("has nothing to drop for an empty map", () => {
    expect(shouldOmitAcceptFilter({}, USER_AGENTS.androidWebView)).toBe(false);
  });

  it.each([
    ["chromeAndroid", USER_AGENTS.chromeAndroid],
    ["desktopChrome", USER_AGENTS.desktopChrome],
    ["unknown (pre-mount)", ""],
  ])("keeps the filter for %s", (_label, userAgent) => {
    expect(shouldOmitAcceptFilter(UPLOAD_ACCEPT, userAgent)).toBe(false);
  });
});
