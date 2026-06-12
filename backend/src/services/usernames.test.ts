import { describe, it, expect } from "vitest";
import { fitUsername, generateUniqueUsername, usernamePart } from "./usernames.js";

function takenSet(...taken: string[]) {
  const set = new Set(taken);
  return async (candidate: string) => set.has(candidate);
}

describe("usernamePart", () => {
  it("normaliza acentos, mayúsculas y separadores", () => {
    expect(usernamePart("José María")).toEqual(["jose", "maria"]);
    expect(usernamePart("  Gómez-Pérez ")).toEqual(["gomez", "perez"]);
  });

  it("descarta caracteres no alfanuméricos", () => {
    expect(usernamePart("D'Alessandro!")).toEqual(["dalessandro"]);
  });
});

describe("fitUsername", () => {
  it("recorta la base para que base+sufijo no pase de 30", () => {
    const base = "a".repeat(40);
    expect(fitUsername(base, "123")).toHaveLength(30);
    expect(fitUsername(base, "123").endsWith("123")).toBe(true);
  });
});

describe("generateUniqueUsername", () => {
  it("genera nombre.apellido cuando está libre", async () => {
    expect(await generateUniqueUsername("Juan", "García", takenSet())).toBe("juan.garcia");
  });

  it("usa la inicial del segundo apellido ante colisión", async () => {
    expect(
      await generateUniqueUsername("Juan", "García López", takenSet("juan.garcia")),
    ).toBe("juan.garcia.l");
  });

  it("agrega sufijo numérico cuando las variantes están tomadas", async () => {
    expect(
      await generateUniqueUsername("Juan", "García", takenSet("juan.garcia", "juan.garcia1")),
    ).toBe("juan.garcia2");
  });

  it("usa fallbacks cuando faltan nombre o apellido", async () => {
    expect(await generateUniqueUsername("", "García", takenSet())).toBe("usuario.garcia");
    expect(await generateUniqueUsername("Juan", "", takenSet())).toBe("juan.sinapellido");
  });

  it("nunca supera los 30 caracteres", async () => {
    const username = await generateUniqueUsername(
      "Maximiliano Alejandro",
      "Fernández de los Santos",
      takenSet(),
    );
    expect(username.length).toBeLessThanOrEqual(30);
  });
});
