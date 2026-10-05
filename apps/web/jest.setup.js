import "@testing-library/jest-dom";
import { TextDecoder, TextEncoder } from "util";

if (typeof global.TextEncoder === "undefined") {
  global.TextEncoder = TextEncoder;
}

if (typeof global.TextDecoder === "undefined") {
  global.TextDecoder = TextDecoder;
}

if (typeof global.MessageChannel === "undefined") {
  class MockMessagePort {
    onmessage = null;

    postMessage = jest.fn();

    close = jest.fn();

    start = jest.fn();

    addEventListener = jest.fn();

    removeEventListener = jest.fn();

    dispatchEvent = jest.fn();
  }

  global.MessageChannel = class MockMessageChannel {
    constructor() {
      this.port1 = new MockMessagePort();
      this.port2 = new MockMessagePort();
    }
  };
}

if (typeof global.ClipboardEvent === "undefined") {
  global.ClipboardEvent = class ClipboardEvent extends Event {
    constructor(type, eventInitDict) {
      super(type, eventInitDict);
      this.clipboardData = eventInitDict?.clipboardData || null;
    }
  };
}

if (typeof window !== "undefined") {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: jest.fn().mockImplementation((query) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: jest.fn(),
      removeListener: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      dispatchEvent: jest.fn(),
    })),
  });
}

// ProseMirror measures the document to place the caret and to position the
// gap/drop cursors. jsdom implements no layout, so these return nothing and
// coordsAtPos throws part-way through mounting an editor. Stubbing them is
// enough for the editor to mount; anything that genuinely depends on geometry
// belongs in a browser test rather than here.
if (typeof Range !== "undefined") {
  Range.prototype.getBoundingClientRect = () => ({
    top: 0,
    left: 0,
    bottom: 0,
    right: 0,
    width: 0,
    height: 0,
    x: 0,
    y: 0,
    toJSON() {
      return {};
    },
  });

  Range.prototype.getClientRects = () => ({
    length: 0,
    item: () => null,
    [Symbol.iterator]: function* () {},
  });
}

if (typeof document !== "undefined" && !document.elementFromPoint) {
  document.elementFromPoint = () => null;
}

if (typeof global.DataTransfer === "undefined") {
  global.DataTransfer = class DataTransfer {
    items = [];
    files = [];
    types = [];
    setData() {}
    getData() {
      return "";
    }
  };
}
