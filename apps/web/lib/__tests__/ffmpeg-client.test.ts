/**
 * @jest-environment node
 */

// In a Node environment `@ffmpeg/ffmpeg` resolves to a stub class whose
// constructor throws "ffmpeg.wasm does not support nodejs" (see the package's
// dist/esm/empty.mjs). The mock below mirrors that behavior so these tests
// can pin the SSR contract without Jest having to transform the package's
// untranspiled ESM: evaluating ffmpeg-client must construct nothing, and the
// instance must be created lazily, exactly once.

const constructorSpy = jest.fn();

jest.mock("@ffmpeg/ffmpeg", () => ({
  FFmpeg: class {
    constructor() {
      constructorSpy();
    }
  },
}));

describe("ffmpeg-client (SSR safety)", () => {
  it("evaluates without constructing FFmpeg", () => {
    jest.isolateModules(() => {
      require("../ffmpeg-client");
    });
    expect(constructorSpy).not.toHaveBeenCalled();
  });

  it("constructs lazily and reuses a single instance", () => {
    let client: typeof import("../ffmpeg-client");
    jest.isolateModules(() => {
      client = require("../ffmpeg-client");
    });

    const first = client.getFfmpeg();
    const second = client.getFfmpeg();

    expect(constructorSpy).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
  });
});
