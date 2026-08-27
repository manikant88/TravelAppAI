import { describe, expect, it } from "vitest";
import { addMoney, inr, multiplyMoney, subtractMoney } from "@/domain/money";

describe("money semantics", () => {
  it("performs deterministic integer INR arithmetic", () => {
    const stay = multiplyMoney(inr(5_000), 4);
    const travel = multiplyMoney(inr(8_000), 2);
    expect(addMoney([stay, travel])).toEqual(inr(36_000));
    expect(subtractMoney(inr(50_000), inr(36_000))).toEqual(inr(14_000));
  });

  it("rejects fractional P0 prices", () => {
    expect(() => inr(99.5)).toThrow("integer INR");
  });
});
