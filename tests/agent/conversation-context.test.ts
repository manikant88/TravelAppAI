import { describe, expect, it } from "vitest";
import { contextualizedMessage } from "@/agent/conversation-routing";

describe("committed conversation context", () => {
  it("combines a day qualifier with the latest actionable user request", () => {
    expect(contextualizedMessage("for day 2", [
      { role: "user", text: "make this cheaper" },
      { role: "assistant", text: "Please include its day or exact card name." },
    ])).toBe("make this cheaper for day 2");
  });

  it("does not rewrite a complete new request", () => {
    expect(contextualizedMessage("What's the weather like in Goa?", [
      { role: "user", text: "make this cheaper" },
    ])).toBe("What's the weather like in Goa?");
  });
});
