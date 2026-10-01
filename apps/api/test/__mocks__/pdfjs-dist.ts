type Viewport = { width: number; height: number; rotation: number };

const createViewport = (scale: number): Viewport => ({
  width: 612 * (scale || 1),
  height: 792 * (scale || 1),
  rotation: 0,
});

const createObjectStore = () => ({
  has: () => false,
  get: (_id: string, callback?: (value: unknown) => void) => {
    // Mirrors pdfjs PDFObjects.get: with a callback it registers interest and
    // returns null; the callback only fires once the worker publishes the
    // object, which never happens in this stub.
    if (callback) return null;
    return null;
  },
});

const createPage = () => ({
  getViewport: ({ scale }: { scale: number }) => createViewport(scale),
  getTextContent: async () => ({ items: [] }),
  getOperatorList: async () => ({
    fnArray: [] as number[],
    argsArray: [] as unknown[],
  }),
  render: () => ({ promise: Promise.resolve() }),
  objs: createObjectStore(),
  commonObjs: createObjectStore(),
  cleanup: () => undefined,
});

const createDocument = () => ({
  numPages: 1,
  getPage: async () => createPage(),
});

/**
 * The image-painting subset of pdfjs's OPS enum, with the numeric ids the
 * installed pdfjs build assigns. Kept in the stub so extractor code can be
 * written against OPS.* instead of magic numbers and still be unit-testable.
 */
export const OPS = {
  paintImageMaskXObject: 83,
  paintImageMaskXObjectGroup: 84,
  paintImageXObject: 85,
  paintInlineImageXObject: 86,
  paintInlineImageXObjectGroup: 87,
  paintImageXObjectRepeat: 88,
  paintImageMaskXObjectRepeat: 89,
  paintSolidColorImageMask: 90,
} as const;

export const getDocument = () => ({
  promise: Promise.resolve(createDocument()),
  destroy: async (): Promise<void> => {
    return;
  },
});

export default { getDocument, OPS };
