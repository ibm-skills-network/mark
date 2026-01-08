type Viewport = { width: number; height: number; rotation: number };

const createViewport = (scale: number): Viewport => ({
  width: 612 * (scale || 1),
  height: 792 * (scale || 1),
  rotation: 0,
});

const createPage = () => ({
  getViewport: ({ scale }: { scale: number }) => createViewport(scale),
  getTextContent: async () => ({ items: [] }),
  getOperatorList: async () => ({
    fnArray: [] as number[],
    argsArray: [] as unknown[],
  }),
  render: () => ({ promise: Promise.resolve() }),
  objs: {
    has: () => false,
    get: () => null,
  },
});

const createDocument = () => ({
  numPages: 1,
  getPage: async () => createPage(),
});

export const getDocument = () => ({
  promise: Promise.resolve(createDocument()),
  destroy: async (): Promise<void> => {
    return;
  },
});

export default { getDocument };
