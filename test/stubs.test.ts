// v0.1 scaffold test — asserts the placeholder exports exist and resolve correctly.
// Real behavioural tests land alongside each module's real implementation
// (BE-mono-12 for ownership, BE-mono-13 for guard/client, BE-mono-10 for tier).

import { describe, expect, it } from "vitest";
import { getDb } from "../src/client.js";
import { ownershipStub } from "../src/ownership.js";
import { tierStub } from "../src/tier.js";

describe("v0.1 scaffold stubs", () => {
  it("./ownership resolves and exports the placeholder shape", () => {
    expect(ownershipStub.placeholder).toBe(true);
  });

  it("./client resolves and its placeholder getDb is a transparent passthrough", () => {
    const binding = { fake: "d1-binding" };
    expect(getDb(binding, "worker-undangan")).toBe(binding);
  });

  it("./tier resolves and exports the placeholder tier list", () => {
    expect(tierStub).toContain("basic");
    expect(tierStub).toHaveLength(3);
  });
});
