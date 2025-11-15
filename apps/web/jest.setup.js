// Optional: configure or set up a testing framework before each test.
// If you delete this file, remove `setupFilesAfterEnv` from `jest.config.js`

// Setup for Node.js environment tests
import '@testing-library/jest-dom';

// Polyfill for ClipboardEvent (not available in jsdom)
if (typeof global.ClipboardEvent === 'undefined') {
  global.ClipboardEvent = class ClipboardEvent extends Event {
    constructor(type, eventInitDict) {
      super(type, eventInitDict);
      this.clipboardData = eventInitDict?.clipboardData || null;
    }
  };
}

// Mock matchMedia (not available in jsdom)
if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: jest.fn().mockImplementation(query => ({
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
