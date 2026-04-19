import { describe, it, expect } from "vitest";
import { isValidMedicalLeaveCertificateValue } from "./medical-leave-certificate.js";

describe("medical-leave-certificate", () => {
  it("acepta URL https", () => {
    expect(isValidMedicalLeaveCertificateValue("https://drive.google.com/file/d/abc/view")).toBe(true);
  });

  it("acepta data URL imagen o PDF", () => {
    expect(isValidMedicalLeaveCertificateValue("data:image/png;base64,AAAA")).toBe(true);
    expect(isValidMedicalLeaveCertificateValue("data:application/pdf;base64,JVBER")).toBe(true);
  });

  it("rechaza data URL arbitraria o texto plano", () => {
    expect(isValidMedicalLeaveCertificateValue("data:text/html;base64,PHA+")).toBe(false);
    expect(isValidMedicalLeaveCertificateValue("solo texto")).toBe(false);
  });
});
