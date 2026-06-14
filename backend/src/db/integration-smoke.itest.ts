import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "./prisma.js";

/** Smoke test: confirma que el harness (Postgres real + schema aplicado) funciona. */
describe("integración: Postgres real", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("crea y lee un Student contra la base real", async () => {
    const created = await prisma.student.create({
      data: { firstName: "Test", lastName: "Integración", username: `it_${Date.now()}` },
    });
    const found = await prisma.student.findUnique({ where: { id: created.id } });
    expect(found?.firstName).toBe("Test");
    await prisma.student.delete({ where: { id: created.id } });
  });
});
