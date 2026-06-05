import "@testing-library/jest-dom/vitest";
import { afterAll, afterEach, beforeAll } from "vitest";
import { server } from "./mocks/server";

beforeAll(() => server.listen({ onUnhandledRequest: "bypass" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

// jsdom v29 provides localStorage, but it's keyed to a file path that isn't
// available in test environments. Replace with a simple in-memory mock.
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; },
  };
})();

Object.defineProperty(globalThis, "localStorage", {
  value: localStorageMock,
  writable: true,
  configurable: true,
});

// jsdom does not implement scrollIntoView — provide a no-op stub.
Element.prototype.scrollIntoView = () => {};

// CodeMirror calls Range.getClientRects() in requestAnimationFrame callbacks
// after a test has torn down, causing false-positive "not a function" errors.
// Return an empty array so CodeMirror's measurement loop is a no-op.
const emptyDomRects: DOMRect[] = [];
Range.prototype.getClientRects = () => ({
  length: 0,
  item: () => null,
  [Symbol.iterator]: emptyDomRects[Symbol.iterator].bind(emptyDomRects),
});
