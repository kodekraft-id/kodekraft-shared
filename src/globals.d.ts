// This package deliberately does not depend on `@cloudflare/workers-types` or `@types/node`
// (see client.ts's file header — kept dependency-free per doc 12 §5.4). `console` is a real
// global in every environment this package runs in (Workers runtime, Node test runner), but
// with `lib: ["ES2022"]` and no DOM/Node types installed, TypeScript doesn't know that on
// its own. Declare only the one method guard.ts actually uses.
declare const console: {
  error(...args: unknown[]): void;
};

// design.ts hashes the consent text with Web Crypto, and temp-password.ts draws random bytes from it; every
// runtime of this package has both (Workers, browsers, Node >= 20). Declared as narrowly as those calls need, same
// reasoning as `console` above.
declare const crypto: {
  subtle: { digest(algorithm: "SHA-256", data: Uint8Array): Promise<ArrayBuffer> };
  getRandomValues<T extends Uint8Array>(array: T): T;
};
declare class TextEncoder {
  encode(input?: string): Uint8Array;
}
