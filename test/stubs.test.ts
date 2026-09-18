// v0.1 scaffold test — asserts the still-placeholder exports resolve correctly.
// `./client` (getDb) and `./guard` are no longer stubs as of BE-mono-13 — their real
// behavioural tests live in test/guard.test.ts. `./tier`'s real tests land with BE-mono-10.
// Ownership's real tests live in test/ownership.test.ts (BE-mono-12).

import { describe, expect, it } from "vitest";
import { tierStub } from "../src/tier.js";

describe("v0.1 scaffold stubs", () => {
  it("./tier resolves and exports the placeholder tier list", () => {
    expect(tierStub).toContain("basic");
    expect(tierStub).toHaveLength(3);
  });
});
