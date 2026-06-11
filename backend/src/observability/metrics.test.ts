import { describe, expect, it } from "vitest";
import { normalizeHttpRoute } from "./metrics.js";

describe("normalizeHttpRoute", () => {
  it("elimina query strings y normaliza IDs frecuentes", () => {
    expect(normalizeHttpRoute("/courses/123?include=students", 200)).toBe("/courses/:id");
    expect(normalizeHttpRoute("/events/550e8400-e29b-41d4-a716-446655440000", 200)).toBe(
      "/events/:id",
    );
  });

  it("agrupa rutas desconocidas para evitar cardinalidad no controlada", () => {
    expect(normalizeHttpRoute("/cualquier/valor", 404)).toBe("/unmatched");
  });
});
