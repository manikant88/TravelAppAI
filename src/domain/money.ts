import type { Money } from "@/domain/model";

export function inr(amount: number): Money {
  if (!Number.isInteger(amount)) throw new Error("P0 money amounts must be integer INR values");
  return { amount, currency: "INR" };
}

export function addMoney(values: Money[]): Money {
  return inr(
    values.reduce((total, value) => {
      if (value.currency !== "INR") throw new Error("P0 supports INR only");
      return total + value.amount;
    }, 0),
  );
}

export function multiplyMoney(value: Money, multiplier: number): Money {
  if (!Number.isInteger(multiplier) || multiplier < 0) {
    throw new Error("Money multipliers must be non-negative integers");
  }
  return inr(value.amount * multiplier);
}

export function subtractMoney(left: Money, right: Money): Money {
  if (left.currency !== right.currency) throw new Error("Currency mismatch");
  return inr(left.amount - right.amount);
}
