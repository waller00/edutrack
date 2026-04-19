import { describe, it, expect } from "vitest";
import {
  evaluateBirthdatePlausibilityForOcrBypass,
  isPlausiblePersonNamePart,
  surnameTokensMatchForVerification,
} from "./dni-verify-plausibility.js";

describe("dni-verify-plausibility", () => {
  it("isPlausiblePersonNamePart", () => {
    expect(isPlausiblePersonNamePart("Ana")).toBe(true);
    expect(isPlausiblePersonNamePart("  ")).toBe(false);
    expect(isPlausiblePersonNamePart("123")).toBe(false);
  });

  it("evaluateBirthdatePlausibilityForOcrBypass rechaza año absurdo", () => {
    expect(evaluateBirthdatePlausibilityForOcrBypass("1823-05-29").ok).toBe(false);
  });

  it("evaluateBirthdatePlausibilityForOcrBypass acepta fecha adulta típica", () => {
    expect(evaluateBirthdatePlausibilityForOcrBypass("1990-06-15").ok).toBe(true);
  });

  it("surnameTokensMatchForVerification rechaza prefijos incompletos e iniciales", () => {
    expect(surnameTokensMatchForVerification("P", "PEIRAN")).toBe(false);
    expect(surnameTokensMatchForVerification("Pei", "PEIRAN")).toBe(false);
    expect(surnameTokensMatchForVerification("Peira", "PEIRAN")).toBe(true);
    expect(surnameTokensMatchForVerification("Marrero", "MARRERO")).toBe(true);
    expect(surnameTokensMatchForVerification("MARRERO", "MARRERO")).toBe(true);
    expect(surnameTokensMatchForVerification("PEIRAM", "PEIRAN")).toBe(true);
  });
});
