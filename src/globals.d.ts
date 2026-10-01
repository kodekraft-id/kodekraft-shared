// This package deliberately does not depend on `@cloudflare/workers-types` or `@types/node`
// (see client.ts's file header — kept dependency-free per doc 12 §5.4). `console` is a real
// global in every environment this package runs in (Workers runtime, Node test runner), but
// with `lib: ["ES2022"]` and no DOM/Node types installed, TypeScript doesn't know that on
// its own. Declare only the one method guard.ts actually uses.
declare const console: {
  error(...args: unknown[]): void;
};

// design.ts hashes the consent text with Web Crypto, which every runtime of this package has (Workers,
// browsers, Node >= 20). Declared as narrowly as the one call needs, same reasoning as `console` above.
declare const crypto: {
  subtle: { digest(algorithm: "SHA-256", data: Uint8Array): Promise<ArrayBuffer> };
};
declare class TextEncoder {
  encode(input?: string): Uint8Array;
}
