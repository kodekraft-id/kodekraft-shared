// This package deliberately does not depend on `@cloudflare/workers-types` or `@types/node`
// (see client.ts's file header — kept dependency-free per doc 12 §5.4). `console` is a real
// global in every environment this package runs in (Workers runtime, Node test runner), but
// with `lib: ["ES2022"]` and no DOM/Node types installed, TypeScript doesn't know that on
// its own. Declare only the one method guard.ts actually uses.
declare const console: {
  error(...args: unknown[]): void;
};
