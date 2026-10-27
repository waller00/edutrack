import { describe, expect, it, vi } from "vitest";
import { shareInFlight } from "./in-flight.js";

describe("shareInFlight", () => {
  it("dos pedidos simultáneos con la misma clave calculan una vez", async () => {
    let finish!: (value: string) => void;
    const load = vi.fn(() => new Promise<string>((resolve) => { finish = resolve; }));

    const first = shareInFlight("k", load);
    const second = shareInFlight("k", load);
    finish("listo");

    await expect(Promise.all([first, second])).resolves.toEqual(["listo", "listo"]);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("claves distintas no se mezclan", async () => {
    const load = vi.fn(async () => Math.random());
    await Promise.all([shareInFlight("a", load), shareInFlight("b", load)]);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("terminado el cálculo, el próximo pedido vuelve a calcular: no es un caché", async () => {
    const load = vi.fn(async () => "ok");
    await shareInFlight("k", load);
    await shareInFlight("k", load);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("un fallo no queda guardado", async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error("caída")).mockResolvedValueOnce("ok");
    await expect(shareInFlight("k", load)).rejects.toThrow("caída");
    await expect(shareInFlight("k", load)).resolves.toBe("ok");
    expect(load).toHaveBeenCalledTimes(2);
  });
});
