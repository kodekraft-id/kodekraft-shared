// v0.1 scaffold test — asserts the placeholder exports exist and resolve correctly.
// Real behavioural tests land alongside each module's real implementation
// (BE-mono-13 for guard/client, BE-mono-10 for tier). Ownership's real tests
// now live in test/ownership.test.ts (BE-mono-12).

import { describe, expect, it } from "vitest";
import { getDb } from "../src/client.js";
import { tierStub } from "../src/tier.js";

describe("v0.1 scaffold stubs", () => {
  it("./client resolves and its placeholder getDb is a transparent passthrough", () => {
    const binding = { fake: "d1-binding" };
    expect(getDb(binding, "worker-undangan")).toBe(binding);
  });

  it("./tier resolves and exports the placeholder tier list", () => {
    expect(tierStub).toContain("basic");
    expect(tierStub).toHaveLength(3);
  });
});
