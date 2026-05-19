// Stub for the `canvas` native module so jest can resolve imports without
// requiring the platform-specific binary (which fails to load on developer
// machines that don't have the build toolchain).
//
// All consumers in this repo only need createCanvas() to return an object
// whose surface satisfies the limited subset used by pdf-structure-extractor.

interface MockContext {
  drawImage: () => void;
  getImageData: () => {
    data: Uint8ClampedArray;
    width: number;
    height: number;
  };
  putImageData: () => void;
  fillRect: () => void;
  clearRect: () => void;
  beginPath: () => void;
  closePath: () => void;
  fill: () => void;
  stroke: () => void;
  save: () => void;
  restore: () => void;
  translate: () => void;
  scale: () => void;
  rotate: () => void;
  fillText: () => void;
  measureText: () => { width: number };
}

interface MockCanvas {
  width: number;
  height: number;
  getContext: () => MockContext;
  toBuffer: () => Buffer;
}

const makeContext = (): MockContext => ({
  drawImage: () => undefined,
  getImageData: () => ({
    data: new Uint8ClampedArray(0),
    width: 0,
    height: 0,
  }),
  putImageData: () => undefined,
  fillRect: () => undefined,
  clearRect: () => undefined,
  beginPath: () => undefined,
  closePath: () => undefined,
  fill: () => undefined,
  stroke: () => undefined,
  save: () => undefined,
  restore: () => undefined,
  translate: () => undefined,
  scale: () => undefined,
  rotate: () => undefined,
  fillText: () => undefined,
  measureText: () => ({ width: 0 }),
});

export const createCanvas = (width = 0, height = 0): MockCanvas => ({
  width,
  height,
  getContext: makeContext,
  toBuffer: () => Buffer.alloc(0),
});

export default { createCanvas };
