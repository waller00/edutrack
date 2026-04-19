import { describe, it, expect } from "vitest";
import {
  extractNationalIdDocumentExpiresAtFromText,
  parseUruguayanDniDateFragmentToIso,
} from "./dni-document-expiry.js";

describe("dni-document-expiry", () => {
  it("parseUruguayanDniDateFragmentToIso", () => {
    expect(parseUruguayanDniDateFragmentToIso("15/03/2030")).toBe("2030-03-15");
    expect(parseUruguayanDniDateFragmentToIso("bad")).toBe("");
  });

  it("extractNationalIdDocumentExpiresAtFromText reconoce Vencimiento / Validade", () => {
    const text = "Algun texto Vencimiento / Validade 20/12/2028 fin";
    expect(extractNationalIdDocumentExpiresAtFromText(text)).toBe("2028-12-20");
  });

  it("extractNationalIdDocumentExpiresAtFromText reconoce solo Vencimiento", () => {
    expect(extractNationalIdDocumentExpiresAtFromText("Vencimiento: 01-05-2027")).toBe("2027-05-01");
  });

  it("extractNationalIdDocumentExpiresAtFromText tolera VTO o Vencim/Validad con OCR", () => {
    expect(extractNationalIdDocumentExpiresAtFromText("VTO 15/08/2032")).toBe("2032-08-15");
    expect(extractNationalIdDocumentExpiresAtFromText("Vencimient0 / Validade 20/12/2028")).toBe("2028-12-20");
  });
});
