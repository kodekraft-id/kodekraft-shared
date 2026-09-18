// R4-exempt (mandatory): test/** spies on env.DB.prepare() by design (mirrors
// worker-undangan's real gate-ordering.test.ts, doc 12 §5.5). Must not trip R4.
import { describe, expect, it, vi } from "vitest";

describe("gate ordering", () => {
  it("spies on env.DB.prepare()", () => {
    const env = { DB: { prepare: vi.fn() } };
    env.DB.prepare("select 1");
    expect(env.DB.prepare).toHaveBeenCalled();
  });
});
